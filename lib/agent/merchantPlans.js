// 商家现有方案（mock）：从 data/merchantPlans.json 读取预设方案（含效果图）。
// 选中「现有方案」分支时，直接复用商家成品方案 + 商家效果图，不走 DIY 现算。
// 生产环境可替换为真实商家方案接口（保持 pickMerchantPlan / normalizeMerchantPlan 契约即可）。
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../util');

let _cache = null;
function load() {
  if (_cache) return _cache;
  try {
    _cache = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'merchantPlans.json'), 'utf8'));
  } catch (e) {
    _cache = [];
  }
  return _cache;
}

// 按 品类(权重2) + 场合(权重1) 打分，取最高；至少场合匹配(score>=1)才视为有现有方案
function pickMerchantPlan(req) {
  const list = load();
  if (!list.length) return null;
  const cat = req && req.category;
  const occ = req && req.occasion;
  let best = null;
  let bestScore = 0;
  for (const mp of list) {
    let s = 0;
    if (mp.category === cat) s += 2;
    if (mp.occasion === occ) s += 1;
    if (s > bestScore) { bestScore = s; best = mp; }
  }
  return bestScore >= 1 ? best : null;
}

function renderSvg(mp) {
  const colors = (mp.items || []).map((it) => it.color || '#CCCCCC');
  const circles = colors
    .map((c, i) => {
      const x = 80 + (i % 4) * 80;
      const y = 90 + Math.floor(i / 4) * 70;
      const r = 26;
      return `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}" stroke="#ffffff" stroke-width="3"/>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#F4F7FF"/>
      <stop offset="1" stop-color="#DCE7FB"/>
    </linearGradient>
  </defs>
  <rect width="400" height="300" fill="url(#bg)"/>
  <text x="200" y="36" font-size="20" font-family="sans-serif" fill="#16233F" text-anchor="middle" font-weight="bold">${mp.title}</text>
  ${circles}
  <rect x="150" y="230" width="100" height="50" rx="10" fill="#2B6CFF" opacity="0.85"/>
  <text x="200" y="261" font-size="16" font-family="sans-serif" fill="#ffffff" text-anchor="middle">商家成品</text>
</svg>`;
}

// 生成（首次）效果图 SVG 文件并写入 data/previews，返回可被小程序直接加载的 /preview 路径
function buildMockEffectImage(mp) {
  const file = path.join(DATA_DIR, 'previews', 'merchant-' + mp.plan_id + '.svg');
  try {
    if (!fs.existsSync(file)) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, renderSvg(mp));
    }
  } catch (e) { /* 预览图生成失败不阻断主流程 */ }
  return '/preview/merchant-' + mp.plan_id + '.svg';
}

// 转成与 DIY plan 统一的 plan 结构，方便前端复用同一套渲染
function normalizeMerchantPlan(mp, req) {
  const items = (mp.items || []).map((it) => ({
    flower_id: it.flower_id,
    name: it.name,
    en: '',
    role: '主花',
    price: it.price,
    price_source: 'merchant',
    unit: it.unit,
    qty: it.qty,
    colorName: '',
    color: it.color || '#CCCCCC',
    花语: '',
    花期: '',
    season: '',
    care: ''
  }));
  const total = items.reduce((s, it) => s + it.price * it.qty, 0);
  const budget = req && req.budget != null ? req.budget : mp.budget;
  return {
    plan_id: mp.plan_id,
    requirements: req,
    category: mp.category,
    mode: 'existing',
    items,
    package: '商家标准包装',
    structure: '商家成品',
    steps: [{ t: '成品交付', d: '由合作商家按现有方案制作并配送，无需自行组装' }],
    care_tips: ['请尽快剪根换水，置于阴凉通风处养护'],
    packCost: 0,
    pack_cost_source: 'merchant',
    bg: '#F4F7FF',
    total,
    budget,
    budget_ok: budget != null ? total <= budget : true,
    summary: mp.summary,
    render_url: buildMockEffectImage(mp),
    render_type: 'image',
    render_local: null,
    created_at: new Date().toISOString()
  };
}

module.exports = { pickMerchantPlan, normalizeMerchantPlan, load };
