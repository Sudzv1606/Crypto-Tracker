const AI_CONFIG = { key: 'YOUR_OPENROUTER_API_KEY', model: 'openrouter/owl-alpha', endpoint: 'https://openrouter.ai/api/v1/chat/completions' };
const CONFIG = { MAX_MCAP_INR: 500e9, REFRESH_INTERVAL: 180000, PER_PAGE: 250, USD_INR_FALLBACK: 85 };
const FORWARD_RETURN_HORIZONS = [
  { key: '1h', label: '1h', ms: 60 * 60 * 1000 },
  { key: '4h', label: '4h', ms: 4 * 60 * 60 * 1000 },
  { key: '24h', label: '24h', ms: 24 * 60 * 60 * 1000 },
  { key: '3d', label: '3d', ms: 3 * 24 * 60 * 60 * 1000 },
  { key: '7d', label: '7d', ms: 7 * 24 * 60 * 60 * 1000 },
  { key: '14d', label: '14d', ms: 14 * 24 * 60 * 60 * 1000 },
];
const PROXY = 'http://localhost:3099';
let marketData = [], btcData = null, fearGreedData = null, trendingCoins = [], newsSentimentMap = {}, globalData = null, devActivityMap = {};
let usdToInr = CONFIG.USD_INR_FALLBACK;
let dataSource = 'none';
let portfolio = JSON.parse(localStorage.getItem('inr_portfolio_v10')) || [];
let signalLog = JSON.parse(localStorage.getItem('quant_signal_log_v1')) || [];
let priceAlerts = JSON.parse(localStorage.getItem('quant_price_alerts_v1')) || [];
let cgCooldownUntil = 0;
let aiInsightsMap = {};
let aiPortfolioInsights = {};
let aiSignalPatterns = null;
let aiCorrelationWarnings = [];
let learnedThresholds = { buy: 45, strongBuy: 65, sampleSize: 0, source: 'default' };
let currentScoringRegime = { key: 'unknown', label: 'Unknown', weights: null };
let marketTrendGates = { btc4h: null, ethBtc: null, btcDominance: null, totalMcap: null, summary: 'Insufficient gate data', penalty: 0 };
