// 智能花卉 DIY 智能体 · 零依赖 Node 服务
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

const decomposer = require('./lib/decomposer');
const { composePlan } = require('./lib/planner');
const { generate: generateImage } = require('./lib/imageGen');
const { buildSummary } = require('./lib/imagePrompt');
const { DATA_DIR, writeJson, readJson } = require('./lib/util');

const PORT = process.env.PORT || 3000;
const PLANS_FILE = 'plans.json';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png'
};

function loadPlans() {
  try { return readJson(PLANS_FILE); } catch (e) { return {}; }
}
function savePlans(p) { writeJson(PLANS_FILE, p); }

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

async function handleChat(req, res) {
  const raw = await readBody(req);
  let parsed;
  try { parsed = JSON.parse(raw || '{}'); } catch (e) { return sendJSON(res, 400, { error: 'invalid json' }); }
  const text = (parsed.message || '').trim();
  if (!text) return sendJSON(res, 400, { error: 'empty message' });

  // 门店上下文：平台侧透传（季节/地区、门店价格与毛利、打包成本），缺省用全局库价+系统当月
  const shop = parsed.shop || {};
  const requirements = await decomposer.decompose(text);
  requirements.month = parsed.month != null ? parsed.month : shop.month;
  if (parsed.price_map || shop.price_map) requirements.price_map = parsed.price_map || shop.price_map;
  if (parsed.cost_map || shop.cost_map) requirements.cost_map = parsed.cost_map || shop.cost_map;
  if (parsed.margin_rate != null || shop.margin_rate != null) requirements.margin_rate = parsed.margin_rate != null ? parsed.margin_rate : shop.margin_rate;
  if (parsed.pack_cost != null || shop.pack_cost != null) requirements.pack_cost = parsed.pack_cost != null ? parsed.pack_cost : shop.pack_cost;
  const plan = composePlan(requirements);
  const img = await generateImage(plan, requirements);

  plan.render_url = img.url;
  plan.render_type = img.type;
  plan.image_prompt = img.prompt;
  plan.negative_prompt = img.negative_prompt;
  plan.summary = buildSummary(plan, requirements);

  const plans = loadPlans();
  plans[plan.plan_id] = plan;
  savePlans(plans);

  sendJSON(res, 200, {
    session_id: parsed.session_id || null,
    plan_id: plan.plan_id,
    reply_text: plan.summary,
    plan,
    render_url: img.url,
    render_type: img.type,
    image_prompt: img.prompt,
    negative_prompt: img.negative_prompt
  });
}

function handlePlan(res, id) {
  const plans = loadPlans();
  const p = plans[id];
  if (!p) return sendJSON(res, 404, { error: 'plan not found' });
  sendJSON(res, 200, p);
}

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  try {
    if (req.method === 'POST' && url === '/api/v1/chat') return await handleChat(req, res);
    if (req.method === 'GET' && url.startsWith('/api/v1/plan/')) {
      return handlePlan(res, url.split('/').pop());
    }
    if (req.method === 'GET' && url === '/api/v1/health') return sendJSON(res, 200, { ok: true });
    if (req.method === 'GET' && url.startsWith('/preview/')) {
      const file = path.join(DATA_DIR, 'previews', url.split('/').pop());
      if (fs.existsSync(file)) {
        res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
        return res.end(fs.readFileSync(file));
      }
      res.writeHead(404); return res.end('not found');
    }
    if (req.method === 'GET') {
      let p = url === '/' ? '/index.html' : url;
      const file = path.join(__dirname, 'web', p);
      if (fs.existsSync(file) && fs.statSync(file).isFile()) {
        const ext = path.extname(file);
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
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
