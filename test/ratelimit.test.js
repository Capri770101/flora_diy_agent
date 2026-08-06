// 限流中间件单测：在进程内模拟 req/res，验证固定窗口限流行为
// 运行：node test/ratelimit.test.js
const assert = require('node:assert/strict');
const { rateLimitMiddleware } = require('../lib/http/middleware');

process.env.RATE_LIMIT_PER_MIN = '3';
// 重新 require 会缓存，直接删除缓存强制重载
delete require.cache[require.resolve('../lib/http/middleware')];
const mw = require('../lib/http/middleware').rateLimitMiddleware;

let pass = 0;
function check(cond, msg) { assert.ok(cond, msg); pass++; }

// 模拟：同一 IP 连打 6 次，限 3 次 → 前 3 次放行，后 3 次 429
const req = { socket: { remoteAddress: '10.0.0.1' } };
const results = [];
function hit() {
  const res = { headers: {}, setHeader() {}, writeHead() {}, end() {} };
  mw(req, res, (err) => { results.push(err ? err.status : 0); });
}

for (let i = 0; i < 6; i++) hit();
check(results.slice(0, 3).every((s) => s === 0), '前 3 次请求放行');
check(results.slice(3).every((s) => s === 429), '第 4 次起被限流 429');
check(results.filter((s) => s === 429).length === 3, '共拦截 3 次');

// 另一 IP 不受影响（独立窗口）
const req2 = { socket: { remoteAddress: '10.0.0.2' } };
let passed2 = 0;
for (let i = 0; i < 3; i++) {
  mw(req2, { headers: {}, setHeader() {}, writeHead() {}, end() {} }, () => { passed2++; });
}
check(passed2 === 3, '不同 IP 互不影响');

// 关闭限流（0）→ 全放行
process.env.RATE_LIMIT_PER_MIN = '0';
delete require.cache[require.resolve('../lib/http/middleware')];
const mw2 = require('../lib/http/middleware').rateLimitMiddleware;
let passed3 = 0;
for (let i = 0; i < 20; i++) {
  mw2(req, { headers: {}, setHeader() {}, writeHead() {}, end() {} }, () => { passed3++; });
}
check(passed3 === 20, 'RATE_LIMIT_PER_MIN=0 时不限流');

console.log(`\n限流中间件测试：${pass} 通过`);
