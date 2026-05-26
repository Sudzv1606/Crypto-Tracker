// ============ Data Validation Functions ============

/**
 * Validates that a value is a finite number
 */
function isValidNumber(val) {
  return typeof val === 'number' && isFinite(val);
}

/**
 * Validates that a value is a non-empty string
 */
function isValidString(val) {
  return typeof val === 'string' && val.trim().length > 0;
}

/**
 * Validates that a value is a positive number
 */
function isPositiveNumber(val) {
  return isValidNumber(val) && val > 0;
}

/**
 * Validates that a value is a number within a reasonable range (for percentages)
 */
function isValidPercentage(val, min = -100, max = 10000) {
  return isValidNumber(val) && val >= min && val <= max;
}

/**
 * Validates Fear & Greed API response
 */
function validateFearGreed(data) {
  if (!data || typeof data !== 'object') return null;
  const value = parseInt(data.value);
  if (isNaN(value) || value < 0 || value > 100) return null;
  return {
    value: value.toString(),
    value_classification: isValidString(data.value_classification) ? data.value_classification : 'Neutral'
  };
}

/**
 * Validates a single coin data object from CoinGecko
 */
function validateCoinData(coin) {
  if (!coin || typeof coin !== 'object') return null;
  
  // Required: id and symbol must be valid strings
  if (!isValidString(coin.id) || !isValidString(coin.symbol)) return null;
  
  // Validate numeric fields with bounds checking
  const validated = {
    id: coin.id.toLowerCase().trim(),
    symbol: coin.symbol.toLowerCase().trim(),
    name: isValidString(coin.name) ? coin.name.trim() : coin.symbol.toUpperCase(),
    current_price: isPositiveNumber(coin.current_price) ? coin.current_price : 0,
    market_cap: isValidNumber(coin.market_cap) && coin.market_cap >= 0 ? coin.market_cap : 0,
    total_volume: isValidNumber(coin.total_volume) && coin.total_volume >= 0 ? coin.total_volume : 0,
    market_cap_rank: isValidNumber(coin.market_cap_rank) && coin.market_cap_rank > 0 
      ? Math.round(coin.market_cap_rank) : null,
    price_change_percentage_1h_in_currency: isValidPercentage(coin.price_change_percentage_1h_in_currency, -100, 1000) 
      ? coin.price_change_percentage_1h_in_currency : null,
    price_change_percentage_24h: isValidPercentage(coin.price_change_percentage_24h, -100, 1000) 
      ? coin.price_change_percentage_24h : 0,
    price_change_percentage_7d_in_currency: isValidPercentage(coin.price_change_percentage_7d_in_currency, -100, 1000) 
      ? coin.price_change_percentage_7d_in_currency : null,
    price_change_percentage_30d_in_currency: isValidPercentage(coin.price_change_percentage_30d_in_currency, -100, 1000) 
      ? coin.price_change_percentage_30d_in_currency : null,
    ath_change_percentage: isValidPercentage(coin.ath_change_percentage, -100, 100) 
      ? coin.ath_change_percentage : null,
    sparkline_in_7d: { price: [] },
  };

  // Validate sparkline data
  if (Array.isArray(coin.sparkline_in_7d?.price)) {
    validated.sparkline_in_7d.price = coin.sparkline_in_7d.price
      .filter(p => isValidNumber(p) && p >= 0)
      .slice(0, 168); // Max 168 hourly points (7 days)
  }

  return validated;
}

/**
 * Validates Binance ticker data
 */
function validateBinanceTicker(ticker) {
  if (!ticker || typeof ticker !== 'object') return null;
  
  if (!isValidString(ticker.symbol) || !ticker.symbol.endsWith('USDT')) return null;
  
  const price = parseFloat(ticker.lastPrice);
  const volume = parseFloat(ticker.quoteVolume);
  const openPrice = parseFloat(ticker.openPrice);
  
  if (!isPositiveNumber(price) || !isValidNumber(volume)) return null;
  
  return {
    symbol: ticker.symbol,
    lastPrice: price,
    quoteVolume: volume,
    openPrice: isValidNumber(openPrice) ? openPrice : price,
  };
}

/**
 * Validates CoinPaprika ticker data
 */
function validatePaprikaTicker(ticker) {
  if (!ticker || typeof ticker !== 'object') return null;
  
  if (!isValidString(ticker.id) || !isValidString(ticker.symbol)) return null;
  
  const q = ticker.quotes?.USD;
  if (!q || !isPositiveNumber(q.price)) return null;
  
  return {
    id: ticker.id,
    symbol: ticker.symbol.toLowerCase().trim(),
    name: isValidString(ticker.name) ? ticker.name.trim() : ticker.symbol.toUpperCase(),
    rank: isValidNumber(ticker.rank) && ticker.rank > 0 ? ticker.rank : 9999,
    quotes: {
      USD: {
        price: q.price,
        market_cap: isValidNumber(q.market_cap) && q.market_cap >= 0 ? q.market_cap : 0,
        volume_24h: isValidNumber(q.volume_24h) && q.volume_24h >= 0 ? q.volume_24h : 0,
        percent_change_1h: isValidPercentage(q.percent_change_1h) ? q.percent_change_1h : null,
        percent_change_24h: isValidPercentage(q.percent_change_24h) ? q.percent_change_24h : 0,
        percent_change_7d: isValidPercentage(q.percent_change_7d) ? q.percent_change_7d : null,
        percent_change_30d: isValidPercentage(q.percent_change_30d) ? q.percent_change_30d : null,
        percent_from_price_ath: isValidPercentage(q.percent_from_price_ath, -100, 100) 
          ? q.percent_from_price_ath : null,
      }
    }
  };
}

/**
 * Validates global market data
 */
function validateGlobalData(data) {
  if (!data || typeof data !== 'object') return null;
  
  return {
    total_market_cap: {
      usd: isValidNumber(data.total_market_cap?.usd) ? data.total_market_cap.usd : 0,
      inr: isValidNumber(data.total_market_cap?.inr) ? data.total_market_cap.inr : 0,
    },
    market_cap_percentage: {
      btc: isValidPercentage(data.market_cap_percentage?.btc, 0, 100) ? data.market_cap_percentage.btc : null,
      eth: isValidPercentage(data.market_cap_percentage?.eth, 0, 100) ? data.market_cap_percentage.eth : null,
    },
    market_cap_change_percentage_24h_usd: isValidPercentage(data.market_cap_change_percentage_24h_usd) 
      ? data.market_cap_change_percentage_24h_usd : null,
  };
}

// ============ API Fetch Functions ============

async function fetchFearGreed() {
  try {
    const res = await fetch(`${PROXY}/api/fng`);
    if (!res.ok) return null;
    const data = await res.json();
    const validated = validateFearGreed(data.data?.[0]);
    return validated;
  } catch { return null; }
}

async function fetchTrending() {
  if (Date.now() < cgCooldownUntil) return [];
  try {
    const res = await fetch(`${PROXY}/api/trending`);
    if (res.status === 429) { cgCooldownUntil = Date.now() + 300000; return []; }
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data.coins)) return [];
    return data.coins
      .map(c => c.item?.id)
      .filter(id => isValidString(id))
      .slice(0, 15); // Limit trending coins
  } catch (e) {
    if (e.message?.includes('429')) cgCooldownUntil = Date.now() + 300000;
    return [];
  }
}

async function fetchGlobalData() {
  if (Date.now() < cgCooldownUntil) return null;
  try {
    const res = await fetch(`${PROXY}/api/global`);
    if (res.status === 429) { cgCooldownUntil = Date.now() + 300000; return null; }
    if (!res.ok) return null;
    const data = await res.json();
    return validateGlobalData(data.data);
  } catch (e) {
    if (e.message?.includes('429')) cgCooldownUntil = Date.now() + 300000;
    return null;
  }
}

async function fetchDevActivity(coinIds) {
  if (Date.now() < cgCooldownUntil) return {};
  const results = {};
  const toFetch = coinIds.slice(0, 5);
  for (let i = 0; i < toFetch.length; i++) {
    const id = toFetch[i];
    try {
      const res = await fetch(`${PROXY}/api/cg/coins/${id}?localization=false&tickers=false&community_data=false&developer_data=true`);
      if (res.status === 429) { cgCooldownUntil = Date.now() + 300000; break; }
      if (!res.ok) continue;
      const data = await res.json();
      if (data?.id && data?.developer_data) results[data.id] = data.developer_data;
    } catch (e) {
      if (e.message?.includes('429')) { cgCooldownUntil = Date.now() + 300000; break; }
    }
    if (i < toFetch.length - 1) await new Promise(r => setTimeout(r, 4000));
  }
  return results;
}

async function fetchCryptoNews() {
  try {
    const res = await fetch(`${PROXY}/api/cc/data/v2/news/?lang=EN&sortOrder=latest`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.Data || []).slice(0, 50);
  } catch { return []; }
}

async function computeNewsSentiment(articles, marketDataList) {
  if (!articles || articles.length === 0) return {};
  const sourceWeights = {
    cointelegraph: 1.1,
    coindesk: 1.25,
    decrypt: 1.05,
    theblock: 1.2,
    cryptoslate: 1.05,
    bitcoinist: 0.9,
  };
  const ambiguousSymbols = new Set(['sol','near','vet','one','gas','hot','fun','any','can','ion','key','new','pay','sun','win','zen','for','the']);
  const coinIndex = marketDataList.map(c => {
    const sym = (c.symbol || '').toLowerCase();
    const name = (c.name || '').toLowerCase();
    const id = (c.id || '').toLowerCase();
    const terms = [];
    if (sym.length > 2 && !ambiguousSymbols.has(sym)) terms.push({ value: sym, kind: 'symbol' });
    if (name.length > 3) terms.push({ value: name, kind: 'name' });
    if (id.length > 3 && id !== name) terms.push({ value: id, kind: 'id' });
    return { id: c.id, sym, display: (c.symbol || id).toUpperCase(), terms };
  });

  const coinArticles = {};
  articles.forEach(a => {
    const text = (a.title + ' ' + (a.body || '').substring(0, 300)).toLowerCase();
    const sourceName = (a.source_info?.name || a.source || '').toLowerCase().replace(/\s+/g, '');
    const sourceWeight = Object.entries(sourceWeights).find(([k]) => sourceName.includes(k))?.[1] || 1;
    coinIndex.forEach(coin => {
      const matched = coin.terms.some(t => {
        const escaped = t.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = t.kind === 'symbol' ? new RegExp(`\\b${escaped}\\b`, 'i') : new RegExp(escaped, 'i');
        return regex.test(text);
      });
      if (matched) {
        if (!coinArticles[coin.id]) coinArticles[coin.id] = { sym: coin.display, headlines: [], weightedMentions: 0 };
        coinArticles[coin.id].headlines.push(a.title);
        coinArticles[coin.id].weightedMentions += sourceWeight;
      }
    });
  });

  if (!AI_CONFIG.key) {
    const map = {};
    Object.entries(coinArticles).forEach(([coinId, entry]) => {
      map[coinId] = { newsScore: Math.min(5, Math.round(entry.weightedMentions * 0.8)), mentionCount: entry.headlines.length, weightedMentions: entry.weightedMentions, headlines: entry.headlines.slice(0, 5), isLLM: false, insight: null };
    });
    return map;
  }

  try {
    const allHeadlines = Object.entries(coinArticles).map(([, entry]) =>
      `${entry.sym}: ${entry.headlines.slice(0, 5).join(' | ')}`
    ).join('\n\n');

    if (!allHeadlines.trim()) return {};

    const resp = await fetch(AI_CONFIG.endpoint, { method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${AI_CONFIG.key}`,'HTTP-Referer':location.href}, body:JSON.stringify({model:AI_CONFIG.model,messages:[{role:'system',content:'You are a crypto news sentiment classifier. For each coin, analyze the headlines and return a JSON object. Each entry has "s" (sentiment score +10 to -10) and "i" (one short sentence summarizing what is happening). Return ONLY valid JSON like {"BTC":{"s":7,"i":"ETF inflows driving institutional demand"},"ETH":{"s":-2,"i":"Network congestion concerns after failed upgrade"}}. No explanation.'},{role:'user',content:allHeadlines}],temperature:0.1}) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    const llmScores = JSON.parse(data.choices[0].message.content.replace(/```json\n?|\n?```/g, '').trim());

    const map = {};
    Object.entries(coinArticles).forEach(([coinId, articleEntry]) => {
      const entry = llmScores[articleEntry.sym];
      const llmScore = typeof entry === 'object' ? (entry.s ?? 0) : (entry ?? 0);
      const insight = typeof entry === 'object' ? (entry.i || null) : null;
      const weightedScore = Math.max(-10, Math.min(10, llmScore * Math.min(1.25, 0.75 + articleEntry.weightedMentions / 10)));
      map[coinId] = { newsScore: Math.round(weightedScore), mentionCount: articleEntry.headlines.length, weightedMentions: articleEntry.weightedMentions, headlines: articleEntry.headlines.slice(0, 5), rawLLM: llmScore, isLLM: true, insight };
    });
    return map;
  } catch (e) {
    console.warn('LLM news classification failed, using mention-based fallback:', e.message);
    const map = {};
    Object.entries(coinArticles).forEach(([coinId, entry]) => {
      map[coinId] = { newsScore: Math.min(5, Math.round(entry.weightedMentions * 0.8)), mentionCount: entry.headlines.length, weightedMentions: entry.weightedMentions, headlines: entry.headlines.slice(0, 5), isLLM: false, insight: null };
    });
    return map;
  }
}

async function fetchUsdToInr() {
  try {
    const res = await fetch(`${PROXY}/api/paprika/tickers/btc-bitcoin?quotes=USD,INR`);
    if (res.ok) {
      const d = await res.json();
      const usd = d.quotes?.USD?.price;
      const inr = d.quotes?.INR?.price;
      if (usd && inr) return inr / usd;
    }
  } catch {}
  return CONFIG.USD_INR_FALLBACK;
}

function parseBinanceKlines(klines, rate) {
  if (!klines || !klines.length) return [];
  return klines.map(k => ({
    time: k[0],
    open: parseFloat(k[1]) * rate,
    high: parseFloat(k[2]) * rate,
    low: parseFloat(k[3]) * rate,
    close: parseFloat(k[4]) * rate,
    volume: parseFloat(k[5]),
    quoteVolume: parseFloat(k[7]) * rate,
  })).filter(c => [c.open, c.high, c.low, c.close].every(v => typeof v === 'number' && isFinite(v)));
}

async function fetchCoinGecko() {
  if (Date.now() < cgCooldownUntil) throw new Error('CoinGecko on cooldown');
  const base = `${PROXY}/api/cg/coins/markets?vs_currency=inr&order=market_cap_desc&per_page=${CONFIG.PER_PAGE}&sparkline=true&price_change_percentage=1h%2C24h%2C7d%2C30d`;
  const res1 = await fetch(base + '&page=1');
  if (res1.status === 429) { cgCooldownUntil = Date.now() + 300000; throw new Error('CoinGecko 429'); }
  if (!res1.ok) throw new Error(`CoinGecko page 1: ${res1.status}`);
  const raw = await res1.json();
  await new Promise(r => setTimeout(r, 2000));
  try {
    const res2 = await fetch(base + '&page=2');
    if (res2.status === 429) { cgCooldownUntil = Date.now() + 300000; }
    else if (res2.ok) raw.push(...await res2.json());
  } catch {}
  
  // Validate each coin from CoinGecko
  const validated = raw
    .map(coin => validateCoinData(coin))
    .filter(coin => coin !== null);
  
  dataSource = 'coingecko';
  return validated;
}

async function fetchCoinPaprika() {
  const res = await fetch(`${PROXY}/api/paprika/tickers`);
  if (!res.ok) throw new Error(`CoinPaprika: ${res.status}`);
  const tickers = await res.json();
  const rate = await fetchUsdToInr();
  usdToInr = rate;
  dataSource = 'coinpaprika';

  // Validate each ticker from CoinPaprika
  const validated = tickers
    .map(t => validatePaprikaTicker(t))
    .filter(t => t !== null && t.rank <= 500)
    .slice(0, 500)
    .map(t => {
      const q = t.quotes.USD;
      return {
        id: t.id,
        symbol: t.symbol,
        name: t.name,
        current_price: q.price * rate,
        market_cap: q.market_cap * rate,
        total_volume: q.volume_24h * rate,
        market_cap_rank: t.rank,
        price_change_percentage_1h_in_currency: q.percent_change_1h,
        price_change_percentage_24h: q.percent_change_24h,
        price_change_percentage_7d_in_currency: q.percent_change_7d,
        price_change_percentage_30d_in_currency: q.percent_change_30d,
        ath_change_percentage: q.percent_from_price_ath,
        sparkline_in_7d: { price: [] },
        _sparkline_prices: [],
        _source: 'coinpaprika',
      };
    });
  
  return validated;
}

async function fetchBinance() {
  const rate = await fetchUsdToInr();
  usdToInr = rate;

  const tickerRes = await fetch(`${PROXY}/api/binance/api/v3/ticker/24hr`);
  if (!tickerRes.ok) throw new Error(`Binance ticker: ${tickerRes.status}`);
  const allTickers = await tickerRes.json();

  // Validate each ticker
  const excluded = /UP$|DOWN$|BULL$|BEAR$/;
  const validatedTickers = allTickers
    .map(t => validateBinanceTicker(t))
    .filter(t => t !== null && !excluded.test(t.symbol) && t.quoteVolume > 1000);

  validatedTickers.sort((a, b) => b.quoteVolume - a.quoteVolume);
  const top = validatedTickers.slice(0, 400);

  const coins = top.map(t => {
    const base = t.symbol.replace('USDT', '').toLowerCase();
    const price = t.lastPrice;
    const open = t.openPrice;
    const vol = t.quoteVolume;
    const pct24h = open > 0 ? ((price - open) / open) * 100 : 0;
    return {
      id: base,
      symbol: base,
      name: base.toUpperCase(),
      current_price: price * rate,
      market_cap: vol * rate * 10,
      total_volume: vol * rate,
      market_cap_rank: null,
      price_change_percentage_1h_in_currency: null,
      price_change_percentage_24h: isValidPercentage(pct24h, -100, 1000) ? pct24h : 0,
      price_change_percentage_7d_in_currency: null,
      price_change_percentage_30d_in_currency: null,
      ath_change_percentage: null,
      sparkline_in_7d: { price: [] },
      _sparkline_prices: [],
      _ohlcv_1h: [],
      _ohlcv_4h: [],
      _volume_1h: [],
      _quote_volume_1h: [],
      _binance_symbol: t.symbol,
      _source: 'binance',
    };
  });

  const klinesTarget = coins.slice(0, 80);
  const KLINE_BATCH = 20;
  for (let i = 0; i < klinesTarget.length; i += KLINE_BATCH) {
    const batch = klinesTarget.slice(i, i + KLINE_BATCH);
    const klinePromises = batch.flatMap(c => [
      fetch(`${PROXY}/api/binance/api/v3/klines?symbol=${c._binance_symbol}&interval=1h&limit=168`)
        .then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`${PROXY}/api/binance/api/v3/klines?symbol=${c._binance_symbol}&interval=4h&limit=42`)
        .then(r => r.ok ? r.json() : null).catch(() => null),
    ]);
    const results = await Promise.all(klinePromises);
    batch.forEach((coin, idx) => {
      const hourlyKlines = results[idx * 2];
      const fourHourKlines = results[idx * 2 + 1];

      if (hourlyKlines && hourlyKlines.length > 0) {
        const hourlyCandles = parseBinanceKlines(hourlyKlines, rate);
        const hourlyCloses = hourlyCandles.map(k => k.close);
        coin._ohlcv_1h = hourlyCandles;
        coin._volume_1h = hourlyCandles.map(k => k.volume);
        coin._quote_volume_1h = hourlyCandles.map(k => k.quoteVolume);
        coin._sparkline_prices = hourlyCloses;
        coin.sparkline_in_7d = { price: hourlyCloses };
        const latest = hourlyCloses[hourlyCloses.length - 1];
        if (hourlyCloses.length >= 2) {
          const oneHourAgo = hourlyCloses[hourlyCloses.length - 2];
          if (oneHourAgo > 0) coin.price_change_percentage_1h_in_currency = ((latest - oneHourAgo) / oneHourAgo) * 100;
          const oldest = hourlyCloses[0];
          if (oldest > 0) coin.price_change_percentage_7d_in_currency = ((latest - oldest) / oldest) * 100;
        }
      }
      if (fourHourKlines && fourHourKlines.length > 0) {
        const fourHourCandles = parseBinanceKlines(fourHourKlines, rate);
        coin._ohlcv_4h = fourHourCandles;
        coin._4h_prices = fourHourCandles.map(k => k.close);
      }
    });
    if (i + KLINE_BATCH < klinesTarget.length) await new Promise(r => setTimeout(r, 300));
  }

  const btcCoin = coins.find(c => c.symbol === 'btc');
  if (btcCoin && btcCoin._sparkline_prices.length === 0) {
    try {
      const btcKlineRes = await fetch(`${PROXY}/api/binance/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=168`);
      if (btcKlineRes.ok) {
        const btcKlines = await btcKlineRes.json();
        btcCoin._ohlcv_1h = parseBinanceKlines(btcKlines, rate);
        btcCoin._sparkline_prices = btcCoin._ohlcv_1h.map(k => k.close);
        btcCoin._volume_1h = btcCoin._ohlcv_1h.map(k => k.volume);
        btcCoin._quote_volume_1h = btcCoin._ohlcv_1h.map(k => k.quoteVolume);
        btcCoin.sparkline_in_7d = { price: btcCoin._sparkline_prices };
      }
    } catch {}
  }

  dataSource = 'binance';
  return coins;
}

async function enrichWithCoinGeckoMeta(coins) {
  if (Date.now() < cgCooldownUntil) return;
  try {
    const res = await fetch(`${PROXY}/api/cg/coins/markets?vs_currency=inr&order=market_cap_desc&per_page=250&page=1&sparkline=false&price_change_percentage=1h%2C24h%2C7d%2C30d`);
    if (res.status === 429) { cgCooldownUntil = Date.now() + 300000; console.warn('CG enrichment 429 — cooldown 5m'); return; }
    if (!res.ok) return;
    const cgCoins = await res.json();
    const cgMap = {};
    cgCoins.forEach(c => { cgMap[c.symbol.toLowerCase()] = c; });

    let enriched = 0;
    coins.forEach(coin => {
      const cg = cgMap[coin.symbol];
      if (cg) {
        coin.market_cap = cg.market_cap || coin.market_cap;
        coin.market_cap_rank = cg.market_cap_rank;
        coin.ath_change_percentage = cg.ath_change_percentage;
        coin.name = cg.name || coin.name;
        coin.id = cg.id;
        coin.price_change_percentage_1h_in_currency = cg.price_change_percentage_1h_in_currency ?? coin.price_change_percentage_1h_in_currency;
        coin.price_change_percentage_30d_in_currency = cg.price_change_percentage_30d_in_currency ?? coin.price_change_percentage_30d_in_currency;
        enriched++;
      }
    });
    console.log(`Enriched ${enriched}/${coins.length} coins with CoinGecko metadata`);
  } catch (e) {
    if (e.message?.includes('429')) cgCooldownUntil = Date.now() + 300000;
    console.warn('CoinGecko metadata enrichment failed (non-critical):', e.message);
  }
}

async function fetchMarketData() {
  try {
    const coins = await fetchBinance();
    if (Date.now() >= cgCooldownUntil) {
      try {
        await enrichWithCoinGeckoMeta(coins);
      } catch (e) {
        console.warn('CoinGecko enrichment failed (non-critical):', e.message);
        if (e.message.includes('429')) cgCooldownUntil = Date.now() + 300000;
      }
    }
    return coins;
  } catch (e) {
    console.warn('Binance failed:', e.message, '→ trying CoinGecko');
  }

  if (Date.now() >= cgCooldownUntil) {
    try {
      return await fetchCoinGecko();
    } catch (e) {
      console.warn('CoinGecko failed:', e.message, '→ trying CoinPaprika');
      if (e.message.includes('429')) cgCooldownUntil = Date.now() + 300000;
    }
  }

  return await fetchCoinPaprika();
}

// ============ Two-Pass Enrichment: Fill ALL missing data for top candidates ============

/**
 * Identifies which data fields are missing for a coin
 */
function identifyMissingFields(coin) {
  const missing = [];
  if (coin.ath_change_percentage == null) missing.push('ath');
  if (coin.price_change_percentage_30d_in_currency == null) missing.push('30d_change');
  if (coin.price_change_percentage_1h_in_currency == null) missing.push('1h_change');
  if (!coin.market_cap_rank) missing.push('rank');
  if (!devActivityMap[coin.id]) missing.push('dev_activity');
  if (!coin._sparkline_prices?.length && !coin.sparkline_in_7d?.price?.length) missing.push('sparkline');
  if (!coin._ohlcv_1h?.length) missing.push('ohlcv_1h');
  if (!coin._4h_prices?.length && !coin._ohlcv_4h?.length) missing.push('ohlcv_4h');
  return missing;
}

/**
 * Fetches complete CoinGecko detail for a single coin (ATH, dev, community, etc.)
 */
async function fetchCoinGeckoDetail(coinId) {
  if (Date.now() < cgCooldownUntil) return null;
  try {
    const res = await fetch(`${PROXY}/api/cg/coins/${coinId}?localization=false&tickers=false&community_data=true&developer_data=true&sparkline=true`);
    if (res.status === 429) { cgCooldownUntil = Date.now() + 300000; return null; }
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    if (e.message?.includes('429')) cgCooldownUntil = Date.now() + 300000;
    return null;
  }
}

/**
 * Fetches Binance klines for a specific symbol if missing
 */
async function fetchBinanceKlinesForCoin(coin, rate) {
  if (!coin._binance_symbol) return;
  const results = {};
  try {
    if (!coin._ohlcv_1h?.length) {
      const res = await fetch(`${PROXY}/api/binance/api/v3/klines?symbol=${coin._binance_symbol}&interval=1h&limit=168`);
      if (res.ok) results.hourly = await res.json();
    }
    if (!coin._ohlcv_4h?.length) {
      const res = await fetch(`${PROXY}/api/binance/api/v3/klines?symbol=${coin._binance_symbol}&interval=4h&limit=42`);
      if (res.ok) results.fourHour = await res.json();
    }
  } catch {}
  
  if (results.hourly?.length) {
    const candles = parseBinanceKlines(results.hourly, rate);
    coin._ohlcv_1h = candles;
    coin._volume_1h = candles.map(k => k.volume);
    coin._quote_volume_1h = candles.map(k => k.quoteVolume);
    coin._sparkline_prices = candles.map(k => k.close);
    coin.sparkline_in_7d = { price: coin._sparkline_prices };
    const closes = coin._sparkline_prices;
    if (closes.length >= 2) {
      const latest = closes[closes.length - 1];
      const oneHourAgo = closes[closes.length - 2];
      if (oneHourAgo > 0) coin.price_change_percentage_1h_in_currency = ((latest - oneHourAgo) / oneHourAgo) * 100;
      const oldest = closes[0];
      if (oldest > 0) coin.price_change_percentage_7d_in_currency = ((latest - oldest) / oldest) * 100;
    }
  }
  if (results.fourHour?.length) {
    const candles = parseBinanceKlines(results.fourHour, rate);
    coin._ohlcv_4h = candles;
    coin._4h_prices = candles.map(k => k.close);
  }
}

/**
 * Two-pass enrichment: fetches ALL missing data for top candidate coins.
 * Called after initial scoring to ensure recommended coins have complete data.
 * Uses multiple free APIs: CoinPaprika (ATH, 30d, rank), CoinGecko (dev), CoinCap (history), Binance (klines)
 * 
 * @param {Array} candidates - Top coins that passed initial scoring
 * @param {number} maxCoins - Maximum coins to fully enrich (API budget)
 * @returns {Object} - Map of enriched data { devActivity, athData, etc. }
 */
async function enrichCandidatesFullData(candidates, maxCoins = 10) {
  if (!candidates?.length) return { enrichedCount: 0 };
  
  const toEnrich = candidates.slice(0, maxCoins);
  let enrichedCount = 0;
  const rate = usdToInr || CONFIG.USD_INR_FALLBACK;
  
  console.log(`[Enrich] Starting full enrichment for ${toEnrich.length} candidates...`);

  // Load cached dev activity from localStorage
  loadCachedDevActivity();
  
  // 1. CoinPaprika enrichment (ATH, 30d, 1h, rank) — no rate limit concerns
  const needsPaprika = toEnrich.filter(c => {
    const missing = identifyMissingFields(c);
    return missing.includes('ath') || missing.includes('30d_change') || missing.includes('1h_change') || missing.includes('rank');
  });
  
  if (needsPaprika.length > 0) {
    console.log(`[Enrich] Fetching CoinPaprika details for ${needsPaprika.length} coins...`);
    // Fetch in parallel batches of 5
    for (let i = 0; i < needsPaprika.length; i += 5) {
      const batch = needsPaprika.slice(i, i + 5);
      const promises = batch.map(c => fetchPaprikaDetail(c));
      await Promise.all(promises);
      if (i + 5 < needsPaprika.length) await new Promise(r => setTimeout(r, 500));
    }
  }
  
  // 2. CoinCap enrichment for sparkline/history (free, no key, 200 req/min)
  const needsHistory = toEnrich.filter(c => {
    const missing = identifyMissingFields(c);
    return missing.includes('sparkline') && !c._binance_symbol; // Only for non-Binance coins
  });
  
  if (needsHistory.length > 0) {
    console.log(`[Enrich] Fetching CoinCap history for ${needsHistory.length} coins...`);
    const histPromises = needsHistory.slice(0, 8).map(c => fetchCoinCapHistory(c, rate));
    await Promise.all(histPromises);
  }
  
  // 3. CoinGecko details for dev activity (rate-limited, only for coins still missing dev)
  const needsDev = toEnrich.filter(c => {
    return !devActivityMap[c.id] && !getCachedDevActivity(c.id);
  });
  
  if (needsDev.length > 0 && Date.now() >= cgCooldownUntil) {
    console.log(`[Enrich] Fetching CoinGecko dev data for ${Math.min(needsDev.length, 6)} coins...`);
    const cgBatch = needsDev.slice(0, 6);
    for (let i = 0; i < cgBatch.length; i++) {
      const coin = cgBatch[i];
      const detail = await fetchCoinGeckoDetail(coin.id);
      
      if (detail) {
        // Fill ATH if still missing (CoinPaprika might have filled it)
        if (coin.ath_change_percentage == null) {
          if (detail.market_data?.ath_change_percentage?.inr != null) {
            coin.ath_change_percentage = detail.market_data.ath_change_percentage.inr;
          } else if (detail.market_data?.ath_change_percentage?.usd != null) {
            coin.ath_change_percentage = detail.market_data.ath_change_percentage.usd;
          }
        }
        
        // Fill 30d change if still missing
        if (coin.price_change_percentage_30d_in_currency == null && detail.market_data?.price_change_percentage_30d != null) {
          coin.price_change_percentage_30d_in_currency = detail.market_data.price_change_percentage_30d;
        }
        
        // Fill market cap rank if still missing
        if (!coin.market_cap_rank && detail.market_cap_rank) {
          coin.market_cap_rank = detail.market_cap_rank;
        }
        
        // Fill developer activity and cache it
        if (detail.developer_data) {
          devActivityMap[coin.id] = detail.developer_data;
          cacheDevActivity(coin.id, detail.developer_data);
        }
        
        // Fill sparkline if still missing
        if (!coin._sparkline_prices?.length && detail.market_data?.sparkline_7d?.price?.length) {
          coin._sparkline_prices = detail.market_data.sparkline_7d.price;
          coin.sparkline_in_7d = { price: detail.market_data.sparkline_7d.price };
        }
        
        enrichedCount++;
        console.log(`[Enrich] ${coin.symbol.toUpperCase()}: CoinGecko filled (Dev: ${!!detail.developer_data})`);
      }
      
      if (i < cgBatch.length - 1) await new Promise(r => setTimeout(r, 2500));
      if (Date.now() >= cgCooldownUntil) break;
    }
  } else if (needsDev.length > 0) {
    // CoinGecko on cooldown — use cached dev data
    needsDev.forEach(c => {
      const cached = getCachedDevActivity(c.id);
      if (cached) {
        devActivityMap[c.id] = cached;
        console.log(`[Enrich] ${c.symbol.toUpperCase()}: using cached dev activity`);
      }
    });
  }
  
  // 4. Fetch Binance klines for coins missing OHLCV data
  const needsKlines = toEnrich.filter(c => {
    const missing = identifyMissingFields(c);
    return (missing.includes('ohlcv_1h') || missing.includes('ohlcv_4h')) && c._binance_symbol;
  });
  
  if (needsKlines.length > 0) {
    console.log(`[Enrich] Fetching Binance klines for ${needsKlines.length} coins...`);
    const klineBatch = needsKlines.slice(0, 10);
    const klinePromises = klineBatch.map(c => fetchBinanceKlinesForCoin(c, rate));
    await Promise.all(klinePromises);
  }
  
  // 5. Log completeness report
  const completenessReport = toEnrich.map(c => {
    const missing = identifyMissingFields(c);
    return { symbol: c.symbol.toUpperCase(), missing, complete: missing.length === 0 };
  });
  
  const fullyComplete = completenessReport.filter(r => r.complete).length;
  const stillMissing = completenessReport.filter(r => !r.complete);
  
  console.log(`[Enrich] ✓ Complete: ${fullyComplete}/${toEnrich.length} coins have full data`);
  if (stillMissing.length > 0) {
    stillMissing.forEach(r => {
      console.log(`[Enrich] ⚠ ${r.symbol} still missing: ${r.missing.join(', ')}`);
    });
  }
  
  return { enrichedCount, fullyComplete, total: toEnrich.length, report: completenessReport };
}

// ============ CoinPaprika Per-Coin Enrichment ============

/**
 * Fetches CoinPaprika ticker detail for a single coin.
 * Fills: ATH%, 1h/30d change, rank — all free, no API key needed.
 */
async function fetchPaprikaDetail(coin) {
  // CoinPaprika uses IDs like "btc-bitcoin", "eth-ethereum"
  // Try to construct the paprika ID from symbol + name
  const paprikaId = buildPaprikaId(coin);
  if (!paprikaId) return;
  
  try {
    const res = await fetch(`${PROXY}/api/paprika/tickers/${paprikaId}`);
    if (!res.ok) return;
    const data = await res.json();
    
    const q = data.quotes?.USD;
    if (!q) return;
    
    const rate = usdToInr || CONFIG.USD_INR_FALLBACK;
    
    // Fill ATH distance
    if (coin.ath_change_percentage == null && q.percent_from_price_ath != null) {
      coin.ath_change_percentage = q.percent_from_price_ath;
    }
    
    // Fill 30d change
    if (coin.price_change_percentage_30d_in_currency == null && q.percent_change_30d != null) {
      coin.price_change_percentage_30d_in_currency = q.percent_change_30d;
    }
    
    // Fill 1h change
    if (coin.price_change_percentage_1h_in_currency == null && q.percent_change_1h != null) {
      coin.price_change_percentage_1h_in_currency = q.percent_change_1h;
    }
    
    // Fill rank
    if (!coin.market_cap_rank && data.rank) {
      coin.market_cap_rank = data.rank;
    }
    
    // Fill market cap if missing or zero
    if ((!coin.market_cap || coin.market_cap === 0) && q.market_cap) {
      coin.market_cap = q.market_cap * rate;
    }
    
    console.log(`[Paprika] ${coin.symbol.toUpperCase()}: ATH=${q.percent_from_price_ath != null ? sf(q.percent_from_price_ath,0)+'%' : 'N/A'}, 30d=${q.percent_change_30d != null ? sf(q.percent_change_30d,1)+'%' : 'N/A'}, Rank=${data.rank || 'N/A'}`);
  } catch (e) {
    // Non-critical, silently fail
  }
}

/**
 * Builds a CoinPaprika ID from coin data.
 * CoinPaprika format: "btc-bitcoin", "eth-ethereum", "sol-solana"
 */
function buildPaprikaId(coin) {
  const sym = (coin.symbol || '').toLowerCase();
  const name = (coin.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const id = (coin.id || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  
  if (!sym) return null;
  
  // Try common patterns
  // Most coins: "sym-name" e.g. "btc-bitcoin"
  if (name) return `${sym}-${name}`;
  if (id && id !== sym) return `${sym}-${id}`;
  return null;
}

// ============ CoinCap History Enrichment ============

/**
 * Fetches hourly price history from CoinCap for sparkline data.
 * Free, no API key, 200 req/min.
 */
async function fetchCoinCapHistory(coin, rate) {
  // CoinCap uses lowercase names like "bitcoin", "ethereum", "solana"
  const coinCapId = (coin.id || coin.name || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (!coinCapId) return;
  
  try {
    const now = Date.now();
    const weekAgo = now - (7 * 24 * 60 * 60 * 1000);
    const res = await fetch(`${PROXY}/api/coincap/assets/${coinCapId}/history?interval=h1&start=${weekAgo}&end=${now}`);
    if (!res.ok) return;
    const data = await res.json();
    
    if (data.data?.length > 0) {
      const prices = data.data.map(p => parseFloat(p.priceUsd) * rate).filter(p => isFinite(p) && p > 0);
      if (prices.length >= 24) {
        coin._sparkline_prices = prices;
        coin.sparkline_in_7d = { price: prices };
        
        // Compute 7d change from history
        const latest = prices[prices.length - 1];
        const oldest = prices[0];
        if (oldest > 0 && coin.price_change_percentage_7d_in_currency == null) {
          coin.price_change_percentage_7d_in_currency = ((latest - oldest) / oldest) * 100;
        }
        
        console.log(`[CoinCap] ${coin.symbol.toUpperCase()}: got ${prices.length} hourly prices`);
      }
    }
  } catch (e) {
    // Non-critical
  }
}

// ============ Dev Activity Cache (localStorage) ============

const DEV_CACHE_KEY = 'quant_dev_activity_cache_v1';
const DEV_CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days — dev data doesn't change hourly

/**
 * Loads cached dev activity from localStorage into devActivityMap
 */
function loadCachedDevActivity() {
  try {
    const cached = JSON.parse(localStorage.getItem(DEV_CACHE_KEY) || '{}');
    const now = Date.now();
    let loaded = 0;
    
    Object.entries(cached).forEach(([coinId, entry]) => {
      // Only use cache if not expired and not already in map
      if (entry.timestamp && (now - entry.timestamp) < DEV_CACHE_MAX_AGE && !devActivityMap[coinId]) {
        devActivityMap[coinId] = entry.data;
        loaded++;
      }
    });
    
    if (loaded > 0) console.log(`[DevCache] Loaded ${loaded} cached dev activity entries`);
  } catch {}
}

/**
 * Gets cached dev activity for a specific coin
 */
function getCachedDevActivity(coinId) {
  try {
    const cached = JSON.parse(localStorage.getItem(DEV_CACHE_KEY) || '{}');
    const entry = cached[coinId];
    if (entry && entry.timestamp && (Date.now() - entry.timestamp) < DEV_CACHE_MAX_AGE) {
      return entry.data;
    }
  } catch {}
  return null;
}

/**
 * Caches dev activity for a coin in localStorage
 */
function cacheDevActivity(coinId, devData) {
  try {
    const cached = JSON.parse(localStorage.getItem(DEV_CACHE_KEY) || '{}');
    cached[coinId] = { data: devData, timestamp: Date.now() };
    
    // Prune old entries (keep max 50)
    const entries = Object.entries(cached);
    if (entries.length > 50) {
      entries.sort((a, b) => (b[1].timestamp || 0) - (a[1].timestamp || 0));
      const pruned = Object.fromEntries(entries.slice(0, 50));
      localStorage.setItem(DEV_CACHE_KEY, JSON.stringify(pruned));
    } else {
      localStorage.setItem(DEV_CACHE_KEY, JSON.stringify(cached));
    }
  } catch {}
}
