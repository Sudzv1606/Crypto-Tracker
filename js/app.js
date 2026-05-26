// ============ Fetch State Management ============
let fetchInProgress = false;
let fetchAbortController = null;
let lastFetchTime = 0;
let isFirstLoad = true; // Track if this is the very first load
const MIN_FETCH_INTERVAL = 10000; // Minimum 10 seconds between fetches

/**
 * Safely initiates a data fetch with race condition protection.
 * Uses PROGRESSIVE RENDERING: shows data as soon as basic scoring is done,
 * then updates cards in-place when enrichment/AI completes.
 * Previous data stays visible during refresh (no blank screen).
 */
async function initiateWaterfallFetch() {
  const srcEl = document.getElementById('data-source');
  const apiEl = document.getElementById('status-api');
  
  // Prevent duplicate concurrent fetches
  if (fetchInProgress) {
    console.log('[Fetch] Skipping - fetch already in progress');
    return;
  }
  
  // Throttle rapid successive calls
  const timeSinceLastFetch = Date.now() - lastFetchTime;
  if (timeSinceLastFetch < MIN_FETCH_INTERVAL) {
    console.log(`[Fetch] Throttling - only ${Math.round(timeSinceLastFetch / 1000)}s since last fetch`);
    return;
  }
  
  // Abort any previous in-flight request
  if (fetchAbortController) {
    fetchAbortController.abort();
    console.log('[Fetch] Aborted previous fetch');
  }
  
  // Create new AbortController for this fetch
  fetchAbortController = new AbortController();
  fetchInProgress = true;
  lastFetchTime = Date.now();
  
  // Show updating indicator (but DON'T clear existing cards)
  srcEl.textContent = 'Updating…';
  apiEl.className = 'status-dot warn';
  
  // Only show skeleton on very first load when there's no data at all
  if (isFirstLoad && marketData.length === 0 && typeof renderSkeletonCards === 'function') {
    renderSkeletonCards(6);
  }

  try {
    // ============ PHASE 1: Core data fetch (fastest path to rendering) ============
    const [fg, newsArticles] = await Promise.all([fetchFearGreed(), fetchCryptoNews()]);
    if (fetchAbortController?.signal?.aborted) return;

    const rawData = await fetchMarketData();
    if (fetchAbortController?.signal?.aborted) return;
    
    const sourceLabels = { binance: 'Binance', coingecko: 'CoinGecko', coinpaprika: 'CoinPaprika' };
    const sourceLabel = sourceLabels[dataSource] || dataSource;

    // Fetch trending/global in parallel (don't wait with long delays)
    let trending = [], gData = null;
    if (dataSource !== 'coinpaprika' && Date.now() >= cgCooldownUntil) {
      [trending, gData] = await Promise.all([fetchTrending(), fetchGlobalData()]);
    }
    if (fetchAbortController?.signal?.aborted) return;

    fearGreedData = fg;
    trendingCoins = trending;
    globalData = gData;
    newsSentimentMap = await computeNewsSentiment(newsArticles, rawData);
    updateForwardReturns(rawData);
    getLearnedThresholds();
    currentScoringRegime = classifyScoringRegime(rawData);
    marketTrendGates = computeMarketTrendGates(rawData);

    const btcIdx = rawData.findIndex(c => c.id === 'bitcoin' || c.symbol === 'btc');
    if (btcIdx !== -1) {
      btcData = rawData[btcIdx];
      btcData._sparkline_prices = rawData[btcIdx]._sparkline_prices?.length > 0
        ? rawData[btcIdx]._sparkline_prices
        : rawData[btcIdx].sparkline_in_7d?.price || [];
    }

    // Score all coins with available data
    marketData = rawData.map(c => {
      if (!c._sparkline_prices || c._sparkline_prices.length === 0) {
        c._sparkline_prices = c.sparkline_in_7d?.price || [];
      }
      return { ...c, analysis: enhancedScore(c) };
    });

    // Data is ready — no longer first load
    isFirstLoad = false;

    // ============ PHASE 2: IMMEDIATE RENDER (show results NOW) ============
    const regime = detectRegime(marketData);
    srcEl.innerHTML = `${sourceLabel} · <strong style="color:${regime.color}">${regime.regime}</strong> <span class="at-mini-label" style="margin-left:6px;">enriching…</span>`;
    apiEl.className = 'status-dot ok';
    apiEl.textContent = sourceLabel;
    document.getElementById('status-freshness').textContent = DateFormatter.now();

    renderStats(marketData);
    renderScannerCards(marketData);
    renderPortfolio();
    checkAlerts();
    updateAlertsCount();
    checkPaperTradeExits();
    renderAutoTradeMiniWidget();

    // Log signals immediately (don't wait for enrichment)
    marketData.forEach(c => {
      if ((c.analysis.action === 'BUY' || c.analysis.action === 'STRONG BUY') && (c.market_cap || 0) <= CONFIG.MAX_MCAP_INR) logSignal(c);
    });

    console.log('[Fetch] Phase 1 complete — cards rendered');

    // ============ PHASE 3: Background enrichment (updates cards in-place) ============
    if (fetchAbortController?.signal?.aborted) return;
    
    // AI regime detection and news impact (run in parallel with data enrichment)
    const aiTasks = [];
    if (typeof aiEnhancedRegime === 'function') aiTasks.push(aiEnhancedRegime());
    if (typeof aiClassifyNewsImpact === 'function') {
      const topForNews = [...marketData]
        .filter(c => c.analysis?.action === 'STRONG BUY' || c.analysis?.action === 'BUY')
        .slice(0, 20);
      if (topForNews.length > 0 && newsArticles?.length > 0) {
        aiTasks.push(aiClassifyNewsImpact(newsArticles, topForNews));
      }
    }
    
    const initialCandidates = [...marketData]
      .filter(c => (c.market_cap || 0) <= CONFIG.MAX_MCAP_INR && c.analysis.action !== 'AVOID')
      .sort((a, b) => b.analysis.composite - a.analysis.composite)
      .slice(0, 15);

    if (initialCandidates.length > 0 && Date.now() >= cgCooldownUntil) {
      // Short delay to let the UI breathe after initial render
      await new Promise(r => setTimeout(r, 500));
      if (fetchAbortController?.signal?.aborted) return;
      
      // Run data enrichment and AI tasks in parallel
      const [enrichResult] = await Promise.all([
        enrichCandidatesFullData(initialCandidates, 10),
        ...aiTasks,
      ]);
      console.log(`[Pass 2] Enriched ${enrichResult.enrichedCount} coins`);
      
      // Re-score and re-render with enriched data
      marketData.forEach(c => { c.analysis = enhancedScore(c); });
      renderScannerCards(marketData);
      renderStats(marketData);
    } else if (aiTasks.length > 0) {
      // Even if no enrichment needed, still run AI tasks
      await Promise.all(aiTasks);
    }

    // ============ PHASE 4: AI enrichment (slowest, updates cards last) ============
    if (fetchAbortController?.signal?.aborted) return;

    computeCrossCorrelation(marketData);
    await aiEnrichTopCandidates(marketData);
    if (portfolio.length > 0) await aiAnalyzePortfolio();
    
    // Medium-priority AI: anomaly detection + daily summary (non-blocking)
    if (typeof aiDetectAnomalies === 'function') aiDetectAnomalies().catch(() => {});
    if (typeof aiGenerateDailySummary === 'function') aiGenerateDailySummary().catch(() => {});

    // Final re-render with AI data
    renderScannerCards(marketData);
    renderAutoTradeMiniWidget();
    
    // Autonomous trading engine (runs AFTER all AI data is available)
    await autoTradeExecute();
    renderAutoTradeMiniWidget();
    
    // Update status to show we're fully done
    srcEl.innerHTML = `${sourceLabel} · <strong style="color:${regime.color}">${regime.regime}</strong>`;
    
    console.log('[Fetch] Phase 3 complete — fully enriched');
  } catch (e) {
    if (e.name === 'AbortError' || fetchAbortController?.signal?.aborted) {
      console.log('[Fetch] Fetch was cancelled');
      return;
    }
    
    console.error('initiateWaterfallFetch error:', e, e.stack);
    // Don't clear existing data on error — keep showing last successful render
    if (isFirstLoad) {
      srcEl.innerHTML = `<span style="color:var(--danger)">All sources failed</span> · retrying 30s`;
    } else {
      srcEl.innerHTML = `${srcEl.innerHTML} <span style="color:var(--danger);font-size:0.72rem;">(update failed, showing cached)</span>`;
    }
    apiEl.className = 'status-dot bad';
    setTimeout(initiateWaterfallFetch, 30000);
  } finally {
    fetchInProgress = false;
    fetchAbortController = null;
  }
}

/**
 * Force refresh - aborts any in-flight request and starts fresh
 */
function forceRefresh() {
  if (fetchAbortController) {
    fetchAbortController.abort();
  }
  fetchInProgress = false;
  initiateWaterfallFetch();
}

// Init
if ('Notification' in window && Notification.permission === 'default') {
  Notification.requestPermission();
}
updateAlertsCount();
initiateWaterfallFetch();
setInterval(initiateWaterfallFetch, CONFIG.REFRESH_INTERVAL);
