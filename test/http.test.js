// HTTP 壳层测试（零依赖，node:assert）：路由匹配 / 参数提取 / 错误码 / CORS / 限流 / OpenAPI
// 以及 6 项产品改进相关的 HTTP 集成：GET /api/v1/plans（历史方案列表）、
// POST /api/v1/orders（下单）、POST /api/v1/orders/:id/pay（支付接口化 mock）。
//
// 运行：node test/http.test.js
//   默认自托管一个隔离 server（独立 FLORA_DATA_DIR，关闭 LLM/出图避免外网依赖），
//   不污染真实数据。若已手动启动 server 并希望复用，可设 FLR_TEST_EXTERNAL=1。
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { Router } = require('../lib/http/router');
const { HttpError } = require('../lib/http/errors');
const { buildOpenApi } = require('../lib/http/openapi');

const BASE = process.argv[2] || 'http://localhost:3000';
let pass = 0;
async function check(cond, msg) {
  assert.ok(cond, msg);
  pass++;
}

// ── 单元：Router 匹配与参数提取 ──
{
  const r = new Router();
  let captured = null;
  r.get('/api/v1/orders/:id', (ctx) => { captured = ctx.params; });
  r.post('/api/v1/shops', () => {});
  const m1 = r.match('GET', '/api/v1/orders/ord_abc123');
  assert.ok(m1, 'GET /api/v1/orders/:id 应匹配');
  m1.handler({ params: m1.params });
  check(captured.id === 'ord_abc123', '路径参数提取 :id');
  check(r.match('GET', '/api/v1/orders/a/b') === null, '多余路径段不匹配');
  check(r.match('DELETE', '/api/v1/orders/x') === null, '方法不匹配返回 null');
  check(r.match('POST', '/api/v1/shops') !== null, 'POST 注册匹配');
  let threw = false;
  try { r.add('FOO', '/x', () => { }); } catch (e) { threw = true; }
  check(threw, '非法方法注册被拒');
}

// ── 单元：HttpError 结构 ──
{
  const e = new HttpError(404, 'NOT_FOUND', 'plan not found', { plan_id: 'p' });
  check(e.status === 404 && e.code === 'NOT_FOUND', 'HttpError 携带状态码与错误码');
  const j = e.toJSON();
  check(j.code === 'NOT_FOUND' && j.details.plan_id === 'p', 'HttpError.toJSON 结构');
  const bi = HttpError.badRequest('bad');
  check(bi.status === 400 && bi.code === 'BAD_REQUEST', 'badRequest 快捷构造');
  const rl = HttpError.rateLimited('slow down');
  check(rl.status === 429 && rl.code === 'RATE_LIMITED', 'rateLimited 快捷构造');
}

// ── 单元：OpenAPI 生成 ──
{
  const r = new Router();
  r.get('/api/v1/orders/:id', () => {});
  r.post('/api/v1/chat', () => {});
  const spec = buildOpenApi(r);
  check(spec.openapi === '3.0.3', 'OpenAPI 版本');
  check(spec.paths['/api/v1/orders/{id}'].get, '路径参数转 {id} 语法');
  check(spec.paths['/api/v1/orders/{id}'].get.parameters[0].name === 'id', '路径参数元数据');
  check(spec.paths['/api/v1/chat'].post.summary.includes('对话'), 'chat 端点 summary 来自元数据');
}

// ── 集成：自托管隔离 server，覆盖 CORS / 错误码 / plans / orders / pay ──
(async () => {
  let child = null;
  let base = BASE;
  const useExternal = process.env.FLORA_TEST_EXTERNAL === '1';

  if (!useExternal) {
    const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'flora-http-'));
    child = cp.spawn(process.execPath, ['server.js'], {
      cwd: __dirname + '/..',
      env: {
        ...process.env,
        PORT: '3999',
        FLORA_DATA_DIR: TMP,
        LLM_API_KEY: '', LLM_BASE_URL: '', LLM_MODEL: '',
        IMAGE_API_KEY: '', IMAGE_API: ''
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const onErr = (d) => process.stderr.write('[server] ' + d);
    child.stdout.on('data', onErr);
    child.stderr.on('data', onErr);
    base = 'http://localhost:3999';
    // 等待 server 就绪
    const deadline = Date.now() + 15000;
    let ready = false;
    while (Date.now() < deadline) {
      try {
        const r = await fetch(base + '/api/v1/openapi.json', { signal: AbortSignal.timeout(700) });
        if (r.ok) { ready = true; break; }
      } catch (e) { /* 未就绪，重试 */ }
      await new Promise((res) => setTimeout(res, 300));
    }
    if (!ready) { child.kill('SIGKILL'); throw new Error('隔离 server 启动超时'); }
  }

  try {
    const chat = async (msg, sid) => {
      const r = await fetch(base + '/api/v1/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, session_id: sid || null, skip_image: true })
      });
      return r.json();
    };

    // CORS
    const cors = await fetch(base + '/api/v1/shops', { headers: { Origin: 'http://x.dev' } });
    check(cors.headers.get('access-control-allow-origin') === '*', 'CORS 头存在');

    // 404 + 统一错误码
    const nf = await fetch(base + '/api/v1/orders/nope');
    check(nf.status === 404, '未找到资源返回 404');
    const nfk = await nf.json();
    check(nfk.code && nfk.message, '404 响应含错误码与消息');

    // 400（非法 JSON）
    const bad = await fetch(base + '/api/v1/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{oops' });
    check(bad.status === 400, '非法 JSON 返回 400');
    const badk = await bad.json();
    check(badk.code === 'BAD_REQUEST', '非法 JSON 错误码 BAD_REQUEST');

    // 未知路由 404（区别于 405 无内容的旧行为）
    const nr = await fetch(base + '/api/v1/nothing/here');
    check(nr.status === 404, '未知路由返回 404 JSON');

    // OpenAPI 契约端点
    const spec = await fetch(base + '/api/v1/openapi.json').then((r) => r.json());
    check(spec.openapi === '3.0.3' && spec.paths['/api/v1/chat'].post, 'openapi.json 端点可用');

    // ── 端到端驱动：确认门禁 → 分支 → DIY → 不出图 → 方案 + 独立选店 ──
    const r1 = await chat('给女朋友做个生日花束，预算200，喜欢粉色');
    check(r1.card && r1.card.kind === 'confirm', '① 关键需求齐→确认卡片');
    check(r1.plan === null, '① 确认前不出方案');
    check((r1.shop_suggestions || []).length === 0, '② 确认卡片不含店铺');
    const sid = r1.session_id;

    const r2 = await chat('确认', sid);
    check(r2.card && r2.card.kind === 'branch', '③ 确认后发分支卡片(现有/DIY)');
    check(r2.plan === null, '③ 分支阶段仍不出方案');

    const r3 = await chat('DIY', sid);
    check(r3.card && r3.card.kind === 'image_ask', '④ DIY 后询问是否出图');
    check((r3.shop_suggestions || []).length === 0, '② DIY 方案卡片不含店铺(选店独立)');

    const r4 = await chat('不用', sid);
    check(r4.plan && r4.plan.plan_id, '④ 不出图→生成方案');
    check(r4.card && r4.card.kind === 'shop_select', '② 方案后→独立选店卡片');
    check(Array.isArray(r4.shop_suggestions) && r4.shop_suggestions.length === 3, '② 独立选店卡片含 Top3 门店');

    // ── ⑤ 历史方案列表 GET /api/v1/plans ──
    const plans = await fetch(base + '/api/v1/plans').then((r) => r.json());
    check(Array.isArray(plans) && plans.length >= 1, '⑤ GET /api/v1/plans 返回列表');
    const found = plans.find((p) => p.plan_id === r4.plan.plan_id);
    check(found, '⑤ 历史列表含刚生成的方案');
    for (const f of ['plan_id', 'summary', 'total', 'budget', 'category', 'mode', 'created_at']) {
      check(found && found[f] != null, `⑤ 历史方案字段 ${f} 完整`);
    }

    // ── 下单 POST /api/v1/orders ──
    const shopId = r4.shop_suggestions[0].shop_id;
    const order = await fetch(base + '/api/v1/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan_id: r4.plan.plan_id, shop_id: shopId })
    }).then((r) => r.json());
    check(order.order_id, '下单成功返回 order_id');
    check(order.status === 'created', '订单初始状态 created');

    // ── ⑥ 支付接口化（mock）POST /api/v1/orders/:id/pay ──
    const paid = await fetch(base + '/api/v1/orders/' + order.order_id + '/pay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    }).then((r) => r.json());
    check(paid.order && paid.order.status === 'paid', '⑥ 支付后订单状态 paid');
    check(paid.payment && paid.payment.package.indexOf('prepay_id=') === 0, '⑥ 支付 package 含 prepay_id');
    check(paid.payment && paid.payment.paySign.indexOf('MOCK_SIGN_') === 0, '⑥ mock 支付签名标识');
    check(paid.payment && paid.payment.paySign.indexOf(order.order_id) >= 0, '⑥ 支付参数绑定订单号');

    // 二次支付应被拒（非 created 状态）
    const repaid = await fetch(base + '/api/v1/orders/' + order.order_id + '/pay', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
    });
    check(repaid.status === 400 && (await repaid.json()).code === 'NOT_PAYABLE', '⑥ 已支付订单不可重复支付');

    console.log(`\nHTTP 壳层测试：${pass} 通过`);
  } finally {
    if (child) child.kill('SIGKILL');
  }
})().catch((e) => { console.error('HTTP TEST ERR:', e.message); process.exit(1); });
