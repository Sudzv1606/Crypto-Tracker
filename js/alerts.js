function hasActiveAlert(coinId) {
  return priceAlerts.some(a => a.coinId === coinId);
}

function openAlertModal(coinId, coinName, currentPrice) {
  document.getElementById('alert-coin-id').value = coinId;
  document.getElementById('alert-coin-name').textContent = coinName;
  document.getElementById('alert-coin-price').textContent = `Current: ${formatINR(currentPrice)}`;
  document.getElementById('alert-target').value = '';
  document.getElementById('alert-direction').value = 'above';
  document.getElementById('alert-modal').classList.add('active');
  renderAlertList(coinId);
}

function saveAlert() {
  const coinId = document.getElementById('alert-coin-id').value;
  const direction = document.getElementById('alert-direction').value;
  const target = parseFloat(document.getElementById('alert-target').value);
  if (!coinId || isNaN(target) || target <= 0) return alert('Enter a valid target price.');
  const coin = marketData.find(c => c.id === coinId || c.symbol === coinId);
  priceAlerts.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    coinId,
    coinName: coin ? coin.name : coinId.toUpperCase(),
    symbol: coin ? coin.symbol.toUpperCase() : coinId.toUpperCase(),
    direction,
    target,
    createdAt: Date.now(),
    triggered: false,
  });
  localStorage.setItem('quant_price_alerts_v1', JSON.stringify(priceAlerts));
  updateAlertsCount();
  renderAlertList(coinId);
  document.getElementById('alert-target').value = '';
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

function deleteAlert(alertId) {
  priceAlerts = priceAlerts.filter(a => a.id !== alertId);
  localStorage.setItem('quant_price_alerts_v1', JSON.stringify(priceAlerts));
  updateAlertsCount();
  const modalCoinId = document.getElementById('alert-coin-id').value;
  if (modalCoinId) renderAlertList(modalCoinId);
  else renderAlertList(null);
}

function renderAlertList(coinId) {
  const list = document.getElementById('alert-list-active');
  const filtered = coinId ? priceAlerts.filter(a => a.coinId === coinId) : priceAlerts;
  if (filtered.length === 0) {
    list.innerHTML = '<li style="color:var(--text-muted);justify-content:center;font-size:0.75rem;">No active alerts</li>';
    return;
  }
  list.innerHTML = filtered.map(a => `<li>
    <span>${a.symbol} ${a.direction === 'above' ? '↑' : '↓'} ${formatINR(a.target)}</span>
    <button class="btn btn-danger btn-sm" onclick="deleteAlert('${a.id}')" style="padding:2px 8px;font-size:0.68rem;">✕</button>
  </li>`).join('');
}

function checkAlerts() {
  if (priceAlerts.length === 0 || marketData.length === 0) return;
  let changed = false;
  priceAlerts.forEach(a => {
    if (a.triggered) return;
    const coin = marketData.find(c => c.id === a.coinId || c.symbol === a.coinId);
    if (!coin) return;
    const price = coin.current_price;
    const hit = (a.direction === 'above' && price >= a.target) || (a.direction === 'below' && price <= a.target);
    if (hit) {
      a.triggered = true;
      changed = true;
      const msg = `${a.symbol} ${a.direction === 'above' ? 'crossed above' : 'dropped below'} ${formatINR(a.target)} — now at ${formatINR(price)}`;
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('Price Alert', { body: msg, icon: '📊' });
      }
      showAlertToast(msg);
    }
  });
  if (changed) {
    priceAlerts = priceAlerts.filter(a => !a.triggered);
    localStorage.setItem('quant_price_alerts_v1', JSON.stringify(priceAlerts));
    updateAlertsCount();
  }
}

function showAlertToast(msg) {
  const toast = document.createElement('div');
  toast.style.cssText = 'position:fixed;top:20px;right:20px;background:linear-gradient(135deg,#f59e0b,#ef4444);color:#fff;padding:14px 20px;border-radius:12px;font-size:0.88rem;font-weight:600;z-index:9999;box-shadow:0 8px 24px rgba(0,0,0,0.4);animation:fadeIn 0.3s ease;max-width:380px;';
  toast.textContent = '🔔 ' + msg;
  document.body.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.5s'; setTimeout(() => toast.remove(), 500); }, 6000);
}

function showAllAlerts() {
  document.getElementById('alert-coin-id').value = '';
  document.getElementById('alert-coin-name').textContent = 'All Coins';
  document.getElementById('alert-coin-price').textContent = '';
  document.getElementById('alert-modal-title').textContent = '🔔 All Price Alerts';
  document.getElementById('alert-modal').classList.add('active');
  renderAlertList(null);
}

function updateAlertsCount() {
  const el = document.getElementById('alerts-count');
  if (!el) return;
  const n = priceAlerts.length;
  el.textContent = n > 0 ? `🔔 ${n}` : '';
}
