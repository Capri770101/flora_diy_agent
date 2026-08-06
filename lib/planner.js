// DIY 方案合成
const flowerKB = require('./flowerKB');
const dataLayer = require('./dataLayer');
const feedbackStore = require('./agent/feedbackStore');
const { ensureBudget } = require('./pricer');
const { uid } = require('./util');

function pickColor(flower, req) {
  if (req.color_tone && req.color_tone.length) {
    const hit = flower.colors.find((c) => req.color_tone.includes(c.name));
    if (hit) return hit;
  }
  return flower.colors[0];
}

// 门店可配置价格：price_map(门店销售价) > cost_map+margin_rate(供货价×毛利) > 全局库价
function effPrice(f, req) {
  if (req.price_map && req.price_map[f.id] != null) {
    return { price: Number(req.price_map[f.id]), source: 'merchant' };
  }
  if (req.cost_map && req.cost_map[f.id] != null) {
    const margin = req.margin_rate != null ? Number(req.margin_rate) : 0;
    return { price: Math.round(Number(req.cost_map[f.id]) * (1 + margin) * 100) / 100, source: 'cost' };
  }
  return { price: f.price, source: 'global' };
}

function buildItems(req, def) {
  // 学习信号回灌：历史负面花材（penalty≥0.5 且样本≥3）在选花时降权排除
  const low = new Set(feedbackStore.getSignals().low_adoption_flowers || []);
  const base = (role) => flowerKB.search(req, role).filter((f) => f._score > -50);
  const pick = (role) => {
    const filtered = base(role).filter((f) => !low.has(f.id));
    return filtered.length ? filtered : base(role); // 候选全部负面时回退，避免空方案
  };

  const mains = pick('主花');
  const fillers = pick('配花');
  const leaves = pick('叶材');

  // 兜底：若无候选，给默认花材
  const mainPick = mains.length ? mains.slice(0, 2) : [flowerKB.byId('rose'), flowerKB.byId('lisianthus')].filter(Boolean);
  const fillerPick = fillers.length ? fillers.slice(0, 2) : [flowerKB.byId('babybreath')].filter(Boolean);
  const leafPick = leaves.length ? leaves.slice(0, 1) : [flowerKB.byId('eucalyptus')].filter(Boolean);

  const items = [];
  mainPick.forEach((f, i) => {
    const col = pickColor(f, req);
    const p = effPrice(f, req);
    items.push({
      flower_id: f.id, name: f.name, en: f.en, role: '主花', price: p.price, price_source: p.source, unit: f.unit,
      qty: i === 0 ? def.main_qty : Math.max(1, Math.round(def.main_qty * 0.5)),
      colorName: col.name, color: col.hex, 花语: f.花语, 花期: f.花期, season: f.season, care: f.care
    });
  });
  const mainTotal = mainPick.reduce((s, _, i) => s + (i === 0 ? def.main_qty : Math.round(def.main_qty * 0.5)), 0);
  fillerPick.forEach((f) => {
    const col = pickColor(f, req);
    const p = effPrice(f, req);
    items.push({
      flower_id: f.id, name: f.name, en: f.en, role: '配花', price: p.price, price_source: p.source, unit: f.unit,
      qty: Math.max(1, Math.round(mainTotal * def.filler_ratio)), colorName: col.name, color: col.hex, 花语: f.花语, 花期: f.花期, season: f.season, care: f.care
    });
  });
  leafPick.forEach((f) => {
    const col = pickColor(f, req);
    const p = effPrice(f, req);
    items.push({
      flower_id: f.id, name: f.name, en: f.en, role: '叶材', price: p.price, price_source: p.source, unit: f.unit,
      qty: def.leaf_qty, colorName: col.name, color: col.hex, 花语: f.花语, 花期: f.花期, season: f.season, care: f.care
    });
  });
  return items;
}

function composePlan(req) {
  const templates = dataLayer.templatesAll();
  const cat = req.category || '花束';
  const def = templates.category_defaults[cat] || templates.category_defaults['花束'];
  const items = buildItems(req, def);

  const styleHint = (req.style && req.style[0] && templates.styles[req.style[0]]) || templates.styles['温柔'];
  const packageDesc = styleHint.package_hint + (cat === '瓶花' ? '（配透明花瓶）' : '');

  const plan = {
    plan_id: uid('pln'),
    requirements: req,
    category: cat,
    items,
    package: packageDesc,
    structure: def.structure,
    steps: def.steps,
    care_tips: templates.care_tips,
    packCost: req.pack_cost != null ? Number(req.pack_cost) : def.pack_cost,
    pack_cost_source: req.pack_cost != null ? 'merchant' : 'global',
    bg: styleHint.bg,
    total: 0,
    budget: req.budget,
    budget_ok: true,
    created_at: new Date().toISOString()
  };
  ensureBudget(plan, req);
  return plan;
}

module.exports = { composePlan, pickColor };
