function renderStats(data) {
  const underLimit = data.filter(c => (c.market_cap || 0) <= CONFIG.MAX_MCAP_INR);
  const regime = detectRegime(data);
  const actionable = underLimit.filter(c => c.analysis?.action !== 'AVOID' && c.analysis?.action !== 'HOLD').length;
  const strongBuy = underLimit.filter(c => c.analysis?.action === 'STRONG BUY').length;
  const avgConfidence = underLimit.reduce((a, c) => a + (c.analysis?.confidence || 0), 0) / (underLimit.length || 1);
  const thresholdMeta = learnedThresholds || { buy: 45, strongBuy: 65, sampleSize: 0, source: 'default' };

  const fgColorClass = (val) => val <= 25 ? 'text-green' : val <= 45 ? 'text-accent' : val <= 55 ? 'text-warning' : val <= 75 ? 'text-warning' : 'text-red';
  const regimeColorClass = regime.color === 'var(--success)' ? 'text-green' : regime.color === 'var(--danger)' ? 'text-red' : regime.color === '#3b82f6' ? 'text-accent' : 'text-warning';

  let fgHtml = '';
  if (fearGreedData) {
    const fgVal = parseInt(fearGreedData.value) || 50;
    const fgClass = fearGreedData.value_classification || 'Neutral';
    fgHtml = `<div class="stat-card" role="status" aria-label="Fear and Greed Index"><div class="stat-label">Fear & Greed</div><div class="stat-value ${fgColorClass(fgVal)}">${fgVal}/100</div><div class="stat-sub">${fgClass} · Contrarian: ${fgVal<=25?'Buy Zone':fgVal<=45?'Buy Bias':fgVal<=55?'Neutral':fgVal<=75?'Caution':'Sell Zone'}</div></div>`;
  }

  const trendingSet = new Set(trendingCoins);
  const matchCount = data.filter(c => trendingSet.has(c.id)).length;

  const btcDomColorClass = (val) => val > 55 ? 'text-warning' : val < 42 ? 'text-green' : '';
  let btcDomHtml = '';
  if (globalData) {
    const btcDom = globalData.market_cap_percentage?.btc || 50;
    const ethDom = globalData.market_cap_percentage?.eth || 15;
    btcDomHtml = `<div class="stat-card" role="status" aria-label="BTC Dominance"><div class="stat-label">BTC Dominance</div><div class="stat-value ${btcDomColorClass(btcDom)}">${sf(btcDom,1)}%</div><div class="stat-sub">ETH: ${sf(ethDom,1)}% · ${btcDom>55?'Alt Pressure':btcDom<42?'Alt Season Signal':'Neutral'}</div></div>`;
  }

  let devHtml = '';
  const devCount = Object.keys(devActivityMap).length;
  if (devCount > 0) {
    const activeDevs = Object.values(devActivityMap).filter(d => (d.commit_count_4_weeks || 0) > 10).length;
    devHtml = `<div class="stat-card" role="status" aria-label="Developer Activity"><div class="stat-label">Active Devs</div><div class="stat-value text-accent">${activeDevs}</div><div class="stat-sub">${devCount} analyzed · ${activeDevs} with active repos</div></div>`;
  }

  const gatesColorClass = marketTrendGates.penalty ? 'text-warning' : 'text-green';

  document.getElementById('stats-row').innerHTML = `
    <div class="stat-card" role="status" aria-label="Market Regime"><div class="stat-label">Market Regime <span class="stat-label-note">(algorithmic)</span></div><div class="stat-value stat-value-sm ${regimeColorClass}">${regime.regime}</div><div class="stat-sub">${regime.details}</div></div>
    <div class="stat-card" role="status" aria-label="Actionable signals"><div class="stat-label">Actionable</div><div class="stat-value text-green">${actionable}</div><div class="stat-sub">${strongBuy} Strong Buy · Mcap ≤ ₹${(CONFIG.MAX_MCAP_INR/1e9).toFixed(0)}B</div></div>
    <div class="stat-card" role="status" aria-label="Learned Cutoffs"><div class="stat-label">Learned Cutoffs</div><div class="stat-value stat-value-sm">${thresholdMeta.buy}/${thresholdMeta.strongBuy}</div><div class="stat-sub">${thresholdMeta.source} &middot; ${thresholdMeta.sampleSize} completed forward samples</div></div>
    <div class="stat-card" role="status" aria-label="BTC ETH Gates"><div class="stat-label">BTC/ETH Gates</div><div class="stat-value stat-value-md ${gatesColorClass}">${marketTrendGates.penalty ? '-' + marketTrendGates.penalty + ' score' : 'Clear'}</div><div class="stat-sub">${marketTrendGates.summary}</div></div>
    ${btcDomHtml}
    ${fgHtml}
    ${devHtml}
    <div class="stat-card" role="status" aria-label="Trending Match"><div class="stat-label">Trending Match</div><div class="stat-value text-accent">${matchCount}</div><div class="stat-sub">${trendingCoins.length} trending · ${matchCount} in range</div></div>
    <div class="stat-card" role="status" aria-label="24h Breadth"><div class="stat-label">24h Breadth</div><div class="stat-value ${regime.avg24h > 0 ? 'text-green' : 'text-red'}">${sf(regime.avg24h,2)}%</div><div class="stat-sub">${sf(regime.pctPositive*100,0)}% positive</div></div>
    <div class="stat-card" role="status" aria-label="7d Trend"><div class="stat-label">7d Trend</div><div class="stat-value ${regime.avg7d > 0 ? 'text-green' : 'text-red'}">${sf(regime.avg7d,2)}%</div><div class="stat-sub">Avg RSI: ${sf(regime.avgRSI,0)}</div></div>
  `;
}

let scannerViewState = { visiblePerTier: { strongBuy: 12, buy: 12, hold: 8 }, sortBy: 'score', mcapFilter: 'all', signalFilter: 'all', collapsedTiers: { hold: true } };

function applyFilters() {
  scannerViewState.sortBy = document.getElementById('sort-by').value;
  scannerViewState.mcapFilter = document.getElementById('mcap-filter').value;
  scannerViewState.signalFilter = document.getElementById('signal-filter').value;
  renderScannerCards(marketData);
}

function toggleTier(tier) {
  scannerViewState.collapsedTiers[tier] = !scannerViewState.collapsedTiers[tier];
  const body = document.getElementById(`tier-body-${tier}`);
  const header = document.getElementById(`tier-header-${tier}`);
  if (scannerViewState.collapsedTiers[tier]) {
    body.classList.add('collapsed');
    header.classList.add('collapsed');
  } else {
    body.classList.remove('collapsed');
    header.classList.remove('collapsed');
  }
}

function showMoreTier(tier) {
  scannerViewState.visiblePerTier[tier] += 12;
  renderScannerCards(marketData);
}

function renderScannerCards(data) {
  const s = scannerViewState;
  let eligible = data.filter(c => (c.market_cap || 0) <= CONFIG.MAX_MCAP_INR && c.analysis?.action !== 'AVOID');

  if (s.mcapFilter === 'top50') eligible = eligible.filter(c => c.market_cap_rank <= 50);
  else if (s.mcapFilter === '50-150') eligible = eligible.filter(c => c.market_cap_rank > 50 && c.market_cap_rank <= 150);
  else if (s.mcapFilter === '150-400') eligible = eligible.filter(c => c.market_cap_rank > 150 && c.market_cap_rank <= 400);
  else if (s.mcapFilter === '400plus') eligible = eligible.filter(c => c.market_cap_rank > 400 || !c.market_cap_rank);

  if (s.signalFilter === 'strong-buy') eligible = eligible.filter(c => c.analysis.action === 'STRONG BUY');
  else if (s.signalFilter === 'buy') eligible = eligible.filter(c => c.analysis.action === 'STRONG BUY' || c.analysis.action === 'BUY');

  if (s.sortBy === 'score') eligible.sort((a, b) => b.analysis.composite - a.analysis.composite);
  else if (s.sortBy === 'confidence') eligible.sort((a, b) => b.analysis.confidence - a.analysis.confidence);
  else if (s.sortBy === 'price') eligible.sort((a, b) => b.current_price - a.current_price);
  else if (s.sortBy === 'rsi') eligible.sort((a, b) => (a.analysis.rsi || 100) - (b.analysis.rsi || 100));
  else if (s.sortBy === 'marketcap') eligible.sort((a, b) => (a.market_cap_rank || 9999) - (b.market_cap_rank || 9999));
  else if (s.sortBy === 'change24h') eligible.sort((a, b) => b.analysis.d24 - a.analysis.d24);

  document.getElementById('filter-count').textContent = `${eligible.length} results`;

  const tiers = {
    strongBuy: { label: 'Strong Buy Opportunities', icon: '🟢', badgeClass: 'strong-buy', filter: c => c.analysis.action === 'STRONG BUY', key: 'strongBuy' },
    buy: { label: 'Buy Opportunities', icon: '🔵', badgeClass: 'buy', filter: c => c.analysis.action === 'BUY', key: 'buy' },
    hold: { label: 'Hold / Watchlist', icon: '🟡', badgeClass: 'hold', filter: c => c.analysis.action === 'HOLD', key: 'hold' }
  };

  const container = document.getElementById('scanner-tiers');
  container.innerHTML = '';

  if (aiCorrelationWarnings.length > 0) {
    container.innerHTML += aiCorrelationWarnings.map(w =>
      `<div class="corr-warning-banner" role="alert">⚠ ${w.message}</div>`
    ).join('');
  }

  Object.values(tiers).forEach(tier => {
    const tierCoins = eligible.filter(tier.filter);
    const visible = s.visiblePerTier[tier.key];
    const shown = tierCoins.slice(0, visible);
    const remaining = Math.max(0, tierCoins.length - visible);
    const collapsed = s.collapsedTiers[tier.key];

    if (tierCoins.length === 0 && tier.key !== 'hold') return;

    const section = document.createElement('div');
    section.className = 'tier-section';
    section.innerHTML = `
      <div class="tier-header ${collapsed ? 'collapsed' : ''}" id="tier-header-${tier.key}" onclick="toggleTier('${tier.key}')" role="button" tabindex="0" aria-expanded="${!collapsed}" aria-controls="tier-body-${tier.key}" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleTier('${tier.key}')}">
        <span class="tier-icon" aria-hidden="true">▼</span>
        <h3>${tier.icon} ${tier.label}</h3>
        <span class="tier-count">${tierCoins.length} coins</span>
        ${collapsed ? '<span class="tier-showmore">click to expand</span>' : ''}
      </div>
      <div class="tier-body ${collapsed ? 'collapsed' : ''}" id="tier-body-${tier.key}" ${collapsed ? '' : 'style="max-height:9999px;"'} role="region" aria-labelledby="tier-header-${tier.key}">
        <div class="tier-body-inner">
          <div class="card-grid" role="list">${shown.map(coin => renderCoinCard(coin)).join('')}</div>
          ${remaining > 0 ? `<div class="tier-showmore-wrap"><button class="btn btn-sm" onclick="showMoreTier('${tier.key}')" aria-label="Show ${Math.min(12, remaining)} more ${tier.label}">Show ${Math.min(12, remaining)} More (${remaining} remaining)</button></div>` : ''}
        </div>
      </div>
    `;
    container.appendChild(section);
  });
}

/**
 * Renders skeleton loading cards while data is being fetched
 */
function renderSkeletonCards(count = 6) {
  const container = document.getElementById('scanner-tiers');
  let html = '<div class="card-grid" role="list" aria-label="Loading market data">';
  for (let i = 0; i < count; i++) {
    html += `<div class="skeleton-card" role="listitem" aria-hidden="true">
      <div class="skeleton skeleton-line skeleton-line-md"></div>
      <div class="skeleton skeleton-block"></div>
      <div class="skeleton skeleton-line skeleton-line-lg"></div>
      <div class="skeleton skeleton-line skeleton-line-full"></div>
      <div class="skeleton skeleton-line skeleton-line-sm"></div>
      <div class="skeleton skeleton-block"></div>
      <div class="skeleton skeleton-line skeleton-line-md"></div>
    </div>`;
  }
  html += '</div>';
  container.innerHTML = html;
}

function renderCoinCard(coin) {
  const a = coin.analysis;
  const ai = aiInsightsMap[coin.id];
  const rsiVal = (a.rsi !== null && a.rsi !== undefined) ? sf(a.rsi,0) : '—';
  const rsiColor = a.rsi !== null ? (a.rsi < 45 ? 'text-green' : a.rsi > 70 ? 'text-red' : 'text-warning') : 'text-muted';
  const macdSignal = a.macd ? (a.macd.crossover === 'bullish' ? 'Bullish ▲' : a.macd.crossover === 'bearish' ? 'Bearish ▼' : a.macd.trend === 'up' ? 'Turning ▲' : 'Turning ▼') : '—';
  const macdColor = a.macd ? (a.macd.crossover === 'bullish' || a.macd.trend === 'up' ? 'text-green' : 'text-red') : 'text-muted';
  const corrVal = (a.btcCorr !== null && a.btcCorr !== undefined) ? sf(a.btcCorr,2) : '—';
  const absCorr = a.btcCorr !== null ? Math.abs(a.btcCorr) : null;
  const corrClass = absCorr !== null ? (absCorr > 0.7 ? 'corr-high' : absCorr > 0.4 ? 'corr-mid' : 'corr-low') : '';
  const confColorClass = a.confidence >= 70 ? 'text-green' : a.confidence >= 50 ? 'text-warning' : 'text-red';
  const change1h = a.p1h;
  const isTrending = trendingCoins.includes(coin.id);
  const trendingBadge = isTrending ? '<span class="badge badge-trending badge-ml" title="Trending on CoinGecko">🔥 Trending</span>' : '';
  const ns = a.ns;
  const newsInsightTip = ns?.insight ? `\n💡 ${ns.insight}` : '';
  const newsBadge = ns && ns.mentionCount > 0 ? `<span class="badge badge-news badge-ml" title="${ns.mentionCount} mentions · Score: ${ns.newsScore}/10 · ${ns.isLLM ? 'LLM-classified' : 'mention-based'}${newsInsightTip}\n${(ns.headlines||[]).join('\n')}">📰 ${ns.newsScore>0?'+':''}${ns.newsScore}</span>` : '';
  const athDist = a.athDist;
  const athLabel = athDist != null ? (athDist > -10 ? 'Near ATH' : athDist <= -80 ? 'Deep Value' : athDist <= -50 ? 'Discounted' : '') : '';
  const dev = a.dev;
  const devLabel = dev ? (dev.commit_count_4_weeks > 20 ? '🛠 Active Dev' : dev.commit_count_4_weeks > 5 ? '🛠 Building' : '') : '';

  const risk = a.risk || {};
  const riskClass = risk.doNotTrade ? 'risk-warning' : 'risk-ok';
  const cluster = a.correlationCluster;

  const compositeColorClass = a.badgeClass === 'strong-buy' ? 'text-green' : a.badgeClass === 'buy' ? 'text-accent' : a.badgeClass === 'hold' ? 'text-warning' : 'text-red';
  const pctClass = (val) => val != null ? (val >= 0 ? 'text-green' : 'text-red') : 'text-muted';
  const rsiBarClass = a.rsi !== null ? (a.rsi < 45 ? 'text-green' : a.rsi > 70 ? 'text-red' : 'text-warning') : '';
  const rsiBarBg = a.rsi !== null ? (a.rsi < 45 ? 'var(--success)' : a.rsi > 70 ? 'var(--danger)' : 'var(--warning)') : 'var(--warning)';

  // AI enrichment loading indicator
  const aiLoadingHtml = (!ai && (a.action === 'STRONG BUY' || a.action === 'BUY') && AI_CONFIG.key) 
    ? '<div class="ai-enriching-indicator" aria-live="polite"><span class="spinner-sm" aria-hidden="true"></span> AI analysis in progress…</div>' 
    : '';

  return `<div class="coin-card" role="listitem" aria-label="${coin.name} - ${a.action} - Score ${a.composite}">
    <div class="card-header">
      <div class="coin-name">${coin.name} <span class="coin-symbol">${coin.symbol.toUpperCase()}</span></div>
      <span class="badge ${a.badgeClass}" role="status" aria-label="Signal: ${a.action}">${a.action}</span>${trendingBadge}${newsBadge}
    </div>
    <div class="metrics-grid-3">
      <div class="metric"><span class="metric-label">Composite</span><span class="metric-val ${compositeColorClass}">${a.composite}/100${a.aiDisagreement?.level === 'downgrade' || a.aiDisagreement?.level === 'avoid' ? `<span class="ai-rank-pill">AI ${a.aiDisagreement.level}</span>` : ''}</span></div>
      <div class="metric"><span class="metric-label">Confidence</span><span class="metric-val ${confColorClass}">${a.confidence}%</span></div>
      <div class="metric"><span class="metric-label">Price (₹)</span><span class="metric-val">${formatINR(coin.current_price)}</span></div>
    </div>
    <div class="metrics-grid-3">
      <div class="metric"><span class="metric-label">ATH Distance</span><span class="metric-val ${athDist>-20?'text-warning':'text-green'}">${athDist!=null?sf(athDist,0)+'%':'—'}</span></div>
      <div class="metric"><span class="metric-label">Market Rank</span><span class="metric-val">#${coin.market_cap_rank||'N/A'}</span></div>
      <div class="metric"><span class="metric-label">Dev Activity</span><span class="metric-val ${dev&&dev.commit_count_4_weeks>10?'text-green':'text-muted'}">${dev?dev.commit_count_4_weeks+' commits':'—'}</span></div>
    </div>
    <div class="indicator-row" aria-label="Price changes across timeframes">
      <span class="tf-label">Timeframe</span>
      <span class="${pctClass(change1h)}">1h: ${formatPct(change1h)}</span>
      <span class="tf-value ${pctClass(a.d24)}">24h: ${formatPct(a.d24)}</span>
      <span class="tf-value ${pctClass(a.d7)}">7d: ${formatPct(a.d7)}</span>
      <span class="tf-value ${pctClass(a.d30)}">30d: ${formatPct(a.d30)}</span>
    </div>
    <div class="indicator-row" aria-label="RSI indicator: ${rsiVal}">
      <span class="tooltip" data-tip="Daily RSI — hourly sparkline resampled to daily closes" tabindex="0">RSI</span>
      <span class="${rsiColor} rsi-value">${rsiVal}</span>
      <span class="rsi-bar-wrap">
        <div class="confidence-bar" role="progressbar" aria-valuenow="${a.rsi!==null?Math.round(a.rsi):50}" aria-valuemin="0" aria-valuemax="100"><div class="confidence-fill" style="width:${a.rsi!==null?Math.min(100,Math.max(0,a.rsi)):50}%;background:${rsiBarBg}"></div></div>
      </span>
    </div>
    <div class="indicator-row" aria-label="MACD indicator: ${macdSignal}">
      <span class="tooltip" data-tip="Hourly MACD (3,7,3) — 168 hourly candles for short-term signals" tabindex="0">MACD</span>
      <span class="${macdColor} macd-value">${macdSignal}</span>
    </div>
    ${renderHorizonSignals(a)}
    ${renderMTFGrid(a)}
    ${renderTechnicalQuality(a)}
    <div class="indicator-row" aria-label="BTC Correlation: ${corrVal}">
      <span class="tooltip" data-tip="7-day Pearson correlation on hourly returns (not raw prices)" tabindex="0">BTC Corr</span>
      <span class="corr-badge ${corrClass} corr-value">${corrVal}</span>
      <span class="vol-mcap-label">Vol/Mcap: ${sf(a.volRatio*100,1)}%</span>
    </div>
    ${cluster && !cluster.isLeader ? `<div class="cluster-note" role="note">Cluster duplicate: prefer ${marketData.find(c => c.id === cluster.leader)?.symbol?.toUpperCase() || 'leader'} unless you need this specific exposure.</div>` : ''}
    <div class="risk-panel ${riskClass}" aria-label="Risk plan">
      <div class="risk-title">Risk Plan <span>${risk.realizedVolatility != null ? 'Vol ' + sf(risk.realizedVolatility,1) + '%' : 'Vol N/A'}</span></div>
      <div class="risk-grid">
        <div><span>Max Size</span><strong>${risk.maxPositionPct != null ? sf(risk.maxPositionPct,2) + '% equity' : '--'}</strong></div>
        <div><span>Invalidation</span><strong>${risk.invalidation ? formatINR(risk.invalidation) : '--'}</strong></div>
        <div><span>Stop</span><strong>${risk.stopLoss ? formatINR(risk.stopLoss) + ' (' + sf(risk.stopPct,1) + '%)' : '--'}</strong></div>
        <div><span>Targets</span><strong>${risk.takeProfit1 ? formatINR(risk.takeProfit1) + ' / ' + formatINR(risk.takeProfit2) : '--'}</strong></div>
        <div><span>R/R</span><strong>${risk.riskReward ? sf(risk.riskReward,2) + ':1' : '--'}</strong></div>
        <div><span>Drawdown</span><strong>${risk.recentDrawdown != null ? sf(risk.recentDrawdown,1) + '%' : '--'}</strong></div>
      </div>
      ${risk.doNotTrade ? `<div class="do-not-trade" role="alert">Do not trade: ${risk.doNotTrade}</div>` : ''}
    </div>
    <div class="score-bars" aria-label="Sub-score breakdown">
      <span class="score-bars-label">Scores</span>
      <span class="score-bar score-bar-momentum" style="width:${a.momentumScore}px;" title="Momentum: ${a.momentumScore}/100"></span>
      <span class="score-bar score-bar-volume" style="width:${a.volumeScore}px;" title="Volume: ${a.volumeScore}/100"></span>
      <span class="score-bar score-bar-rsi" style="width:${a.rsiScore}px;" title="RSI: ${a.rsiScore}/100"></span>
      <span class="score-bar score-bar-macd" style="width:${a.macdScore}px;" title="MACD: ${a.macdScore}/100"></span>
      <span class="score-bar score-bar-corr" style="width:${a.corrScore}px;" title="Corr: ${a.corrScore}/100"></span>
      <span class="score-bar score-bar-sentiment" style="width:${a.sentimentScore}px;" title="F&G: ${a.sentimentScore}/100"></span>
      <span class="score-bar score-bar-news" style="width:${a.newsScore}px;" title="News: ${a.newsScore}/100"></span>
      <span class="score-bar score-bar-ath" style="width:${a.athScore}px;" title="ATH: ${a.athScore}/100${athLabel?' ('+athLabel+')':''}"></span>
      <span class="score-bar score-bar-btcdom" style="width:${a.btcDomScore}px;" title="BTC.D: ${a.btcDomScore}/100"></span>
      <span class="score-bar score-bar-dev" style="width:${a.devScore}px;" title="Dev: ${a.devScore}/100${devLabel?' ('+devLabel+')':''}"></span>
    </div>
    <div class="score-bars-legend ${ai ? 'score-bars-legend-ai' : ''}">Mom · Vol · RSI · MACD · Corr · Sent · News · ATH · BTC.D · Dev</div>
    ${aiLoadingHtml}
    ${renderAIReview(ai, a, ns)}
    ${renderDataCompleteness(coin)}
    <div class="card-actions">
      <button class="btn btn-primary btn-sm" onclick="openModal('quick-add-modal','${coin.id}','${coin.symbol}',${coin.current_price})" aria-label="Add ${coin.symbol.toUpperCase()} to portfolio">Quick Add</button>
      <button class="btn btn-sm" onclick="openPaperTradeFromCard('${coin.id}','${coin.symbol}',${coin.current_price})" aria-label="Paper trade ${coin.symbol.toUpperCase()}" title="Paper Trade">📝</button>
      <button class="btn btn-ai btn-sm" onclick="triggerDeepDive('${coin.id}')" aria-label="Get AI report for ${coin.symbol.toUpperCase()}">AI Report</button>
      <button class="btn btn-alert btn-sm ${hasActiveAlert(coin.id)?'active':''}" onclick="openAlertModal('${coin.id}','${coin.name}',${coin.current_price})" title="Set Price Alert" aria-label="Set price alert for ${coin.name}">🔔</button>
    </div>
  </div>`;
}

function mtfRsiClass(v) {
  if (v === null) return 'mtf-na';
  return v < 40 ? 'mtf-bull' : v > 65 ? 'mtf-bear' : 'mtf-neutral';
}

function renderHorizonSignals(a) {
  const h = a.horizonSignals;
  if (!h) return '';
  return `<div class="horizon-grid">
    ${['scalp','swing','position'].map(k => {
      const x = h[k];
      return `<div class="horizon-cell ${x.cls}">
        <span>${x.label}</span>
        <strong>${x.action}</strong>
        <em>${x.score}/100</em>
      </div>`;
    }).join('')}
  </div>`;
}

function renderTechnicalQuality(a) {
  const sr = a.supportResistance;
  const bb = a.bollinger;
  const adx = a.adx;
  const vol = a.volumeConfirmation;
  const gate = a.marketGates;
  return `<div class="tech-quality-grid">
    <div><span>ATR</span><strong>${a.atr?.atrPct != null ? sf(a.atr.atrPct,1) + '%' : '--'}</strong></div>
    <div><span>ADX</span><strong>${adx ? sf(adx.adx,0) + ' ' + adx.trend : '--'}</strong></div>
    <div><span>BB Width</span><strong>${bb ? sf(bb.bandwidth,1) + '%' : '--'}</strong></div>
    <div><span>Vol Confirm</span><strong>${vol?.ratio ? sf(vol.ratio,2) + 'x' : '--'}</strong></div>
    <div><span>Resistance</span><strong>${sr?.distanceToResistancePct != null ? sf(sr.distanceToResistancePct,1) + '% away' : '--'}</strong></div>
    <div><span>BTC/ETH Gates</span><strong>${gate?.penalty ? '-' + gate.penalty + ' score' : 'clear'}</strong></div>
  </div>`;
}

function renderAIReview(ai, a, ns) {
  if (!ai) return '';
  const conflicts = [
    ...(ai.signal_conflicts || []),
    ...(a.aiDisagreement?.deterministicConflicts || []),
  ].slice(0, 4);
  const flagLabels = Object.entries(ai.flags || {})
    .filter(([, v]) => v)
    .map(([k]) => k.replace(/_/g, ' '));
  const level = a.aiDisagreement?.level || ai.disagreement_level || 'watch';
  return `<div class="ai-insight-section ai-review-${level}">
    <div class="ai-review-head">
      <span>AI Risk Review</span>
      <strong>${ai.trade_setup_quality || 'mixed'} setup</strong>
    </div>
    ${ai.bull_case ? `<div class="ai-why"><strong>Bull case:</strong> ${ai.bull_case}</div>` : ''}
    ${ai.bear_case ? `<div class="ai-risk"><strong>Bear case:</strong> ${ai.bear_case}</div>` : ''}
    ${conflicts.length ? `<div class="ai-conflicts"><strong>Conflicts:</strong> ${conflicts.join(' | ')}</div>` : ''}
    ${ai.missing_data?.length ? `<div class="ai-missing"><strong>Missing data:</strong> ${ai.missing_data.join(', ')}</div>` : ''}
    ${flagLabels.length ? `<div class="ai-flags">${flagLabels.map(f => `<span>${f}</span>`).join('')}</div>` : ''}
    ${ai.avoid_reason ? `<div class="do-not-trade">AI avoid reason: ${ai.avoid_reason}</div>` : ''}
    ${ns?.insight ? `<div class="ai-news-insight">News: ${ns.insight}</div>` : ''}
  </div>`;
}

function mtfMacdClass(m) {
  if (!m) return 'mtf-na';
  if (m.crossover === 'bullish' || m.trend === 'up') return 'mtf-bull';
  return 'mtf-bear';
}
function mtfMacdLabel(m) {
  if (!m) return '—';
  if (m.crossover === 'bullish') return '▲ Bull X';
  if (m.crossover === 'bearish') return '▼ Bear X';
  return m.trend === 'up' ? '▲ Up' : '▼ Down';
}

function renderMTFGrid(a) {
  const r1h = a.rsi_1h, r4h = a.rsi_4h, r1d = a.rsi_1d;
  const m1h = a.macd_1h, m4h = a.macd_4h, m1d = a.macd_1d;

  if (r1h === null && r4h === null && r1d === null && !m1h && !m4h && !m1d) return '';

  return `<div class="mtf-grid">
    <div class="mtf-cell mtf-header"></div>
    <div class="mtf-cell mtf-header">1H</div>
    <div class="mtf-cell mtf-header">4H</div>
    <div class="mtf-cell mtf-header">1D</div>
    <div class="mtf-cell mtf-label">RSI</div>
    <div class="mtf-cell ${mtfRsiClass(r1h)}">${r1h!==null?sf(r1h,0):'—'}</div>
    <div class="mtf-cell ${mtfRsiClass(r4h)}">${r4h!==null?sf(r4h,0):'—'}</div>
    <div class="mtf-cell ${mtfRsiClass(r1d)}">${r1d!==null?sf(r1d,0):'—'}</div>
    <div class="mtf-cell mtf-label">MACD</div>
    <div class="mtf-cell ${mtfMacdClass(m1h)}">${mtfMacdLabel(m1h)}</div>
    <div class="mtf-cell ${mtfMacdClass(m4h)}">${mtfMacdLabel(m4h)}</div>
    <div class="mtf-cell ${mtfMacdClass(m1d)}">${mtfMacdLabel(m1d)}</div>
  </div>`;
}

/**
 * Renders a data completeness indicator for a coin card.
 * Shows which data fields are available vs missing.
 */
function renderDataCompleteness(coin) {
  if (typeof identifyMissingFields !== 'function') return '';
  
  const missing = identifyMissingFields(coin);
  if (missing.length === 0) return ''; // Fully complete, no need to show anything
  
  const fieldLabels = {
    'ath': 'ATH',
    '30d_change': '30d',
    '1h_change': '1h',
    'rank': 'Rank',
    'dev_activity': 'Dev',
    'sparkline': 'Sparkline',
    'ohlcv_1h': '1H Candles',
    'ohlcv_4h': '4H Candles',
  };
  
  const totalFields = 8;
  const available = totalFields - missing.length;
  const pct = Math.round((available / totalFields) * 100);
  const colorClass = pct >= 80 ? 'text-green' : pct >= 60 ? 'text-warning' : 'text-red';
  
  const missingLabels = missing.map(f => fieldLabels[f] || f).join(', ');
  
  return `<div class="data-completeness" aria-label="Data completeness: ${pct}%" title="Missing: ${missingLabels}">
    <span class="data-completeness-label">Data: <strong class="${colorClass}">${pct}%</strong></span>
    <span class="data-completeness-missing">Missing: ${missingLabels}</span>
  </div>`;
}
