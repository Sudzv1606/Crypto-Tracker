# Quant Screener Pro

A quantitative crypto screening dashboard with AI-powered scoring, autonomous paper trading, portfolio tracking, backtesting, and signal analytics — all in vanilla JavaScript.

## Quick Start

```bash
# 1. Clone the repo
git clone git@github.com:Sudzv1606/AI-Vakeel.git
cd AI-Vakeel

# 2. Copy the config template
cp js/config.example.js js/config.js

# 3. (Optional) Set your OpenRouter API key in js/config.js for AI features
#    All AI features degrade gracefully without a key.

# 4. Start the CORS proxy (Node.js — no npm install needed)
node proxy.js

# 5. Open index.html in your browser
```

## Architecture

| Layer | Technology |
|---|---|
| **Frontend** | Vanilla JS, CSS custom properties, single HTML shell |
| **Proxy** | Node.js (`http`/`https` modules, zero dependencies) |
| **AI** | OpenRouter API (`openrouter/owl-alpha`) |
| **Persistence** | `localStorage` (portfolio, signals, trades, alerts, learned rules) |

## Data Sources

All external API calls route through the proxy server at `localhost:3099`:

| Provider | Used For |
|---|---|
| **Binance** | Primary market data — tickers, OHLCV klines, prices, volume |
| **CoinGecko** | Fallback data, market cap, ATH, trending coins, global stats, developer activity |
| **CoinPaprika** | Tertiary fallback, USD→INR rate, enrichment |
| **CryptoCompare** | News headlines for sentiment analysis |
| **CoinCap** | Supplemental price history |
| **alternative.me** | Fear & Greed Index |
| **OpenRouter** | 15+ AI functions (trade confirmation, regime detection, sentiment, weight optimization, etc.) |

## Features

### Market Scanner
- Scores every coin on an **11-factor composite model** (0–100)
- Tiered display: **Strong Buy / Buy / Hold / Avoid**
- Sort by composite score, confidence, price, RSI, market cap, or 24h change
- Filter by market cap tier (Top 50, 50–150, 150–400, 400+) and signal type
- Progressive rendering — cards appear immediately, update in-place as enrichment arrives
- Skeleton loaders, auto-retry on failure, cached data fallback

### Scoring Model (11 Factors)

| # | Factor | Default Weight | Description |
|---|---|---|---|
| 1 | Momentum | 20% | 1h, 24h, 7d, 30d price trends |
| 2 | Volume | 18% | Volume/market-cap ratio + trend detection |
| 3 | RSI | 12% | Daily RSI(14); oversold <30 = 90pts |
| 4 | MACD | 10% | Hourly MACD(3,7,3) with crossover detection |
| 5 | BTC Correlation | 8% | Pearson on hourly returns, not raw prices |
| 6 | Fear & Greed | 8% | Scaled by market cap tier |
| 7 | ATH Distance | 7% | Depth below all-time high |
| 8 | Developer Activity | 7% | GitHub commits, contributors, stars |
| 9 | Setup Quality | 7% | BB, Keltner, ADX, VWAP, S/R, MA slope |
| 10 | News Sentiment | 5% | LLM-classified from CryptoCompare headlines |
| 11 | BTC Dominance | 5% | Alt-season signal from CoinGecko global |

Weights adapt automatically to the detected market regime (Strong Bull, Mild Bull, Sideways, Mild Bear, Bear). A market trend gates penalty (up to −21 points) adjusts for weak BTC/ETH conditions.

### AI Integration (15+ functions)

- **Signal enrichment** — AI risk review with bull/bear case, conflicts, and flags for top candidates
- **Trade confirmation** — pre-trade gatekeeper approves or rejects trades with reasoning
- **Exit advisor** — for profitable positions: HOLD, TIGHTEN stop, or EXIT
- **Regime detection** — 9 nuanced regimes (strong_accumulation, early_bull, euphoria, capitulation, etc.)
- **Weight optimization** — data-driven weight suggestions from backtest history
- **News impact** — classifies headlines as price-moving events vs noise
- **Cross-correlation** — detects dangerous clusters of correlated coins (>0.75)
- **Portfolio analysis** — per-coin advice and diversification scoring
- **Anomaly detection** — flags unusual volume/price action
- **Daily summary** — concise market briefing
- **Deep dive reports** — per-coin technical + plain-English analysis
- **Signal pattern analysis** — finds patterns in historical win/loss data

Every AI feature falls back gracefully when no API key is set.

### Autonomous Paper Trading

- **Starting capital:** ₹1,00,000
- Self-optimizing with **learned rules** tracked across 15+ dimensions (score buckets, regimes, RSI ranges, confidence levels, volatility, holding time)
- Adaptive position sizing (8–20% of equity based on score + confidence + AI confirmation)
- Risk controls: trailing stop (+3%), dual take-profit targets, 72h max hold, 30% circuit breaker
- Daily P&L log and equity tracking
- Toggleable from the UI with a compact mini-widget

### Portfolio Tracker
- Add holdings (coin ID, quantity, buy price in INR)
- Live valuation with P&L per coin and total
- AI portfolio insights override default signals
- Automatic sell/partial-sell/buy/cut-loss signals based on P&L% + RSI + composite score

### Signal Tracker
- Every BUY/STRONG BUY signal logged with full context
- Forward return tracking at 6 horizons: **1h, 4h, 24h, 3d, 7d, 14d**
- Win/loss marking with walk-forward validation
- Learned thresholds for signal classification

### Backtest Engine
- Score range analysis — performance by bucket (0–34, 35–49, 50–64, 65–79, 80–100)
- Regime performance comparison
- Factor edge analysis — tests 11 conditions for predictive power
- Signal freshness decay analysis
- Paper trade simulator with stop/take-profit management
- Risk manager: max drawdown 15%, daily loss cap 5%, max correlated exposure 40%, max single position 8%
- CSV export and AI backtest insights

### Price Alerts
- Set above/below price alerts on any coin
- Browser notification API integration
- Toast notifications with auto-fade
- Persisted in localStorage

## Configuration

Edit `js/config.js` (copy from `js/config.example.js`):

| Key | Default | Description |
|---|---|---|
| `AI_CONFIG.key` | `'YOUR_OPENROUTER_API_KEY'` | OpenRouter API key (optional) |
| `AI_CONFIG.model` | `'openrouter/owl-alpha'` | OpenRouter model ID |
| `CONFIG.MAX_MCAP_INR` | `500e9` | Market cap filter (₹500B ≈ $5.9B) |
| `CONFIG.REFRESH_INTERVAL` | `180000` | Auto-refresh (3 min in ms) |
| `CONFIG.PER_PAGE` | `250` | Coins per page from CoinGecko |
| `CONFIG.USD_INR_FALLBACK` | `85` | Fallback exchange rate |
| `PROXY` | `'http://localhost:3099'` | Proxy server URL |

The proxy server (`proxy.js`) runs on port **3099** with rate limiting (100 req/min per IP) and request validation.

## Progressive Rendering Pipeline

Data fetching follows a 4-phase waterfall:

1. **Core data** — Fear & Greed, news, market data → score → render immediately
2. **Basic enrichment** — News sentiment, forward returns, regime detection, trend gates
3. **Background enrichment** — AI regime, news impact, klines for top candidates → re-score → re-render
4. **AI enrichment** — Cross-correlation, AI reviews, portfolio analysis, daily summary → auto-trade

Cards are never cleared during refresh. On failure, cached data remains visible with a "showing cached" status.

## API Key Security

`js/config.js` is in `.gitignore`. Never commit your actual API key. Use `js/config.example.js` as a template.

## Browser Support

Modern browsers with ES6 support. Uses `localStorage`, `Notification API`, and `fetch`. Dark theme.

## License

MIT
