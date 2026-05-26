// ============ Backtest & Performance Analysis Module ============
// Analyzes historical signal performance, portfolio risk, signal freshness,
// and provides weight optimization suggestions.

// ============ Portfolio-Level Risk Manager ============

const RISK_LIMITS = {
  maxPortfolioDrawdown: 15,    // % — stop opening positions if portfolio down this much
  maxDailyLoss: 5,             // % — daily loss cap
  maxCorrelatedExposure: 40,   // % — max % of portfolio in correlated assets (>0.75)
  maxSinglePosition: 8,        // % — max single coin allocation
  maxOpenPositions: 10,        // max simultaneous positions
  cooldownAfterStopHit: 4,     // hours to wait after a stop loss triggers
};

let paperTrades = JSON.parse(localStorage.getItem('quant_paper_trades_v1')) || [];
let riskState = { dailyPnl: 0, dailyReset: 0, lastStopHit: 0, blocked: false, reason: '' };

/**
 * Checks portfolio-level risk limits before allowing a new trade
 */
function checkPortfolioRisk() {
  const now = Date.now();
  
  // Reset daily P&L at midnight
  const today = new Date().setHours(0,0,0,0);
  if (riskState.dailyReset < today) {
    riskState.dailyPnl = 0;
    riskState.dailyReset = today;
  }
  
  const issues = [];
  
  // Check daily loss limit
  if (Math.abs(riskState.dailyPnl) >= RISK_LIMITS.maxDailyLoss) {
    issues.push(`Daily loss limit hit (${sf(riskState.dailyPnl,1)}% today)`);
  }
  
  // Check cooldown after stop loss
  if (riskState.lastStopHit && (now - riskState.lastStopHit) < RISK_LIMITS.cooldownAfterStopHit * 3600000) {
    const hoursLeft = ((riskState.lastStopHit + RISK_LIMITS.cooldownAfterStopHit * 3600000) - now) / 3600000;
    issues.push(`Stop-loss cooldown (${sf(hoursLeft,1)}h remaining)`);
  }
  
  // Check max open positions (paper trades)
  const openPaperTrades = paperTrades.filter(t => t.status === 'open');
  if (openPaperTrades.length >= RISK_LIMITS.maxOpenPositions) {
    issues.push(`Max open positions reached (${openPaperTrades.length}/${RISK_LIMITS.maxOpenPositions})`);
  }
  
  // Check portfolio drawdown
  if (portfolio.length > 0 && marketData.length > 0) {
    let totalCost = 0, totalValue = 0;
    portfolio.forEach(item => {
      const mc = marketData.find(c => c.id === item.id?.toLowerCase() || c.symbol === item.id?.toLowerCase());
      const cp = mc ? mc.current_price : item.buyPrice;
      totalCost += item.qty * item.buyPrice;
      totalValue += item.qty * cp;
    });
    const drawdown = totalCost > 0 ? ((totalValue - totalCost) / totalCost) * 100 : 0;
    if (drawdown <= -RISK_LIMITS.maxPortfolioDrawdown) {
      issues.push(`Portfolio drawdown limit (${sf(drawdown,1)}% vs -${RISK_LIMITS.maxPortfolioDrawdown}% limit)`);
    }
  }
  
  // Check correlated exposure
  if (aiCorrelationWarnings.length > 0 && portfolio.length > 0) {
    const correlatedIds = new Set();
    aiCorrelationWarnings.forEach(w => w.coins.forEach(id => correlatedIds.add(id)));
    const correlatedHoldings = portfolio.filter(p => correlatedIds.has(p.id?.toLowerCase()));
    if (correlatedHoldings.length >= 3) {
      issues.push(`High correlated exposure (${correlatedHoldings.length} correlated holdings)`);
    }
  }
  
  riskState.blocked = issues.length > 0;
  riskState.reason = issues.join(' · ');
  return { allowed: issues.length === 0, issues, riskState };
}

// ============ Signal Freshness Decay ============

/**
 * Applies freshness decay to a signal score based on age.
 * A signal loses strength over time — a 4-hour-old signal is weaker than a fresh one.
 */
function applyFreshnessDecay(score, signalTimestamp) {
  if (!signalTimestamp) return score;
  const ageHours = (Date.now() - signalTimestamp) / 3600000;
  
  // No decay in first hour
  if (ageHours <= 1) return score;
  
  // Linear decay: lose 5% per hour after first hour, floor at 40% of original
  const decayFactor = Math.max(0.4, 1 - (ageHours - 1) * 0.05);
  return Math.round(score * decayFactor);
}

/**
 * Gets the effective score for a signal considering freshness
 */
function getEffectiveScore(signal) {
  if (!signal?.score || !signal?.timestamp) return signal?.score || 0;
  return applyFreshnessDecay(signal.score, signal.timestamp);
}

// ============ Paper Trading ============

/**
 * Opens a paper trade (simulated position)
 */
function openPaperTrade(coinId, symbol, entryPrice, score, confidence, riskPlan) {
  const risk = checkPortfolioRisk();
  if (!risk.allowed) {
    console.warn('[PaperTrade] Blocked:', risk.issues.join(', '));
    return { success: false, reason: risk.reason };
  }
  
  const trade = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2,6),
    coinId,
    symbol: symbol.toUpperCase(),
    entryPrice,
    entryTime: Date.now(),
    score,
    confidence,
    stopLoss: riskPlan?.stopLoss || entryPrice * 0.92,
    takeProfit1: riskPlan?.takeProfit1 || entryPrice * 1.12,
    takeProfit2: riskPlan?.takeProfit2 || entryPrice * 1.25,
    positionSize: riskPlan?.maxPositionPct || 3,
    status: 'open', // open, closed-win, closed-loss, closed-stop, closed-tp
    exitPrice: null,
    exitTime: null,
    pnlPct: null,
    exitReason: null,
  };
  
  paperTrades.push(trade);
  savePaperTrades();
  return { success: true, trade };
}

/**
 * Closes a paper trade
 */
function closePaperTrade(tradeId, exitPrice, reason) {
  const trade = paperTrades.find(t => t.id === tradeId);
  if (!trade || trade.status !== 'open') return false;
  
  trade.exitPrice = exitPrice;
  trade.exitTime = Date.now();
  trade.pnlPct = ((exitPrice - trade.entryPrice) / trade.entryPrice) * 100;
  trade.exitReason = reason || (trade.pnlPct >= 0 ? 'manual-win' : 'manual-loss');
  trade.status = trade.pnlPct >= 0 ? 'closed-win' : 'closed-loss';
  
  // Update daily P&L
  riskState.dailyPnl += trade.pnlPct * (trade.positionSize / 100);
  
  // Track stop loss hits for cooldown
  if (reason === 'stop-loss') {
    riskState.lastStopHit = Date.now();
    trade.status = 'closed-stop';
  }
  
  savePaperTrades();
  return true;
}

/**
 * Auto-checks open paper trades against current prices
 */
function checkPaperTradeExits() {
  if (!marketData.length || !paperTrades.length) return;
  
  const openTrades = paperTrades.filter(t => t.status === 'open');
  openTrades.forEach(trade => {
    const coin = marketData.find(c => c.id === trade.coinId || c.symbol.toLowerCase() === trade.symbol.toLowerCase());
    if (!coin) return;
    
    const price = coin.current_price;
    
    // Check stop loss
    if (price <= trade.stopLoss) {
      closePaperTrade(trade.id, price, 'stop-loss');
      console.log(`[PaperTrade] ${trade.symbol} STOPPED OUT at ${formatINR(price)}`);
    }
    // Check take profit 1
    else if (price >= trade.takeProfit1 && !trade.tp1Hit) {
      trade.tp1Hit = true;
      // Move stop to breakeven
      trade.stopLoss = trade.entryPrice * 1.005;
      savePaperTrades();
      console.log(`[PaperTrade] ${trade.symbol} TP1 hit, stop moved to breakeven`);
    }
    // Check take profit 2
    else if (price >= trade.takeProfit2) {
      closePaperTrade(trade.id, price, 'take-profit');
      trade.status = 'closed-tp';
      savePaperTrades();
      console.log(`[PaperTrade] ${trade.symbol} TP2 hit, closed at ${formatINR(price)}`);
    }
  });
}

function savePaperTrades() {
  paperTrades = paperTrades.slice(-200); // Keep last 200
  localStorage.setItem('quant_paper_trades_v1', JSON.stringify(paperTrades));
}

// ============ Backtest Analysis Engine ============

/**
 * Runs full backtest analysis on historical signal data
 */
function runFullBacktest() {
  const signals = signalLog.filter(s => s.forwardReturns && Object.keys(s.forwardReturns).length > 0);
  
  if (signals.length < 10) {
    document.getElementById('backtest-summary').innerHTML = `
      <div class="stat-card stat-card-full">
        <div class="stat-label">Insufficient Data</div>
        <div class="stat-value text-warning">Need ${10 - signals.length} more signals</div>
        <div class="stat-sub">The system needs at least 10 signals with forward returns to run analysis. Keep scanning — data accumulates automatically.</div>
      </div>`;
    return;
  }
  
  renderBacktestSummary(signals);
  renderScoreRangeAnalysis(signals);
  renderRegimeAnalysis(signals);
  renderFactorAnalysis(signals);
  renderWeightSuggestions(signals);
  renderFreshnessAnalysis(signals);
  renderPaperTradeLog();
  renderRiskManager();
}

/**
 * Summary stats for the backtest
 */
function renderBacktestSummary(signals) {
  const withReturns = signals.filter(s => s.forwardReturns?.['24h'] != null);
  const wins24h = withReturns.filter(s => s.forwardReturns['24h'] > 0);
  const avg24h = withReturns.length ? withReturns.reduce((a,s) => a + s.forwardReturns['24h'], 0) / withReturns.length : 0;
  
  const with7d = signals.filter(s => s.forwardReturns?.['7d'] != null);
  const wins7d = with7d.filter(s => s.forwardReturns['7d'] > 0);
  const avg7d = with7d.length ? with7d.reduce((a,s) => a + s.forwardReturns['7d'], 0) / with7d.length : 0;
  
  const bestSignal = withReturns.sort((a,b) => (b.forwardReturns['24h']||0) - (a.forwardReturns['24h']||0))[0];
  const worstSignal = withReturns.sort((a,b) => (a.forwardReturns['24h']||0) - (b.forwardReturns['24h']||0))[0];
  
  const avgScore = signals.reduce((a,s) => a + s.score, 0) / signals.length;
  const highScoreWinRate = (() => {
    const high = withReturns.filter(s => s.score >= 60);
    return high.length >= 3 ? (high.filter(s => s.forwardReturns['24h'] > 0).length / high.length * 100) : null;
  })();
  
  const risk = checkPortfolioRisk();
  
  document.getElementById('backtest-summary').innerHTML = `
    <div class="stat-card" role="status"><div class="stat-label">Total Signals Analyzed</div><div class="stat-value">${signals.length}</div><div class="stat-sub">${withReturns.length} with 24h returns</div></div>
    <div class="stat-card" role="status"><div class="stat-label">24h Win Rate</div><div class="stat-value ${wins24h.length/withReturns.length >= 0.5 ? 'text-green' : 'text-red'}">${withReturns.length ? sf(wins24h.length/withReturns.length*100,1) : '--'}%</div><div class="stat-sub">Avg return: ${sf(avg24h,2)}%</div></div>
    <div class="stat-card" role="status"><div class="stat-label">7d Win Rate</div><div class="stat-value ${wins7d.length/Math.max(1,with7d.length) >= 0.5 ? 'text-green' : 'text-red'}">${with7d.length ? sf(wins7d.length/with7d.length*100,1) : '--'}%</div><div class="stat-sub">Avg return: ${sf(avg7d,2)}%</div></div>
    <div class="stat-card" role="status"><div class="stat-label">Score 60+ Win Rate</div><div class="stat-value ${highScoreWinRate >= 55 ? 'text-green' : 'text-warning'}">${highScoreWinRate != null ? sf(highScoreWinRate,1)+'%' : 'Need data'}</div><div class="stat-sub">Avg signal score: ${sf(avgScore,0)}</div></div>
    <div class="stat-card" role="status"><div class="stat-label">Best Signal</div><div class="stat-value text-green">${bestSignal ? bestSignal.symbol.toUpperCase() : '--'}</div><div class="stat-sub">${bestSignal ? '+'+sf(bestSignal.forwardReturns['24h'],2)+'% (score '+bestSignal.score+')' : ''}</div></div>
    <div class="stat-card" role="status"><div class="stat-label">Worst Signal</div><div class="stat-value text-red">${worstSignal ? worstSignal.symbol.toUpperCase() : '--'}</div><div class="stat-sub">${worstSignal ? sf(worstSignal.forwardReturns['24h'],2)+'% (score '+worstSignal.score+')' : ''}</div></div>
    <div class="stat-card" role="status"><div class="stat-label">Paper Trades</div><div class="stat-value">${paperTrades.length}</div><div class="stat-sub">${paperTrades.filter(t=>t.status==='open').length} open · ${paperTrades.filter(t=>t.status.startsWith('closed')).length} closed</div></div>
    <div class="stat-card" role="status"><div class="stat-label">Risk Status</div><div class="stat-value ${risk.allowed ? 'text-green' : 'text-red'}">${risk.allowed ? '✓ Clear' : '⚠ Blocked'}</div><div class="stat-sub">${risk.allowed ? 'All limits OK' : risk.reason}</div></div>
  `;
}

/**
 * Analyzes performance by score range buckets
 */
function renderScoreRangeAnalysis(signals) {
  const withReturns = signals.filter(s => s.forwardReturns?.['24h'] != null);
  if (withReturns.length < 5) { document.getElementById('backtest-score-analysis').innerHTML = ''; return; }
  
  const buckets = [
    { label: '80-100 (Strong Buy)', min: 80, max: 100 },
    { label: '65-79 (Buy)', min: 65, max: 79 },
    { label: '50-64 (Moderate)', min: 50, max: 64 },
    { label: '35-49 (Weak)', min: 35, max: 49 },
    { label: '0-34 (Avoid)', min: 0, max: 34 },
  ];
  
  const rows = buckets.map(b => {
    const bucket = withReturns.filter(s => s.score >= b.min && s.score <= b.max);
    if (bucket.length === 0) return null;
    const wins = bucket.filter(s => s.forwardReturns['24h'] > 0).length;
    const avg = bucket.reduce((a,s) => a + s.forwardReturns['24h'], 0) / bucket.length;
    const avg7d = bucket.filter(s => s.forwardReturns?.['7d'] != null);
    const avg7dRet = avg7d.length ? avg7d.reduce((a,s) => a + s.forwardReturns['7d'], 0) / avg7d.length : null;
    const winRate = (wins / bucket.length * 100);
    const winCls = winRate >= 55 ? 'text-green' : winRate >= 45 ? 'text-warning' : 'text-red';
    return `<tr>
      <td>${b.label}</td>
      <td>${bucket.length}</td>
      <td class="${winCls}"><strong>${sf(winRate,1)}%</strong></td>
      <td class="${avg >= 0 ? 'text-green' : 'text-red'}">${sf(avg,2)}%</td>
      <td class="${avg7dRet != null ? (avg7dRet >= 0 ? 'text-green' : 'text-red') : 'text-muted'}">${avg7dRet != null ? sf(avg7dRet,2)+'%' : '--'}</td>
    </tr>`;
  }).filter(Boolean).join('');
  
  document.getElementById('backtest-score-analysis').innerHTML = `
    <div class="section-title">Score Range Performance</div>
    <table aria-label="Score range performance"><thead><tr><th>Score Range</th><th>Signals</th><th>24h Win Rate</th><th>Avg 24h Return</th><th>Avg 7d Return</th></tr></thead><tbody>${rows}</tbody></table>
  `;
}

/**
 * Analyzes performance by market regime
 */
function renderRegimeAnalysis(signals) {
  const withReturns = signals.filter(s => s.forwardReturns?.['24h'] != null && s.regimeKey);
  if (withReturns.length < 5) { document.getElementById('backtest-regime-analysis').innerHTML = ''; return; }
  
  const regimes = {};
  withReturns.forEach(s => {
    const key = s.regimeKey || 'unknown';
    if (!regimes[key]) regimes[key] = [];
    regimes[key].push(s);
  });
  
  const rows = Object.entries(regimes).map(([key, bucket]) => {
    const wins = bucket.filter(s => s.forwardReturns['24h'] > 0).length;
    const avg = bucket.reduce((a,s) => a + s.forwardReturns['24h'], 0) / bucket.length;
    const avgScore = bucket.reduce((a,s) => a + s.score, 0) / bucket.length;
    const winRate = wins / bucket.length * 100;
    const winCls = winRate >= 55 ? 'text-green' : winRate >= 45 ? 'text-warning' : 'text-red';
    return `<tr>
      <td style="text-transform:capitalize;">${key.replace(/([A-Z])/g, ' $1')}</td>
      <td>${bucket.length}</td>
      <td class="${winCls}"><strong>${sf(winRate,1)}%</strong></td>
      <td class="${avg >= 0 ? 'text-green' : 'text-red'}">${sf(avg,2)}%</td>
      <td>${sf(avgScore,0)}</td>
    </tr>`;
  }).join('');
  
  document.getElementById('backtest-regime-analysis').innerHTML = `
    <div class="section-title">Performance by Market Regime</div>
    <p class="text-muted" style="font-size:0.8rem;margin-bottom:10px;">Shows which regimes the scoring system works best in.</p>
    <table aria-label="Regime performance"><thead><tr><th>Regime</th><th>Signals</th><th>24h Win Rate</th><th>Avg Return</th><th>Avg Score</th></tr></thead><tbody>${rows}</tbody></table>
  `;
}

/**
 * Analyzes which individual factors best predict wins
 */
function renderFactorAnalysis(signals) {
  const withReturns = signals.filter(s => s.forwardReturns?.['24h'] != null);
  if (withReturns.length < 10) { document.getElementById('backtest-factor-analysis').innerHTML = ''; return; }
  
  // Analyze conditions that correlate with wins
  const conditions = [
    { label: 'RSI < 35', test: s => s.rsi != null && s.rsi < 35 },
    { label: 'RSI < 45', test: s => s.rsi != null && s.rsi < 45 },
    { label: 'RSI > 65', test: s => s.rsi != null && s.rsi > 65 },
    { label: 'BTC Corr < 0.3', test: s => s.btcCorr != null && s.btcCorr < 0.3 },
    { label: 'BTC Corr > 0.7', test: s => s.btcCorr != null && s.btcCorr > 0.7 },
    { label: 'Confidence > 70%', test: s => s.confidence > 70 },
    { label: 'Confidence < 40%', test: s => s.confidence < 40 },
    { label: 'Score > 65', test: s => s.score > 65 },
    { label: 'Score > 50 + Low RSI', test: s => s.score > 50 && s.rsi != null && s.rsi < 45 },
    { label: 'Strong Buy signal', test: s => s.signal === 'STRONG BUY' },
    { label: 'Market gates clear', test: s => !s.marketGates?.penalty },
  ];
  
  const rows = conditions.map(cond => {
    const matching = withReturns.filter(cond.test);
    if (matching.length < 3) return null;
    const wins = matching.filter(s => s.forwardReturns['24h'] > 0).length;
    const avg = matching.reduce((a,s) => a + s.forwardReturns['24h'], 0) / matching.length;
    const winRate = wins / matching.length * 100;
    const winCls = winRate >= 60 ? 'text-green' : winRate >= 50 ? 'text-warning' : 'text-red';
    const edge = avg > 0 ? '✓' : '✗';
    return `<tr>
      <td>${cond.label}</td>
      <td>${matching.length}</td>
      <td class="${winCls}"><strong>${sf(winRate,1)}%</strong></td>
      <td class="${avg >= 0 ? 'text-green' : 'text-red'}">${sf(avg,2)}%</td>
      <td>${edge}</td>
    </tr>`;
  }).filter(Boolean).join('');
  
  document.getElementById('backtest-factor-analysis').innerHTML = `
    <div class="section-title">Factor Edge Analysis</div>
    <p class="text-muted" style="font-size:0.8rem;margin-bottom:10px;">Which conditions actually predict profitable trades? Conditions with 60%+ win rate and positive avg return have real edge.</p>
    <table aria-label="Factor analysis"><thead><tr><th>Condition</th><th>Occurrences</th><th>Win Rate</th><th>Avg Return</th><th>Edge</th></tr></thead><tbody>${rows}</tbody></table>
  `;
}

/**
 * Suggests weight adjustments based on historical performance
 */
function renderWeightSuggestions(signals) {
  const withReturns = signals.filter(s => s.forwardReturns?.['24h'] != null);
  if (withReturns.length < 15) { document.getElementById('backtest-weight-suggestions').innerHTML = ''; return; }
  
  // Simple correlation: which sub-scores correlate with positive returns?
  const factorCorrelations = [];
  const factorNames = ['rsi', 'btcCorr', 'confidence'];
  
  // RSI correlation with returns
  const rsiSignals = withReturns.filter(s => s.rsi != null);
  if (rsiSignals.length >= 10) {
    const lowRsi = rsiSignals.filter(s => s.rsi < 40);
    const highRsi = rsiSignals.filter(s => s.rsi > 60);
    const lowAvg = lowRsi.length ? lowRsi.reduce((a,s) => a + s.forwardReturns['24h'], 0) / lowRsi.length : 0;
    const highAvg = highRsi.length ? highRsi.reduce((a,s) => a + s.forwardReturns['24h'], 0) / highRsi.length : 0;
    factorCorrelations.push({ factor: 'RSI (oversold)', edge: lowAvg - highAvg, suggestion: lowAvg > highAvg ? 'Increase RSI weight — oversold signals outperform' : 'RSI weight is appropriate' });
  }
  
  // Confidence correlation
  const highConf = withReturns.filter(s => s.confidence > 60);
  const lowConf = withReturns.filter(s => s.confidence < 40);
  if (highConf.length >= 5 && lowConf.length >= 5) {
    const highAvg = highConf.reduce((a,s) => a + s.forwardReturns['24h'], 0) / highConf.length;
    const lowAvg = lowConf.reduce((a,s) => a + s.forwardReturns['24h'], 0) / lowConf.length;
    factorCorrelations.push({ factor: 'Confidence', edge: highAvg - lowAvg, suggestion: highAvg > lowAvg + 1 ? 'High confidence signals outperform — consider filtering below 50%' : 'Confidence is not strongly predictive yet' });
  }
  
  // Score threshold analysis
  const thresholds = [40, 45, 50, 55, 60, 65, 70, 75];
  let bestThreshold = { threshold: 45, score: -Infinity };
  thresholds.forEach(t => {
    const above = withReturns.filter(s => s.score >= t);
    if (above.length < 5) return;
    const winRate = above.filter(s => s.forwardReturns['24h'] > 0).length / above.length;
    const avg = above.reduce((a,s) => a + s.forwardReturns['24h'], 0) / above.length;
    const combined = winRate * 2 + avg;
    if (combined > bestThreshold.score) bestThreshold = { threshold: t, score: combined, winRate, avg, count: above.length };
  });
  
  const currentBuy = learnedThresholds?.buy || 45;
  const thresholdSuggestion = bestThreshold.threshold !== currentBuy 
    ? `Data suggests BUY threshold of ${bestThreshold.threshold} (currently ${currentBuy}). Win rate: ${sf(bestThreshold.winRate*100,1)}%, avg return: ${sf(bestThreshold.avg,2)}%`
    : `Current BUY threshold of ${currentBuy} appears optimal for your data.`;
  
  const html = `
    <div class="section-title">Weight & Threshold Optimization</div>
    <div class="methodology-box" style="margin-bottom:16px;">
      <h4>Threshold Recommendation</h4>
      <p>${thresholdSuggestion}</p>
      <p class="text-muted" style="margin-top:8px;">Based on ${withReturns.length} signals with measured outcomes.</p>
    </div>
    ${factorCorrelations.length ? `<div class="methodology-box">
      <h4>Factor Insights</h4>
      ${factorCorrelations.map(f => `<p><strong>${f.factor}:</strong> ${f.suggestion} (edge: ${sf(f.edge,2)}%)</p>`).join('')}
    </div>` : ''}
  `;
  
  document.getElementById('backtest-weight-suggestions').innerHTML = html;
}

/**
 * Analyzes how signal age affects accuracy
 */
function renderFreshnessAnalysis(signals) {
  const withReturns = signals.filter(s => s.forwardReturns?.['24h'] != null && s.timestamp);
  if (withReturns.length < 10) { document.getElementById('backtest-freshness').innerHTML = ''; return; }
  
  // Group by how old the signal was when the 24h return was measured
  // (All signals are measured at the same 24h horizon, but we can look at
  // whether signals generated in different market conditions decay differently)
  
  // Instead, analyze: do signals that were STRONG BUY maintain their edge over time?
  const strongBuys = withReturns.filter(s => s.signal === 'STRONG BUY');
  const buys = withReturns.filter(s => s.signal === 'BUY');
  
  const horizons = FORWARD_RETURN_HORIZONS || [];
  const decayData = horizons.map(h => {
    const sbReturns = strongBuys.filter(s => s.forwardReturns?.[h.key] != null).map(s => s.forwardReturns[h.key]);
    const bReturns = buys.filter(s => s.forwardReturns?.[h.key] != null).map(s => s.forwardReturns[h.key]);
    return {
      horizon: h.label,
      sbAvg: sbReturns.length >= 3 ? sbReturns.reduce((a,v) => a+v, 0) / sbReturns.length : null,
      sbWin: sbReturns.length >= 3 ? sbReturns.filter(v => v > 0).length / sbReturns.length * 100 : null,
      sbCount: sbReturns.length,
      bAvg: bReturns.length >= 3 ? bReturns.reduce((a,v) => a+v, 0) / bReturns.length : null,
      bWin: bReturns.length >= 3 ? bReturns.filter(v => v > 0).length / bReturns.length * 100 : null,
      bCount: bReturns.length,
    };
  });
  
  const rows = decayData.map(d => {
    if (d.sbCount < 3 && d.bCount < 3) return null;
    return `<tr>
      <td>${d.horizon}</td>
      <td class="${d.sbAvg != null ? (d.sbAvg >= 0 ? 'text-green' : 'text-red') : 'text-muted'}">${d.sbAvg != null ? sf(d.sbAvg,2)+'%' : '--'} <span class="text-muted">(${d.sbCount})</span></td>
      <td class="${d.sbWin != null ? (d.sbWin >= 50 ? 'text-green' : 'text-red') : 'text-muted'}">${d.sbWin != null ? sf(d.sbWin,0)+'%' : '--'}</td>
      <td class="${d.bAvg != null ? (d.bAvg >= 0 ? 'text-green' : 'text-red') : 'text-muted'}">${d.bAvg != null ? sf(d.bAvg,2)+'%' : '--'} <span class="text-muted">(${d.bCount})</span></td>
      <td class="${d.bWin != null ? (d.bWin >= 50 ? 'text-green' : 'text-red') : 'text-muted'}">${d.bWin != null ? sf(d.bWin,0)+'%' : '--'}</td>
    </tr>`;
  }).filter(Boolean).join('');
  
  document.getElementById('backtest-freshness').innerHTML = `
    <div class="section-title">Signal Decay Over Time</div>
    <p class="text-muted" style="font-size:0.8rem;margin-bottom:10px;">How do signals perform at different time horizons? If returns decay quickly, signals are best for short-term trades.</p>
    <table aria-label="Signal freshness"><thead><tr><th>Horizon</th><th>Strong Buy Avg</th><th>SB Win%</th><th>Buy Avg</th><th>Buy Win%</th></tr></thead><tbody>${rows}</tbody></table>
  `;
}

/**
 * Renders the paper trade log (delegates to auto-trade panel if available)
 */
function renderPaperTradeLog() {
  if (typeof renderAutoTradePanel === 'function') {
    renderAutoTradePanel();
    return;
  }
  
  const container = document.getElementById('backtest-paper-trades');
  container.innerHTML = '<p class="text-muted">Auto-trade module not loaded.</p>';
}

/**
 * Renders portfolio-level risk manager status
 */
function renderRiskManager() {
  const risk = checkPortfolioRisk();
  const container = document.getElementById('backtest-risk-manager');
  
  container.innerHTML = `
    <div class="section-title">🛡 Portfolio Risk Manager</div>
    <div class="risk-panel ${risk.allowed ? '' : 'risk-warning'}">
      <div class="risk-title">Status: ${risk.allowed ? '<span class="text-green">All Clear</span>' : '<span class="text-red">Trading Blocked</span>'}</div>
      ${!risk.allowed ? `<div class="do-not-trade">${risk.reason}</div>` : ''}
      <div class="risk-grid" style="margin-top:10px;">
        <div><span>Max Drawdown</span><strong>-${RISK_LIMITS.maxPortfolioDrawdown}%</strong></div>
        <div><span>Daily Loss Cap</span><strong>-${RISK_LIMITS.maxDailyLoss}%</strong></div>
        <div><span>Max Positions</span><strong>${RISK_LIMITS.maxOpenPositions}</strong></div>
        <div><span>Max Single</span><strong>${RISK_LIMITS.maxSinglePosition}%</strong></div>
        <div><span>Corr Exposure</span><strong>${RISK_LIMITS.maxCorrelatedExposure}%</strong></div>
        <div><span>Stop Cooldown</span><strong>${RISK_LIMITS.cooldownAfterStopHit}h</strong></div>
      </div>
    </div>
  `;
}

// ============ AI Backtest Insights ============

async function aiBacktestInsights() {
  if (!AI_CONFIG.key) { alert('API key not configured.'); return; }
  
  const signals = signalLog.filter(s => s.forwardReturns && Object.keys(s.forwardReturns).length > 0);
  if (signals.length < 10) { alert('Need at least 10 signals with forward returns for AI analysis.'); return; }
  
  const box = document.getElementById('ai-response-box');
  document.getElementById('ai-modal-title').innerText = '🧠 AI Backtest Analysis';
  openModal('ai-modal');
  box.innerHTML = '<div class="loader"></div><div style="text-align:center;margin-top:12px;color:var(--text-muted);">Analyzing signal history...</div>';
  
  const withReturns = signals.filter(s => s.forwardReturns?.['24h'] != null);
  
  // Handle case where no 24h returns are available yet
  if (withReturns.length === 0) {
    box.innerHTML = '<div class="text-warning" style="text-align:center;padding:20px;">No 24h forward returns measured yet. The system needs at least 24 hours after generating signals to measure outcomes. Check back later.</div>';
    return;
  }
  
  const wins = withReturns.filter(s => s.forwardReturns['24h'] > 0);
  const winRate = withReturns.length > 0 ? (wins.length / withReturns.length * 100) : 0;
  const avg = withReturns.length > 0 ? withReturns.reduce((a,s) => a + s.forwardReturns['24h'], 0) / withReturns.length : 0;
  
  // Build data summary for AI
  const summary = withReturns.slice(-50).map(s => 
    `${s.symbol.toUpperCase()} Score:${s.score} Conf:${s.confidence}% RSI:${sf(s.rsi,0)} Corr:${sf(s.btcCorr,2)} Regime:${s.regimeKey||'?'} → 24h:${sf(s.forwardReturns['24h'],2)}% 7d:${s.forwardReturns?.['7d'] != null ? sf(s.forwardReturns['7d'],2)+'%' : '?'}`
  ).join('\n');
  
  try {
    const resp = await fetch(AI_CONFIG.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${AI_CONFIG.key}`, 'HTTP-Referer': location.href },
      body: JSON.stringify({
        model: AI_CONFIG.model,
        messages: [{
          role: 'system',
          content: 'You are a quantitative trading system analyst. Analyze signal performance data and provide actionable insights. Be specific with numbers.'
        }, {
          role: 'user',
          content: `Backtest results: ${withReturns.length} signals, ${sf(winRate,1)}% win rate, ${sf(avg,2)}% avg 24h return.\n\nRecent signals:\n${summary}\n\nAnalyze:\n1. What score/RSI/confidence ranges produce the best results?\n2. Are there clear patterns in winners vs losers?\n3. What regime works best for this system?\n4. Specific threshold recommendations (buy at score X, avoid when Y)\n5. One critical weakness you see in the data\n\nBe concise, data-driven, reference actual numbers from the data.`
        }],
        temperature: 0.2
      })
    });
    
    if (!resp.ok) {
      const errBody = await resp.text();
      throw new Error(`HTTP ${resp.status}: ${errBody.slice(0, 200)}`);
    }
    
    const data = await resp.json();
    
    // Safely access the response
    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('AI returned empty response. Response structure: ' + JSON.stringify(Object.keys(data || {})));
    }
    
    box.innerHTML = `<div style="color:var(--text-main);line-height:1.7;font-size:0.88rem;white-space:pre-wrap;">${content}</div>`;
  } catch (e) {
    box.innerHTML = `<div style="padding:12px;">
      <span class="text-red" style="font-weight:600;">Analysis Failed</span>
      <p class="text-muted" style="margin-top:8px;font-size:0.82rem;">${e.message}</p>
      <p class="text-muted" style="margin-top:6px;font-size:0.78rem;">This can happen if the AI API is temporarily unavailable or the API key has expired. Try again in a moment.</p>
    </div>`;
  }
}

// ============ Export ============

function exportBacktestData() {
  const signals = signalLog.filter(s => s.forwardReturns && Object.keys(s.forwardReturns).length > 0);
  if (signals.length === 0) { alert('No data to export.'); return; }
  
  const headers = ['Date','Symbol','Score','Signal','Confidence','RSI','BTC_Corr','Regime','Price','1h_Return','4h_Return','24h_Return','3d_Return','7d_Return'];
  const rows = signals.map(s => [
    s.date, s.symbol.toUpperCase(), s.score, s.signal, s.confidence,
    s.rsi != null ? sf(s.rsi,1) : '', s.btcCorr != null ? sf(s.btcCorr,3) : '',
    s.regimeKey || '', sf(s.price,2),
    s.forwardReturns?.['1h'] != null ? sf(s.forwardReturns['1h'],3) : '',
    s.forwardReturns?.['4h'] != null ? sf(s.forwardReturns['4h'],3) : '',
    s.forwardReturns?.['24h'] != null ? sf(s.forwardReturns['24h'],3) : '',
    s.forwardReturns?.['3d'] != null ? sf(s.forwardReturns['3d'],3) : '',
    s.forwardReturns?.['7d'] != null ? sf(s.forwardReturns['7d'],3) : '',
  ].join(','));
  
  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `quant-backtest-${DateFormatter.today().replace(/\//g,'-')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ============ UI Helpers ============

/**
 * Opens a paper trade from a coin card button
 */
function openPaperTradeFromCard(coinId, symbol, price) {
  const coin = marketData.find(c => c.id === coinId);
  if (!coin?.analysis) { alert('No analysis data available.'); return; }
  
  const a = coin.analysis;
  const result = openPaperTrade(coinId, symbol, price, a.composite, a.confidence, a.risk);
  
  if (result.success) {
    showAlertToast(`📝 Paper trade opened: ${symbol.toUpperCase()} at ${formatINR(price)} (Score: ${a.composite})`);
  } else {
    alert(`Cannot open trade: ${result.reason}`);
  }
}
