function addHolding() {
  const id = document.getElementById('add-id').value.toLowerCase().trim();
  const qty = parseFloat(document.getElementById('add-qty').value);
  const price = parseFloat(document.getElementById('add-price').value);
  if (!id || isNaN(qty) || isNaN(price)) return alert('Please fill all fields.');
  portfolio.push({ id, qty, buyPrice: price, dateAdded: Date.now() });
  localStorage.setItem('inr_portfolio_v10', JSON.stringify(portfolio));
  closeModal('quick-add-modal');
  renderPortfolio();
}

function removeHolding(index) { portfolio.splice(index, 1); localStorage.setItem('inr_portfolio_v10', JSON.stringify(portfolio)); renderPortfolio(); }

function portfolioSignal(pnlPct, score, rsi, macd, d24) {
  const macdBearish = macd?.crossover === 'bearish' || macd?.trend === 'down';
  const macdBullish = macd?.crossover === 'bullish' || macd?.trend === 'up';
  const label = (txt, cls) => ({ text: txt, cls });

  if (pnlPct > 30 && rsi !== null && rsi > 75) return label('🟥 SELL — Take Profit (Overheated)', 'badge-sell');
  if (pnlPct > 20 && rsi !== null && rsi > 70) return label('🟧 PARTIAL SELL — Overbought', 'badge-partial');
  if (pnlPct > 15 && macdBearish) return label('🟧 SELL — Trend Reversing', 'badge-partial');
  if (pnlPct < -15 && score < 40) return label('🟥 CUT LOSS — Weak Signal', 'badge-sell');
  if (pnlPct < -10 && macdBearish) return label('🟧 EXIT — Downtrend Confirmed', 'badge-partial');

  if (score >= 75 && pnlPct <= 5) return label('🟢 STRONG BUY — Accumulate', 'badge-strong-hold');
  if (score >= 65 && pnlPct >= 0) return label('🟢 HOLD — Uptrend Intact', 'badge-strong-hold');
  if (score >= 55 && pnlPct >= -5) return label('🔵 HOLD — Stable', 'badge-hold');
  if (score >= 45) return label('🔵 HOLD — Wait & Watch', 'badge-hold');
  if (pnlPct < -5 && score >= 50) return label('🔵 HOLD — Recovery Potential', 'badge-hold');

  if (score < 45 && pnlPct < -5) return label('🟠 WEAK — Consider Exiting', 'badge-partial');
  if (score < 45 && pnlPct >= -5) return label('🟡 WEAK — Low Conviction', 'badge-hold');
  if (score === undefined || score === null) return label('⚪ HOLD — No Data Yet', 'badge-hold');

  return label('⚪ HOLD — Monitoring', 'badge-hold');
}

function renderPortfolio() {
  const tbody = document.getElementById('portfolio-table');
  tbody.innerHTML = '';
  let totalValue = 0, totalCost = 0;
  if (portfolio.length === 0) { tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-muted);">No assets yet.</td></tr>'; }
  portfolio.forEach((item, index) => {
    const itemLower = (item.id || '').toLowerCase();
    const mc = marketData.find(c => c.id === itemLower || c.symbol.toLowerCase() === itemLower || c.name?.toLowerCase() === itemLower);
    const cp = mc ? mc.current_price : item.buyPrice;
    const a = mc?.analysis || {};
    const value = item.qty * cp, cost = item.qty * item.buyPrice;
    const netProfit = value - cost, pnlPct = ((cp - item.buyPrice) / item.buyPrice) * 100;
    const aiPi = aiPortfolioInsights[mc?.id];
    const sig = aiPi ? aiActionToBadge(aiPi.action) : portfolioSignal(pnlPct, a.composite ?? null, a.rsi, a.macd, a.d24 || 0);
    const aiReason = aiPi?.reason || '';
    totalValue += value; totalCost += cost;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td style="font-weight:600;text-transform:capitalize;">${item.id}</td><td>${item.qty}</td><td>${formatINR(item.buyPrice)}</td><td>${formatINR(cp)}</td><td class="${pnlPct>=0?'text-green':'text-red'}"><strong>${formatPct(pnlPct)}</strong></td><td class="${netProfit>=0?'text-green':'text-red'}">${formatINR(netProfit)}</td><td><span class="badge ${sig.cls}" style="font-size:0.68rem;cursor:help;" title="Score: ${a.composite||'N/A'} | RSI: ${sf(a.rsi,0)!=='—'?sf(a.rsi,0):'N/A'} | MACD: ${a.macd?.crossover||a.macd?.trend||'N/A'}">${sig.text}</span>${aiReason ? `<div class="ai-portfolio-reason">${aiReason}</div>` : ''}</td><td><button class="btn btn-danger btn-sm" onclick="removeHolding(${index})">Del</button></td>`;
    tbody.appendChild(tr);
  });
  const netPnl = totalValue - totalCost;
  document.getElementById('port-cost').innerText = formatINR(totalCost);
  document.getElementById('port-total').innerText = formatINR(totalValue);
  const pnlEl = document.getElementById('port-pnl');
  pnlEl.innerText = formatINR(netPnl);
  pnlEl.className = `stat-value ${netPnl >= 0 ? 'text-green' : 'text-red'}`;
}
