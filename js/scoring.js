function classifyScoringRegime(data) {
  const empty = { key: 'unknown', label: 'Unknown', weights: getRegimeWeights('unknown') };
  if (!data || data.length < 10) return empty;
  const underLimit = data.filter(c => (c.market_cap || 0) > 0 && (c.market_cap || 0) <= CONFIG.MAX_MCAP_INR);
  if (underLimit.length === 0) return empty;

  const avg24h = underLimit.reduce((a, c) => a + (c.price_change_percentage_24h || 0), 0) / underLimit.length;
  const avg7d = underLimit.reduce((a, c) => a + (c.price_change_percentage_7d_in_currency || 0), 0) / underLimit.length;
  const pctPositive = underLimit.filter(c => (c.price_change_percentage_24h || 0) > 0).length / underLimit.length;
  const avgVol = underLimit.reduce((a, c) => a + ((c.total_volume / (c.market_cap || 1)) || 0), 0) / underLimit.length;

  let key = 'sideways', label = 'Sideways';
  if (avg24h > 2 && avg7d > 4 && pctPositive > 0.6 && avgVol > 0.05) { key = 'strongBull'; label = 'Strong Bull'; }
  else if (avg24h > 0.5 && avg7d > 1 && pctPositive > 0.5) { key = 'mildBull'; label = 'Mild Bull'; }
  else if (avg24h < -2 && avg7d < -3 && pctPositive < 0.4) { key = 'bear'; label = 'Bear'; }
  else if (avg24h < -1 && avg7d < -1 && pctPositive < 0.5) { key = 'mildBear'; label = 'Mild Bear'; }
  return { key, label, avg24h, avg7d, pctPositive, avgVol, weights: getRegimeWeights(key) };
}

function getRegimeWeights(key) {
  const presets = {
    strongBull: { mom: 22, vol: 18, rsi: 7,  macd: 11, corr: 6,  fg: 5,  news: 5, ath: 6, btcDom: 5, dev: 8, setup: 7 },
    mildBull:   { mom: 20, vol: 17, rsi: 9,  macd: 10, corr: 7,  fg: 7,  news: 5, ath: 7, btcDom: 5, dev: 6, setup: 7 },
    sideways:   { mom: 14, vol: 14, rsi: 16, macd: 8,  corr: 9,  fg: 10, news: 5, ath: 8, btcDom: 4, dev: 5, setup: 7 },
    mildBear:   { mom: 12, vol: 12, rsi: 17, macd: 7,  corr: 11, fg: 13, news: 5, ath: 8, btcDom: 5, dev: 4, setup: 6 },
    bear:       { mom: 9,  vol: 11, rsi: 19, macd: 6,  corr: 12, fg: 16, news: 4, ath: 9, btcDom: 6, dev: 3, setup: 5 },
    unknown:    { mom: 18, vol: 16, rsi: 12, macd: 9,  corr: 8,  fg: 8,  news: 5, ath: 7, btcDom: 5, dev: 6, setup: 6 },
  };
  return presets[key] || presets.unknown;
}

function getLearnedThresholds() {
  const outcomes = [];
  signalLog.forEach(s => {
    const ret = s.forwardReturns?.['24h'] ?? s.forwardReturns?.['3d'] ?? s.forwardReturns?.['7d'];
    if (typeof ret === 'number' && typeof s.score === 'number') outcomes.push({ score: s.score, ret });
  });

  if (outcomes.length < 20) {
    learnedThresholds = { buy: 45, strongBuy: 65, sampleSize: outcomes.length, source: 'default' };
    return learnedThresholds;
  }

  const candidates = [];
  for (let threshold = 35; threshold <= 75; threshold += 5) {
    const bucket = outcomes.filter(o => o.score >= threshold);
    if (bucket.length < 8) continue;
    const winRate = bucket.filter(o => o.ret > 0).length / bucket.length;
    const avgReturn = bucket.reduce((a, o) => a + o.ret, 0) / bucket.length;
    candidates.push({ threshold, winRate, avgReturn, count: bucket.length });
  }

  const buyPick = candidates
    .filter(c => c.winRate >= 0.52 || c.avgReturn > 1)
    .sort((a, b) => (b.avgReturn + b.winRate * 2) - (a.avgReturn + a.winRate * 2))[0];

  const strongPick = candidates
    .filter(c => c.threshold >= (buyPick?.threshold || 45) + 10 && c.count >= 5)
    .sort((a, b) => (b.avgReturn + b.winRate * 3) - (a.avgReturn + a.winRate * 3))[0];

  const buy = buyPick ? Math.max(35, Math.min(70, buyPick.threshold)) : 45;
  const strongBuy = strongPick ? Math.max(buy + 10, Math.min(85, strongPick.threshold)) : Math.max(65, buy + 15);
  learnedThresholds = { buy, strongBuy, sampleSize: outcomes.length, source: 'learned' };
  return learnedThresholds;
}

function computeMarketTrendGates(data) {
  const btc = data.find(c => c.id === 'bitcoin' || c.symbol === 'btc');
  const eth = data.find(c => c.id === 'ethereum' || c.symbol === 'eth');
  const btc4hPrices = btc?._4h_prices || [];
  const btc4hSlope = calcMovingAverageSlope(btc4hPrices, Math.min(12, Math.max(6, btc4hPrices.length - 6)));
  const btcMacd4h = calcMACD(btc4hPrices);
  const btc4hPositive = btc4hSlope != null && btc4hSlope > 0 && (!btcMacd4h || btcMacd4h.trend === 'up');

  let ethBtcSlope = null;
  if (eth?._sparkline_prices?.length && btc?._sparkline_prices?.length) {
    const n = Math.min(eth._sparkline_prices.length, btc._sparkline_prices.length);
    const ratio = eth._sparkline_prices.slice(-n).map((p, i) => {
      const b = btc._sparkline_prices[btc._sparkline_prices.length - n + i];
      return b > 0 ? p / b : null;
    }).filter(v => v != null);
    ethBtcSlope = calcMovingAverageSlope(ratio, Math.min(24, Math.max(8, ratio.length - 6)));
  }
  const ethBtcPositive = ethBtcSlope != null ? ethBtcSlope > 0 : null;

  const btcDom = globalData?.market_cap_percentage?.btc ?? null;
  const btcDominanceState = btcDom == null ? null : btcDom > 55 ? 'alt_pressure' : btcDom < 42 ? 'alt_friendly' : 'neutral';
  const totalMcapChange = globalData?.market_cap_change_percentage_24h_usd ?? null;
  const totalMcapPositive = totalMcapChange == null ? null : totalMcapChange > 0;

  let penalty = 0;
  if (btc4hPositive === false) penalty += 8;
  if (ethBtcPositive === false) penalty += 5;
  if (btcDominanceState === 'alt_pressure') penalty += 4;
  if (totalMcapPositive === false) penalty += 4;

  const positives = [
    btc4hPositive === true ? 'BTC 4H up' : btc4hPositive === false ? 'BTC 4H down' : 'BTC 4H n/a',
    ethBtcPositive === true ? 'ETH/BTC up' : ethBtcPositive === false ? 'ETH/BTC down' : 'ETH/BTC n/a',
    btcDominanceState ? `BTC.D ${btcDominanceState.replace('_', ' ')}` : 'BTC.D n/a',
    totalMcapPositive === true ? 'Total cap up' : totalMcapPositive === false ? 'Total cap down' : 'Total cap n/a',
  ];

  return {
    btc4h: { positive: btc4hPositive, slope: btc4hSlope, macd: btcMacd4h },
    ethBtc: { positive: ethBtcPositive, slope: ethBtcSlope },
    btcDominance: { value: btcDom, state: btcDominanceState },
    totalMcap: { change24h: totalMcapChange, positive: totalMcapPositive },
    summary: positives.join(' | '),
    penalty,
  };
}

function scoreHorizon(label, rawScore) {
  const score = Math.max(0, Math.min(100, Math.round(rawScore)));
  if (score >= 70) return { label, score, action: 'High Conviction', cls: 'horizon-strong' };
  if (score >= 55) return { label, score, action: 'Tradable', cls: 'horizon-buy' };
  if (score >= 40) return { label, score, action: 'Watch', cls: 'horizon-watch' };
  return { label, score, action: 'Avoid', cls: 'horizon-avoid' };
}

function calcRealizedVolatility(prices) {
  const returns = pricesToReturns(prices || []).slice(-72);
  if (returns.length < 12) return null;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, r) => a + ((r - mean) ** 2), 0) / returns.length;
  return Math.sqrt(variance) * Math.sqrt(24) * 100;
}

function calcMaxDrawdown(prices) {
  if (!prices || prices.length < 3) return null;
  let peak = prices[0], maxDd = 0;
  prices.forEach(p => {
    if (p > peak) peak = p;
    if (peak > 0) maxDd = Math.min(maxDd, ((p - peak) / peak) * 100);
  });
  return maxDd;
}

function buildRiskPlan(coin, analysisInput) {
  const prices = coin._sparkline_prices || [];
  const current = coin.current_price || 0;
  const vol = calcRealizedVolatility(prices);
  const drawdown = calcMaxDrawdown(prices.slice(-72));
  const confidence = analysisInput.confidence || 0;
  const composite = analysisInput.composite || 0;
  const d24 = analysisInput.d24 || 0;
  const rsi = analysisInput.rsi;

  const volPenalty = vol == null ? 0.6 : vol > 18 ? 0.35 : vol > 12 ? 0.5 : vol > 8 ? 0.7 : 1;
  const qualityMultiplier = Math.max(0.25, Math.min(1, confidence / 75));
  const scoreMultiplier = Math.max(0.25, Math.min(1.2, composite / 70));
  const maxPositionPct = Math.max(0.25, Math.min(6, 4 * volPenalty * qualityMultiplier * scoreMultiplier));

  const stopPct = Math.max(4, Math.min(18, (vol || 8) * 0.8));
  const invalidationPct = Math.max(stopPct * 1.15, Math.abs(drawdown || 0) * 0.45, 5);
  const stopLoss = current > 0 ? current * (1 - stopPct / 100) : null;
  const invalidation = current > 0 ? current * (1 - invalidationPct / 100) : null;
  const target1Pct = stopPct * 1.5;
  const target2Pct = stopPct * 2.5;
  const takeProfit1 = current > 0 ? current * (1 + target1Pct / 100) : null;
  const takeProfit2 = current > 0 ? current * (1 + target2Pct / 100) : null;
  const riskReward = stopPct > 0 ? target1Pct / stopPct : null;

  let doNotTrade = null;
  if (vol != null && vol > 22) doNotTrade = 'Realized volatility is extreme; reduce size or wait for calmer candles.';
  else if (confidence < 35) doNotTrade = 'Indicator agreement is weak; score is not backed by enough confirmation.';
  else if (rsi != null && rsi > 78 && d24 > 8) doNotTrade = 'Price is extended and RSI is overheated after a sharp move.';
  else if ((coin.total_volume || 0) < 25000000) doNotTrade = 'Liquidity is thin for reliable execution.';

  return {
    maxPositionPct,
    stopLoss,
    stopPct,
    invalidation,
    invalidationPct,
    takeProfit1,
    takeProfit2,
    riskReward,
    realizedVolatility: vol,
    recentDrawdown: drawdown,
    doNotTrade,
  };
}

function enhancedScore(coin) {
  const rawP1h = coin.price_change_percentage_1h_in_currency;
  const rawD30 = coin.price_change_percentage_30d_in_currency;
  const p = rawP1h || 0;
  const d24 = coin.price_change_percentage_24h || 0;
  const d7 = coin.price_change_percentage_7d_in_currency || 0;
  const d30 = rawD30 || 0;
  const vol = coin.total_volume || 0;
  const mcap = coin.market_cap || 1;
  const volRatio = mcap > 0 ? vol / mcap : 0.03;
  const rank = coin.market_cap_rank || 9999;

  const hourlyPrices = coin._sparkline_prices || [];
  const hourlyCandles = coin._ohlcv_1h || [];
  const dailyPrices = resampleToDaily(hourlyPrices);
  const rsi = calcRSI(dailyPrices, Math.min(14, dailyPrices.length - 1));
  const macd = calcMACD(hourlyPrices);
  const btcPrices = btcData ? btcData._sparkline_prices : null;
  const btcCorr = calcPearsonCorrelation(hourlyPrices, btcPrices);
  const bollinger = calcBollingerBands(hourlyPrices, Math.min(20, hourlyPrices.length));
  const keltner = calcKeltnerChannels(hourlyCandles, 20, 1.5);
  const atr = calcATR(hourlyCandles, 14);
  const adx = calcADX(hourlyCandles, 14);
  const maSlope = calcMovingAverageSlope(hourlyPrices, Math.min(24, Math.max(8, hourlyPrices.length - 6)));
  const supportResistance = calcSupportResistance(hourlyCandles, 72);
  const vwap = calcVWAP(hourlyCandles, 48);
  const lastPrice = hourlyPrices[hourlyPrices.length - 1] || coin.current_price || 0;

  // --- Momentum (0-100) ---
  let momentumScore = 0;
  if (p > 0.5) momentumScore += 10; else if (p > 0) momentumScore += 5;
  if (p < -1) momentumScore -= 10;
  if (d24 > 5) momentumScore += 25; else if (d24 > 2) momentumScore += 15; else if (d24 > 0) momentumScore += 5;
  if (d24 < -5) momentumScore -= 20; else if (d24 < -3) momentumScore -= 15;
  if (d7 > 10) momentumScore += 30; else if (d7 > 5) momentumScore += 20; else if (d7 > 0) momentumScore += 5;
  if (d7 < -10) momentumScore -= 20; else if (d7 < -5) momentumScore -= 15;
  if (d30 > 10) momentumScore += 20; else if (d30 > 3) momentumScore += 10;
  if (d30 < -10) momentumScore -= 15;
  momentumScore = Math.max(0, Math.min(100, momentumScore));

  // --- Volume (0-100) ---
  let volumeScore = 0;
  if (volRatio > 0.10) volumeScore += 50; else if (volRatio > 0.08) volumeScore += 40; else if (volRatio > 0.05) volumeScore += 30; else if (volRatio > 0.03) volumeScore += 15;
  if (volRatio < 0.01) volumeScore -= 20; else if (volRatio < 0.015) volumeScore -= 10;
  let volumeConfirmation = null;
  const volumeSeries = coin._quote_volume_1h?.length ? coin._quote_volume_1h : coin._volume_1h;
  if (volumeSeries?.length > 48) {
    const recentVols = volumeSeries.slice(-24);
    const olderVols = volumeSeries.slice(-48, -24);
    const recentAvg = recentVols.reduce((a,b) => a+b, 0) / recentVols.length;
    const olderAvg = olderVols.reduce((a,b) => a+b, 0) / olderVols.length;
    const ratio = olderAvg > 0 ? recentAvg / olderAvg : null;
    volumeConfirmation = { ratio, recentAvg, olderAvg };
    if (ratio > 1.5) volumeScore += 25;
    else if (ratio > 1.2) volumeScore += 10;
  }
  volumeScore = Math.max(0, Math.min(100, volumeScore));

  // --- RSI (0-100) ---
  let rsiScore = 0;
  if (rsi !== null) {
    if (rsi < 30) rsiScore = 90;
    else if (rsi < 35) rsiScore = 70;
    else if (rsi < 45) rsiScore = 50;
    else if (rsi >= 45 && rsi <= 55) rsiScore = 30;
    else if (rsi > 55 && rsi <= 65) rsiScore = 15;
    else if (rsi > 65 && rsi <= 75) rsiScore = 5;
    else if (rsi > 75) rsiScore = 0;
  }

  // --- MACD (0-100) ---
  let macdScore = 0;
  if (macd !== null) {
    if (macd.crossover === 'bullish') macdScore = 90;
    else if (macd.crossover === 'bearish') macdScore = 0;
    else if (macd.trend === 'up') macdScore = 60;
    else macdScore = 15;
  }

  // --- BTC Correlation (0-100) ---
  let corrScore = 0;
  if (btcCorr !== null) {
    if (btcCorr < 0.2) corrScore = 100;
    else if (btcCorr < 0.3) corrScore = 80;
    else if (btcCorr < 0.5) corrScore = 60;
    else if (btcCorr <= 0.7) corrScore = 40;
    else if (btcCorr <= 0.8) corrScore = 20;
    else corrScore = 5;
  }

  // --- Fear & Greed scaled by market cap tier (0-100) ---
  let sentimentScore = 0;
  if (fearGreedData) {
    const fgVal = parseInt(fearGreedData.value) || 50;
    let baseFG = 0;
    if (fgVal <= 20) baseFG = 90;
    else if (fgVal <= 30) baseFG = 70;
    else if (fgVal <= 40) baseFG = 50;
    else if (fgVal <= 55) baseFG = 30;
    else if (fgVal <= 70) baseFG = 10;
    else if (fgVal <= 80) baseFG = 0;
    else baseFG = -20;

    let capMultiplier = 1.0;
    if (rank > 300) capMultiplier = 0.4;
    else if (rank > 150) capMultiplier = 0.6;
    else if (rank > 50) capMultiplier = 0.8;

    sentimentScore = Math.max(0, Math.min(100, Math.round(baseFG * capMultiplier)));
  }

  // --- News (0-100) ---
  let newsScore = 0;
  const ns = newsSentimentMap[coin.id];
  if (ns) {
    const raw = ns.newsScore;
    newsScore = Math.max(0, Math.min(100, Math.round((raw + 10) * 5)));
  }

  // --- ATH Distance (0-100) ---
  let athScore = 0;
  const athDist = coin.ath_change_percentage;
  if (athDist != null) {
    if (athDist > -5) athScore = 0;
    else if (athDist > -15) athScore = 10;
    else if (athDist > -30) athScore = 30;
    else if (athDist > -50) athScore = 50;
    else if (athDist > -70) athScore = 70;
    else if (athDist > -85) athScore = 85;
    else athScore = 95;
  }

  // --- BTC Dominance (0-100) ---
  let btcDomScore = 50;
  if (globalData) {
    const btcDom = globalData.market_cap_percentage?.btc || 50;
    if (btcDom > 60) btcDomScore = 10;
    else if (btcDom > 55) btcDomScore = 25;
    else if (btcDom > 48) btcDomScore = 50;
    else if (btcDom > 42) btcDomScore = 70;
    else btcDomScore = 90;
  }

  // --- Dev Activity (0-100) ---
  let devScore = 0;
  const dev = devActivityMap[coin.id];
  if (dev) {
    const commits = dev.commit_count_4_weeks || 0;
    const contributors = dev.pull_request_contributors || 0;
    const stars = dev.stars || 0;
    if (commits > 100 && contributors > 10) devScore = 100;
    else if (commits > 50 && contributors > 5) devScore = 80;
    else if (commits > 20 && contributors > 2) devScore = 60;
    else if (commits > 5 || contributors > 0) devScore = 35;
    else if (commits === 0 && contributors === 0 && stars < 10) devScore = 0;
    else devScore = 15;
  }

  let setupScore = 0;
  if (bollinger) {
    if (bollinger.bandwidth < 6 && d24 > 0) setupScore += 20;
    else if (bollinger.position > 0.2 && bollinger.position < 0.8) setupScore += 10;
    if (bollinger.position > 0.95) setupScore -= 10;
  }
  if (keltner && bollinger && bollinger.bandwidth < keltner.widthPct) setupScore += 15;
  if (adx) {
    if (adx.adx > 25 && adx.trend === 'up') setupScore += 25;
    else if (adx.adx > 20 && adx.trend === 'up') setupScore += 15;
    else if (adx.adx > 25 && adx.trend === 'down') setupScore -= 15;
  }
  if (maSlope != null) setupScore += maSlope > 1 ? 15 : maSlope > 0 ? 8 : maSlope < -1 ? -10 : 0;
  if (vwap && lastPrice > vwap) setupScore += 10;
  if (supportResistance) {
    if (supportResistance.distanceToResistancePct != null && supportResistance.distanceToResistancePct > 4) setupScore += 10;
    if (supportResistance.distanceToSupportPct != null && supportResistance.distanceToSupportPct < 2) setupScore -= 8;
    if (supportResistance.breakout) setupScore += 12;
  }
  setupScore = Math.max(0, Math.min(100, setupScore));

  const weights = (typeof getAIOptimizedWeights === 'function' && getAIOptimizedWeights()) || currentScoringRegime?.weights || getRegimeWeights('unknown');

  const factors = [
    { score: momentumScore, w: weights.mom,    has: true },
    { score: volumeScore,   w: weights.vol,    has: volRatio > 0 },
    { score: rsiScore,      w: weights.rsi,    has: rsi !== null },
    { score: macdScore,     w: weights.macd,   has: macd !== null },
    { score: corrScore,     w: weights.corr,   has: btcCorr !== null },
    { score: sentimentScore,w: weights.fg,     has: !!fearGreedData },
    { score: newsScore,     w: weights.news,   has: !!ns },
    { score: athScore,      w: weights.ath,    has: athDist != null },
    { score: btcDomScore,   w: weights.btcDom, has: !!globalData },
    { score: devScore,      w: weights.dev,    has: !!dev },
    { score: setupScore,    w: weights.setup,  has: !!(bollinger || adx || supportResistance || vwap) },
  ];

  const availableWeight = factors.reduce((s, f) => s + (f.has ? f.w : 0), 0);
  const rawSum = factors.reduce((s, f) => s + (f.has ? (f.score / 100) * f.w : 0), 0);
  const baseComposite = availableWeight > 0 ? Math.round((rawSum / availableWeight) * 100) : 0;
  const composite = Math.max(0, Math.min(100, baseComposite - (marketTrendGates?.penalty || 0)));

  const signals = [];
  if (rsi !== null) signals.push(rsi < 50 ? 1 : -1);
  if (macd !== null) signals.push(macd.crossover === 'bullish' || macd.trend === 'up' ? 1 : -1);
  if (d24 !== 0) signals.push(d24 > 0 ? 1 : -1);
  if (d7 !== 0) signals.push(d7 > 0 ? 1 : -1);
  if (btcCorr !== null) signals.push(btcCorr < 0.5 ? 1 : 0);
  if (volRatio > 0) signals.push(volRatio > 0.03 ? 1 : -1);
  if (ns) signals.push(ns.newsScore > 0 ? 1 : ns.newsScore < 0 ? -1 : 0);

  const bullishCount = signals.filter(s => s === 1).length;
  const totalSignals = signals.length;
  const indicatorsAvailable = (rsi !== null ? 1 : 0) + (macd !== null ? 1 : 0) + (btcCorr !== null ? 1 : 0) + (dailyPrices.length >= 3 ? 1 : 0) + (volRatio > 0 ? 1 : 0) + (athDist != null ? 1 : 0);
  const dataQuality = Math.min(1, indicatorsAvailable / 6);
  const agreement = totalSignals > 0 ? bullishCount / totalSignals : 0;
  const confidence = Math.round(dataQuality * agreement * 100);

  const thresholds = getLearnedThresholds();
  let action = 'AVOID', badgeClass = 'avoid', color = 'var(--danger)';
  if (composite >= thresholds.strongBuy) { action = 'STRONG BUY'; badgeClass = 'strong-buy'; color = 'var(--success)'; }
  else if (composite >= thresholds.buy) { action = 'BUY'; badgeClass = 'buy'; color = '#3b82f6'; }
  else if (composite >= 28) { action = 'HOLD'; badgeClass = 'hold'; color = 'var(--warning)'; }

  // Multi-Timeframe RSI & MACD
  const rsi_1h = calcRSI(hourlyPrices, Math.min(14, hourlyPrices.length - 1));
  const macd_1h = calcMACD(hourlyPrices);

  const fourHourPrices = coin._4h_prices || [];
  const rsi_4h = calcRSI(fourHourPrices, Math.min(14, fourHourPrices.length - 1));
  const macd_4h = calcMACD(fourHourPrices);

  const rsi_1d = rsi;
  const macd_1d = calcMACD(dailyPrices);

  const risk = buildRiskPlan(coin, { composite, confidence, d24, rsi });
  risk.atrPct = atr?.atrPct ?? null;
  const horizonSignals = {
    scalp: scoreHorizon('Scalp 1h-4h', (p > 0 ? 16 : -8) + (macd_1h?.trend === 'up' ? 18 : -8) + (volumeConfirmation?.ratio > 1.2 ? 14 : 0) + (adx?.trend === 'up' ? 10 : -5) + 35 - (marketTrendGates?.penalty || 0)),
    swing: scoreHorizon('Swing 1d-7d', composite * 0.45 + momentumScore * 0.2 + setupScore * 0.15 + confidence * 0.2 - (marketTrendGates?.penalty || 0)),
    position: scoreHorizon('Position 14d-30d', composite * 0.35 + devScore * 0.18 + athScore * 0.15 + btcDomScore * 0.12 + sentimentScore * 0.12 + (d30 > 0 ? 8 : -4) - (marketTrendGates?.penalty || 0)),
  };

  return { composite, baseComposite, action, badgeClass, color, confidence, thresholds, regimeKey: currentScoringRegime?.key || 'unknown', regimeWeights: weights, marketGates: marketTrendGates, momentumScore, volumeScore, rsiScore, macdScore, corrScore, sentimentScore, newsScore, athScore, btcDomScore, devScore, setupScore, ns, dev, rsi, macd, btcCorr, volRatio, dataQuality, d24, d7, d30: rawD30, p1h: rawP1h, athDist, rsi_1h, rsi_4h, rsi_1d, macd_1h, macd_4h, macd_1d, risk, bollinger, keltner, atr, adx, maSlope, supportResistance, vwap, volumeConfirmation, horizonSignals };
}

function detectRegime(data) {
  const empty = { regime: 'Insufficient Data', color: 'var(--text-muted)', details: '', avg24h: 0, avg7d: 0, pctPositive: 0, avgVol: 0, avgRSI: 50 };
  if (!data || data.length < 10) return empty;
  const underLimit = data.filter(c => (c.market_cap || 0) > 0 && (c.market_cap || 0) <= CONFIG.MAX_MCAP_INR);
  if (underLimit.length === 0) return empty;
  const avg24h = underLimit.reduce((a, c) => a + (c.price_change_percentage_24h || 0), 0) / underLimit.length;
  const avg7d = underLimit.reduce((a, c) => a + (c.price_change_percentage_7d_in_currency || 0), 0) / underLimit.length;
  const pctPositive = underLimit.filter(c => (c.price_change_percentage_24h || 0) > 0).length / underLimit.length;
  const avgVol = underLimit.reduce((a, c) => a + ((c.total_volume / (c.market_cap || 1)) || 0), 0) / underLimit.length;
  const avgRSI = underLimit.reduce((a, c) => a + (c.analysis?.rsi ?? 50), 0) / underLimit.length;
  const pctGreen = (pctPositive * 100);
  const pctRed = (100 - pctGreen);

  let regime, color, details = '';
  if (avg24h > 2 && avg7d > 4 && pctPositive > 0.6 && avgVol > 0.05) {
    regime = 'Strong Bull — High Momentum'; color = 'var(--success)';
    details = `${sf(pctGreen,0)}% coins green · Avg RSI ${sf(avgRSI,0)} · Vol healthy`;
  } else if (avg24h > 0.5 && avg7d > 1 && pctPositive > 0.5) {
    regime = 'Mild Bull — Accumulation'; color = '#3b82f6';
    details = `${sf(pctGreen,0)}% coins green · Avg RSI ${sf(avgRSI,0)}`;
  } else if (avg24h < -2 && avg7d < -3 && pctPositive < 0.4) {
    regime = 'Bearish — Distribution'; color = 'var(--danger)';
    details = `${sf(pctRed,0)}% coins red · Avg RSI ${sf(avgRSI,0)} · Caution`;
  } else if (avg24h < -1 && avg7d < -1 && pctPositive < 0.5) {
    regime = 'Mild Bear — Correction'; color = 'var(--warning)';
    details = `${sf(pctRed,0)}% coins red · Avg RSI ${sf(avgRSI,0)}`;
  } else {
    regime = 'Sideways — Consolidation'; color = 'var(--warning)';
    details = `${sf(pctGreen,0)}% coins green · Avg RSI ${sf(avgRSI,0)} · Range-bound`;
  }
  return { regime, color, details, avg24h, avg7d, pctPositive, avgVol, avgRSI };
}
