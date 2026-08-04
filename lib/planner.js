// DIY 方案合成
const flowerKB = require('./flowerKB');
const templates = require('../data/templates.json');
const { ensureBudget } = require('./pricer');
const { uid } = require('./util');

function pickColor(flower, req) {
  if (req.color_tone && req.color_tone.length) {
    const hit = flower.colors.find((c) => req.color_tone.includes(c.name));
    if (hit) return hit;
  }
  return flower.colors[0];
}

function buildItems(req, def) {
  const mains = flowerKB.search(req, '主花').filter((f) => f._score > -50);
  const fillers = flowerKB.search(req, '配花').filter((f) => f._score > -50);
  const leaves = flowerKB.search(req, '叶材').filter((f) => f._score > -50);

  // 兜底：若无候选，给默认花材
  const mainPick = mains.length ? mains.slice(0, 2) : [flowerKB.byId('rose'), flowerKB.byId('lisianthus')].filter(Boolean);
  const fillerPick = fillers.length ? fillers.slice(0, 2) : [flowerKB.byId('babybreath')].filter(Boolean);
  const leafPick = leaves.length ? leaves.slice(0, 1) : [flowerKB.byId('eucalyptus')].filter(Boolean);

  const items = [];
  mainPick.forEach((f, i) => {
    const col = pickColor(f, req);
    items.push({
      flower_id: f.id, name: f.name, en: f.en, role: '主花', price: f.price, unit: f.unit,
      qty: i === 0 ? def.main_qty : Math.max(1, Math.round(def.main_qty * 0.5)),
      colorName: col.name, color: col.hex, 花语: f.花语, 花期: f.花期, season: f.season, care: f.care
    });
  });
  const mainTotal = mainPick.reduce((s, _, i) => s + (i === 0 ? def.main_qty : Math.round(def.main_qty * 0.5)), 0);
  fillerPick.forEach((f) => {
    const col = pickColor(f, req);
    items.push({
      flower_id: f.id, name: f.name, en: f.en, role: '配花', price: f.price, unit: f.unit,
      qty: Math.max(1, Math.round(mainTotal * def.filler_ratio)), colorName: col.name, color: col.hex, 花语: f.花语, 花期: f.花期, season: f.season, care: f.care
    });
  });
  leafPick.forEach((f) => {
    const col = pickColor(f, req);
    items.push({
      flower_id: f.id, name: f.name, en: f.en, role: '叶材', price: f.price, unit: f.unit,
      qty: def.leaf_qty, colorName: col.name, color: col.hex, 花语: f.花语, 花期: f.花期, season: f.season, care: f.care
    });
  });
  return items;
}

function composePlan(req) {
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
    packCost: def.pack_cost,
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
