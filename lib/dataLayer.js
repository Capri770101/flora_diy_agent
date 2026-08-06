// 统一数据访问层（14 域数据底座的读入口）
// 优先读 SQLite 结构化表；表为空或未建时回退到 data/*.json，保证现有行为零破坏。
// 同时把自己注册为插件注册表的 'data' 槽位默认 adapter（id: sqlite-json），
// 以便其他模块经 registry.resolve('data') 拿到当前生效的数据实现。
const config = require('./config');
const registry = require('./plugins/registry');
const db = require('./db');
const { readJson } = require('./util');

function safeRows(sql) {
  try {
    return db.ensure().prepare(sql).all();
  } catch (e) {
    return null; // 表未建
  }
}

// ---------- A 花卉详情（含 E 花卉季节）----------
function rowToFlower(r) {
  return {
    id: r.id, name: r.name, en: r.en, role: r.role, season: r.season,
    price: r.price, unit: r.unit,
    花语: r.meaning, 花期: r.bloom_period, 过敏: !!r.allergen, care: r.care,
    months: JSON.parse(r.months_json || '[]'),
    styleTags: JSON.parse(r.style_tags_json || '[]'),
    occasions: JSON.parse(r.occasions_json || '[]'),
    colors: JSON.parse(r.colors_json || '[]')
  };
}
function flowersAll() {
  const rows = safeRows('SELECT * FROM flowers');
  if (rows && rows.length) return rows.map(rowToFlower);
  try { return readJson('flowers.json'); } catch (e) { return []; }
}
function flowerById(id) {
  try {
    const r = db.ensure().prepare('SELECT * FROM flowers WHERE id=?').get(id);
    if (r) return rowToFlower(r);
  } catch (e) {}
  return flowersAll().find((f) => f.id === id) || null;
}
function flowersByRole(role) {
  return flowersAll().filter((f) => f.role === role);
}

// ---------- B 门店价格（含 C 商家风格派生字段）----------
function rowToShop(r) {
  return {
    shop_id: r.shop_id, name: r.name, city: r.city, district: r.district, address: r.address,
    lat: r.lat, lng: r.lng, rating: r.rating, open_hours: r.open_hours, status: r.status || 'open',
    support_flowers: JSON.parse(r.support_flowers_json || '[]'),
    price_map: JSON.parse(r.price_map_json || '{}'),
    cost_map: JSON.parse(r.cost_map_json || '{}'),
    margin_rate: r.margin_rate, pack_cost: r.pack_cost,
    style_tags: JSON.parse(r.style_tags_json || '[]'),
    service_tags: JSON.parse(r.service_tags_json || '[]')
  };
}
function shopsAll() {
  const rows = safeRows('SELECT * FROM shops');
  if (rows && rows.length) return rows.map(rowToShop);
  try { return readJson('shops.json'); } catch (e) { return []; }
}

// ---------- 模板（occasions/styles/placements/care_tips/category_defaults）----------
function templatesAll() {
  try {
    const t = db.kvGet('config', 'templates');
    if (t) return t;
  } catch (e) {}
  try { return readJson('templates.json'); } catch (e) { return {}; }
}

// ---------- 新增域只读入口（供后续能力消费）----------
function regionsAll() { return safeRows('SELECT * FROM regions') || []; }
function knowledgeAll() { return safeRows('SELECT * FROM knowledge') || []; }
function complianceAll() { return safeRows('SELECT * FROM compliance') || []; }
function logisticsAll() { return safeRows('SELECT * FROM logistics') || []; }
function trendsAll() { return safeRows('SELECT * FROM trends') || []; }
function merchantProfilesAll() { return safeRows('SELECT * FROM merchant_profiles') || []; }

// ---------- 注册为默认 data adapter ----------
const adapter = {
  id: 'sqlite-json',
  slot: 'data',
  priority: 0,
  enabled: () => true,
  flowersAll, flowerById, flowersByRole,
  shopsAll, templatesAll,
  regionsAll, knowledgeAll, complianceAll, logisticsAll, trendsAll, merchantProfilesAll
};
registry.register(adapter);

module.exports = {
  flowersAll, flowerById, flowersByRole,
  shopsAll,
  templatesAll,
  regionsAll, knowledgeAll, complianceAll, logisticsAll, trendsAll, merchantProfilesAll,
  __adapter: adapter
};