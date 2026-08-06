// 智能花卉 DIY 智能体 · 零依赖 Node 服务（薄壳）
// HTTP + 持久化在此层，业务全在 lib/agent（可独立测试/部署）
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

const { runAgent } = require('./lib/agent');
const { loadShops, effPrice } = require('./lib/agent/shopMatcher');
const feedbackStore = require('./lib/agent/feedbackStore');
const { DATA_DIR, uid } = require('./lib/util');
const db = require('./lib/db');

const PORT = process.env.PORT || 3000;

const loadPlans = () => db.kvGetAll('plans');
const savePlans = (p) => { for (const [k, v] of Object.entries(p || {})) db.kvSet('plans', k, v); };
const loadSessions = () => db.kvGetAll('sessions');
const saveSessions = (s) => { for (const [k, v] of Object.entries(s || {})) db.kvSet('sessions', k, v); };
const loadOrders = () => db.kvGetAll('orders');
const saveOrders = (o) => { for (const [k, v] of Object.entries(o || {})) db.kvSet('orders', k, v); };

function sendJSON(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj, null, 2));
}
function readBody(req) {
  return new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => (d += c));
    req.on('end', () => resolve(d));
  });
}
function parseBody(raw) {
  try { return JSON.parse(raw || '{}'); } catch (e) { return null; }
}

async function handleChat(req, res) {
  const parsed = parseBody(await readBody(req));
  if (!parsed) return sendJSON(res, 400, { error: 'invalid json' });
  const text = (parsed.message || '').trim();
  if (!text) return sendJSON(res, 400, { error: 'empty message' });

  const sid = parsed.session_id || null;
  const session = sid ? loadSessions()[sid] || null : null;
  const loc = parsed.location;
  const location = loc && typeof loc.lat === 'number' && typeof loc.lng === 'number'
    ? { lat: loc.lat, lng: loc.lng } : null;

  // 安全化门店上下文：价格类字段（price_map/cost_map/margin_rate/pack_cost）
  // 一律以服务端 shops.json 为准，客户端传来的价不可信，直接丢弃。
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

  sendJSON(res, 200, {
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
}

function handlePlan(res, id) {
  const p = loadPlans()[id];
  if (!p) return sendJSON(res, 404, { error: 'plan not found' });
  sendJSON(res, 200, p);
}

function handleShops(res, id) {
  const shops = loadShops();
  if (!id) return sendJSON(res, 200, shops);
  const s = shops.find((x) => x.shop_id === id);
  if (!s) return sendJSON(res, 404, { error: 'shop not found' });
  sendJSON(res, 200, s);
}

async function handleCreateOrder(req, res) {
  const parsed = parseBody(await readBody(req));
  if (!parsed) return sendJSON(res, 400, { error: 'invalid json' });
  const { plan_id, shop_id } = parsed;
  const plan = loadPlans()[plan_id];
  if (!plan) return sendJSON(res, 404, { error: 'plan not found' });
  const shop = loadShops().find((s) => s.shop_id === shop_id);
  if (!shop) return sendJSON(res, 404, { error: 'shop not found' });

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

  // 积累域 H：下单扣减供应链库存；I：沉淀一条订单分享 UGC
  for (const it of items) {
    db.adjustStock(it.flower_id, shop_id, -(it.qty || 1));
  }
  db.writeUgc({ type: 'order', ref_id: order.order_id, content: order.plan_summary || '', rating: null, author: order.user_id || 'anon' });

  sendJSON(res, 200, order);
}

function handleListOrders(req, res) {
  const q = new URL(req.url, 'http://x').searchParams;
  const user_id = q.get('user_id');
  const list = Object.values(loadOrders())
    .filter((o) => !user_id || o.user_id === user_id)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  sendJSON(res, 200, list);
}

function handleGetOrder(res, id) {
  const o = loadOrders()[id];
  if (!o) return sendJSON(res, 404, { error: 'order not found' });
  sendJSON(res, 200, o);
}

// 状态机：created → paid → making → delivering → done；created/paid → canceled
const ORDER_TRANSITIONS = {
  created: ['paid', 'canceled'],
  paid: ['making', 'canceled'],
  making: ['delivering'],
  delivering: ['done'],
  done: [],
  canceled: []
};

async function handleOrderStatus(req, res, id) {
  const parsed = parseBody(await readBody(req));
  if (!parsed || !parsed.status) return sendJSON(res, 400, { error: 'status required' });
  const orders = loadOrders();
  const order = orders[id];
  if (!order) return sendJSON(res, 404, { error: 'order not found' });
  const next = parsed.status;
  if (!ORDER_TRANSITIONS[order.status].includes(next)) {
    return sendJSON(res, 400, { error: `invalid transition: ${order.status} -> ${next}` });
  }
  order.status = next;
  if (next === 'paid') order.paid_at = new Date().toISOString();
  saveOrders(orders);
  sendJSON(res, 200, order);
}

// mock 支付：返回 wx.requestPayment 所需参数。
// 接入真实微信支付时：调统一下单换 prepay_id，并改为依赖 /api/v1/pay/notify 回调改状态。
async function handlePay(req, res, id) {
  const orders = loadOrders();
  const order = orders[id];
  if (!order) return sendJSON(res, 404, { error: 'order not found' });
  if (order.status !== 'created') return sendJSON(res, 400, { error: 'order not payable, current: ' + order.status });
  order.status = 'paid';
  order.paid_at = new Date().toISOString();
  saveOrders(orders);
  sendJSON(res, 200, {
    order,
    payment: {
      timeStamp: String(Math.floor(Date.now() / 1000)),
      nonceStr: Math.random().toString(36).slice(2, 12),
      package: 'prepay_id=mock_' + order.order_id,
      signType: 'RSA',
      paySign: 'MOCK_SIGN_' + order.order_id
    }
  });
}

async function handlePayNotify(req, res) {
  const parsed = parseBody(await readBody(req));
  if (parsed && parsed.order_id) {
    const orders = loadOrders();
    const order = orders[parsed.order_id];
    if (order && order.status === 'created') {
      order.status = 'paid';
      order.paid_at = new Date().toISOString();
      saveOrders(orders);
    }
  }
  sendJSON(res, 200, { ok: true });
}

async function handleFeedback(req, res) {
  const parsed = parseBody(await readBody(req));
  if (!parsed) return sendJSON(res, 400, { error: 'invalid json' });
  try {
    const rec = feedbackStore.recordFeedback(parsed);
    return sendJSON(res, 200, { ok: true, feedback: rec });
  } catch (e) {
    return sendJSON(res, 400, { error: e.message, code: e.code });
  }
}
function handleFeedbackStats(res) {
  return sendJSON(res, 200, feedbackStore.aggregate());
}

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  try {
    if (req.method === 'POST' && url === '/api/v1/chat') return await handleChat(req, res);
    if (req.method === 'POST' && url === '/api/v1/orders') return await handleCreateOrder(req, res);
    if (req.method === 'GET' && url === '/api/v1/orders') return handleListOrders(req, res);
    if (req.method === 'GET' && url.startsWith('/api/v1/orders/')) return handleGetOrder(res, url.split('/').pop());
    if (req.method === 'POST' && url.startsWith('/api/v1/orders/') && url.endsWith('/status')) {
      const id = url.split('/').slice(-2)[0];
      return await handleOrderStatus(req, res, id);
    }
    if (req.method === 'POST' && url.startsWith('/api/v1/orders/') && url.endsWith('/pay')) {
      return await handlePay(req, res, url.split('/').slice(-2)[0]);
    }
    if (req.method === 'POST' && url === '/api/v1/pay/notify') return await handlePayNotify(req, res);
    if (req.method === 'POST' && url === '/api/v1/feedback') return await handleFeedback(req, res);
    if (req.method === 'GET' && url === '/api/v1/feedback/stats') return handleFeedbackStats(res);
    if (req.method === 'GET' && url === '/api/v1/health') return sendJSON(res, 200, { ok: true });
    if (req.method === 'GET' && url.startsWith('/api/v1/plan/')) return handlePlan(res, url.split('/').pop());
    if (req.method === 'GET' && url === '/api/v1/shops') return handleShops(res, null);
    if (req.method === 'GET' && url.startsWith('/api/v1/shops/')) return handleShops(res, url.split('/').pop());
    if (req.method === 'GET' && url.startsWith('/preview/')) {
      const file = path.join(DATA_DIR, 'previews', url.split('/').pop());
      if (fs.existsSync(file)) {
        res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
        return res.end(fs.readFileSync(file));
      }
      res.writeHead(404); return res.end('not found');
    }
    res.writeHead(405); res.end();
  } catch (e) {
    console.error(e);
    sendJSON(res, 500, { error: e.message });
  }
});

server.listen(PORT, () => console.log('🌸 Flora DIY Agent running: http://localhost:' + PORT));
