function computeCrossCorrelation(coins) {
  const strongBuys = coins
    .filter(c => (c.analysis?.action === 'STRONG BUY' || c.analysis?.action === 'BUY') && c._sparkline_prices?.length > 20)
    .sort((a, b) => b.analysis.composite - a.analysis.composite)
    .slice(0, 24);
  if (strongBuys.length < 2) { aiCorrelationWarnings = []; return; }

  const groups = [];
  const assigned = new Set();
  for (let i = 0; i < strongBuys.length; i++) {
    if (assigned.has(i)) continue;
    const group = [strongBuys[i]];
    assigned.add(i);
    for (let j = i + 1; j < strongBuys.length; j++) {
      if (assigned.has(j)) continue;
      const corr = calcPearsonCorrelation(strongBuys[i]._sparkline_prices, strongBuys[j]._sparkline_prices);
      if (corr !== null && corr > 0.75) { group.push(strongBuys[j]); assigned.add(j); }
    }
    if (group.length >= 2) groups.push(group);
  }
  aiCorrelationWarnings = groups.map(g => ({
    coins: g.map(c => c.id),
    message: `${g.map(c => c.symbol.toUpperCase()).join(', ')} are highly correlated (>0.75) — buying all gives similar exposure, not diversification.`
  }));
  aiCorrelationWarnings = aiCorrelationWarnings.map((w, idx) => {
    const group = groups[idx] || [];
    const leader = group.slice().sort((a, b) => b.analysis.composite - a.analysis.composite)[0];
    if (!leader) return w;
    return {
      ...w,
      leader: leader.id,
      message: `${group.map(c => c.symbol.toUpperCase()).join(', ')} are highly correlated (>0.75). Prefer ${leader.symbol.toUpperCase()} as the cluster leader; buying all gives duplicate exposure, not diversification.`
    };
  });

  aiCorrelationWarnings.forEach(w => {
    w.coins.forEach(id => {
      const coin = coins.find(c => c.id === id);
      if (!coin?.analysis) return;
      coin.analysis.correlationCluster = { leader: w.leader, isLeader: id === w.leader, members: w.coins };
      if (id !== w.leader) coin.analysis.clusterNote = 'Cluster duplicate: lower priority than leader.';
    });
  });
}

async function aiAnalyzePortfolio() {
  if (!AI_CONFIG.key || portfolio.length === 0 || marketData.length === 0) return;
  const holdingData = portfolio.map(item => {
    const mc = marketData.find(c => c.id === (item.id||'').toLowerCase() || c.symbol.toLowerCase() === (item.id||'').toLowerCase());
    if (!mc) return null;
    const a = mc.analysis || {};
    const cp = mc.current_price;
    const pnl = ((cp - item.buyPrice) / item.buyPrice * 100);
    return { sym: mc.symbol.toUpperCase(), id: mc.id, text: `${mc.symbol.toUpperCase()} | Bought:₹${sf(item.buyPrice)} Now:₹${sf(cp)} P&L:${sf(pnl)}% | Score:${a.composite||'?'} RSI:${sf(a.rsi,0)} MACD:${a.macd?.crossover||a.macd?.trend||'?'} 24h:${sf(a.d24)}% 7d:${sf(a.d7)}%` };
  }).filter(Boolean);
  if (holdingData.length === 0) return;

  const fg = fearGreedData;
  const regime = detectRegime(marketData);
  try {
    const resp = await fetch(AI_CONFIG.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${AI_CONFIG.key}`, 'HTTP-Referer': location.href },
      body: JSON.stringify({
        model: AI_CONFIG.model,
        messages: [{
          role: 'system',
          content: 'You are a crypto portfolio advisor. Return ONLY valid JSON. No markdown, no explanation.'
        }, {
          role: 'user',
          content: `Market: ${regime.regime} | F&G: ${fg ? fg.value + ' (' + fg.value_classification + ')' : 'N/A'}\n\nHoldings:\n${holdingData.map(h => h.text).join('\n')}\n\nReturn JSON mapping each coin symbol to:\n- "action": one of "ACCUMULATE","STRONG HOLD","HOLD","TAKE PARTIAL","EXIT"\n- "reason": 1 concise sentence factoring in P&L + indicators + current market conditions\n\nFormat: {"BTC":{"action":"HOLD","reason":"..."},...}`
        }],
        temperature: 0.2
      })
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    const parsed = JSON.parse(data.choices[0].message.content.replace(/```json\n?|\n?```/g, '').trim());
    holdingData.forEach(h => {
      if (parsed[h.sym]) aiPortfolioInsights[h.id] = parsed[h.sym];
    });
  } catch (e) {
    console.warn('AI portfolio analysis failed:', e.message);
  }
}

async function aiAnalyzeSignalPatterns() {
  if (!AI_CONFIG.key) { aiSignalPatterns = null; return; }
  const resolved = signalLog.filter(s => s.result !== null);
  if (resolved.length < 8) { aiSignalPatterns = null; return; }

  const logData = resolved.slice(-80).map(s =>
    `${s.symbol.toUpperCase()} ${s.signal} Score:${s.score} Conf:${s.confidence}% RSI:${sf(s.rsi,0)} Corr:${sf(s.btcCorr)} → ${s.result}`
  ).join('\n');

  try {
    const resp = await fetch(AI_CONFIG.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${AI_CONFIG.key}`, 'HTTP-Referer': location.href },
      body: JSON.stringify({
        model: AI_CONFIG.model,
        messages: [{
          role: 'system',
          content: 'You are a trading signal analyst. Find patterns in win/loss results. Return ONLY valid JSON.'
        }, {
          role: 'user',
          content: `Signal history:\n${logData}\n\nReturn JSON:\n- "summary": 2 sentences on overall signal quality and win rate patterns\n- "patterns": array of 2-4 specific data-backed patterns found, e.g. "Signals with RSI under 30 won 7/9 times"\n- "advice": 1 sentence — what conditions to trust and what to avoid\n\nFormat: {"summary":"...","patterns":["..."],"advice":"..."}`
        }],
        temperature: 0.2
      })
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    aiSignalPatterns = JSON.parse(data.choices[0].message.content.replace(/```json\n?|\n?```/g, '').trim());
  } catch (e) {
    console.warn('AI signal analysis failed:', e.message);
    aiSignalPatterns = null;
  }
}

function aiActionToBadge(action) {
  const map = {
    'ACCUMULATE': { text: '🟢 ACCUMULATE', cls: 'badge-strong-hold' },
    'STRONG HOLD': { text: '🟢 STRONG HOLD', cls: 'badge-strong-hold' },
    'HOLD': { text: '🔵 HOLD', cls: 'badge-hold' },
    'TAKE PARTIAL': { text: '🟧 TAKE PARTIAL', cls: 'badge-partial' },
    'EXIT': { text: '🟥 EXIT', cls: 'badge-sell' },
  };
  return map[action] || { text: action, cls: 'badge-hold' };
}

async function triggerDeepDive(coinId) {
  if (!AI_CONFIG.key) { alert('Paste your OpenRouter API key in AI_CONFIG.key (line ~120).'); return; }
  const coin = marketData.find(c => c.id === coinId);
  if (!coin?.analysis) return;
  const box = document.getElementById('ai-response-box');
  document.getElementById('ai-modal-title').innerText = `AI Report: ${coin.symbol.toUpperCase()}`;
  openModal('ai-modal');
  box.innerHTML = '<div class="loader"></div><div style="text-align:center;margin-top:12px;color:var(--text-muted);">Analyzing indicators…</div>';

  const a = coin.analysis;
  const fg = fearGreedData;
  const isTrending = trendingCoins.includes(coin.id);
  const ns = a.ns;
  const dev = a.dev;
  const btcDom = sf(globalData?.market_cap_percentage?.btc, 1) !== '—' ? sf(globalData?.market_cap_percentage?.btc, 1) : 'N/A';
  const newsContext = ns?.headlines?.length ? `\nRecent News Headlines:\n${ns.headlines.map((h,i) => `${i+1}. ${h}`).join('\n')}\nAI News Sentiment: ${ns.newsScore}/10` : '\nNo recent news found.';
  const devContext = dev ? `\nDeveloper Activity: ${dev.commit_count_4_weeks||0} commits (4w), ${dev.pull_request_contributors||0} contributors, ${dev.stars||0} stars` : '';
  const userData = `${coin.name} (${coin.symbol.toUpperCase()})
Price: ₹${coin.current_price} | Rank: #${coin.market_cap_rank||'N/A'}
Composite Score: ${a.composite}/100 (${a.action}, ${a.confidence}% confidence)
Timeframes: 1h:${sf(a.p1h)}% 24h:${sf(a.d24)}% 7d:${sf(a.d7)}% 30d:${sf(a.d30)}%
ATH Distance: ${sf(a.athDist,0)||'N/A'}% | BTC Dominance: ${btcDom}%
Daily RSI: ${sf(a.rsi,0)||'N/A'} | Hourly MACD(3,7,3): ${a.macd?.crossover||a.macd?.trend||'N/A'}
BTC 7d Correlation (on returns): ${sf(a.btcCorr)||'N/A'} | Vol/Mcap Ratio: ${sf(a.volRatio*100)}%
Sentiment: ${a.sentimentScore}/100 (mcap-scaled) | F&G Index: ${fg ? fg.value+'/100 ('+fg.value_classification+')' : 'N/A'}
Trending on CoinGecko: ${isTrending ? '🔥 YES' : 'No'}${newsContext}${devContext}
Sub-scores (all 0-100): Mom(${a.momentumScore}) Vol(${a.volumeScore}) RSI(${a.rsiScore}) MACD(${a.macdScore}) Corr(${a.corrScore}) F&G(${a.sentimentScore}) News(${a.newsScore}) ATH(${a.athScore}) BTC.D(${a.btcDomScore}) Dev(${a.devScore})
Confidence: ${a.confidence}% (indicator agreement × data quality, independent of composite)`;

  try {
    const resp = await fetch(AI_CONFIG.endpoint, { method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${AI_CONFIG.key}`,'HTTP-Referer':location.href,'X-Title':'QuantScreenerPro'}, body:JSON.stringify({model:AI_CONFIG.model,messages:[{role:'system',content:'You are an expert quantitative crypto analyst. All sub-scores are 0-100 (zero-base). RSI and MACD are daily-timeframe. BTC correlation is on returns. Confidence = indicator agreement.\n\nFORMAT YOUR RESPONSE IN TWO SECTIONS separated by "---":\n\nSECTION 1 — TECHNICAL (4 sentences): 1) Momentum & volume health, 2) RSI/MACD signal, 3) BTC correlation implication, 4) Entry/target/stop levels. Data-driven, reference numbers.\n\n---\n\nSECTION 2 — SIMPLE ENGLISH (2-3 sentences): Explain like talking to a friend who is new to crypto. No jargon (no RSI, MACD, correlation, dominance). Just say: Is this coin looking good or bad right now? Should I buy it, hold it, or stay away? Why in simple terms? End with "**In short:**" one-liner.\n\nNo markdown headers in either section.'},{role:'user',content:userData}],temperature:0.3}) });
    if (!resp.ok) { const e = await resp.json(); throw new Error(e.error?.message||`HTTP ${resp.status}`); }
    const data = await resp.json();
    const raw = data.choices[0].message.content || '';
    const parts = raw.split(/\n---\n|---/);
    const technical = (parts[0] || '').trim();
    const simple = (parts[1] || '').trim();

    if (simple) {
      box.innerHTML = `
        <div style="background:var(--bg-card);border:1px solid var(--success);border-radius:10px;padding:14px 16px;margin-bottom:14px;">
          <div style="font-weight:700;color:var(--success);margin-bottom:8px;font-size:0.9rem;">🟢 What This Means (Simple English)</div>
          <div style="color:var(--text-main);line-height:1.7;font-size:0.88rem;">${simple}</div>
        </div>
        <details style="cursor:pointer;">
          <summary style="font-weight:600;color:var(--accent);font-size:0.85rem;margin-bottom:8px;user-select:none;">📊 Detailed Technical Analysis (click to expand)</summary>
          <div style="color:var(--text-muted);line-height:1.6;font-size:0.82rem;margin-top:8px;padding:10px;border-left:3px solid var(--accent);">${technical}</div>
        </details>`;
    } else {
      box.innerHTML = `<span style="color:var(--text-main);">${raw}</span>`;
    }
  } catch (err) { box.innerHTML = `<span style="color:var(--danger);">Failed: ${err.message}<br><br>Check your API key in AI_CONFIG.key</span>`; }
}

async function triggerMarketSentiment() {
  if (!AI_CONFIG.key) { alert('API key not configured.'); return; }
  const box = document.getElementById('ai-response-box');
  document.getElementById('ai-modal-title').innerText = '🧠 AI Market Analysis (full context)';
  openModal('ai-modal');
  box.innerHTML = '<div class="loader"></div><div style="text-align:center;margin-top:12px;color:var(--text-muted);">Consulting AI on market conditions…</div>';

  const regime = detectRegime(marketData);
  const underLimit = marketData.filter(c => (c.market_cap || 0) <= CONFIG.MAX_MCAP_INR);
  const actionable = underLimit.filter(c => c.analysis?.action === 'STRONG BUY' || c.analysis?.action === 'BUY');
  const topByScore = [...actionable].sort((a,b) => b.analysis.composite - a.analysis.composite).slice(0,5);
  const fg = fearGreedData;
  const trendingNames = trendingCoins.slice(0,10).map(id => marketData.find(c => c.id === id)?.symbol?.toUpperCase()).filter(Boolean).join(', ');
  const btcDom = sf(globalData?.market_cap_percentage?.btc, 1) !== '—' ? sf(globalData?.market_cap_percentage?.btc, 1) : 'N/A';
  const totalMcap = globalData?.total_market_cap?.inr ? sf(globalData.total_market_cap.inr / 1e12) + 'T INR' : 'N/A';
  const devActivityCount = Object.values(devActivityMap).filter(d => (d.commit_count_4_weeks || 0) > 10).length;

  const avgScores = underLimit.length > 0 ? (underLimit.reduce((s,c) => s + (c.analysis?.composite||0), 0) / underLimit.length).toFixed(1) : 'N/A';
  const buyCount = underLimit.filter(c => c.analysis?.action === 'BUY').length;
  const strongBuyCount = underLimit.filter(c => c.analysis?.action === 'STRONG BUY').length;
  const holdCount = underLimit.filter(c => c.analysis?.action === 'HOLD').length;
  const avoidCount = underLimit.filter(c => c.analysis?.action === 'AVOID').length;

  const prompt = `You are a professional crypto market analyst. Analyze the FULL data below and give a unified market view in 6 concise sentences.

RAW MARKET DATA (use these numbers, not just the regime label):
- Algorithmic Regime: "${regime.regime}"
- Underlying stats: Avg 24h change: ${sf(regime.avg24h)}% | Avg 7d change: ${sf(regime.avg7d)}% | ${sf(regime.pctPositive*100,0)}% coins in green | Avg Vol/Mcap: ${sf(regime.avgVol*100,1)}% | Avg RSI: ${sf(regime.avgRSI,0)}
- Signal distribution: ${strongBuyCount} Strong Buy, ${buyCount} Buy, ${holdCount} Hold, ${avoidCount} Avoid (avg score: ${avgScores}/100)
- BTC Dominance: ${btcDom}% (Total mcap: ${totalMcap})
- Fear & Greed Index: ${fg ? `${fg.value}/100 (${fg.value_classification})` : 'N/A'}
- Trending: ${trendingNames || 'none'}
- Dev Activity: ${devActivityCount} projects with active GitHub repos

FORMAT YOUR RESPONSE IN EXACTLY TWO SECTIONS separated by "---":

SECTION 1 — TECHNICAL ANALYSIS (for experienced traders):
1) Market state: Synthesize the regime label WITH the raw stats and F&G. If F&G contradicts the regime, explain the nuance.
2) BTC Dominance: ${btcDom>55?'altcoins under pressure':btcDom<42?'potential alt season signal':'neutral zone'} — what it means for altcoin plays.
3) Fear & Greed: Contrarian signal interpretation relative to the actual price action above.
4) Top opportunities: ${topByScore.map(c => `${c.symbol.toUpperCase()}(score:${c.analysis.composite},conf:${c.analysis.confidence}%)`).join(', ') || 'none currently pass threshold'}.
5) Signal quality: ${strongBuyCount+buyCount} actionable out of ${underLimit.length} scanned — is this a target-rich or selective environment?

---

SECTION 2 — SIMPLE ENGLISH SUMMARY (for beginners, write like you're explaining to a friend):
Write 3-4 short sentences in plain everyday language. No jargon. Explain:
- Is it a good time to buy crypto or should I wait? Why?
- What's the overall mood of the market right now (scared, greedy, calm)?
- What should a beginner do right now (buy, hold, stay out)?
- If there are any coins worth looking at, name them simply.
End with one clear "**Bottom line:**" sentence a complete beginner can act on.

RULES: Be data-driven in Section 1, use actual numbers. Section 2 must be jargon-free — no RSI, MACD, dominance, contrarian, regime, etc. No markdown headers.`;

  try {
    const resp = await fetch(AI_CONFIG.endpoint, { method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${AI_CONFIG.key}`,'HTTP-Referer':location.href,'X-Title':'QuantScreenerPro'}, body:JSON.stringify({model:AI_CONFIG.model,messages:[{role:'system',content:'You are a professional crypto market analyst. The user\'s dashboard shows an algorithmic "Market Regime" label based on price averages and volume. Your job is to provide DEEPER analysis by combining that regime with Fear & Greed, BTC dominance, signal distribution, and trending data. If the raw numbers tell a different story than the regime label, explain WHY — e.g. "The algorithm sees sideways price action, but extreme fear + rising buy signals suggest a bottoming pattern." Always reference specific numbers from the data provided. Be concise and data-driven.'},{role:'user',content:prompt}],temperature:0.3}) });
    if (!resp.ok) { const e = await resp.json(); throw new Error(e.error?.message||`HTTP ${resp.status}`); }
    const data = await resp.json();
    const raw = data.choices[0].message.content || '';
    const parts = raw.split(/\n---\n|---/);
    const technical = (parts[0] || '').trim();
    const simple = (parts[1] || '').trim();

    if (simple) {
      box.innerHTML = `
        <div style="background:var(--bg-card);border:1px solid var(--success);border-radius:10px;padding:14px 16px;margin-bottom:14px;">
          <div style="font-weight:700;color:var(--success);margin-bottom:8px;font-size:0.9rem;">🟢 What This Means (Simple English)</div>
          <div style="color:var(--text-main);line-height:1.7;font-size:0.88rem;">${simple}</div>
        </div>
        <details style="cursor:pointer;">
          <summary style="font-weight:600;color:var(--accent);font-size:0.85rem;margin-bottom:8px;user-select:none;">📊 Detailed Technical Analysis (click to expand)</summary>
          <div style="color:var(--text-muted);line-height:1.6;font-size:0.82rem;margin-top:8px;padding:10px;border-left:3px solid var(--accent);">${technical}</div>
        </details>`;
    } else {
      box.innerHTML = `<span style="color:var(--text-main);">${raw}</span>`;
    }
  } catch (err) { box.innerHTML = `<span style="color:var(--danger);">Failed: ${err.message}</span>`; }
}

async function aiEnrichTopCandidates(coins) {
  if (!AI_CONFIG.key) return;
  const topCoins = coins
    .filter(c => c.analysis && (c.analysis.action === 'STRONG BUY' || c.analysis.action === 'BUY'))
    .sort((a, b) => b.analysis.composite - a.analysis.composite)
    .slice(0, 15);
  if (topCoins.length === 0) return;

  const coinSummaries = topCoins.map(c => {
    const a = c.analysis;
    const news = a.ns ? `NewsScore:${a.ns.newsScore}/10 Headlines:${(a.ns.headlines || []).slice(0, 3).join(' | ')}` : 'News:N/A';
    const risk = a.risk ? `Risk Vol:${sf(a.risk.realizedVolatility,1)}% Stop:${sf(a.risk.stopPct,1)}% DoNotTrade:${a.risk.doNotTrade || 'none'}` : 'Risk:N/A';
    const gates = a.marketGates ? `Gates:${a.marketGates.summary} Penalty:${a.marketGates.penalty}` : 'Gates:N/A';
    const setup = `Setup ATR:${sf(a.atr?.atrPct,1)}% ADX:${sf(a.adx?.adx,0)} ${a.adx?.trend || ''} BBWidth:${sf(a.bollinger?.bandwidth,1)}% VolConfirm:${sf(a.volumeConfirmation?.ratio,2)}x Resistance:${sf(a.supportResistance?.distanceToResistancePct,1)}%`;
    return `${c.symbol.toUpperCase()} | QuantAction:${a.action} Score:${a.composite} BaseScore:${a.baseComposite ?? a.composite} Conf:${a.confidence}% | Horizons Scalp:${a.horizonSignals?.scalp?.score} Swing:${a.horizonSignals?.swing?.score} Position:${a.horizonSignals?.position?.score} | 1h:${sf(a.p1h)}% 24h:${sf(a.d24)}% 7d:${sf(a.d7)}% 30d:${sf(a.d30)}% | RSI:${sf(a.rsi,0)} MACD:${a.macd?.crossover || a.macd?.trend || 'N/A'} | BTC-Corr:${sf(a.btcCorr)} Vol/Mcap:${sf(a.volRatio * 100,1)}% | ATH:${sf(a.athDist,0)}% Rank:#${c.market_cap_rank || 'N/A'} | ${setup} | ${risk} | ${gates} | ${news} | Sub: Mom${a.momentumScore} Vol${a.volumeScore} RSI${a.rsiScore} MACD${a.macdScore} Corr${a.corrScore} FG${a.sentimentScore} News${a.newsScore} ATH${a.athScore} BTC.D${a.btcDomScore} Dev${a.devScore} Setup${a.setupScore}`;
  }).join('\n');

  const fg = fearGreedData;
  const regime = detectRegime(coins);

  try {
    const resp = await fetch(AI_CONFIG.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${AI_CONFIG.key}`, 'HTTP-Referer': location.href },
      body: JSON.stringify({
        model: AI_CONFIG.model,
        messages: [{
          role: 'system',
          content: 'You are an AI risk reviewer for a crypto quant dashboard. You do NOT predict winners, rank coins, or override the quantitative score. Explain evidence, identify missing data, and flag contradictions. Return ONLY valid JSON. No markdown, no explanation, no code fences.'
        }, {
          role: 'user',
          content: `Market: ${regime.regime} | F&G: ${fg ? fg.value + ' (' + fg.value_classification + ')' : 'N/A'} | BTC.D: ${sf(globalData?.market_cap_percentage?.btc, 1)}%\n\nQuant-selected candidates:\n${coinSummaries}\n\nReturn JSON mapping each coin symbol to this exact object shape:\n{"BTC":{"bull_case":"...","bear_case":"...","missing_data":["..."],"signal_conflicts":["..."],"trade_setup_quality":"excellent|good|mixed|poor","avoid_reason":null,"flags":{"bad_news":false,"unlock_risk":false,"weak_btc_conditions":false,"overheated_volatility":false,"thin_liquidity":false},"disagreement_level":"none|watch|downgrade|avoid"}}\n\nRules:\n- Do not rank coins.\n- Do not say a coin will go up.\n- Use only supplied data/headlines; if unlock data is missing, set unlock_risk false and include it in missing_data when relevant.\n- Use downgrade/avoid only for clear contradictions: bad news, weak BTC/ETH gates, overheated volatility, thin liquidity, or poor setup quality.`
        }],
        temperature: 0.1
      })
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    const parsed = JSON.parse(data.choices[0].message.content.replace(/```json\n?|\n?```/g, '').trim());
    topCoins.forEach(c => {
      const sym = c.symbol.toUpperCase();
      if (parsed[sym]) {
        aiInsightsMap[c.id] = normalizeAIReview(parsed[sym]);
        applyAIReviewToCoin(c, aiInsightsMap[c.id]);
      }
    });
  } catch (e) {
    console.warn('AI enrichment failed:', e.message);
  }
}

function normalizeAIReview(review) {
  const flags = review.flags || {};
  return {
    bull_case: review.bull_case || review.why || '',
    bear_case: review.bear_case || review.risk || '',
    missing_data: Array.isArray(review.missing_data) ? review.missing_data.slice(0, 4) : [],
    signal_conflicts: Array.isArray(review.signal_conflicts) ? review.signal_conflicts.slice(0, 4) : [],
    trade_setup_quality: ['excellent', 'good', 'mixed', 'poor'].includes(review.trade_setup_quality) ? review.trade_setup_quality : 'mixed',
    avoid_reason: review.avoid_reason || null,
    flags: {
      bad_news: !!flags.bad_news,
      unlock_risk: !!flags.unlock_risk,
      weak_btc_conditions: !!flags.weak_btc_conditions,
      overheated_volatility: !!flags.overheated_volatility,
      thin_liquidity: !!flags.thin_liquidity,
    },
    disagreement_level: ['none', 'watch', 'downgrade', 'avoid'].includes(review.disagreement_level) ? review.disagreement_level : 'watch',
  };
}

function applyAIReviewToCoin(coin, review) {
  if (!coin?.analysis || !review) return;
  const a = coin.analysis;
  const severeFlagCount = Object.values(review.flags || {}).filter(Boolean).length;
  const deterministicConflicts = [];

  if (a.risk?.doNotTrade) deterministicConflicts.push(a.risk.doNotTrade);
  if ((a.marketGates?.penalty || 0) >= 10) deterministicConflicts.push('BTC/ETH market gates are materially weak.');
  if ((a.risk?.realizedVolatility || 0) > 22) deterministicConflicts.push('Realized volatility is overheated.');
  if ((a.ns?.newsScore || 0) < -3) deterministicConflicts.push('News sentiment is negative.');

  const shouldAvoid = review.disagreement_level === 'avoid' || review.trade_setup_quality === 'poor' || severeFlagCount >= 3;
  const shouldDowngrade = shouldAvoid || review.disagreement_level === 'downgrade' || severeFlagCount >= 2 || deterministicConflicts.length >= 2;

  a.aiReview = review;
  a.aiDisagreement = {
    level: shouldAvoid ? 'avoid' : shouldDowngrade ? 'downgrade' : review.disagreement_level,
    flags: review.flags,
    deterministicConflicts,
    originalAction: a.action,
    originalComposite: a.composite,
  };

  if (!shouldDowngrade) return;
  if (a.action === 'STRONG BUY') {
    a.action = shouldAvoid ? 'HOLD' : 'BUY';
    a.badgeClass = shouldAvoid ? 'hold' : 'buy';
    a.color = shouldAvoid ? 'var(--warning)' : '#3b82f6';
  } else if (a.action === 'BUY' && shouldAvoid) {
    a.action = 'HOLD';
    a.badgeClass = 'hold';
    a.color = 'var(--warning)';
  }
}
