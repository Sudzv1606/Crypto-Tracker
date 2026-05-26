function resampleToDaily(hourlyPrices) {
  if (!hourlyPrices || hourlyPrices.length < 24) return [];
  const dailyCloses = [];
  for (let i = 0; i + 24 <= hourlyPrices.length; i += 24) {
    dailyCloses.push(hourlyPrices[i + 23]);
  }
  if (hourlyPrices.length % 24 !== 0) {
    dailyCloses.push(hourlyPrices[hourlyPrices.length - 1]);
  }
  return dailyCloses;
}

function calcRSI(prices, period = 14) {
  if (period < 1 || !prices || prices.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  const avgGain = gains / period, avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return 100 - (100 / (1 + avgGain / avgLoss));
}

function calcMACD(prices, fast = 3, slow = 7, signal = 3) {
  if (!prices || prices.length < slow + signal) return null;
  const ema = (data, period) => {
    const k = 2 / (period + 1);
    let emaArr = [data[0]];
    for (let i = 1; i < data.length; i++) emaArr.push(data[i] * k + emaArr[i - 1] * (1 - k));
    return emaArr;
  };
  const fastEMA = ema(prices, fast), slowEMA = ema(prices, slow);
  const macdLine = fastEMA.map((v, i) => v - slowEMA[i]);
  const signalLine = ema(macdLine, signal);
  const histogram = macdLine.map((v, i) => v - signalLine[i]);
  const last = macdLine.length - 1;
  const prev = Math.max(0, last - 1);
  return {
    macd: macdLine[last], signal: signalLine[last], histogram: histogram[last],
    macdPrev: macdLine[prev], signalPrev: signalLine[prev], histPrev: histogram[prev],
    crossover: (histogram[last] > 0 && histogram[prev] <= 0) ? 'bullish' : ((histogram[last] < 0 && histogram[prev] >= 0) ? 'bearish' : null),
    trend: histogram[last] > histogram[prev] ? 'up' : 'down'
  };
}

function pricesToReturns(prices) {
  if (!prices || prices.length < 2) return [];
  const returns = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push(prices[i - 1] === 0 ? 0 : (prices[i] - prices[i - 1]) / prices[i - 1]);
  }
  return returns;
}

function calcPearsonCorrelation(pricesA, pricesB) {
  const a = pricesToReturns(pricesA);
  const b = pricesToReturns(pricesB);
  if (a.length < 5 || b.length < 5) return null;
  const n = Math.min(a.length, b.length);
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (let i = 0; i < n; i++) { sumX += a[i]; sumY += b[i]; sumXY += a[i] * b[i]; sumX2 += a[i] ** 2; sumY2 += b[i] ** 2; }
  const num = n * sumXY - sumX * sumY;
  const den = Math.sqrt((n * sumX2 - sumX ** 2) * (n * sumY2 - sumY ** 2));
  return den === 0 ? null : num / den;
}

function detectVolumeSpike(currentVol, sparklineVolumes) {
  if (!sparklineVolumes || sparklineVolumes.length < 20) return null;
  const recent = sparklineVolumes.slice(-24);
  const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
  if (avg <= 0) return null;
  return { ratio: currentVol / avg, avg, current: currentVol };
}

function average(values) {
  const clean = (values || []).filter(v => typeof v === 'number' && isFinite(v));
  return clean.length ? clean.reduce((a, b) => a + b, 0) / clean.length : null;
}

function standardDeviation(values) {
  const avg = average(values);
  if (avg === null) return null;
  const variance = values.reduce((a, v) => a + ((v - avg) ** 2), 0) / values.length;
  return Math.sqrt(variance);
}

function calcBollingerBands(prices, period = 20, mult = 2) {
  if (!prices || prices.length < period) return null;
  const window = prices.slice(-period);
  const mid = average(window);
  const sd = standardDeviation(window);
  const last = prices[prices.length - 1];
  if (mid === null || sd === null || mid === 0) return null;
  const upper = mid + sd * mult;
  const lower = mid - sd * mult;
  const bandwidth = ((upper - lower) / mid) * 100;
  const position = (upper - lower) !== 0 ? (last - lower) / (upper - lower) : 0.5;
  return { upper, middle: mid, lower, bandwidth, position };
}

function calcATR(candles, period = 14) {
  if (!candles || candles.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  const recent = trs.slice(-period);
  const atr = average(recent);
  const lastClose = candles[candles.length - 1].close;
  return atr === null ? null : { atr, atrPct: lastClose > 0 ? (atr / lastClose) * 100 : null };
}

function calcKeltnerChannels(candles, period = 20, mult = 1.5) {
  if (!candles || candles.length < period + 1) return null;
  const closes = candles.map(c => c.close);
  const mid = average(closes.slice(-period));
  const atr = calcATR(candles, Math.min(14, period - 1));
  if (mid === null || !atr) return null;
  return { upper: mid + atr.atr * mult, middle: mid, lower: mid - atr.atr * mult, widthPct: mid > 0 ? (atr.atr * mult * 2 / mid) * 100 : null };
}

function calcADX(candles, period = 14) {
  if (!candles || candles.length < period + 2) return null;
  const plusDM = [], minusDM = [], tr = [];
  for (let i = 1; i < candles.length; i++) {
    const curr = candles[i], prev = candles[i - 1];
    const upMove = curr.high - prev.high;
    const downMove = prev.low - curr.low;
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    tr.push(Math.max(curr.high - curr.low, Math.abs(curr.high - prev.close), Math.abs(curr.low - prev.close)));
  }
  const recentTR = tr.slice(-period);
  const trSum = recentTR.reduce((a, b) => a + b, 0);
  if (trSum === 0) return null;
  const pdi = 100 * plusDM.slice(-period).reduce((a, b) => a + b, 0) / trSum;
  const mdi = 100 * minusDM.slice(-period).reduce((a, b) => a + b, 0) / trSum;
  const dx = (pdi + mdi) === 0 ? 0 : 100 * Math.abs(pdi - mdi) / (pdi + mdi);
  return { adx: dx, plusDI: pdi, minusDI: mdi, trend: pdi >= mdi ? 'up' : 'down' };
}

function calcMovingAverageSlope(prices, period = 20) {
  if (!prices || prices.length < period + 6) return null;
  const recent = average(prices.slice(-period));
  const prior = average(prices.slice(-(period + 5), -5));
  if (recent === null || prior === null || prior === 0) return null;
  return ((recent - prior) / prior) * 100;
}

function calcSupportResistance(candles, lookback = 72) {
  if (!candles || candles.length < 12) return null;
  const recent = candles.slice(-lookback);
  const lows = recent.map(c => c.low);
  const highs = recent.map(c => c.high);
  const close = recent[recent.length - 1].close;
  const support = Math.min(...lows);
  const resistance = Math.max(...highs);
  const range = resistance - support;
  return {
    support,
    resistance,
    rangePct: close > 0 ? (range / close) * 100 : null,
    distanceToSupportPct: close > 0 ? ((close - support) / close) * 100 : null,
    distanceToResistancePct: close > 0 ? ((resistance - close) / close) * 100 : null,
    breakout: close > resistance * 0.995,
    breakdown: close < support * 1.005,
  };
}

function calcVWAP(candles, lookback = 48) {
  if (!candles || candles.length < 3) return null;
  const recent = candles.slice(-lookback);
  let pv = 0, vol = 0;
  recent.forEach(c => {
    const typical = (c.high + c.low + c.close) / 3;
    pv += typical * (c.volume || 0);
    vol += c.volume || 0;
  });
  return vol > 0 ? pv / vol : null;
}
