const http = require('http');
const https = require('https');
const { URL } = require('url');

const PORT = 3099;

// Rate limiting configuration
const RATE_LIMITS = {
  windowMs: 60 * 1000, // 1 minute window
  maxRequests: 100,    // max requests per window per IP
  blockDurationMs: 5 * 60 * 1000, // 5 minute block if limit exceeded
};

// In-memory rate limit store (IP -> {count, resetTime, blocked})
const rateLimitStore = new Map();

// Clean up expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, data] of rateLimitStore.entries()) {
    if (now > data.resetTime && !data.blocked) {
      rateLimitStore.delete(ip);
    }
  }
}, 5 * 60 * 1000);

function checkRateLimit(clientIp) {
  const now = Date.now();
  const entry = rateLimitStore.get(clientIp);

  // Check if IP is blocked
  if (entry?.blocked && now < entry.blockedUntil) {
    return { allowed: false, retryAfter: Math.ceil((entry.blockedUntil - now) / 1000) };
  }

  // Reset if window expired
  if (!entry || now > entry.resetTime) {
    rateLimitStore.set(clientIp, { count: 1, resetTime: now + RATE_LIMITS.windowMs });
    return { allowed: true };
  }

  // Increment count
  entry.count++;

  // Check if limit exceeded
  if (entry.count > RATE_LIMITS.maxRequests) {
    entry.blocked = true;
    entry.blockedUntil = now + RATE_LIMITS.blockDurationMs;
    console.warn(`⚠ Rate limit exceeded for ${clientIp}, blocked for ${RATE_LIMITS.blockDurationMs / 1000}s`);
    return { allowed: false, retryAfter: RATE_LIMITS.blockDurationMs / 1000 };
  }

  return { allowed: true };
}

// Request validation
function validateRequest(req) {
  const parsed = new URL(req.url, `http://localhost:${PORT}`);
  const path = parsed.pathname;
  
  // Validate path length
  if (path.length > 500) {
    return { valid: false, error: 'Path too long' };
  }

  // Validate query string length
  if (parsed.search.length > 2000) {
    return { valid: false, error: 'Query string too long' };
  }

  // Check for suspicious patterns
  const suspiciousPatterns = [/\.\./, /%00/, /\0/, /<script/i, /javascript:/i];
  const fullUrl = req.url.toLowerCase();
  for (const pattern of suspiciousPatterns) {
    if (pattern.test(fullUrl)) {
      return { valid: false, error: 'Invalid request pattern' };
    }
  }

  return { valid: true };
}

const ROUTES = {
  '/api/fng':      'https://api.alternative.me/fng/',
  '/api/trending': 'https://api.coingecko.com/api/v3/search/trending',
  '/api/global':   'https://api.coingecko.com/api/v3/global',
  '/api/usdrate':  'https://api.coinpaprika.com/v1/tickers/usd-us-dollar?quotes=INR',
};

function buildTarget(req) {
  const parsed = new URL(req.url, `http://localhost:${PORT}`);
  const path = parsed.pathname;

  if (ROUTES[path]) return ROUTES[path] + parsed.search;
  if (path.startsWith('/api/binance/')) return 'https://api.binance.com/' + path.slice(13) + parsed.search;
  if (path.startsWith('/api/cg/'))      return 'https://api.coingecko.com/api/v3/' + path.slice(8) + parsed.search;
  if (path.startsWith('/api/cc/'))      return 'https://min-api.cryptocompare.com/' + path.slice(8) + parsed.search;
  if (path.startsWith('/api/paprika/')) return 'https://api.coinpaprika.com/v1/' + path.slice(13) + parsed.search;
  if (path.startsWith('/api/coincap/')) return 'https://api.coincap.io/v2/' + path.slice(13) + parsed.search;
  return null;
}

function proxyRequest(target, res) {
  const url = new URL(target);
  const options = {
    hostname: url.hostname,
    port: 443,
    path: url.pathname + url.search,
    method: 'GET',
    headers: {
      'User-Agent': 'QuantScreenerProxy/1.0',
      'Accept': 'application/json',
    },
  };

  const upstream = https.request(options, response => {
    const ct = response.headers['content-type'] || 'application/json';
    res.writeHead(response.statusCode, {
      'Content-Type': ct,
      'X-Upstream-Status': response.statusCode,
    });
    response.pipe(res);
  });

  upstream.on('error', err => {
    console.error(`  ✗ ${target} → ${err.message}`);
    res.writeHead(502);
    res.end(JSON.stringify({ error: err.message }));
  });

  upstream.end();
}

const server = http.createServer((req, res) => {
  // Get client IP (handle proxy headers)
  const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';

  // Validate request
  const validation = validateRequest(req);
  if (!validation.valid) {
    console.warn(`⚠ Invalid request from ${clientIp}: ${validation.error}`);
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: validation.error }));
    return;
  }

  // Check rate limit
  const rateCheck = checkRateLimit(clientIp);
  if (!rateCheck.allowed) {
    res.writeHead(429, {
      'Content-Type': 'application/json',
      'Retry-After': rateCheck.retryAfter.toString(),
      'X-RateLimit-Limit': RATE_LIMITS.maxRequests.toString(),
      'X-RateLimit-Reset': RATE_LIMITS.windowMs.toString(),
    });
    res.end(JSON.stringify({ 
      error: 'Too many requests', 
      retryAfter: rateCheck.retryAfter 
    }));
    return;
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const target = buildTarget(req);
  if (!target) {
    console.log(`  ? 404 ${req.url}`);
    res.writeHead(404);
    res.end('Unknown route');
    return;
  }

  console.log(`  → ${clientIp} ${req.url.slice(0, 80)}`);
  proxyRequest(target, res);
});

server.listen(PORT, () => {
  console.log(`\n  CORS proxy running on http://localhost:${PORT}`);
  console.log(`  Routes: /api/binance/* → Binance`);
  console.log(`          /api/cg/* → CoinGecko`);
  console.log(`          /api/paprika/* → CoinPaprika`);
  console.log(`          /api/coincap/* → CoinCap`);
  console.log(`          /api/cc/* → CryptoCompare`);
  console.log(`          /api/fng → Fear & Greed\n`);
});
