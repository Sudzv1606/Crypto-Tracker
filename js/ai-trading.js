// ============ AI Trading Intelligence ============
// High-impact AI enhancements for the auto-trading system:
// 1. Pre-trade confirmation
// 2. Exit timing advisor
// 3. Enhanced regime detection
// 4. Weight optimization
// 5. News impact scoring

// Throttle AI calls to avoid excessive API usage
let lastAITradeConfirmTime = 0;
let lastAIExitCheckTime = 0;
let lastAIRegimeTime = 0;
let aiRegimeCache = null;
let aiNewsImpactCache = {};
const AI_TRADE_COOLDOWN = 60000;    // 1 min between trade confirmations
const AI_EXIT_COOLDOWN = 300000;    // 5 min between exit checks
const AI_REGIME_COOLDOWN = 600000;  // 10 min between regime analyses

// ============ 1. AI Pre-Trade Confirmation ============

/**
 * Asks AI whether a specific trade should be taken.
 * Returns { approved: boolean, reason: string, confidence: number }
 */
async function aiConfirmTrade(coin) {
  if (!AI_CONFIG.key) return { approved: true, reason: 'No AI key — auto-approved', confidence: 50 };
  
  // Throttle
  if (Date.now() - lastAITradeConfirmTime < AI_TRADE_COOLDOWN) {
    return { approved: true, reason: 'Throttled — auto-approved', confidence: 50 };
  }
  lastAITradeConfirmTime = Date.now();
  
  const a = coin.analysis;
  const ns = newsSentimentMap[coin.id];
  const regime = currentScoringRegime;

  const coinData = `${coin.symbol.toUpperCase()} | Price:₹${sf(coin.current_price,2)} | Score:${a.composite} Conf:${a.confidence}%
RSI:${sf(a.rsi,0)} MACD:${a.macd?.crossover||a.macd?.trend||'N/A'} | 1h:${sf(a.p1h,1)}% 24h:${sf(a.d24,1)}% 7d:${sf(a.d7,1)}%
Vol/Mcap:${sf(a.volRatio*100,1)}% | BTC Corr:${sf(a.btcCorr,2)} | ATH:${sf(a.athDist,0)}%
Volatility:${sf(a.risk?.realizedVolatility,1)}% | Volume:₹${sf(coin.total_volume/10000000,1)}Cr
Regime:${regime?.label||'unknown'} | F&G:${fearGreedData?.value||'?'}/100
${ns ? `News: ${ns.newsScore}/10, ${ns.mentionCount} mentions. Headlines: ${(ns.headlines||[]).slice(0,3).join(' | ')}` : 'No recent news'}
${a.risk?.doNotTrade ? `WARNING: ${a.risk.doNotTrade}` : ''}`;

  try {
    const resp = await fetch(AI_CONFIG.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${AI_CONFIG.key}`, 'HTTP-Referer': location.href },
      body: JSON.stringify({
        model: AI_CONFIG.model,
        messages: [{
          role: 'system',
          content: 'You are a crypto trade gatekeeper. Given coin data, decide if this trade should be taken RIGHT NOW. Consider: Is the entry timing good? Is there any red flag the quant model might miss (overextended move, suspicious volume, bad news)? Return ONLY valid JSON: {"approved":true/false,"reason":"one sentence","confidence":0-100}'
        }, {
          role: 'user',
          content: `Should I open a LONG position on this coin now?\n\n${coinData}\n\nReturn JSON only.`
        }],
        temperature: 0.1
      })
    });
    
    if (!resp.ok) return { approved: true, reason: 'AI unavailable — auto-approved', confidence: 50 };
    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content || '';
    const parsed = JSON.parse(content.replace(/```json\n?|\n?```/g, '').trim());
    
    console.log(`[AI-Trade] ${coin.symbol.toUpperCase()}: ${parsed.approved ? '✓ APPROVED' : '✗ REJECTED'} — ${parsed.reason}`);
    return {
      approved: !!parsed.approved,
      reason: parsed.reason || '',
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 50
    };
  } catch (e) {
    console.warn('[AI-Trade] Confirmation failed:', e.message);
    return { approved: true, reason: 'AI error — auto-approved', confidence: 50 };
  }
}

// ============ 2. AI Exit Timing Advisor ============

/**
 * For positions in profit, asks AI whether to hold or take profit.
 * Called periodically for open positions that are between entry and TP.
 */
async function aiExitAdvisor(positions) {
  if (!AI_CONFIG.key || positions.length === 0) return {};
  if (Date.now() - lastAIExitCheckTime < AI_EXIT_COOLDOWN) return {};
  lastAIExitCheckTime = Date.now();
  
  // Only check positions that are in profit but haven't hit TP2
  const profitablePositions = positions.filter(pos => {
    const coin = marketData.find(c => c.id === pos.coinId || c.symbol.toLowerCase() === pos.symbol.toLowerCase());
    if (!coin) return false;
    const pnl = ((coin.current_price - pos.entryPrice) / pos.entryPrice) * 100;
    return pnl > 2 && coin.current_price < pos.takeProfit2; // In profit but not at TP2
  });
  
  if (profitablePositions.length === 0) return {};
  
  const positionSummaries = profitablePositions.map(pos => {
    const coin = marketData.find(c => c.id === pos.coinId || c.symbol.toLowerCase() === pos.symbol.toLowerCase());
    const price = coin?.current_price || pos.entryPrice;
    const pnl = ((price - pos.entryPrice) / pos.entryPrice) * 100;
    const a = coin?.analysis || {};
    const holdHours = ((Date.now() - pos.entryTime) / 3600000);
    return `${pos.symbol} | Entry:₹${sf(pos.entryPrice,2)} Now:₹${sf(price,2)} P&L:+${sf(pnl,1)}% | Held:${sf(holdHours,1)}h | RSI:${sf(a.rsi,0)} MACD:${a.macd?.trend||'?'} | TP1:₹${sf(pos.takeProfit1,2)} TP2:₹${sf(pos.takeProfit2,2)} | Stop:₹${sf(pos.stopLoss,2)}`;
  }).join('\n');
  
  try {
    const resp = await fetch(AI_CONFIG.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${AI_CONFIG.key}`, 'HTTP-Referer': location.href },
      body: JSON.stringify({
        model: AI_CONFIG.model,
        messages: [{
          role: 'system',
          content: 'You are a trade exit advisor. For each open position in profit, decide: HOLD (momentum still strong), TIGHTEN (move stop closer), or EXIT (take profit now). Consider RSI, MACD trend, and how long the position has been held. Return ONLY valid JSON mapping each symbol to {"action":"HOLD"|"TIGHTEN"|"EXIT","reason":"one sentence"}'
        }, {
          role: 'user',
          content: `Market regime: ${currentScoringRegime?.label||'unknown'} | F&G: ${fearGreedData?.value||'?'}/100\n\nOpen positions in profit:\n${positionSummaries}\n\nReturn JSON only.`
        }],
        temperature: 0.1
      })
    });
    
    if (!resp.ok) return {};
    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content || '';
    const parsed = JSON.parse(content.replace(/```json\n?|\n?```/g, '').trim());
    
    // Apply AI exit decisions
    const results = {};
    profitablePositions.forEach(pos => {
      const advice = parsed[pos.symbol];
      if (!advice) return;
      results[pos.id] = advice;
      
      if (advice.action === 'EXIT') {
        const coin = marketData.find(c => c.id === pos.coinId || c.symbol.toLowerCase() === pos.symbol.toLowerCase());
        if (coin) {
          console.log(`[AI-Exit] ${pos.symbol}: EXIT recommended — ${advice.reason}`);
          autoClosePosition(pos, coin.current_price, 'ai-exit');
        }
      } else if (advice.action === 'TIGHTEN') {
        // Move stop to lock in 50% of current profit
        const coin = marketData.find(c => c.id === pos.coinId || c.symbol.toLowerCase() === pos.symbol.toLowerCase());
        if (coin) {
          const midPoint = pos.entryPrice + (coin.current_price - pos.entryPrice) * 0.5;
          if (midPoint > pos.stopLoss) {
            pos.stopLoss = midPoint;
            console.log(`[AI-Exit] ${pos.symbol}: TIGHTEN — stop moved to ${formatINR(midPoint)} — ${advice.reason}`);
          }
        }
      } else {
        console.log(`[AI-Exit] ${pos.symbol}: HOLD — ${advice.reason}`);
      }
    });
    
    saveAutoTradeState();
    return results;
  } catch (e) {
    console.warn('[AI-Exit] Advisor failed:', e.message);
    return {};
  }
}

// ============ 3. AI Enhanced Regime Detection ============

/**
 * Uses AI to provide nuanced market regime analysis beyond simple price averages.
 * Considers macro context, narrative, and cross-market signals.
 */
async function aiEnhancedRegime() {
  if (!AI_CONFIG.key) return null;
  if (Date.now() - lastAIRegimeTime < AI_REGIME_COOLDOWN && aiRegimeCache) return aiRegimeCache;
  lastAIRegimeTime = Date.now();
  
  const regime = detectRegime(marketData);
  const fg = fearGreedData;
  const btcDom = globalData?.market_cap_percentage?.btc;
  const gates = marketTrendGates;
  
  // Gather broader context
  const underLimit = marketData.filter(c => (c.market_cap || 0) <= CONFIG.MAX_MCAP_INR);
  const strongBuys = underLimit.filter(c => c.analysis?.action === 'STRONG BUY').length;
  const buys = underLimit.filter(c => c.analysis?.action === 'BUY').length;
  const avoids = underLimit.filter(c => c.analysis?.action === 'AVOID').length;
  
  const contextData = `Algorithmic regime: "${regime.regime}" (avg24h:${sf(regime.avg24h,1)}%, avg7d:${sf(regime.avg7d,1)}%, ${sf(regime.pctPositive*100,0)}% green)
F&G Index: ${fg?.value||'?'}/100 (${fg?.value_classification||'?'})
BTC Dominance: ${sf(btcDom,1)}% | BTC 4H: ${gates?.btc4h?.positive ? 'up' : 'down'} | ETH/BTC: ${gates?.ethBtc?.positive ? 'up' : 'down'}
Total market cap 24h change: ${sf(gates?.totalMcap?.change24h,2)}%
Signal distribution: ${strongBuys} Strong Buy, ${buys} Buy, ${avoids} Avoid out of ${underLimit.length} scanned
Market gates penalty: ${gates?.penalty || 0} points`;

  try {
    const resp = await fetch(AI_CONFIG.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${AI_CONFIG.key}`, 'HTTP-Referer': location.href },
      body: JSON.stringify({
        model: AI_CONFIG.model,
        messages: [{
          role: 'system',
          content: 'You are a crypto market regime analyst. Given market data, provide a nuanced regime classification that goes beyond simple price averages. Consider: Is this accumulation or distribution? Is fear justified or a buying opportunity? Are we in early trend or exhaustion? Return ONLY valid JSON: {"regime":"one of: strong_accumulation|early_bull|mid_bull|euphoria|distribution|early_bear|capitulation|bottoming|range_bound","confidence":0-100,"bias":"long|short|neutral","reasoning":"2 sentences max","shouldTrade":true/false,"adjustScoreBy":number between -10 and +10}'
        }, {
          role: 'user',
          content: contextData
        }],
        temperature: 0.1
      })
    });
    
    if (!resp.ok) return null;
    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content || '';
    const parsed = JSON.parse(content.replace(/```json\n?|\n?```/g, '').trim());
    
    aiRegimeCache = {
      regime: parsed.regime || 'unknown',
      confidence: parsed.confidence || 50,
      bias: parsed.bias || 'neutral',
      reasoning: parsed.reasoning || '',
      shouldTrade: parsed.shouldTrade !== false,
      adjustScoreBy: typeof parsed.adjustScoreBy === 'number' ? Math.max(-10, Math.min(10, parsed.adjustScoreBy)) : 0,
      timestamp: Date.now(),
    };
    
    console.log(`[AI-Regime] ${aiRegimeCache.regime} (${aiRegimeCache.confidence}% conf) | Bias: ${aiRegimeCache.bias} | Score adj: ${aiRegimeCache.adjustScoreBy > 0 ? '+' : ''}${aiRegimeCache.adjustScoreBy} | ${aiRegimeCache.reasoning}`);
    return aiRegimeCache;
  } catch (e) {
    console.warn('[AI-Regime] Failed:', e.message);
    return null;
  }
}

// ============ 4. AI Weight Optimization ============

/**
 * After sufficient trades, asks AI to suggest weight adjustments based on backtest data.
 * Called manually or after every 20 new closed trades.
 */
async function aiOptimizeWeights() {
  if (!AI_CONFIG.key) return null;
  
  const totalClosed = autoTradeState.wins + autoTradeState.losses;
  if (totalClosed < 25) {
    console.log('[AI-Weights] Need 25+ closed trades for optimization');
    return null;
  }
  
  // Build performance summary by factor
  const rules = autoTradeState.learnedRules;
  const factorSummary = Object.entries(rules)
    .filter(([, v]) => (v.wins + v.losses) >= 3)
    .map(([key, data]) => {
      const total = data.wins + data.losses;
      const winRate = (data.wins / total * 100);
      const avgRet = data.totalReturn / total;
      return `${key}: ${total} trades, ${sf(winRate,0)}% win, ${sf(avgRet,2)}% avg return`;
    }).join('\n');
  
  // Current weights
  const currentWeights = currentScoringRegime?.weights || getRegimeWeights('unknown');
  const weightsStr = Object.entries(currentWeights).map(([k,v]) => `${k}:${v}`).join(', ');
  
  // Recent trade outcomes
  const recentTrades = autoTradeState.history.slice(-30).map(t => 
    `${t.symbol} Score:${t.score} RSI:${sf(t.rsi,0)} Conf:${t.confidence}% Regime:${t.regime} → ${t.isWin ? 'WIN' : 'LOSS'} ${sf(t.pnlPct,1)}% (${t.reason})`
  ).join('\n');
  
  try {
    const resp = await fetch(AI_CONFIG.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${AI_CONFIG.key}`, 'HTTP-Referer': location.href },
      body: JSON.stringify({
        model: AI_CONFIG.model,
        messages: [{
          role: 'system',
          content: 'You are a quantitative portfolio optimizer. Given trading performance data and current scoring weights, suggest specific weight adjustments to improve win rate. The weights must sum to 100. Return ONLY valid JSON: {"weights":{"mom":N,"vol":N,"rsi":N,"macd":N,"corr":N,"fg":N,"news":N,"ath":N,"btcDom":N,"dev":N,"setup":N},"reasoning":"2-3 sentences explaining the changes","expectedImprovement":"one sentence"}'
        }, {
          role: 'user',
          content: `Current regime: ${currentScoringRegime?.label||'unknown'}
Current weights: ${weightsStr}
Overall: ${totalClosed} trades, ${sf(autoTradeState.wins/totalClosed*100,1)}% win rate, ${sf(autoTradeState.totalPnl,0)} total P&L

Factor performance:\n${factorSummary}

Recent trades:\n${recentTrades}

Suggest new weights that would have improved results. Weights must sum to 100.`
        }],
        temperature: 0.2
      })
    });
    
    if (!resp.ok) return null;
    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content || '';
    const parsed = JSON.parse(content.replace(/```json\n?|\n?```/g, '').trim());
    
    // Validate weights sum to ~100
    if (parsed.weights) {
      const sum = Object.values(parsed.weights).reduce((a, v) => a + (v || 0), 0);
      if (sum >= 90 && sum <= 110) { // Allow small rounding errors
        console.log(`[AI-Weights] Suggested weights: ${JSON.stringify(parsed.weights)}`);
        console.log(`[AI-Weights] Reasoning: ${parsed.reasoning}`);
        return parsed;
      }
    }
    
    return null;
  } catch (e) {
    console.warn('[AI-Weights] Optimization failed:', e.message);
    return null;
  }
}

/**
 * Applies AI-suggested weights to the scoring system
 */
function applyAIWeights(suggestion) {
  if (!suggestion?.weights) return false;
  
  // Store as a custom regime override
  localStorage.setItem('quant_ai_weights_v1', JSON.stringify({
    weights: suggestion.weights,
    reasoning: suggestion.reasoning,
    appliedAt: Date.now(),
    basedOnTrades: autoTradeState.wins + autoTradeState.losses,
  }));
  
  console.log('[AI-Weights] Applied new weights — will take effect on next scoring cycle');
  return true;
}

/**
 * Gets AI-optimized weights if available, otherwise returns default
 */
function getAIOptimizedWeights(regimeKey) {
  try {
    const saved = JSON.parse(localStorage.getItem('quant_ai_weights_v1') || 'null');
    if (saved && saved.weights && (Date.now() - saved.appliedAt) < 7 * 24 * 3600000) {
      return saved.weights;
    }
  } catch {}
  return null;
}

// ============ 5. AI News Impact Scoring ============

/**
 * Classifies news as "price-moving event" vs "noise".
 * A regulatory ban should override all technical signals.
 * Returns impact level and whether it should block/boost trading.
 */
async function aiClassifyNewsImpact(articles, topCoins) {
  if (!AI_CONFIG.key || !articles?.length) return {};
  
  // Only classify if we have fresh news (last 6 hours)
  const recentArticles = articles.filter(a => {
    const pubTime = a.published_on ? a.published_on * 1000 : 0;
    return (Date.now() - pubTime) < 6 * 3600000;
  });
  
  if (recentArticles.length === 0) return {};
  
  // Get headlines relevant to our top coins
  const coinSymbols = topCoins.map(c => c.symbol.toUpperCase()).join(', ');
  const headlines = recentArticles.slice(0, 20).map(a => a.title).join('\n');
  
  try {
    const resp = await fetch(AI_CONFIG.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${AI_CONFIG.key}`, 'HTTP-Referer': location.href },
      body: JSON.stringify({
        model: AI_CONFIG.model,
        messages: [{
          role: 'system',
          content: 'You are a crypto news impact classifier. For each headline, determine if it is a PRICE-MOVING EVENT (regulatory action, hack, major partnership, ETF decision, protocol failure) or NOISE (opinion pieces, minor updates, recycled news). Return ONLY valid JSON: {"events":[{"headline":"...","impact":"critical|high|low|noise","coins":["SYM"],"direction":"bullish|bearish|neutral","shouldBlock":false}]} Only include items with impact "critical" or "high". If no significant events, return {"events":[]}'
        }, {
          role: 'user',
          content: `Coins we are considering trading: ${coinSymbols}\n\nRecent headlines:\n${headlines}\n\nWhich headlines are price-moving events that should affect our trading decisions?`
        }],
        temperature: 0.1
      })
    });
    
    if (!resp.ok) return {};
    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content || '';
    const parsed = JSON.parse(content.replace(/```json\n?|\n?```/g, '').trim());
    
    const impactMap = {};
    if (parsed.events?.length) {
      parsed.events.forEach(event => {
        if (!event.coins?.length) return;
        event.coins.forEach(sym => {
          const key = sym.toLowerCase();
          if (!impactMap[key]) impactMap[key] = [];
          impactMap[key].push({
            headline: event.headline,
            impact: event.impact,
            direction: event.direction,
            shouldBlock: event.shouldBlock || event.impact === 'critical',
          });
        });
      });
      
      console.log(`[AI-News] Found ${parsed.events.length} significant events affecting: ${Object.keys(impactMap).join(', ')}`);
    }
    
    aiNewsImpactCache = impactMap;
    return impactMap;
  } catch (e) {
    console.warn('[AI-News] Impact classification failed:', e.message);
    return {};
  }
}

/**
 * Checks if a coin has a critical news event that should block trading
 */
function hasBlockingNewsEvent(coin) {
  const sym = coin.symbol.toLowerCase();
  const events = aiNewsImpactCache[sym];
  if (!events?.length) return false;
  
  return events.some(e => e.shouldBlock && e.direction === 'bearish');
}

/**
 * Gets the news impact boost/penalty for a coin
 */
function getNewsImpactAdjustment(coin) {
  const sym = coin.symbol.toLowerCase();
  const events = aiNewsImpactCache[sym];
  if (!events?.length) return 0;
  
  let adjustment = 0;
  events.forEach(e => {
    if (e.impact === 'critical') adjustment += e.direction === 'bullish' ? 8 : -15;
    else if (e.impact === 'high') adjustment += e.direction === 'bullish' ? 4 : -8;
  });
  
  return adjustment;
}

// ============ MEDIUM PRIORITY AI ENHANCEMENTS ============

// ============ 6. AI Trade Journal / Explanation ============

let aiTradeJournal = JSON.parse(localStorage.getItem('quant_ai_journal_v1') || '[]');

/**
 * After a trade closes, asks AI to explain why it won or lost.
 * Stores the explanation with the trade for future reference.
 */
async function aiExplainTrade(trade) {
  if (!AI_CONFIG.key) return null;
  
  const holdHours = trade.holdingHours ? sf(trade.holdingHours, 1) : '?';
  const tradeData = `${trade.symbol} | Entry:₹${sf(trade.entryPrice,2)} Exit:₹${sf(trade.exitPrice,2)} | P&L:${sf(trade.pnlPct,2)}% | ${trade.isWin ? 'WIN' : 'LOSS'}
Held: ${holdHours}h | Exit reason: ${trade.reason}
Entry conditions: Score:${trade.score} Conf:${trade.confidence}% RSI:${sf(trade.rsi,0)} BTC-Corr:${sf(trade.btcCorr,2)} Regime:${trade.regime}
Volatility: ${sf(trade.realizedVol,1)}% | MACD: ${trade.macdTrend || 'N/A'}
AI confirmed: ${trade.aiConfirmReason || 'N/A'}`;

  try {
    const resp = await fetch(AI_CONFIG.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${AI_CONFIG.key}`, 'HTTP-Referer': location.href },
      body: JSON.stringify({
        model: AI_CONFIG.model,
        messages: [{
          role: 'system',
          content: 'You are a trade post-mortem analyst. Given a closed trade, explain in 2 sentences: (1) The key factor that caused this trade to win or lose. (2) What could have been done differently. Be specific and data-driven. Return ONLY valid JSON: {"keyFactor":"...","lesson":"...","category":"one of: good_entry|bad_timing|stopped_too_tight|held_too_long|news_driven|momentum_fade|regime_mismatch"}'
        }, {
          role: 'user',
          content: tradeData
        }],
        temperature: 0.1
      })
    });
    
    if (!resp.ok) return null;
    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content || '';
    const parsed = JSON.parse(content.replace(/```json\n?|\n?```/g, '').trim());
    
    const entry = {
      tradeId: trade.id,
      symbol: trade.symbol,
      pnlPct: trade.pnlPct,
      isWin: trade.isWin,
      keyFactor: parsed.keyFactor || '',
      lesson: parsed.lesson || '',
      category: parsed.category || 'unknown',
      timestamp: Date.now(),
    };
    
    aiTradeJournal.push(entry);
    if (aiTradeJournal.length > 100) aiTradeJournal = aiTradeJournal.slice(-100);
    localStorage.setItem('quant_ai_journal_v1', JSON.stringify(aiTradeJournal));
    
    console.log(`[AI-Journal] ${trade.symbol} ${trade.isWin ? 'WIN' : 'LOSS'}: ${parsed.keyFactor}`);
    return entry;
  } catch (e) {
    console.warn('[AI-Journal] Failed:', e.message);
    return null;
  }
}

// ============ 7. AI Anomaly Detection ============

let aiAnomalies = [];

/**
 * Detects unusual market behavior that the scoring model might miss.
 * Flags coins with abnormal volume/price action that don't match their score.
 */
async function aiDetectAnomalies() {
  if (!AI_CONFIG.key || !marketData.length) return [];
  
  // Find coins with unusual characteristics
  const anomalyCandidates = marketData.filter(c => {
    if (!c.analysis) return false;
    const a = c.analysis;
    // Volume spike but low score
    const volSpike = a.volRatio > 0.15 && a.composite < 50;
    // Huge 24h move but not flagged as buy
    const bigMove = Math.abs(a.d24) > 15 && a.action === 'HOLD';
    // Very low RSI but scored as avoid
    const deepOversold = a.rsi != null && a.rsi < 25 && a.action === 'AVOID';
    // High score but extreme volatility
    const riskyHigh = a.composite > 60 && (a.risk?.realizedVolatility || 0) > 20;
    return volSpike || bigMove || deepOversold || riskyHigh;
  }).slice(0, 8);
  
  if (anomalyCandidates.length === 0) { aiAnomalies = []; return []; }
  
  const anomalyData = anomalyCandidates.map(c => {
    const a = c.analysis;
    return `${c.symbol.toUpperCase()} | Score:${a.composite} Action:${a.action} | 24h:${sf(a.d24,1)}% Vol/Mcap:${sf(a.volRatio*100,1)}% RSI:${sf(a.rsi,0)} | Vol:${sf(a.risk?.realizedVolatility,1)}% | Rank:#${c.market_cap_rank||'?'}`;
  }).join('\n');
  
  try {
    const resp = await fetch(AI_CONFIG.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${AI_CONFIG.key}`, 'HTTP-Referer': location.href },
      body: JSON.stringify({
        model: AI_CONFIG.model,
        messages: [{
          role: 'system',
          content: 'You are a crypto anomaly detector. Given coins with unusual characteristics, identify which ones represent genuine opportunities or risks that a scoring model might miss. Return ONLY valid JSON: {"anomalies":[{"symbol":"...","type":"opportunity|risk|manipulation","alert":"one sentence explanation","urgency":"high|medium|low"}]} Only include genuinely notable items. If nothing stands out, return {"anomalies":[]}'
        }, {
          role: 'user',
          content: `These coins have unusual characteristics that don't match their quant scores:\n\n${anomalyData}\n\nMarket regime: ${currentScoringRegime?.label||'unknown'} | F&G: ${fearGreedData?.value||'?'}/100\n\nWhich are genuinely anomalous?`
        }],
        temperature: 0.1
      })
    });
    
    if (!resp.ok) return [];
    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content || '';
    const parsed = JSON.parse(content.replace(/```json\n?|\n?```/g, '').trim());
    
    aiAnomalies = (parsed.anomalies || []).slice(0, 5);
    if (aiAnomalies.length > 0) {
      console.log(`[AI-Anomaly] Detected ${aiAnomalies.length} anomalies: ${aiAnomalies.map(a => a.symbol).join(', ')}`);
    }
    return aiAnomalies;
  } catch (e) {
    console.warn('[AI-Anomaly] Detection failed:', e.message);
    return [];
  }
}

// ============ 8. AI Portfolio Rebalancing ============

/**
 * Analyzes the portfolio as a whole and suggests rebalancing.
 * Considers sector concentration, correlation, and risk distribution.
 */
async function aiRebalancePortfolio() {
  if (!AI_CONFIG.key || portfolio.length < 2 || !marketData.length) return null;
  
  const holdingData = portfolio.map(item => {
    const mc = marketData.find(c => c.id === (item.id||'').toLowerCase() || c.symbol.toLowerCase() === (item.id||'').toLowerCase());
    if (!mc) return null;
    const cp = mc.current_price;
    const value = item.qty * cp;
    const pnl = ((cp - item.buyPrice) / item.buyPrice * 100);
    const a = mc.analysis || {};
    return {
      symbol: mc.symbol.toUpperCase(),
      value,
      pnlPct: pnl,
      score: a.composite || 0,
      rsi: a.rsi,
      btcCorr: a.btcCorr,
      action: a.action || '?',
    };
  }).filter(Boolean);
  
  if (holdingData.length < 2) return null;
  
  const totalValue = holdingData.reduce((a, h) => a + h.value, 0);
  const holdingSummary = holdingData.map(h => 
    `${h.symbol}: ₹${sf(h.value,0)} (${sf(h.value/totalValue*100,0)}% of portfolio) | P&L:${sf(h.pnlPct,1)}% | Score:${h.score} | RSI:${sf(h.rsi,0)} | BTC-Corr:${sf(h.btcCorr,2)} | Signal:${h.action}`
  ).join('\n');
  
  try {
    const resp = await fetch(AI_CONFIG.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${AI_CONFIG.key}`, 'HTTP-Referer': location.href },
      body: JSON.stringify({
        model: AI_CONFIG.model,
        messages: [{
          role: 'system',
          content: 'You are a crypto portfolio advisor. Analyze the portfolio as a WHOLE — not individual coins. Look for: concentration risk, correlation clustering, sector imbalance, and risk/reward distribution. Return ONLY valid JSON: {"overallHealth":"good|moderate|poor","risks":["risk1","risk2"],"suggestions":["action1","action2"],"diversificationScore":0-100,"summary":"2 sentences"}'
        }, {
          role: 'user',
          content: `Portfolio (${holdingData.length} holdings, total ₹${sf(totalValue,0)}):\n${holdingSummary}\n\nMarket: ${currentScoringRegime?.label||'unknown'} | F&G: ${fearGreedData?.value||'?'}/100\n\nAnalyze portfolio-level risks and suggest rebalancing.`
        }],
        temperature: 0.2
      })
    });
    
    if (!resp.ok) return null;
    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content || '';
    const parsed = JSON.parse(content.replace(/```json\n?|\n?```/g, '').trim());
    
    console.log(`[AI-Rebalance] Health: ${parsed.overallHealth} | Diversification: ${parsed.diversificationScore}/100`);
    return parsed;
  } catch (e) {
    console.warn('[AI-Rebalance] Failed:', e.message);
    return null;
  }
}

// ============ 9. AI Daily Summary ============

let aiDailySummary = null;
let lastDailySummaryDate = '';

/**
 * Generates a concise daily summary of trading activity and market conditions.
 * Called once per day (or on demand).
 */
async function aiGenerateDailySummary() {
  if (!AI_CONFIG.key) return null;
  
  const today = new Date().toISOString().slice(0, 10);
  if (lastDailySummaryDate === today && aiDailySummary) return aiDailySummary;
  
  const state = autoTradeState;
  const todayTrades = state.history.filter(t => 
    t.exitTime && new Date(t.exitTime).toISOString().slice(0, 10) === today
  );
  const openPositions = state.positions;
  const equity = getTotalEquity();
  const totalReturn = ((equity - state.startingCapital) / state.startingCapital) * 100;
  
  // Yesterday's equity for daily change
  const yesterdayLog = state.dailyLog.find(d => {
    const dDate = new Date(d.date);
    const diff = (new Date(today) - dDate) / 86400000;
    return diff === 1;
  });
  const dailyChange = yesterdayLog ? ((equity - yesterdayLog.endEquity) / yesterdayLog.endEquity * 100) : null;
  
  const summaryData = `Date: ${today}
Equity: ₹${sf(equity,0)} (${totalReturn >= 0 ? '+' : ''}${sf(totalReturn,1)}% all-time)${dailyChange != null ? ` | Today: ${dailyChange >= 0 ? '+' : ''}${sf(dailyChange,2)}%` : ''}
Today's trades: ${todayTrades.length} closed (${todayTrades.filter(t=>t.isWin).length}W/${todayTrades.filter(t=>!t.isWin).length}L)
${todayTrades.length > 0 ? todayTrades.map(t => `  ${t.symbol} ${t.isWin?'✓':'✗'} ${sf(t.pnlPct,1)}% (${t.reason})`).join('\n') : '  No trades closed today'}
Open positions: ${openPositions.length}
${openPositions.map(p => {
  const coin = marketData.find(c => c.id === p.coinId);
  const price = coin?.current_price || p.entryPrice;
  const pnl = ((price - p.entryPrice) / p.entryPrice) * 100;
  return `  ${p.symbol} ${pnl >= 0 ? '+' : ''}${sf(pnl,1)}% (held ${sf((Date.now()-p.entryTime)/3600000,0)}h)`;
}).join('\n')}
Market: ${currentScoringRegime?.label||'unknown'} | F&G: ${fearGreedData?.value||'?'}/100
All-time: ${state.wins}W/${state.losses}L (${state.totalTrades > 0 ? sf(state.wins/(state.wins+state.losses)*100,0) : '--'}% win rate)`;

  try {
    const resp = await fetch(AI_CONFIG.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${AI_CONFIG.key}`, 'HTTP-Referer': location.href },
      body: JSON.stringify({
        model: AI_CONFIG.model,
        messages: [{
          role: 'system',
          content: 'You are a trading journal assistant. Generate a brief, friendly daily summary in 3-4 sentences. Mention: key wins/losses, overall portfolio direction, and one actionable insight for tomorrow. Keep it conversational, like a quick morning briefing. Return ONLY valid JSON: {"summary":"...","mood":"positive|neutral|cautious|negative","tomorrowTip":"one sentence"}'
        }, {
          role: 'user',
          content: summaryData
        }],
        temperature: 0.3
      })
    });
    
    if (!resp.ok) return null;
    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content || '';
    const parsed = JSON.parse(content.replace(/```json\n?|\n?```/g, '').trim());
    
    aiDailySummary = { ...parsed, date: today, generatedAt: Date.now() };
    lastDailySummaryDate = today;
    
    console.log(`[AI-Daily] ${parsed.mood}: ${parsed.summary}`);
    return aiDailySummary;
  } catch (e) {
    console.warn('[AI-Daily] Summary failed:', e.message);
    return null;
  }
}

// ============ 10. AI Confidence Calibration ============

/**
 * When indicators conflict, asks AI to assess the real probability of success.
 * Returns a calibrated confidence that weighs conflicting signals intelligently.
 */
async function aiCalibrateConfidence(coin) {
  if (!AI_CONFIG.key || !coin?.analysis) return null;
  
  const a = coin.analysis;
  
  // Only calibrate when there's genuine conflict (confidence < 60 but score > 55)
  if (a.confidence >= 60 || a.composite < 55) return null;
  
  const conflicts = [];
  if (a.rsi != null && a.rsi > 60 && a.d24 > 3) conflicts.push('RSI overbought but momentum strong');
  if (a.macd?.trend === 'down' && a.d7 > 5) conflicts.push('MACD bearish but 7d trend up');
  if (a.btcCorr > 0.7 && a.d24 > 0 && marketTrendGates?.btc4h?.positive === false) conflicts.push('High BTC correlation but BTC trending down');
  if (a.ns?.newsScore < -3 && a.composite > 60) conflicts.push('Negative news but high quant score');
  if (a.volRatio < 0.02 && a.composite > 55) conflicts.push('Low volume but decent score');
  
  if (conflicts.length === 0) return null;
  
  const coinData = `${coin.symbol.toUpperCase()} Score:${a.composite} Conf:${a.confidence}%
RSI:${sf(a.rsi,0)} MACD:${a.macd?.crossover||a.macd?.trend||'?'} | 24h:${sf(a.d24,1)}% 7d:${sf(a.d7,1)}%
BTC Corr:${sf(a.btcCorr,2)} | Vol/Mcap:${sf(a.volRatio*100,1)}%
Conflicts: ${conflicts.join('; ')}`;

  try {
    const resp = await fetch(AI_CONFIG.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${AI_CONFIG.key}`, 'HTTP-Referer': location.href },
      body: JSON.stringify({
        model: AI_CONFIG.model,
        messages: [{
          role: 'system',
          content: 'You are a probability calibrator for crypto trades. Given conflicting indicators, estimate the real probability (0-100) that a long trade on this coin will be profitable in the next 24 hours. Consider which conflicts are more important. Return ONLY valid JSON: {"probability":N,"dominantSignal":"bullish|bearish|unclear","reasoning":"one sentence"}'
        }, {
          role: 'user',
          content: `Market: ${currentScoringRegime?.label||'unknown'} | F&G: ${fearGreedData?.value||'?'}/100\n\n${coinData}\n\nWhat is the real probability this trade works?`
        }],
        temperature: 0.1
      })
    });
    
    if (!resp.ok) return null;
    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content || '';
    const parsed = JSON.parse(content.replace(/```json\n?|\n?```/g, '').trim());
    
    return {
      calibratedConfidence: typeof parsed.probability === 'number' ? Math.max(0, Math.min(100, parsed.probability)) : null,
      dominantSignal: parsed.dominantSignal || 'unclear',
      reasoning: parsed.reasoning || '',
    };
  } catch (e) {
    return null;
  }
}

// ============ Integration: Hook into autoClosePosition for journaling ============

// Store original close function reference and wrap it
const _originalAutoClose = typeof autoClosePosition === 'function' ? autoClosePosition : null;

/**
 * Enhanced close that triggers AI journal entry
 */
function autoCloseWithJournal(pos, exitPrice, reason) {
  // Call original close logic (it's defined in autotrade.js, loaded before this file)
  if (typeof autoClosePosition === 'function') {
    autoClosePosition(pos, exitPrice, reason);
  }
  
  // Trigger async journal entry (non-blocking)
  const trade = autoTradeState.history.find(t => t.id === pos.id);
  if (trade) {
    aiExplainTrade(trade).catch(() => {});
  }
}

// ============ Render: Anomaly alerts on scanner ============

/**
 * Renders anomaly alerts at the top of the scanner view
 */
function renderAnomalyAlerts() {
  if (!aiAnomalies?.length) return '';
  
  return aiAnomalies.map(a => {
    const typeCls = a.type === 'risk' ? 'text-red' : a.type === 'opportunity' ? 'text-green' : 'text-warning';
    const icon = a.type === 'risk' ? '⚠' : a.type === 'opportunity' ? '💡' : '🔍';
    return `<div class="anomaly-alert ${a.urgency === 'high' ? 'anomaly-high' : ''}" role="alert">
      <span class="${typeCls}">${icon} <strong>${a.symbol}</strong></span>
      <span>${a.alert}</span>
    </div>`;
  }).join('');
}

// ============ Render: Daily Summary Widget ============

/**
 * Renders the daily summary in the auto-trade mini widget
 */
function renderDailySummaryHtml() {
  if (!aiDailySummary) return '';
  
  const moodIcon = { positive: '🟢', neutral: '⚪', cautious: '🟡', negative: '🔴' };
  return `<div class="at-mini-daily">
    <span class="at-mini-daily-mood">${moodIcon[aiDailySummary.mood] || '⚪'}</span>
    <span class="at-mini-daily-text">${aiDailySummary.summary}</span>
    ${aiDailySummary.tomorrowTip ? `<span class="at-mini-daily-tip">💡 ${aiDailySummary.tomorrowTip}</span>` : ''}
  </div>`;
}

// ============ Render: Trade Journal in Backtest Tab ============

/**
 * Renders the AI trade journal entries
 */
function renderTradeJournal() {
  if (!aiTradeJournal?.length) return '';
  
  const recent = aiTradeJournal.slice(-10).reverse();
  const rows = recent.map(j => {
    const cls = j.isWin ? 'text-green' : 'text-red';
    return `<tr>
      <td class="tracker-symbol">${j.symbol}</td>
      <td class="${cls}">${sf(j.pnlPct,1)}%</td>
      <td>${j.keyFactor}</td>
      <td>${j.lesson}</td>
      <td><span class="badge">${j.category.replace(/_/g,' ')}</span></td>
    </tr>`;
  }).join('');
  
  return `
    <div class="section-title">📓 AI Trade Journal</div>
    <p class="text-muted" style="font-size:0.78rem;margin-bottom:8px;">AI explains why each trade won or lost — building institutional knowledge over time.</p>
    <table aria-label="AI trade journal"><thead><tr><th>Coin</th><th>P&L</th><th>Key Factor</th><th>Lesson</th><th>Category</th></tr></thead><tbody>${rows}</tbody></table>
  `;
}
