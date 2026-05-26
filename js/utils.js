const sf = (v, d = 2) => (typeof v === 'number' && isFinite(v)) ? v.toFixed(d) : '—';
const formatINR = n => (typeof n === 'number' && isFinite(n)) ? new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',minimumFractionDigits:2,maximumFractionDigits:2}).format(n) : '₹—';
const formatPct = n => (typeof n === 'number' && isFinite(n)) ? `${n>0?'+':''}${n.toFixed(2)}%` : '—%';

// ============ #19: Centralized Date/Time Formatting ============

const DateFormatter = {
  // Locale used across the app
  locale: 'en-IN',
  
  /**
   * Format a timestamp or Date to short date: "25 May 2026"
   */
  date(input) {
    const d = input instanceof Date ? input : new Date(input);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString(this.locale, { day: 'numeric', month: 'short', year: 'numeric' });
  },

  /**
   * Format a timestamp or Date to short date without year: "25 May"
   */
  dateShort(input) {
    const d = input instanceof Date ? input : new Date(input);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString(this.locale, { day: 'numeric', month: 'short' });
  },

  /**
   * Format a timestamp or Date to locale date string: "25/5/2026"
   */
  dateNumeric(input) {
    const d = input instanceof Date ? input : new Date(input);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString(this.locale);
  },

  /**
   * Format a timestamp or Date to time: "14:30"
   */
  time(input) {
    const d = input instanceof Date ? input : new Date(input);
    if (isNaN(d.getTime())) return '--:--';
    return d.toLocaleTimeString(this.locale, { hour: '2-digit', minute: '2-digit' });
  },

  /**
   * Format a timestamp or Date to time with seconds: "14:30:45"
   */
  timeFull(input) {
    const d = input instanceof Date ? input : new Date(input);
    if (isNaN(d.getTime())) return '--:--:--';
    return d.toLocaleTimeString(this.locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  },

  /**
   * Format a timestamp or Date to date + time: "25 May, 14:30"
   */
  dateTime(input) {
    const d = input instanceof Date ? input : new Date(input);
    if (isNaN(d.getTime())) return '—';
    return `${this.dateShort(d)}, ${this.time(d)}`;
  },

  /**
   * Format a timestamp to relative time: "2m ago", "3h ago", "1d ago"
   */
  relative(input) {
    const d = input instanceof Date ? input : new Date(input);
    if (isNaN(d.getTime())) return '—';
    const diff = Date.now() - d.getTime();
    if (diff < 0) return 'just now';
    if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
    return this.dateShort(d);
  },

  /**
   * Get current time formatted: "14:30"
   */
  now() {
    return this.time(new Date());
  },

  /**
   * Get today's date formatted for signal logging: "25/5/2026"
   */
  today() {
    return this.dateNumeric(new Date());
  },
};

function switchView(name, e) {
  document.querySelectorAll('.tab,.view').forEach(el => el.classList.remove('active'));
  e.target.classList.add('active');
  document.getElementById(`view-${name}`).classList.add('active');
  if (name === 'portfolio') renderPortfolio();
  if (name === 'tracker') { renderTracker(); if (!aiSignalPatterns && signalLog.filter(s => s.result).length >= 8) aiAnalyzeSignalPatterns().then(() => renderTracker()); }
  if (name === 'backtest') runFullBacktest();
}

function openModal(id, coinId, symbol, price) {
  const modal = document.getElementById(id);
  modal.classList.add('active');
  // Focus trap: focus the modal content for accessibility
  const content = modal.querySelector('.modal-content');
  if (content) content.focus();
  if (id === 'quick-add-modal') {
    document.getElementById('add-id').value = coinId||''; document.getElementById('add-qty').value = ''; document.getElementById('add-price').value = price?sf(price):'';
    document.getElementById('modal-title').innerText = symbol ? `Add ${symbol.toUpperCase()}` : 'Add Custom Entry';
  }
}
function closeModal(id) { document.getElementById(id).classList.remove('active'); }

// Close modal on Escape key
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active'));
  }
});
