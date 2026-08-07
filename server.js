// 智能花卉 DIY 智能体 · 零依赖 Node 服务（薄壳）
// HTTP 壳层：中间件管道（CORS/限流/日志）+ 声明式路由 + OpenAPI 契约。
// 业务全在 lib/agent（可独立测试/部署）。持久化在本层路由处理器内完成。
const http = require('http');
const fs = require('fs');
const path = require('path');

// 轻量 .env 加载（零依赖）
try {
  const envFile = path.join(__dirname, '.env');
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
} catch (e) { console.warn('skip .env load:', e.message); }

const config = require('./lib/config');
const { HttpError } = require('./lib/http/errors');
const { Router } = require('./lib/http/router');
const { corsMiddleware, rateLimitMiddleware, logMiddleware, errorHandler, sendJSON } = require('./lib/http/middleware');
const { buildOpenApi } = require('./lib/http/openapi');
const { runAgent } = require('./lib/agent');
const { loadShops, effPrice } = require('./lib/agent/shopMatcher');
const feedbackStore = require('./lib/agent/feedbackStore');
const { DATA_DIR, uid } = require('./lib/util');
const db = require('./lib/db');

const PORT = config.get('PORT');

const loadPlans = () => db.kvGetAll('plans');
const savePlans = (p) => { for (const [k, v] of Object.entries(p || {})) db.kvSet('plans', k, v); };
const loadSessions = () => db.kvGetAll('sessions');
const saveSessions = (s) => { for (const [k, v] of Object.entries(s || {})) db.kvSet('sessions', k, v); };
const loadOrders = () => db.kvGetAll('orders');
const saveOrders = (o) => { for (const [k, v] of Object.entries(o || {})) db.kvSet('orders', k, v); };

function readBody(req) {
  return new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => (d += c));
    req.on('end', () => resolve(d));
  });
}
function parseBody(raw) {
  try { return JSON.parse(raw || '{}'); } catch (e) { throw HttpError.badRequest('invalid json'); }
}

// ── 路由与处理器 ──
const router = new Router();

router.post('/api/v1/chat', async (ctx) => {
  const parsed = parseBody(ctx.body);
  const text = (parsed.message || '').trim();
  if (!text) throw HttpError.badRequest('empty message');

  const sid = parsed.session_id || null;
  const session = sid ? loadSessions()[sid] || null : null;
  const loc = parsed.location;
  const location = loc && typeof loc.lat === 'number' && typeof loc.lng === 'number'
    ? { lat: loc.lat, lng: loc.lng } : null;

  // 安全化门店上下文：价格类字段一律以服务端 shops.json 为准，客户端价不可信，直接丢弃。
  let safeShop = null;
  if (parsed.shop && typeof parsed.shop === 'object') {
    const srv = parsed.shop.shop_id ? loadShops().find((s) => s.shop_id === parsed.shop.shop_id) : null;
    safeShop = srv
      ? {
          shop_id: srv.shop_id,
          month: parsed.shop.month != null ? parsed.shop.month : undefined,
          price_map: srv.price_map,
          cost_map: srv.cost_map,
          margin_rate: srv.margin_rate,
          pack_cost: srv.pack_cost
        }
      : (parsed.shop.month != null ? { month: parsed.shop.month } : null);
  }

  const result = await runAgent({
    text,
    session,
    location,
    config: {
      skip_image: parsed.skip_image === true,
      shop_limit: parsed.shop_limit || 3,
      shop_context: safeShop
    }
  });

  const sessions = loadSessions();
  sessions[result.session_id] = result.session;
  saveSessions(sessions);

  const plans = loadPlans();
  if (result.plan) plans[result.plan.plan_id] = result.plan;
  savePlans(plans);

  sendJSON(ctx.res, 200, {
    session_id: result.session_id,
    plan_id: result.plan ? result.plan.plan_id : null,
    reply_text: result.reply,
    plan: result.plan,
    plan_version: result.plan_version,
    render_url: result.plan ? result.plan.render_url : null,
    render_type: result.plan ? result.plan.render_type : null,
    image_prompt: result.plan ? result.plan.image_prompt || null : null,
    negative_prompt: result.plan ? result.plan.negative_prompt || null : null,
    shop_suggestions: result.shop_suggestions,
    feedback_signals: feedbackStore.getSignals(),
    domain_insights: result.domain_insights || null,
    shop_choice: result.shop_choice || null,
    need_clarify: result.need_clarify,
    missing_fields: result.missing_fields
  });
});

// 与 /api/v1/chat 相同的请求语义，但回复以 SSE 流式返回：
//   data: {"type":"meta", ...}     （首帧：阶段信息）
//   data: {"type":"token","delta":"..."}  （LLM 逐段文本）
//   data: {"type":"done", ...完整响应体...} （结束帧，含 session_id/plan/shop_suggestions 等）
//   data: {"type":"error","message":"..."} （失败帧）
// 降级：LLM 不可用/超时 → 只有 meta + done（done 内含模板 reply_text），前端自行打字机动画。
function sseWrite(res, payload) {
  res.write('data: ' + JSON.stringify(payload) + '\n\n');
}

router.post('/api/v1/chat/stream', async (ctx) => {
  const parsed = parseBody(ctx.body);
  const text = (parsed.message || '').trim();
  if (!text) throw HttpError.badRequest('empty message');

  const sid = parsed.session_id || null;
  const session = sid ? loadSessions()[sid] || null : null;
  const loc = parsed.location;
  const location = loc && typeof loc.lat === 'number' && typeof loc.lng === 'number'
    ? { lat: loc.lat, lng: loc.lng } : null;

  let safeShop = null;
  if (parsed.shop && typeof parsed.shop === 'object') {
    const srv = parsed.shop.shop_id ? loadShops().find((s) => s.shop_id === parsed.shop.shop_id) : null;
    safeShop = srv
      ? {
          shop_id: srv.shop_id,
          month: parsed.shop.month != null ? parsed.shop.month : undefined,
          price_map: srv.price_map,
          cost_map: srv.cost_map,
          margin_rate: srv.margin_rate,
          pack_cost: srv.pack_cost
        }
      : (parsed.shop.month != null ? { month: parsed.shop.month } : null);
  }

  ctx.res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  sseWrite(ctx.res, { type: 'meta', status: 'thinking' });

  try {
    const result = await runAgent({
      text,
      session,
      location,
      config: {
        skip_image: parsed.skip_image === true,
        shop_limit: parsed.shop_limit || 3,
        shop_context: safeShop,
        onReplyChunk: (delta) => sseWrite(ctx.res, { type: 'token', delta })
      }
    });

    const sessions = loadSessions();
    sessions[result.session_id] = result.session;
    saveSessions(sessions);
    const plans = loadPlans();
    if (result.plan) plans[result.plan.plan_id] = result.plan;
    savePlans(plans);

    sseWrite(ctx.res, {
      type: 'done',
      session_id: result.session_id,
      plan_id: result.plan ? result.plan.plan_id : null,
      reply_text: result.reply,
      plan: result.plan,
      plan_version: result.plan_version,
      render_url: result.plan ? result.plan.render_url : null,
      render_type: result.plan ? result.plan.render_type : null,
      image_prompt: result.plan ? result.plan.image_prompt || null : null,
      negative_prompt: result.plan ? result.plan.negative_prompt || null : null,
      shop_suggestions: result.shop_suggestions,
      feedback_signals: feedbackStore.getSignals(),
      domain_insights: result.domain_insights || null,
      shop_choice: result.shop_choice || null,
      need_clarify: result.need_clarify,
      missing_fields: result.missing_fields
    });
  } catch (e) {
    sseWrite(ctx.res, { type: 'error', message: e && e.message ? e.message : 'internal error' });
  }
  ctx.res.end();
});

router.get('/api/v1/plan/:id', (ctx) => {
  const p = loadPlans()[ctx.params.id];
  if (!p) throw new HttpError(404, 'NOT_FOUND', 'plan not found');
  sendJSON(ctx.res, 200, p);
});
router.get('/api/v1/shops', (ctx) => sendJSON(ctx.res, 200, loadShops()));
router.get('/api/v1/shops/:id', (ctx) => {
  const s = loadShops().find((x) => x.shop_id === ctx.params.id);
  if (!s) throw new HttpError(404, 'NOT_FOUND', 'shop not found');
  sendJSON(ctx.res, 200, s);
});

router.post('/api/v1/orders', async (ctx) => {
  const parsed = parseBody(ctx.body);
  const { plan_id, shop_id } = parsed;
  const plan = loadPlans()[plan_id];
  if (!plan) throw new HttpError(404, 'NOT_FOUND', 'plan not found');
  const shop = loadShops().find((s) => s.shop_id === shop_id);
  if (!shop) throw new HttpError(404, 'NOT_FOUND', 'shop not found');

  const packCost = shop.pack_cost != null ? Number(shop.pack_cost) : plan.packCost || 0;
  const items = [];
  const missing = [];
  let priceTotal = packCost;
  for (const it of plan.items) {
    const p = effPrice(shop, it.flower_id);
    if (p == null) { missing.push({ flower_id: it.flower_id, name: it.name, qty: it.qty }); continue; }
    items.push({ ...it, price: p, price_source: 'merchant' });
    priceTotal += p * it.qty;
  }

  const order = {
    order_id: uid('ord'),
    plan_id,
    plan_summary: plan.summary || '',
    shop_id,
    shop_name: shop.name,
    user_id: parsed.user_id || 'dev-user',
    status: 'created',
    items,
    missing,
    pack_cost: packCost,
    price_total: Math.round(priceTotal),
    plan_total: plan.total,
    price_diff: Math.round(priceTotal - (plan.total || 0)),
    delivery_type: parsed.delivery_type || 'delivery',
    address: parsed.address || '',
    remark: parsed.remark || '',
    created_at: new Date().toISOString(),
    paid_at: null
  };
  const orders = loadOrders();
  orders[order.order_id] = order;
  saveOrders(orders);

  for (const it of items) db.adjustStock(it.flower_id, shop_id, -(it.qty || 1));
  db.writeUgc({ type: 'order', ref_id: order.order_id, content: order.plan_summary || '', rating: null, author: order.user_id || 'anon' });

  sendJSON(ctx.res, 200, order);
});

router.get('/api/v1/orders', (ctx) => {
  const user_id = (ctx.query || {}).user_id;
  const list = Object.values(loadOrders())
    .filter((o) => !user_id || o.user_id === user_id)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  sendJSON(ctx.res, 200, list);
});
router.get('/api/v1/orders/:id', (ctx) => {
  const o = loadOrders()[ctx.params.id];
  if (!o) throw new HttpError(404, 'NOT_FOUND', 'order not found');
  sendJSON(ctx.res, 200, o);
});

// 状态机：created → paid → making → delivering → done；created/paid → canceled
const ORDER_TRANSITIONS = {
  created: ['paid', 'canceled'],
  paid: ['making', 'canceled'],
  making: ['delivering'],
  delivering: ['done'],
  done: [],
  canceled: []
};
router.post('/api/v1/orders/:id/status', async (ctx) => {
  const parsed = parseBody(ctx.body);
  if (!parsed || !parsed.status) throw HttpError.badRequest('status required');
  const orders = loadOrders();
  const order = orders[ctx.params.id];
  if (!order) throw new HttpError(404, 'NOT_FOUND', 'order not found');
  const next = parsed.status;
  if (!ORDER_TRANSITIONS[order.status].includes(next)) {
    throw new HttpError(400, 'INVALID_TRANSITION', `invalid transition: ${order.status} -> ${next}`);
  }
  order.status = next;
  if (next === 'paid') order.paid_at = new Date().toISOString();
  saveOrders(orders);
  sendJSON(ctx.res, 200, order);
});

router.post('/api/v1/orders/:id/pay', async (ctx) => {
  const orders = loadOrders();
  const order = orders[ctx.params.id];
  if (!order) throw new HttpError(404, 'NOT_FOUND', 'order not found');
  if (order.status !== 'created') throw new HttpError(400, 'NOT_PAYABLE', 'order not payable, current: ' + order.status);
  order.status = 'paid';
  order.paid_at = new Date().toISOString();
  saveOrders(orders);
  sendJSON(ctx.res, 200, {
    order,
    payment: {
      timeStamp: String(Math.floor(Date.now() / 1000)),
      nonceStr: Math.random().toString(36).slice(2, 12),
      package: 'prepay_id=mock_' + order.order_id,
      signType: 'RSA',
      paySign: 'MOCK_SIGN_' + order.order_id
    }
  });
});

router.post('/api/v1/pay/notify', async (ctx) => {
  const parsed = parseBody(ctx.body);
  if (parsed && parsed.order_id) {
    const orders = loadOrders();
    const order = orders[parsed.order_id];
    if (order && order.status === 'created') {
      order.status = 'paid';
      order.paid_at = new Date().toISOString();
      saveOrders(orders);
    }
  }
  sendJSON(ctx.res, 200, { ok: true });
});

router.post('/api/v1/feedback', async (ctx) => {
  const parsed = parseBody(ctx.body);
  if (!parsed) throw HttpError.badRequest('invalid json');
  try {
    const rec = feedbackStore.recordFeedback(parsed);
    return sendJSON(ctx.res, 200, { ok: true, feedback: rec });
  } catch (e) {
    throw new HttpError(400, 'BAD_FEEDBACK', e.message);
  }
});
router.get('/api/v1/feedback/stats', (ctx) => sendJSON(ctx.res, 200, feedbackStore.aggregate()));

router.get('/api/v1/health', (ctx) => sendJSON(ctx.res, 200, { ok: true }));
router.get('/api/v1/openapi.json', (ctx) => sendJSON(ctx.res, 200, buildOpenApi(router)));

// ── 中间件管道：把中间件与请求分发组合成一个 async 处理链 ──
// 设计：middlewares 前置处理（返回或抛出），然后 dispatch 读 body + 路由匹配 + 执行 handler。
// 所有异常统一抛到外层 catch → errorHandler。
async function handleRequest(req, res) {
  const urlObj = new URL(req.url, 'http://local');
  const pathname = urlObj.pathname;
  const ctx = {
    req, res,
    url: req.url,
    method: req.method,
    body: undefined,
    params: {},
    query: Object.fromEntries(urlObj.searchParams),
    pathname
  };

  // 静态预览图（不经中间件，直出 SVG）
  if (req.method === 'GET' && pathname.startsWith('/preview/')) {
    const file = path.join(DATA_DIR, 'previews', pathname.split('/').pop());
    if (fs.existsSync(file)) {
      res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
      return res.end(fs.readFileSync(file));
    }
    res.writeHead(404); return res.end('not found');
  }

  // 中间件链（顺序执行；errorHandler 统一处理）
  const middlewares = [corsMiddleware, rateLimitMiddleware, logMiddleware];
  for (const mw of middlewares) {
    const stop = await new Promise((resolveStop) => {
      mw(req, res, () => resolveStop(false));
      if (res.writableEnded) resolveStop(true);
    });
    if (stop) return; // 中间件已写响应（如 CORS 预检 / 限流 429）
  }

  ctx.body = req.method !== 'GET' ? await readBody(req) : '';

  const route = router.match(ctx.method, pathname);
  if (!route) {
    sendJSON(res, 404, { code: 'NOT_FOUND', message: 'no route: ' + ctx.method + ' ' + pathname });
    return;
  }
  ctx.params = route.params;
  await route.handler(ctx);
}

const server = http.createServer(async (req, res) => {
  try {
    await handleRequest(req, res);
  } catch (e) {
    errorHandler(e, req, res);
  }
});

server.listen(PORT, () => {
  const cap = config.all();
  const llm = config.enabled('llm') ? `已启用(${cap.llm} · ${config.get('LLM_MODEL')})` : '未启用(规则引擎兜底)';
  const img = config.enabled('image') ? `已启用(${cap.image})` : '未启用(SVG 风格预览兜底)';
  console.log('🌸 Flora DIY Agent running: http://localhost:' + PORT);
  console.log('   LLM 通道：' + llm);
  console.log('   文生图：' + img);
});