// ============ Autonomous Paper Trading Engine ============
// Manages a virtual ₹5,000 portfolio that auto-trades based on scoring signals.
// Self-optimizes over time by learning from outcomes.

const AUTOTRADE_CONFIG = {
  initialCapital: 100000,          // ₹1,00,000 starting capital
  maxPositionPct: 20,             // Max 20% of capital per trade (₹20,000)
  minPositionPct: 8,              // Min 8% per trade (₹8,000)
  maxOpenPositions: 5,            // Max simultaneous positions
  minScoreToTrade: 45,            // Minimum composite score (starts lower, adapts UP if losing)
  minConfidence: 35,              // Minimum confidence %
  maxHoldingHours: 72,            // Force close after 72 hours
  trailingStopPct: 3,            // Trailing stop activation after +3%
  cooldownAfterLoss: 30,          // Minutes to wait after a loss
  scanInterval: null,             // Set by init
  enabled: false,                 // Toggle on/off
};

// Persistent state
let autoTradeState = loadAutoTradeState();

function loadAutoTradeState() {
  const saved = localStorage.getItem('quant_autotrade_v1');
  if (saved) {
    try { return JSON.parse(saved); } catch {}
  }
  return {
    capital: AUTOTRADE_CONFIG.initialCapital,
    startingCapital: AUTOTRADE_CONFIG.initialCapital,
    positions: [],          // Open positions
    history: [],            // Closed trades
    totalTrades: 0,
    wins: 0,
    losses: 0,
    totalPnl: 0,
    peakCapital: AUTOTRADE_CONFIG.initialCapital,
    maxDrawdown: 0,
    lastTradeTime: 0,
    lastLossTime: 0,
    learnedRules: {},       // Self-optimized rules
    dailyLog: [],           // Daily P&L log
    enabled: false,
    createdAt: Date.now(),
  };
}

function saveAutoTradeState() {
  // Keep history manageable
  if (autoTradeState.history.length > 500) {
    autoTradeState.history = autoTradeState.history.slice(-500);
  }
  if (autoTradeState.dailyLog.length > 90) {
    autoTradeState.dailyLog = autoTradeState.dailyLog.slice(-90);
  }
  localStorage.setItem('quant_autotrade_v1', JSON.stringify(autoTradeState));
}

// ============ Core Trading Logic ============

/**
 * Main autonomous trading cycle — called after every market scan.
 * Now includes AI pre-trade confirmation, exit advisor, and news impact checks.
 */
async function autoTradeExecute() {
  if (!autoTradeState.enabled || !marketData.length) return;
  
  // 1. Check and close expired/stopped positions
  autoCheckExits();
  
  // 2. AI Exit Advisor — check if profitable positions should be closed
  if (autoTradeState.positions.length > 0) {
    await aiExitAdvisor(autoTradeState.positions);
  }
  
  // 3. Update daily log
  updateDailyLog();
  
  // 4. Check AI regime — should we be trading at all?
  const aiRegime = aiRegimeCache;
  if (aiRegime && !aiRegime.shouldTrade) {
    console.log(`[AutoTrade] AI regime says don't trade: ${aiRegime.reasoning}`);
    return;
  }
  
  // 5. Check if we can open new positions
  if (!canOpenNewPosition()) return;
  
  // 6. Find best candidates
  const candidates = findTradeCandidates();
  if (candidates.length === 0) return;
  
  // 7. Apply AI news impact filter
  const filteredCandidates = candidates.filter(c => !hasBlockingNewsEvent(c));
  if (filteredCandidates.length === 0) {
    console.log('[AutoTrade] All candidates blocked by news events');
    return;
  }
  
  // 8. Open positions with AI confirmation
  const slotsAvailable = AUTOTRADE_CONFIG.maxOpenPositions - autoTradeState.positions.length;
  const toOpen = filteredCandidates.slice(0, slotsAvailable);
  
  for (const coin of toOpen) {
    // AI pre-trade confirmation (only for first candidate to avoid API spam)
    const confirmation = await aiConfirmTrade(coin);
    
    if (confirmation.approved) {
      autoOpenPosition(coin, confirmation);
    } else {
      console.log(`[AutoTrade] AI REJECTED ${coin.symbol.toUpperCase()}: ${confirmation.reason}`);
    }
  }
  
  saveAutoTradeState();
}

/**
 * Determines if we're allowed to open new positions
 */
function canOpenNewPosition() {
  const now = Date.now();
  
  // Max positions reached
  if (autoTradeState.positions.length >= AUTOTRADE_CONFIG.maxOpenPositions) return false;
  
  // No capital left
  if (autoTradeState.capital < autoTradeState.startingCapital * 0.05) return false;
  
  // Cooldown after loss
  if (autoTradeState.lastLossTime && (now - autoTradeState.lastLossTime) < AUTOTRADE_CONFIG.cooldownAfterLoss * 60000) return false;
  
  // Max drawdown circuit breaker (stop if down 30% from peak)
  const drawdownPct = autoTradeState.peakCapital > 0 
    ? ((getTotalEquity() - autoTradeState.peakCapital) / autoTradeState.peakCapital) * 100 
    : 0;
  if (drawdownPct < -30) return false;
  
  // Don't trade if portfolio risk manager says no
  const risk = checkPortfolioRisk();
  if (!risk.allowed) return false;
  
  return true;
}

/**
 * Gets total equity (capital + open position values)
 */
function getTotalEquity() {
  let equity = autoTradeState.capital;
  autoTradeState.positions.forEach(pos => {
    const coin = marketData.find(c => c.id === pos.coinId || c.symbol.toLowerCase() === pos.symbol.toLowerCase());
    const currentPrice = coin?.current_price || pos.entryPrice;
    equity += pos.quantity * currentPrice;
  });
  return equity;
}

/**
 * Finds coins that qualify for auto-trading
 */
function findTradeCandidates() {
  const minScore = getAdaptiveMinScore();
  const minConf = AUTOTRADE_CONFIG.minConfidence;
  
  // Already holding these coins
  const heldIds = new Set(autoTradeState.positions.map(p => p.coinId));
  
  // Track blocked coins for UI explanation
  autoTradeState._lastBlockedCoins = [];
  
  const candidates = marketData
    .filter(c => {
      if (!c.analysis) return false;
      if (heldIds.has(c.id)) return false;
      if ((c.market_cap || 0) > CONFIG.MAX_MCAP_INR) return false;
      if (c.analysis.composite < minScore) return false;
      if (c.analysis.confidence < minConf) return false;
      // Accept BUY/STRONG BUY signals, OR HOLD coins that still pass our adaptive score
      // (The scanner's BUY threshold might be higher than our trading threshold)
      if (c.analysis.action === 'AVOID') return false;
      if (c.analysis.action === 'HOLD' && c.analysis.composite < minScore + 5) return false;
      
      // Risk filters
      if (c.analysis.risk?.doNotTrade) return false;
      if ((c.analysis.risk?.realizedVolatility || 0) > 25) return false;
      if ((c.total_volume || 0) < 10000000) return false; // Min ₹1Cr volume
      
      // Learned rules filter
      if (!passesLearnedRules(c)) {
        autoTradeState._lastBlockedCoins.push({
          symbol: c.symbol.toUpperCase(),
          reason: c._learnedBlockReason || 'Learned rules penalty too high',
        });
        return false;
      }
      
      return true;
    })
    .sort((a, b) => {
      // Rank by: composite * confidence weight
      const scoreA = a.analysis.composite * (1 + a.analysis.confidence / 200);
      const scoreB = b.analysis.composite * (1 + b.analysis.confidence / 200);
      return scoreB - scoreA;
    });
  
  return candidates;
}

/**
 * Opens a new auto-trade position
 */
function autoOpenPosition(coin, aiConfirmation) {
  const a = coin.analysis;
  const price = coin.current_price;
  const equity = getTotalEquity();
  
  // Position sizing: higher score/confidence = larger position
  // AI confidence can boost or reduce size
  const aiConfBonus = aiConfirmation?.confidence ? (aiConfirmation.confidence - 50) * 0.05 : 0;
  const baseSize = AUTOTRADE_CONFIG.minPositionPct;
  const bonusSize = Math.min(AUTOTRADE_CONFIG.maxPositionPct - baseSize, 
    (a.composite - 50) * 0.3 + (a.confidence - 40) * 0.1 + aiConfBonus);
  const positionPct = Math.min(AUTOTRADE_CONFIG.maxPositionPct, Math.max(baseSize, baseSize + bonusSize));
  
  // Apply AI regime score adjustment
  const regimeAdj = aiRegimeCache?.adjustScoreBy || 0;
  const newsAdj = getNewsImpactAdjustment(coin);
  const effectiveScore = a.composite + regimeAdj + newsAdj;
  
  const positionValue = equity * (positionPct / 100);
  
  if (positionValue > autoTradeState.capital) return; // Not enough free capital
  if (positionValue < 100) return; // Too small to be meaningful
  
  const quantity = positionValue / price;
  const stopPct = a.risk?.stopPct || 8;
  const stopLoss = price * (1 - stopPct / 100);
  const tp1 = price * (1 + stopPct * 1.5 / 100);
  const tp2 = price * (1 + stopPct * 2.5 / 100);
  
  const position = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2,5),
    coinId: coin.id,
    symbol: coin.symbol.toUpperCase(),
    entryPrice: price,
    entryTime: Date.now(),
    quantity,
    investedAmount: positionValue,
    score: a.composite,
    effectiveScore,
    confidence: a.confidence,
    regime: currentScoringRegime?.key || 'unknown',
    aiRegime: aiRegimeCache?.regime || null,
    aiConfirmReason: aiConfirmation?.reason || null,
    aiConfirmConfidence: aiConfirmation?.confidence || null,
    rsi: a.rsi,
    btcCorr: a.btcCorr,
    realizedVol: a.risk?.realizedVolatility || null,
    macdTrend: a.macd?.crossover || a.macd?.trend || null,
    volumeConfirmRatio: a.volumeConfirmation?.ratio || null,
    stopLoss,
    takeProfit1: tp1,
    takeProfit2: tp2,
    trailingStop: null,
    highWaterMark: price,
    tp1Hit: false,
  };
  
  autoTradeState.capital -= positionValue;
  autoTradeState.positions.push(position);
  autoTradeState.lastTradeTime = Date.now();
  
  console.log(`[AutoTrade] OPENED ${position.symbol} | ₹${sf(positionValue,0)} | Score:${a.composite} Conf:${a.confidence}% | Stop:${formatINR(stopLoss)} TP:${formatINR(tp1)}`);
  saveAutoTradeState();
}

/**
 * Checks all open positions for exit conditions
 */
function autoCheckExits() {
  const now = Date.now();
  const toClose = [];
  
  autoTradeState.positions.forEach(pos => {
    const coin = marketData.find(c => c.id === pos.coinId || c.symbol.toLowerCase() === pos.symbol.toLowerCase());
    if (!coin) return;
    
    const price = coin.current_price;
    let reason = null;
    
    // Update high water mark
    if (price > pos.highWaterMark) {
      pos.highWaterMark = price;
    }
    
    // 1. Stop loss hit
    if (price <= pos.stopLoss) {
      reason = 'stop-loss';
    }
    // 2. Trailing stop (activated after +3%)
    else if (pos.tp1Hit && pos.trailingStop && price <= pos.trailingStop) {
      reason = 'trailing-stop';
    }
    // 3. Take profit 2 hit (full exit)
    else if (price >= pos.takeProfit2) {
      reason = 'take-profit-2';
    }
    // 4. Take profit 1 hit (move stop to breakeven, activate trailing)
    else if (!pos.tp1Hit && price >= pos.takeProfit1) {
      pos.tp1Hit = true;
      pos.stopLoss = pos.entryPrice * 1.005; // Move stop to breakeven + 0.5%
      pos.trailingStop = pos.highWaterMark * (1 - AUTOTRADE_CONFIG.trailingStopPct / 100);
    }
    // 5. Update trailing stop if active
    else if (pos.tp1Hit) {
      const newTrailing = pos.highWaterMark * (1 - AUTOTRADE_CONFIG.trailingStopPct / 100);
      if (!pos.trailingStop || newTrailing > pos.trailingStop) {
        pos.trailingStop = newTrailing;
      }
    }
    // 6. Time expiry
    else if ((now - pos.entryTime) > AUTOTRADE_CONFIG.maxHoldingHours * 3600000) {
      reason = 'time-expiry';
    }
    
    if (reason) {
      toClose.push({ pos, price, reason });
    }
  });
  
  toClose.forEach(({ pos, price, reason }) => {
    autoClosePosition(pos, price, reason);
  });
}

/**
 * Closes a position and records the outcome
 */
function autoClosePosition(pos, exitPrice, reason) {
  const pnlPct = ((exitPrice - pos.entryPrice) / pos.entryPrice) * 100;
  const pnlAmount = pos.quantity * (exitPrice - pos.entryPrice);
  const returnedCapital = pos.quantity * exitPrice;
  
  // Return capital
  autoTradeState.capital += returnedCapital;
  
  // Update peak/drawdown
  const equity = getTotalEquity();
  if (equity > autoTradeState.peakCapital) {
    autoTradeState.peakCapital = equity;
  }
  const currentDrawdown = ((equity - autoTradeState.peakCapital) / autoTradeState.peakCapital) * 100;
  if (currentDrawdown < autoTradeState.maxDrawdown) {
    autoTradeState.maxDrawdown = currentDrawdown;
  }
  
  // Record outcome
  const isWin = pnlPct > 0;
  if (isWin) autoTradeState.wins++;
  else autoTradeState.losses++;
  autoTradeState.totalTrades = autoTradeState.wins + autoTradeState.losses; // Always in sync
  autoTradeState.totalPnl += pnlAmount;
  
  if (!isWin) autoTradeState.lastLossTime = Date.now();
  
  // Save to history
  const record = {
    ...pos,
    exitPrice,
    exitTime: Date.now(),
    pnlPct,
    pnlAmount,
    reason,
    holdingHours: ((Date.now() - pos.entryTime) / 3600000),
    isWin,
  };
  autoTradeState.history.push(record);
  
  // Remove from open positions
  autoTradeState.positions = autoTradeState.positions.filter(p => p.id !== pos.id);
  
  // Feed into learning system
  learnFromTrade(record);
  
  // AI Trade Journal — explain why this trade won/lost (async, non-blocking)
  if (typeof aiExplainTrade === 'function') {
    aiExplainTrade(record).catch(() => {});
  }
  
  console.log(`[AutoTrade] CLOSED ${pos.symbol} | ${reason} | P&L: ${sf(pnlPct,2)}% (₹${sf(pnlAmount,2)}) | Capital: ₹${sf(autoTradeState.capital,0)}`);
  saveAutoTradeState();
}

// ============ Self-Optimization / Learning ============

/**
 * Learns from a completed trade to adjust future behavior.
 * Tracks multiple dimensions and combo conditions for robust pattern detection.
 */
function learnFromTrade(trade) {
  const rules = autoTradeState.learnedRules;
  const now = Date.now();
  
  // --- Single-dimension tracking ---
  
  // 1. Score bucket (50, 60, 70, etc.)
  const scoreBucket = Math.floor(trade.score / 10) * 10;
  recordRule(rules, `score_${scoreBucket}`, trade, now);
  
  // 2. Regime
  recordRule(rules, `regime_${trade.regime || 'unknown'}`, trade, now);
  
  // 3. RSI range
  if (trade.rsi != null) {
    const rsiKey = trade.rsi < 30 ? 'rsi_deep_oversold' : trade.rsi < 40 ? 'rsi_oversold' : trade.rsi < 50 ? 'rsi_low' : trade.rsi < 60 ? 'rsi_mid' : trade.rsi < 70 ? 'rsi_high' : 'rsi_overbought';
    recordRule(rules, rsiKey, trade, now);
  }
  
  // 4. Confidence range
  const confKey = trade.confidence >= 70 ? 'conf_high' : trade.confidence >= 55 ? 'conf_mid' : 'conf_low';
  recordRule(rules, confKey, trade, now);
  
  // 5. BTC Correlation range
  if (trade.btcCorr != null) {
    const corrKey = trade.btcCorr < 0.3 ? 'corr_low' : trade.btcCorr < 0.6 ? 'corr_mid' : 'corr_high';
    recordRule(rules, corrKey, trade, now);
  }
  
  // 6. Volatility (from risk plan)
  if (trade.realizedVol != null) {
    const volKey = trade.realizedVol > 18 ? 'vol_extreme' : trade.realizedVol > 12 ? 'vol_high' : trade.realizedVol > 6 ? 'vol_normal' : 'vol_low';
    recordRule(rules, volKey, trade, now);
  }
  
  // 7. Exit type (what kind of close was it?)
  recordRule(rules, `exit_${trade.reason || 'unknown'}`, trade, now);
  
  // 8. Holding time bucket
  const holdKey = trade.holdingHours < 4 ? 'hold_scalp' : trade.holdingHours < 24 ? 'hold_day' : trade.holdingHours < 48 ? 'hold_swing' : 'hold_long';
  recordRule(rules, holdKey, trade, now);
  
  // --- Combo-condition tracking (2-factor combinations) ---
  
  // Score + Regime
  recordRule(rules, `combo_score${scoreBucket}_${trade.regime || 'unknown'}`, trade, now);
  
  // RSI + Regime
  if (trade.rsi != null) {
    const rsiSimple = trade.rsi < 40 ? 'rsiLow' : trade.rsi < 60 ? 'rsiMid' : 'rsiHigh';
    recordRule(rules, `combo_${rsiSimple}_${trade.regime || 'unknown'}`, trade, now);
  }
  
  // Score + Confidence
  const confSimple = trade.confidence >= 60 ? 'confHigh' : 'confLow';
  recordRule(rules, `combo_score${scoreBucket}_${confSimple}`, trade, now);
  
  saveAutoTradeState();
}

/**
 * Records a single rule entry with time-weighted decay
 */
function recordRule(rules, key, trade, timestamp) {
  if (!rules[key]) {
    rules[key] = { wins: 0, losses: 0, totalReturn: 0, trades: [], lastUpdated: timestamp };
  }
  const rule = rules[key];
  rule[trade.isWin ? 'wins' : 'losses']++;
  rule.totalReturn += trade.pnlPct;
  rule.lastUpdated = timestamp;
  
  // Keep last 20 individual trade results for recency weighting
  if (!rule.trades) rule.trades = [];
  rule.trades.push({ pnl: trade.pnlPct, time: timestamp, isWin: trade.isWin });
  if (rule.trades.length > 20) rule.trades = rule.trades.slice(-20);
}

/**
 * Gets the effective win rate for a rule, applying recency weighting.
 * Recent trades count more than old ones.
 */
function getRecencyWeightedWinRate(rule) {
  if (!rule || !rule.trades || rule.trades.length < 3) return null;
  
  const now = Date.now();
  const ONE_WEEK = 7 * 24 * 3600000;
  
  let weightedWins = 0, totalWeight = 0;
  rule.trades.forEach(t => {
    // Trades from last week get full weight, older trades decay
    const age = now - (t.time || 0);
    const weight = age < ONE_WEEK ? 1.0 : age < ONE_WEEK * 2 ? 0.7 : age < ONE_WEEK * 4 ? 0.4 : 0.2;
    weightedWins += t.isWin ? weight : 0;
    totalWeight += weight;
  });
  
  return totalWeight > 0 ? (weightedWins / totalWeight) : null;
}

/**
 * Gets the effective average return for a rule with recency weighting
 */
function getRecencyWeightedReturn(rule) {
  if (!rule || !rule.trades || rule.trades.length < 3) return null;
  
  const now = Date.now();
  const ONE_WEEK = 7 * 24 * 3600000;
  
  let weightedReturn = 0, totalWeight = 0;
  rule.trades.forEach(t => {
    const age = now - (t.time || 0);
    const weight = age < ONE_WEEK ? 1.0 : age < ONE_WEEK * 2 ? 0.7 : age < ONE_WEEK * 4 ? 0.4 : 0.2;
    weightedReturn += t.pnl * weight;
    totalWeight += weight;
  });
  
  return totalWeight > 0 ? (weightedReturn / totalWeight) : null;
}

/**
 * Gets adaptive minimum score based on learned performance.
 * Can both raise AND lower the threshold based on recent data.
 */
function getAdaptiveMinScore() {
  const rules = autoTradeState.learnedRules;
  const totalClosed = autoTradeState.wins + autoTradeState.losses;
  
  // Need at least 15 closed trades before adapting
  if (totalClosed < 15) return AUTOTRADE_CONFIG.minScoreToTrade;
  
  // Evaluate each score bucket's recent performance
  let bestMinScore = 40; // Start optimistic
  let foundPositiveBucket = false;
  
  for (let bucket = 40; bucket <= 80; bucket += 10) {
    const key = `score_${bucket}`;
    const data = rules[key];
    if (!data) continue;
    
    const recentWinRate = getRecencyWeightedWinRate(data);
    const recentReturn = getRecencyWeightedReturn(data);
    
    // If we have enough data and this bucket is losing
    if (recentWinRate !== null && recentReturn !== null) {
      if (recentWinRate < 0.4 && recentReturn < -1.5) {
        // This bucket loses — minimum should be above it
        bestMinScore = Math.max(bestMinScore, bucket + 10);
      } else if (recentWinRate >= 0.5 && recentReturn > 0) {
        foundPositiveBucket = true;
      }
    }
  }
  
  // If no bucket has positive expectancy, be very conservative
  if (!foundPositiveBucket && totalClosed >= 25) {
    bestMinScore = Math.max(bestMinScore, 65);
  }
  
  return Math.min(80, Math.max(40, bestMinScore));
}

/**
 * Checks if a coin passes learned rules.
 * Uses a SCORING approach instead of hard-blocking:
 * Each rule contributes a penalty or bonus. Trade is blocked only if
 * total penalty exceeds a threshold.
 * Returns { passed: boolean, netScore, explanation } for transparency.
 */
function passesLearnedRules(coin) {
  const rules = autoTradeState.learnedRules;
  const totalClosed = autoTradeState.wins + autoTradeState.losses;
  
  // Don't filter until we have enough data
  if (totalClosed < 20) return true;
  
  const a = coin.analysis;
  let penaltyScore = 0; // Accumulates negative signals
  let bonusScore = 0;   // Accumulates positive signals
  const reasons = [];    // Human-readable explanations
  
  // Check regime performance
  const regimeKey = `regime_${currentScoringRegime?.key || 'unknown'}`;
  const regimeWR = getRecencyWeightedWinRate(rules[regimeKey]);
  const regimeRet = getRecencyWeightedReturn(rules[regimeKey]);
  if (regimeWR !== null) {
    const regimeTotal = (rules[regimeKey]?.wins || 0) + (rules[regimeKey]?.losses || 0);
    if (regimeWR < 0.35 && regimeRet < -2) {
      penaltyScore += 3;
      reasons.push(`${currentScoringRegime?.label || 'Current'} regime has ${sf(regimeWR*100,0)}% win rate (${regimeTotal} trades)`);
    }
    else if (regimeWR < 0.4) penaltyScore += 1;
    else if (regimeWR >= 0.6 && regimeRet > 1) bonusScore += 2;
  }
  
  // Check RSI range performance
  if (a.rsi != null) {
    const rsiKey = a.rsi < 30 ? 'rsi_deep_oversold' : a.rsi < 40 ? 'rsi_oversold' : a.rsi < 50 ? 'rsi_low' : a.rsi < 60 ? 'rsi_mid' : a.rsi < 70 ? 'rsi_high' : 'rsi_overbought';
    const rsiWR = getRecencyWeightedWinRate(rules[rsiKey]);
    const rsiRet = getRecencyWeightedReturn(rules[rsiKey]);
    if (rsiWR !== null) {
      const rsiTotal = (rules[rsiKey]?.wins || 0) + (rules[rsiKey]?.losses || 0);
      if (rsiWR < 0.3 && rsiRet < -2) {
        penaltyScore += 3;
        reasons.push(`RSI ${sf(a.rsi,0)} range has ${sf(rsiWR*100,0)}% win rate (${rsiTotal} trades)`);
      }
      else if (rsiWR < 0.4) penaltyScore += 1;
      else if (rsiWR >= 0.6 && rsiRet > 1) bonusScore += 2;
    }
  }
  
  // Check confidence range
  const confKey = a.confidence >= 70 ? 'conf_high' : a.confidence >= 55 ? 'conf_mid' : 'conf_low';
  const confWR = getRecencyWeightedWinRate(rules[confKey]);
  if (confWR !== null) {
    const confTotal = (rules[confKey]?.wins || 0) + (rules[confKey]?.losses || 0);
    if (confWR < 0.3) {
      penaltyScore += 2;
      reasons.push(`Confidence ${a.confidence}% range has ${sf(confWR*100,0)}% win rate (${confTotal} trades)`);
    }
    else if (confWR >= 0.6) bonusScore += 1;
  }
  
  // Check BTC correlation range
  if (a.btcCorr != null) {
    const corrKey = a.btcCorr < 0.3 ? 'corr_low' : a.btcCorr < 0.6 ? 'corr_mid' : 'corr_high';
    const corrWR = getRecencyWeightedWinRate(rules[corrKey]);
    if (corrWR !== null) {
      const corrTotal = (rules[corrKey]?.wins || 0) + (rules[corrKey]?.losses || 0);
      if (corrWR < 0.3) {
        penaltyScore += 2;
        reasons.push(`BTC corr ${sf(a.btcCorr,2)} range has ${sf(corrWR*100,0)}% win rate (${corrTotal} trades)`);
      }
      else if (corrWR >= 0.6) bonusScore += 1;
    }
  }
  
  // Check combo conditions (most powerful signals)
  const scoreBucket = Math.floor(a.composite / 10) * 10;
  const comboKey = `combo_score${scoreBucket}_${currentScoringRegime?.key || 'unknown'}`;
  const comboWR = getRecencyWeightedWinRate(rules[comboKey]);
  if (comboWR !== null) {
    const comboTotal = (rules[comboKey]?.wins || 0) + (rules[comboKey]?.losses || 0);
    if (comboWR < 0.3) {
      penaltyScore += 4;
      reasons.push(`Score ${scoreBucket}+ in ${currentScoringRegime?.label || 'this'} regime has ${sf(comboWR*100,0)}% win rate (${comboTotal} trades)`);
    }
    else if (comboWR >= 0.65) bonusScore += 3;
  }
  
  // Decision: block only if penalty significantly outweighs bonus
  const netScore = bonusScore - penaltyScore;
  const passed = netScore > -4;
  
  // Store explanation for UI display
  if (!passed && reasons.length > 0) {
    coin._learnedBlockReason = reasons.join(' · ');
    console.log(`[LearnedRules] BLOCKED ${coin.symbol.toUpperCase()}: ${coin._learnedBlockReason}`);
  }
  
  return passed;
}

// ============ Daily Log & Stats ============

function updateDailyLog() {
  const today = new Date().toISOString().slice(0, 10);
  const existing = autoTradeState.dailyLog.find(d => d.date === today);
  const equity = getTotalEquity();
  
  if (!existing) {
    autoTradeState.dailyLog.push({
      date: today,
      startEquity: equity,
      endEquity: equity,
      trades: 0,
      wins: 0,
      losses: 0,
      pnl: 0,
    });
  } else {
    existing.endEquity = equity;
    // Count today's closed trades
    const todayTrades = autoTradeState.history.filter(t => 
      t.exitTime && new Date(t.exitTime).toISOString().slice(0,10) === today
    );
    existing.trades = todayTrades.length;
    existing.wins = todayTrades.filter(t => t.isWin).length;
    existing.losses = todayTrades.filter(t => !t.isWin).length;
    existing.pnl = todayTrades.reduce((a, t) => a + (t.pnlAmount || 0), 0);
  }
}

// ============ UI Rendering ============

function renderAutoTradePanel() {
  const container = document.getElementById('backtest-paper-trades');
  if (!container) return;
  
  const state = autoTradeState;
  const equity = getTotalEquity();
  const totalReturn = ((equity - state.startingCapital) / state.startingCapital) * 100;
  const winRate = state.totalTrades > 0 ? (state.wins / (state.wins + state.losses) * 100) : 0;
  const adaptiveScore = getAdaptiveMinScore();
  
  const openRows = state.positions.map(pos => {
    const coin = marketData.find(c => c.id === pos.coinId || c.symbol.toLowerCase() === pos.symbol.toLowerCase());
    const price = coin?.current_price || pos.entryPrice;
    const pnl = ((price - pos.entryPrice) / pos.entryPrice) * 100;
    const age = DateFormatter.relative(pos.entryTime);
    return `<tr>
      <td class="tracker-symbol">${pos.symbol}</td>
      <td>${formatINR(pos.entryPrice)}</td>
      <td>${formatINR(price)}</td>
      <td class="${pnl >= 0 ? 'text-green' : 'text-red'}"><strong>${sf(pnl,2)}%</strong></td>
      <td>${formatINR(pos.stopLoss)}</td>
      <td>${pos.tp1Hit ? '✓ TP1' : formatINR(pos.takeProfit1)}</td>
      <td>${age}</td>
      <td>${pos.score}</td>
    </tr>`;
  }).join('');
  
  const recentHistory = state.history.slice(-15).reverse();
  const historyRows = recentHistory.map(t => {
    const pnlCls = t.isWin ? 'text-green' : 'text-red';
    return `<tr>
      <td class="tracker-symbol">${t.symbol}</td>
      <td>${formatINR(t.entryPrice)}</td>
      <td>${formatINR(t.exitPrice)}</td>
      <td class="${pnlCls}"><strong>${sf(t.pnlPct,2)}%</strong></td>
      <td>${formatINR(t.pnlAmount)}</td>
      <td>${t.reason}</td>
      <td>${sf(t.holdingHours,1)}h</td>
      <td>${DateFormatter.dateShort(t.exitTime)}</td>
    </tr>`;
  }).join('');
  
  // Learned rules summary
  const rulesHtml = renderLearnedRules();
  
  container.innerHTML = `
    <div class="section-title">🤖 Autonomous Paper Trading Engine</div>
    <div class="autotrade-controls">
      <div class="autotrade-toggle">
        <button class="btn ${state.enabled ? 'btn-danger' : 'btn-success'}" onclick="toggleAutoTrade()">
          ${state.enabled ? '⏸ Pause Auto-Trading' : '▶ Start Auto-Trading'}
        </button>
        <span class="autotrade-status ${state.enabled ? 'text-green' : 'text-muted'}">
          ${state.enabled ? '● ACTIVE — scanning every 3 min' : '○ Paused'}
        </span>
      </div>
      <button class="btn btn-sm" onclick="resetAutoTrade()" title="Reset to ₹1,00,000">🔄 Reset</button>
    </div>
    
    <div class="grid-stats" style="margin-top:16px;">
      <div class="stat-card"><div class="stat-label">Equity</div><div class="stat-value ${totalReturn >= 0 ? 'text-green' : 'text-red'}">${formatINR(equity)}</div><div class="stat-sub">${totalReturn >= 0 ? '+' : ''}${sf(totalReturn,2)}% from ₹${state.startingCapital}</div></div>
      <div class="stat-card"><div class="stat-label">Free Capital</div><div class="stat-value">${formatINR(state.capital)}</div><div class="stat-sub">${state.positions.length} open positions</div></div>
      <div class="stat-card"><div class="stat-label">Win Rate</div><div class="stat-value ${winRate >= 50 ? 'text-green' : 'text-red'}">${state.totalTrades ? sf(winRate,1)+'%' : '--'}</div><div class="stat-sub">${state.wins}W / ${state.losses}L (${state.totalTrades} total)</div></div>
      <div class="stat-card"><div class="stat-label">Max Drawdown</div><div class="stat-value text-red">${sf(state.maxDrawdown,1)}%</div><div class="stat-sub">Adaptive min score: ${adaptiveScore}</div></div>
    </div>
    
    ${state.positions.length > 0 ? `
      <h4 style="margin:16px 0 8px;">Open Positions (${state.positions.length})</h4>
      <table aria-label="Auto-trade open positions"><thead><tr><th>Coin</th><th>Entry</th><th>Current</th><th>P&L</th><th>Stop</th><th>Target</th><th>Age</th><th>Score</th></tr></thead><tbody>${openRows}</tbody></table>
    ` : '<p class="text-muted" style="margin:12px 0;">No open positions.</p>'}
    
    ${recentHistory.length > 0 ? `
      <h4 style="margin:16px 0 8px;">Recent Trades</h4>
      <table aria-label="Auto-trade history"><thead><tr><th>Coin</th><th>Entry</th><th>Exit</th><th>P&L %</th><th>P&L ₹</th><th>Reason</th><th>Held</th><th>Date</th></tr></thead><tbody>${historyRows}</tbody></table>
    ` : ''}
    
    ${rulesHtml}
    ${typeof renderTradeJournal === 'function' ? renderTradeJournal() : ''}
  `;
}

function renderLearnedRules() {
  const rules = autoTradeState.learnedRules;
  const entries = Object.entries(rules).filter(([, v]) => (v.wins + v.losses) >= 3);
  if (entries.length === 0) return '<p class="text-muted" style="margin:12px 0;font-size:0.82rem;">No learned rules yet — the system needs 15+ closed trades to start self-optimizing.</p>';
  
  const rows = entries
    .map(([key, data]) => {
      const total = data.wins + data.losses;
      const rawWinRate = data.wins / total * 100;
      const recentWR = getRecencyWeightedWinRate(data);
      const recentRet = getRecencyWeightedReturn(data);
      const displayWR = recentWR !== null ? (recentWR * 100) : rawWinRate;
      const displayRet = recentRet !== null ? recentRet : (data.totalReturn / total);
      const label = key.replace(/_/g, ' ').replace(/^(score|regime|rsi|conf|corr|vol|exit|hold|combo)/, m => m.charAt(0).toUpperCase() + m.slice(1));
      
      // Determine verdict based on recency-weighted data
      let verdict, cls;
      if (displayWR >= 58 && displayRet > 0.5) { verdict = '✓ Strong Edge'; cls = 'text-green'; }
      else if (displayWR >= 50 && displayRet > 0) { verdict = '✓ Edge'; cls = 'text-green'; }
      else if (displayWR < 38 || displayRet < -2) { verdict = '✗ Avoid'; cls = 'text-red'; }
      else { verdict = '~ Neutral'; cls = 'text-warning'; }
      
      // Priority for sorting: combo rules first, then by trade count
      const isCombo = key.startsWith('combo_');
      const sortWeight = (isCombo ? 1000 : 0) + total;
      
      return { key, label, total, displayWR, displayRet, verdict, cls, sortWeight };
    })
    .sort((a, b) => b.sortWeight - a.sortWeight)
    .slice(0, 15)
    .map(r => `<tr><td>${r.label}</td><td>${r.total}</td><td class="${r.cls}">${sf(r.displayWR,0)}%</td><td class="${r.displayRet >= 0 ? 'text-green' : 'text-red'}">${sf(r.displayRet,2)}%</td><td class="${r.cls}">${r.verdict}</td></tr>`)
    .join('');
  
  const totalClosed = autoTradeState.wins + autoTradeState.losses;
  const adaptiveScore = getAdaptiveMinScore();
  const rulesActive = totalClosed >= 20;
  
  return `
    <h4 style="margin:16px 0 8px;">🧠 Learned Rules (Self-Optimizing)</h4>
    <p class="text-muted" style="font-size:0.78rem;margin-bottom:8px;">
      ${rulesActive 
        ? `Active — filtering trades based on ${entries.length} learned patterns. Adaptive min score: ${adaptiveScore}. Recent trades weighted 2.5x more than old ones.`
        : `Collecting data (${totalClosed}/20 trades needed to activate). Currently using default rules.`
      }
    </p>
    <table aria-label="Learned trading rules"><thead><tr><th>Condition</th><th>Trades</th><th>Win Rate (recent)</th><th>Avg Return (recent)</th><th>Verdict</th></tr></thead><tbody>${rows}</tbody></table>
  `;
}

// ============ Controls ============

function toggleAutoTrade() {
  autoTradeState.enabled = !autoTradeState.enabled;
  saveAutoTradeState();
  renderAutoTradePanel();
  
  if (autoTradeState.enabled) {
    console.log('[AutoTrade] ▶ ENABLED — will trade on next scan cycle');
    showAlertToast('🤖 Auto-trading ENABLED — system will trade autonomously');
  } else {
    console.log('[AutoTrade] ⏸ PAUSED');
    showAlertToast('⏸ Auto-trading PAUSED');
  }
}

function resetAutoTrade() {
  if (!confirm('Reset auto-trade? This will close all positions and reset capital to ₹1,00,000. Trade history will be preserved.')) return;
  
  // Close all open positions at current price
  autoTradeState.positions.forEach(pos => {
    const coin = marketData.find(c => c.id === pos.coinId || c.symbol.toLowerCase() === pos.symbol.toLowerCase());
    const price = coin?.current_price || pos.entryPrice;
    autoClosePosition(pos, price, 'manual-reset');
  });
  
  autoTradeState.capital = AUTOTRADE_CONFIG.initialCapital;
  autoTradeState.startingCapital = AUTOTRADE_CONFIG.initialCapital;
  autoTradeState.positions = [];
  autoTradeState.peakCapital = AUTOTRADE_CONFIG.initialCapital;
  autoTradeState.maxDrawdown = 0;
  autoTradeState.totalTrades = 0;
  autoTradeState.wins = 0;
  autoTradeState.losses = 0;
  autoTradeState.totalPnl = 0;
  autoTradeState.lastLossTime = 0;
  autoTradeState.learnedRules = {};
  autoTradeState.enabled = false;
  
  saveAutoTradeState();
  renderAutoTradePanel();
  showAlertToast('🔄 Auto-trade reset to ₹1,00,000');
}

// ============ Mini Widget (shown on Market Scan tab) ============

/**
 * Renders a compact auto-trade status card on the scanner view
 */
function renderAutoTradeMiniWidget() {
  const container = document.getElementById('autotrade-mini-widget');
  if (!container) return;
  
  const state = autoTradeState;
  const equity = getTotalEquity();
  const totalReturn = ((equity - state.startingCapital) / state.startingCapital) * 100;
  const totalClosed = state.wins + state.losses;
  const winRate = totalClosed > 0 ? (state.wins / totalClosed * 100) : 0;
  
  // Open positions summary
  const openPositions = state.positions;
  let positionsHtml = '';
  if (openPositions.length > 0) {
    const posItems = openPositions.map(pos => {
      const coin = marketData.find(c => c.id === pos.coinId || c.symbol.toLowerCase() === pos.symbol.toLowerCase());
      const price = coin?.current_price || pos.entryPrice;
      const pnl = ((price - pos.entryPrice) / pos.entryPrice) * 100;
      const pnlCls = pnl >= 0 ? 'text-green' : 'text-red';
      return `<span class="at-mini-pos"><strong>${pos.symbol}</strong> <span class="${pnlCls}">${pnl >= 0 ? '+' : ''}${sf(pnl,1)}%</span></span>`;
    }).join('');
    positionsHtml = `<div class="at-mini-positions">${posItems}</div>`;
  }
  
  // Last trade info
  const lastTrade = state.history.length > 0 ? state.history[state.history.length - 1] : null;
  let lastTradeHtml = '';
  if (lastTrade) {
    const ltCls = lastTrade.isWin ? 'text-green' : 'text-red';
    lastTradeHtml = `<span class="at-mini-last">Last: <strong>${lastTrade.symbol}</strong> <span class="${ltCls}">${lastTrade.isWin ? '+' : ''}${sf(lastTrade.pnlPct,1)}%</span> (${lastTrade.reason}) ${DateFormatter.relative(lastTrade.exitTime)}</span>`;
  }
  
  const statusCls = state.enabled ? 'at-mini-active' : 'at-mini-paused';
  const statusIcon = state.enabled ? '●' : '○';
  const statusText = state.enabled ? 'Auto-Trading Active' : 'Auto-Trading Paused';
  
  container.innerHTML = `
    <div class="at-mini-card ${statusCls}" role="status" aria-label="Auto-trade status">
      <div class="at-mini-header">
        <span class="at-mini-status">${statusIcon} ${statusText}</span>
        <button class="btn btn-sm ${state.enabled ? 'btn-danger' : 'btn-success'}" onclick="toggleAutoTrade();renderAutoTradeMiniWidget()" style="padding:3px 10px;font-size:0.68rem;">
          ${state.enabled ? '⏸ Pause' : '▶ Start'}
        </button>
      </div>
      <div class="at-mini-stats">
        <span class="at-mini-stat">
          <span class="at-mini-label">Equity</span>
          <span class="at-mini-value ${totalReturn >= 0 ? 'text-green' : 'text-red'}">${formatINR(equity)} <small>(${totalReturn >= 0 ? '+' : ''}${sf(totalReturn,1)}%)</small></span>
        </span>
        <span class="at-mini-stat">
          <span class="at-mini-label">Win Rate</span>
          <span class="at-mini-value ${winRate >= 50 ? 'text-green' : totalClosed > 0 ? 'text-red' : ''}">${totalClosed > 0 ? sf(winRate,0)+'%' : '--'} <small>(${state.wins}W/${state.losses}L)</small></span>
        </span>
        <span class="at-mini-stat">
          <span class="at-mini-label">Open</span>
          <span class="at-mini-value">${openPositions.length}/${AUTOTRADE_CONFIG.maxOpenPositions}</span>
        </span>
        <span class="at-mini-stat">
          <span class="at-mini-label">Min Score</span>
          <span class="at-mini-value">${getAdaptiveMinScore()}</span>
        </span>
      </div>
      ${positionsHtml}
      ${lastTradeHtml}
      ${typeof renderDailySummaryHtml === 'function' ? renderDailySummaryHtml() : ''}
      ${typeof renderAnomalyAlerts === 'function' ? renderAnomalyAlerts() : ''}
      ${renderBlockedCoinsHtml()}
    </div>
  `;
}

/**
 * Renders blocked coins with explanations in the mini widget
 */
function renderBlockedCoinsHtml() {
  const blocked = autoTradeState._lastBlockedCoins;
  if (!blocked?.length) return '';
  
  const items = blocked.slice(0, 3).map(b => 
    `<div class="at-mini-blocked-item"><strong>${b.symbol}</strong> <span>${b.reason}</span></div>`
  ).join('');
  
  return `<div class="at-mini-blocked">
    <span class="at-mini-blocked-title">🚫 Blocked by learned rules:</span>
    ${items}
  </div>`;
}
