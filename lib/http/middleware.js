// HTTP 中间件：CORS / 限流 / 请求日志 / 统一异常处理
const { HttpError } = require('./errors');
const config = require('../config');

function sendJSON(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj, null, 2));
}

// ---- CORS ----
function corsMiddleware(req, res, next) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return; // 不调用 next → 请求已终结
  }
  next();
}

// ---- 限流（固定窗口，按来源 IP；RATE_LIMIT_PER_MIN 为 0/空 时不限制）----
const _ratelimit = new Map(); // ip -> { hits, windowStart }
function rateLimitMiddleware(req, res, next) {
  const limit = config.get('RATE_LIMIT_PER_MIN');
  if (!limit) return next();
  const ip = req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  let rec = _ratelimit.get(ip);
  if (!rec || now - rec.windowStart > 60000) {
    rec = { hits: 0, windowStart: now };
    _ratelimit.set(ip, rec);
  }
  rec.hits++;
  if (rec.hits > limit) {
    res.setHeader('Retry-After', '60');
    return next(new HttpError(429, 'RATE_LIMITED', '请求过于频繁，请稍后再试'));
  }
  next();
}

// ---- 请求日志（body 已在 handleRequest 中读出，这里只记方法/路径/耗时/状态）----
function logMiddleware(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    console.log(`[http] ${req.method} ${req.url} → ${res.statusCode} (${ms}ms)`);
  });
  next();
}

// ---- 统一异常处理：HttpError → 精确状态码；未知异常 → 500 ----
function errorHandler(err, req, res) {
  if (err instanceof HttpError) {
    return sendJSON(res, err.status, err.toJSON());
  }
  console.error('[http] unhandled error:', err && err.stack ? err.stack : err);
  sendJSON(res, 500, { code: 'INTERNAL_ERROR', message: '服务器内部错误' });
}

module.exports = { sendJSON, corsMiddleware, rateLimitMiddleware, logMiddleware, errorHandler };