// 智能体运行期数据存储 —— 使用 Node 内置 node:sqlite（零依赖、零编译）
// 取代原先的整文件 JSON（data/plans.json 等），获得：
//   1) 事务/原子写，避免崩溃把整文件写坏；
//   2) 并发安全（WAL 模式，一写多读不互相阻塞）；
//   3) 可聚合查询（feedback 为结构化表，支持 SQL 统计）；
//   4) 为 14 域数据底座预留扩展能力（kv 表可按 store 分区存任意文档）。
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { DATA_DIR, uid } = require('./util');

// node:sqlite 仍是实验特性，会打印一行 ExperimentalWarning。静音它，保持输出干净。
process.on('warning', (w) => {
  if (w && w.name === 'ExperimentalWarning' && /SQLite/.test(w.message || '')) return;
});

const DB_PATH = path.join(DATA_DIR, 'agent.db');

// 14 域数据底座 · 全量表结构（种子域建表并灌数据；积累域先建空表，上线后由真实行为沉淀）
// 字节顺序：A 花卉详情 / B 门店价格 / C 商家服务质量与风格 / D 地区差异 / E 花卉季节(并入花卉.months)
// F 市场潮流(基线+积累) / G 物流履约 / H 供应链库存 / I 内容UGC / J 知识教育 / K 合规信任
// L 营销权益 / M 竞品基准 / N 智能体元学习(并入 feedback 聚合)
const SEED_DOMAIN_SCHEMA = `
  -- A 花卉详情（含 E 花卉季节：months_json 记录可售月份）
  CREATE TABLE IF NOT EXISTS flowers (
    id TEXT PRIMARY KEY,
    name TEXT, en TEXT, role TEXT, season TEXT,
    price REAL, unit TEXT,
    meaning TEXT, bloom_period TEXT, allergen INTEGER DEFAULT 0, care TEXT,
    months_json TEXT, style_tags_json TEXT, occasions_json TEXT, colors_json TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_fl_role ON flowers(role);
  CREATE INDEX IF NOT EXISTS idx_fl_allergen ON flowers(allergen);

  -- B 门店价格
  CREATE TABLE IF NOT EXISTS shops (
    shop_id TEXT PRIMARY KEY,
    name TEXT, city TEXT, district TEXT, address TEXT,
    lat REAL, lng REAL, rating REAL, open_hours TEXT, status TEXT DEFAULT 'open',
    support_flowers_json TEXT,
    price_map_json TEXT,
    cost_map_json TEXT,
    margin_rate REAL,
    pack_cost REAL,
    style_tags_json TEXT,
    service_tags_json TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_sh_city ON shops(city);

  -- C 商家服务质量与风格
  CREATE TABLE IF NOT EXISTS merchant_profiles (
    shop_id TEXT PRIMARY KEY,
    style_tags_json TEXT,
    service_tags_json TEXT,
    quality_score REAL,
    delivery_supported INTEGER DEFAULT 1,
    note TEXT
  );

  -- B/C 门店实时库存（供货价快照）
  CREATE TABLE IF NOT EXISTS shop_stock (
    shop_id TEXT, flower_id TEXT, price REAL, in_stock INTEGER DEFAULT 1,
    PRIMARY KEY (shop_id, flower_id)
  );

  -- D 地区差异（季节修正 / 价格系数 / 偏好风格）
  CREATE TABLE IF NOT EXISTS regions (
    region_id TEXT PRIMARY KEY,
    city TEXT, district TEXT,
    season_modifier_json TEXT,
    price_index REAL,
    popular_styles_json TEXT,
    note TEXT
  );

  -- J 知识教育
  CREATE TABLE IF NOT EXISTS knowledge (
    knowledge_id TEXT PRIMARY KEY,
    category TEXT, title TEXT, body TEXT,
    tags_json TEXT, source TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_know_cat ON knowledge(category);

  -- K 合规信任
  CREATE TABLE IF NOT EXISTS compliance (
    rule_id TEXT PRIMARY KEY,
    category TEXT, title TEXT, detail TEXT,
    applies_to TEXT, source TEXT
  );

  -- G 物流履约（基础）
  CREATE TABLE IF NOT EXISTS logistics (
    zone_id TEXT PRIMARY KEY,
    region_ref TEXT, carrier TEXT,
    lead_time_days INTEGER, fee REAL,
    supports_fresh INTEGER DEFAULT 1
  );

  -- F 市场潮流（基线种子 + 积累）
  CREATE TABLE IF NOT EXISTS trends (
    trend_id TEXT PRIMARY KEY,
    region_ref TEXT, month INTEGER,
    flower_id TEXT, score REAL, source TEXT
  );

  -- I 内容 UGC 库（积累域，空表）
  CREATE TABLE IF NOT EXISTS ugc (
    ugc_id TEXT PRIMARY KEY,
    author TEXT, type TEXT, ref_id TEXT,
    content TEXT, rating REAL, created_at TEXT
  );

  -- H 供应链库存（积累域，空表）
  CREATE TABLE IF NOT EXISTS supply_inventory (
    flower_id TEXT, shop_id TEXT, stock_qty INTEGER, updated_at TEXT,
    PRIMARY KEY (flower_id, shop_id)
  );

  -- L 营销权益（积累域，空表）
  CREATE TABLE IF NOT EXISTS marketing (
    campaign_id TEXT PRIMARY KEY,
    title TEXT, benefit_type TEXT, benefit_detail TEXT,
    start_at TEXT, end_at TEXT, region_ref TEXT
  );

  -- M 竞品基准（积累域，空表）
  CREATE TABLE IF NOT EXISTS competitors (
    competitor_id TEXT PRIMARY KEY,
    name TEXT, region_ref TEXT, price_index REAL, rating REAL, note TEXT
  );

  -- N 智能体元学习（积累域，空表；信号由 feedback 聚合回写）
  CREATE TABLE IF NOT EXISTS meta_learning (
    signal_id TEXT PRIMARY KEY,
    domain TEXT, key TEXT, metric TEXT, value REAL, updated_at TEXT
  );
`;

let db = null;

function init() {
  if (db) return db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode=WAL'); // 一写多读，读写互不阻塞
  db.exec('PRAGMA foreign_keys=ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS kv (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(store, key)
    );
    CREATE TABLE IF NOT EXISTS feedback (
      feedback_id TEXT PRIMARY KEY,
      session_id TEXT,
      plan_id TEXT,
      shop_id TEXT,
      user_id TEXT,
      action TEXT NOT NULL,
      rating INTEGER,
      edited_fields TEXT,
      comment TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_fb_plan ON feedback(plan_id);
    CREATE INDEX IF NOT EXISTS idx_fb_action ON feedback(action);
  `);
  db.exec(SEED_DOMAIN_SCHEMA);
  migrateFromJson();
  return db;
}

function ensure() {
  if (!db) init();
  return db;
}

// 便捷单例（模块加载即初始化，CLI 不 require 本文件所以无副作用）
init();

// ---------- KV 文档存储（plans / sessions / orders 等半结构化对象）----------
function kvGet(store, key) {
  const row = ensure().prepare('SELECT value FROM kv WHERE store=? AND key=?').get(store, key);
  return row ? JSON.parse(row.value) : null;
}

function kvSet(store, key, obj) {
  const now = new Date().toISOString();
  const value = JSON.stringify(obj);
  ensure()
    .prepare(
      `INSERT INTO kv(store,key,value,created_at,updated_at) VALUES(?,?,?,?,?)
       ON CONFLICT(store,key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`
    )
    .run(store, key, value, now, now);
  return obj;
}

function kvGetAll(store) {
  const rows = ensure().prepare('SELECT key, value FROM kv WHERE store=?').all(store);
  const out = {};
  for (const r of rows) out[r.key] = JSON.parse(r.value);
  return out;
}

// ---------- feedback 结构化表（支持 SQL 聚合）----------
function insertFeedback(rec) {
  ensure()
    .prepare(
      `INSERT INTO feedback(feedback_id,session_id,plan_id,shop_id,user_id,action,rating,edited_fields,comment,created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      rec.feedback_id,
      rec.session_id || null,
      rec.plan_id || null,
      rec.shop_id || null,
      rec.user_id || null,
      rec.action,
      typeof rec.rating === 'number' ? rec.rating : null,
      rec.edited_fields ? JSON.stringify(rec.edited_fields) : null,
      rec.comment || null,
      rec.created_at
    );
  return rec;
}

function allFeedback() {
  const rows = ensure().prepare('SELECT * FROM feedback ORDER BY created_at ASC').all();
  return rows.map((r) => ({
    feedback_id: r.feedback_id,
    session_id: r.session_id,
    plan_id: r.plan_id,
    shop_id: r.shop_id,
    user_id: r.user_id,
    action: r.action,
    rating: r.rating,
    edited_fields: r.edited_fields ? JSON.parse(r.edited_fields) : null,
    comment: r.comment,
    created_at: r.created_at
  }));
}

// ---------- 一次性迁移：把现有 JSON 文件导入 SQLite ----------
// 仅当源文件存在且 db 中尚无对应记录时导入；导入成功后将源文件改名 *.json.migrated 保留（不删，可回退）。
function migrateFromJson() {
  const stores = { plans: 'plans.json', sessions: 'sessions.json', orders: 'orders.json' };
  for (const [store, file] of Object.entries(stores)) {
    const p = path.join(DATA_DIR, file);
    if (!fs.existsSync(p)) continue;
    let obj;
    try {
      obj = JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (e) {
      continue;
    }
    const existing = kvGetAll(store);
    for (const [k, v] of Object.entries(obj)) {
      if (!(k in existing)) kvSet(store, k, v);
    }
    try {
      fs.renameSync(p, p + '.migrated');
    } catch (e) {
      /* 改名失败不阻塞，下次启动会再尝试（去重逻辑保证不重复导入） */
    }
  }
  // feedback.json -> feedback 表（结构化）
  const fp = path.join(DATA_DIR, 'feedback.json');
  if (fs.existsSync(fp)) {
    let obj;
    try {
      obj = JSON.parse(fs.readFileSync(fp, 'utf8'));
    } catch (e) {
      obj = {};
    }
    const cur = new Set(allFeedback().map((r) => r.feedback_id));
    for (const rec of Object.values(obj)) {
      if (!cur.has(rec.feedback_id)) insertFeedback(rec);
    }
    try {
      fs.renameSync(fp, fp + '.migrated');
    } catch (e) {
      /* ignore */
    }
  }
}

// ---------- 积累域写入层（H 供应链库存 / I UGC / L 营销 / M 竞品 / N 元学习）----------
// 这些域上线后由真实行为沉淀；此处提供幂等写入接口，供 server / feedbackStore 调用。
function writeUgc(rec) {
  const id = rec.ugc_id || uid('ugc');
  ensure()
    .prepare('INSERT INTO ugc(ugc_id,author,type,ref_id,content,rating,created_at) VALUES(?,?,?,?,?,?,?)')
    .run(id, rec.author || 'anon', rec.type || 'note', rec.ref_id || null, rec.content || '', typeof rec.rating === 'number' ? rec.rating : null, new Date().toISOString());
  return id;
}

// 下单扣减库存（delta 为负）。无库存行（未 seed）时静默跳过，不影响下单。
function adjustStock(flower_id, shop_id, delta) {
  ensure()
    .prepare('UPDATE supply_inventory SET stock_qty = stock_qty + ?, updated_at = ? WHERE flower_id = ? AND shop_id = ?')
    .run(delta, new Date().toISOString(), flower_id, shop_id);
  return true;
}

function writeMarketing(rec) {
  ensure()
    .prepare('INSERT OR REPLACE INTO marketing(campaign_id,title,benefit_type,benefit_detail,start_at,end_at,region_ref) VALUES(?,?,?,?,?,?,?)')
    .run(rec.campaign_id, rec.title, rec.benefit_type, rec.benefit_detail, rec.start_at || null, rec.end_at || null, rec.region_ref || null);
  return rec.campaign_id;
}

function writeCompetitor(rec) {
  ensure()
    .prepare('INSERT OR REPLACE INTO competitors(competitor_id,name,region_ref,price_index,rating,note) VALUES(?,?,?,?,?,?)')
    .run(rec.competitor_id, rec.name, rec.region_ref || null, rec.price_index != null ? rec.price_index : null, rec.rating != null ? rec.rating : null, rec.note || '');
  return rec.competitor_id;
}

// N 元学习：信号以 domain+key 为主键，聚合回写后供方案生成与监控消费
function writeMetaLearning(domain, key, metric, value) {
  ensure()
    .prepare('INSERT OR REPLACE INTO meta_learning(signal_id,domain,key,metric,value,updated_at) VALUES(?,?,?,?,?,?)')
    .run(`${domain}_${key}`, domain, key, metric, value, new Date().toISOString());
  return `${domain}_${key}`;
}

function allMetaLearning() {
  try {
    return ensure().prepare('SELECT * FROM meta_learning ORDER BY updated_at DESC').all();
  } catch (e) {
    return [];
  }
}

module.exports = { init, ensure, kvGet, kvSet, kvGetAll, insertFeedback, allFeedback, DB_PATH,
  writeUgc, adjustStock, writeMarketing, writeCompetitor, writeMetaLearning, allMetaLearning };
