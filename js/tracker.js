function ensureForwardReturnFields(signal) {
  if (!signal.forwardReturns) signal.forwardReturns = {};
  if (!signal.forwardPrices) signal.forwardPrices = {};
}

function updateForwardReturns(data) {
  if (!signalLog.length || !data?.length) return;
  let changed = false;
  const now = Date.now();

  signalLog.forEach(signal => {
    ensureForwardReturnFields(signal);
    FORWARD_RETURN_HORIZONS.forEach(h => {
      if (signal.forwardReturns[h.key] !== undefined) return;
      if (now - signal.timestamp < h.ms) return;
      const sigSymbol = (signal.symbol || '').toLowerCase();
      const coin = data.find(c => c.id === signal.id || c.symbol?.toLowerCase() === sigSymbol);
      if (!coin?.current_price || !signal.price) return;
      signal.forwardPrices[h.key] = coin.current_price;
      signal.forwardReturns[h.key] = ((coin.current_price - signal.price) / signal.price) * 100;
      changed = true;
    });
  });

  if (changed) localStorage.setItem('quant_signal_log_v1', JSON.stringify(signalLog));
}

function getForwardReturnStats(signals) {
  const stats = {};
  FORWARD_RETURN_HORIZONS.forEach(h => {
    const values = signals
      .map(s => s.forwardReturns?.[h.key])
      .filter(v => typeof v === 'number' && isFinite(v));
    if (!values.length) {
      stats[h.key] = { count: 0, winRate: null, avg: null };
      return;
    }
    stats[h.key] = {
      count: values.length,
      winRate: values.filter(v => v > 0).length / values.length * 100,
      avg: values.reduce((a, v) => a + v, 0) / values.length,
    };
  });
  return stats;
}

function runWalkForwardValidation(signals, horizonKey = '24h', trainSize = 30, testSize = 10) {
  const completed = signals
    .filter(s => typeof s.score === 'number' && typeof s.forwardReturns?.[horizonKey] === 'number')
    .sort((a, b) => a.timestamp - b.timestamp);
  if (completed.length < trainSize + testSize) {
    return { ready: false, samples: completed.length, trainSize, testSize, avgReturn: null, winRate: null, trades: 0, windows: 0 };
  }

  const results = [];
  for (let start = 0; start + trainSize + testSize <= completed.length; start += testSize) {
    const train = completed.slice(start, start + trainSize);
    const test = completed.slice(start + trainSize, start + trainSize + testSize);
    let best = { threshold: 45, score: -Infinity };
    for (let threshold = 35; threshold <= 80; threshold += 5) {
      const picked = train.filter(s => s.score >= threshold);
      if (picked.length < 5) continue;
      const avg = picked.reduce((a, s) => a + s.forwardReturns[horizonKey], 0) / picked.length;
      const win = picked.filter(s => s.forwardReturns[horizonKey] > 0).length / picked.length;
      const rankScore = avg + win * 2;
      if (rankScore > best.score) best = { threshold, score: rankScore };
    }
    test.filter(s => s.score >= best.threshold).forEach(s => {
      results.push({ ret: s.forwardReturns[horizonKey], threshold: best.threshold });
    });
  }

  if (!results.length) return { ready: true, samples: completed.length, trainSize, testSize, avgReturn: null, winRate: null, trades: 0, windows: 0 };
  return {
    ready: true,
    samples: completed.length,
    trainSize,
    testSize,
    trades: results.length,
    windows: Math.floor((completed.length - trainSize) / testSize),
    avgReturn: results.reduce((a, r) => a + r.ret, 0) / results.length,
    winRate: results.filter(r => r.ret > 0).length / results.length * 100,
    avgThreshold: results.reduce((a, r) => a + r.threshold, 0) / results.length,
  };
}

function formatForwardReturns(signal) {
  ensureForwardReturnFields(signal);
  const parts = FORWARD_RETURN_HORIZONS.map(h => {
    const v = signal.forwardReturns[h.key];
    const cls = typeof v === 'number' ? (v >= 0 ? 'text-green' : 'text-red') : 'text-muted';
    return `<span class="${cls}" title="${h.label} forward return">${h.label}:${typeof v === 'number' ? formatPct(v) : 'pending'}</span>`;
  });
  return `<div class="forward-return-row">${parts.join(' ')}</div>`;
}

function logSignal(coin) {
  const exists = signalLog.find(s => s.id === coin.id && s.date === DateFormatter.today());
  if (exists) return;
  signalLog.push({
    id: coin.id,
    name: coin.name,
    symbol: coin.symbol,
    date: DateFormatter.today(),
    timestamp: Date.now(),
    score: coin.analysis.composite,
    signal: coin.analysis.action,
    price: coin.current_price,
    confidence: coin.analysis.confidence,
    rsi: coin.analysis.rsi,
    btcCorr: coin.analysis.btcCorr,
    result: null,
    regimeKey: coin.analysis.regimeKey,
    thresholds: coin.analysis.thresholds,
    risk: coin.analysis.risk,
    horizonSignals: coin.analysis.horizonSignals,
    marketGates: coin.analysis.marketGates,
    forwardReturns: {},
    forwardPrices: {},
  });
  signalLog = signalLog.slice(-500);
  localStorage.setItem('quant_signal_log_v1', JSON.stringify(signalLog));
}

function markSignalResult(index, result) {
  signalLog[index].result = result;
  localStorage.setItem('quant_signal_log_v1', JSON.stringify(signalLog));
  renderTracker();
}

function renderTracker() {
  const tbody = document.getElementById('tracker-table');
  tbody.innerHTML = '';
  const sorted = [...signalLog].sort((a, b) => b.timestamp - a.timestamp);
  const wins = sorted.filter(s => s.result === 'win').length;
  const losses = sorted.filter(s => s.result === 'loss').length;
  const total = wins + losses;
  const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : '--';
  const avgScore = sorted.length > 0 ? (sorted.reduce((a, s) => a + s.score, 0) / sorted.length).toFixed(1) : '--';
  const forwardStats = getForwardReturnStats(sorted);
  const wf = runWalkForwardValidation(sorted, '24h');
  const calibration = learnedThresholds || getLearnedThresholds();
  const horizonStatsHtml = FORWARD_RETURN_HORIZONS.map(h => {
    const st = forwardStats[h.key];
    const avgCls = st.avg == null ? 'text-muted' : st.avg >= 0 ? 'text-green' : 'text-red';
    return `<span class="${avgCls}">${h.label}: ${st.count ? `${sf(st.avg,2)}% avg / ${sf(st.winRate,0)}% win (${st.count})` : 'pending'}</span>`;
  }).join(' &middot; ');

  let patternHtml = '';
  if (aiSignalPatterns) {
    patternHtml = `<div class="ai-pattern-box">
      <h4>AI Pattern Analysis</h4>
      <div class="pattern-summary">${aiSignalPatterns.summary || ''}</div>
      ${aiSignalPatterns.patterns?.length ? `<ul class="ai-pattern-list">${aiSignalPatterns.patterns.map(p => `<li>${p}</li>`).join('')}</ul>` : ''}
      ${aiSignalPatterns.advice ? `<div class="ai-pattern-advice">${aiSignalPatterns.advice}</div>` : ''}
    </div>`;
  } else if (total >= 8 && AI_CONFIG.key) {
    patternHtml = `<div class="ai-pattern-box"><div class="ai-loading-pulse">Analyzing signal patterns...</div></div>`;
  }

  document.getElementById('tracker-stats').innerHTML = `
    <div class="stat-card" role="status"><div class="stat-label">Signals Logged</div><div class="stat-value">${sorted.length}</div></div>
    <div class="stat-card" role="status"><div class="stat-label">Manual Win Rate</div><div class="stat-value ${winRate >= 50 ? 'text-green' : 'text-red'}">${winRate}%</div><div class="stat-sub">${wins}W / ${losses}L</div></div>
    <div class="stat-card" role="status"><div class="stat-label">Avg Score</div><div class="stat-value">${avgScore}</div></div>
    <div class="stat-card" role="status"><div class="stat-label">Learned Thresholds</div><div class="stat-value stat-value-sm">BUY ${calibration.buy} / STRONG ${calibration.strongBuy}</div><div class="stat-sub">${calibration.source} &middot; ${calibration.sampleSize} completed samples</div></div>
    <div class="stat-card stat-card-full" role="status"><div class="stat-label">Forward Return Accuracy</div><div class="stat-sub">${horizonStatsHtml}</div></div>
    <div class="stat-card stat-card-full" role="status"><div class="stat-label">Walk-Forward Validation 24h</div><div class="stat-value stat-value-sm ${wf.avgReturn >= 0 ? 'text-green' : 'text-red'}">${wf.trades ? `${sf(wf.avgReturn,2)}% avg / ${sf(wf.winRate,0)}% win` : 'Collecting data'}</div><div class="stat-sub">Train ${wf.trainSize}, test ${wf.testSize}, samples ${wf.samples}, trades ${wf.trades}${wf.avgThreshold ? `, avg learned cutoff ${sf(wf.avgThreshold,0)}` : ''}</div></div>
  ` + patternHtml;

  sorted.slice(0, 50).forEach((s) => {
    const realIdx = signalLog.findIndex(l => l.id === s.id && l.timestamp === s.timestamp);
    const corr = s.btcCorr;
    const corrClass = corr !== null ? (corr > 0.7 ? 'corr-high' : corr > 0.4 ? 'corr-mid' : 'corr-low') : '';
    const corrLabel = corr !== null ? sf(corr,2) : 'N/A';
    const rsiLabel = s.rsi !== null ? sf(s.rsi,0) : 'N/A';
    const resultLabel = s.result === 'win' ? 'Win' : s.result === 'loss' ? 'Loss' : '--';
    const resultColor = s.result === 'win' ? 'text-green' : s.result === 'loss' ? 'text-red' : 'text-muted';
    const displayDate = s.timestamp ? DateFormatter.dateShort(s.timestamp) : s.date;
    tbody.innerHTML += `<tr>
      <td>${displayDate}</td><td class="tracker-symbol">${s.symbol.toUpperCase()}${formatForwardReturns(s)}</td>
      <td>${s.score}</td><td>${s.signal}<div class="tracker-sub">${s.regimeKey || 'unknown'} regime</div></td><td>${formatINR(s.price)}</td><td>${s.confidence}%</td>
      <td>${rsiLabel}</td><td><span class="corr-badge ${corrClass}">${corrLabel}</span></td>
      <td>
        <span class="${resultColor}">${resultLabel}</span>
        ${s.result === null && realIdx !== -1 ? `<span class="tracker-result-actions"><button class="btn btn-sm btn-success" onclick="markSignalResult(${realIdx},'win')" aria-label="Mark ${s.symbol.toUpperCase()} as win">Win</button><button class="btn btn-sm btn-danger" onclick="markSignalResult(${realIdx},'loss')" aria-label="Mark ${s.symbol.toUpperCase()} as loss">Loss</button></span>` : ''}
      </td></tr>`;
  });
  if (sorted.length === 0) tbody.innerHTML = '<tr><td colspan="9" class="tracker-empty">No signals logged yet. They appear after each market scan.</td></tr>';
}
