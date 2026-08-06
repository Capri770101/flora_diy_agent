// 14 域数据底座 · 种子加载（幂等，可重复执行）
// 把现有 JSON（flowers/shops/templates）迁移进 SQLite 结构化表，
// 并为新增可种子域写入行业种子数据。积累域（ugc/supply_inventory/marketing/
// competitors/meta_learning）仅建表、不灌数据，上线后由真实行为沉淀。
const fs = require('fs');
const path = require('path');
const db = require('./db');
// 种子源固定为项目 data/（不受 FLORA_DATA_DIR 隔离/部署覆盖影响），目标库可变
const SEED_DIR = path.join(__dirname, '..', 'data');

function loadJson(name) {
  return JSON.parse(fs.readFileSync(path.join(SEED_DIR, name), 'utf8'));
}

// 手动事务封装（node:sqlite DatabaseSync 无 .transaction() 包装器）
function tx(d, fn) {
  d.exec('BEGIN');
  try {
    fn();
    d.exec('COMMIT');
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  }
}

// ---------- A 花卉详情（含 E 花卉季节 months）----------
function seedFlowers(d) {
  const flowers = loadJson('flowers.json');
  const stmt = d.prepare(`INSERT OR REPLACE INTO flowers
    (id,name,en,role,season,price,unit,meaning,bloom_period,allergen,care,months_json,style_tags_json,occasions_json,colors_json)
    VALUES (@id,@name,@en,@role,@season,@price,@unit,@meaning,@bloom_period,@allergen,@care,@months_json,@style_tags_json,@occasions_json,@colors_json)`);
  tx(d, () => {
    for (const f of flowers) {
      stmt.run({
        id: f.id, name: f.name, en: f.en, role: f.role, season: f.season,
        price: f.price, unit: f.unit, meaning: f.花语, bloom_period: f.花期,
        allergen: f.过敏 ? 1 : 0, care: f.care,
        months_json: JSON.stringify(f.months || []),
        style_tags_json: JSON.stringify(f.styleTags || []),
        occasions_json: JSON.stringify(f.occasions || []),
        colors_json: JSON.stringify(f.colors || [])
      });
    }
  });
  return flowers.length;
}

// ---------- D 地区差异（先建，供门店风格派生）----------
// 注：source/confidence 为质检元数据，仅用于《知识质检流水线》离线审阅，
// 不写入运行时库表（见《知识质检流水线.md》）。置信度刻度见文档。
const REGION_SEED = [
  { region_id: 'sz_futian', city: '深圳', district: '福田区', price_index: 1.10, popular_styles: ['高级', '浪漫'], season_modifier: { winter_factor: 1.0, note: '亚热带海洋性气候，冬季花价平稳' }, note: 'CBD 商圈，客单价偏高，偏好精致高级款', source: '平台种子', confidence: 0.75 },
  { region_id: 'sz_nanshan', city: '深圳', district: '南山区', price_index: 1.15, popular_styles: ['高级', '清新'], season_modifier: { winter_factor: 1.0, note: '沿海湿润，花期略长' }, note: '科技园/海岸城，年轻客群，偏好简约清新', source: '平台种子', confidence: 0.75 },
  { region_id: 'sz_luohu', city: '深圳', district: '罗湖区', price_index: 1.00, popular_styles: ['热烈', '田园'], season_modifier: { winter_factor: 1.0 }, note: '老城商圈，价格亲民，节日走量', source: '平台种子', confidence: 0.75 },
  { region_id: 'sz_baoan', city: '深圳', district: '宝安区', price_index: 0.95, popular_styles: ['田园', '清新'], season_modifier: { winter_factor: 1.0 }, note: '家庭客群多，偏好温馨家居装饰', source: '平台种子', confidence: 0.75 },
  { region_id: 'sz_longgang', city: '深圳', district: '龙岗区', price_index: 0.95, popular_styles: ['高级', '复古'], season_modifier: { winter_factor: 1.0 }, note: '社区店为主，偏好复古高级感', source: '平台种子', confidence: 0.75 },
  { region_id: 'sz_longhua', city: '深圳', district: '龙华区', price_index: 0.90, popular_styles: ['温柔', '清新'], season_modifier: { winter_factor: 1.0 }, note: '通勤客群，偏好温柔日常款', source: '平台种子', confidence: 0.75 },
  { region_id: 'sz_yantian', city: '深圳', district: '盐田区', price_index: 0.95, popular_styles: ['清新', '田园'], season_modifier: { winter_factor: 1.0, note: '滨海，空气湿润，花期略长' }, note: '滨海旅游与社区客群，偏好清新家居与海岛风', source: '平台种子', confidence: 0.75 }
];
function seedRegions(d) {
  const stmt = d.prepare(`INSERT OR IGNORE INTO regions
    (region_id,city,district,season_modifier_json,price_index,popular_styles_json,note)
    VALUES (?,?,?,?,?,?,?)`);
  tx(d, () => {
    for (const r of REGION_SEED) {
      stmt.run(r.region_id, r.city, r.district, JSON.stringify(r.season_modifier), r.price_index, JSON.stringify(r.popular_styles), r.note);
    }
  });
  return REGION_SEED.length;
}

// ---------- B 门店价格 + C 商家服务质量与风格 ----------
function seedShops(d) {
  const shops = loadJson('shops.json');
  const regionByDistrict = {};
  for (const r of REGION_SEED) regionByDistrict[r.district] = r;

  const sStmt = d.prepare(`INSERT OR REPLACE INTO shops
    (shop_id,name,city,district,address,lat,lng,rating,open_hours,status,support_flowers_json,price_map_json,cost_map_json,margin_rate,pack_cost,style_tags_json,service_tags_json)
    VALUES (@shop_id,@name,@city,@district,@address,@lat,@lng,@rating,@open_hours,@status,@support_flowers_json,@price_map_json,@cost_map_json,@margin_rate,@pack_cost,@style_tags_json,@service_tags_json)`);
  const mStmt = d.prepare(`INSERT OR REPLACE INTO merchant_profiles (shop_id,style_tags_json,service_tags_json,quality_score,delivery_supported,note) VALUES (?,?,?,?,?,?)`);
  const stStmt = d.prepare(`INSERT OR IGNORE INTO shop_stock (shop_id,flower_id,price,in_stock) VALUES (?,?,?,?)`);

  tx(d, () => {
    for (const s of shops) {
      const region = regionByDistrict[s.district] || {};
      const styleTags = s.style_tags || region.popular_styles || [];
      const serviceTags = s.service_tags || ['同城配送', '精美包装', '附养护卡'];
      sStmt.run({
        shop_id: s.shop_id, name: s.name, city: s.city, district: s.district, address: s.address,
        lat: s.lat, lng: s.lng, rating: s.rating, open_hours: s.open_hours, status: s.status || 'open',
        support_flowers_json: JSON.stringify(s.support_flowers || []),
        price_map_json: JSON.stringify(s.price_map || {}),
        cost_map_json: JSON.stringify(s.cost_map || {}),
        margin_rate: s.margin_rate != null ? s.margin_rate : null,
        pack_cost: s.pack_cost != null ? s.pack_cost : null,
        style_tags_json: JSON.stringify(styleTags),
        service_tags_json: JSON.stringify(serviceTags)
      });
      mStmt.run(s.shop_id, JSON.stringify(styleTags), JSON.stringify(serviceTags), s.rating || 4, 1, '');
      for (const fid of (s.support_flowers || [])) {
        const price = (s.price_map && s.price_map[fid] != null) ? s.price_map[fid] : null;
        stStmt.run(s.shop_id, fid, price, 1);
      }
    }
  });
  return shops.length;
}

// ---------- 模板（occasions/styles/placements/care_tips/category_defaults）----------
function seedTemplates(d) {
  const t = loadJson('templates.json');
  db.kvSet('config', 'templates', t);
  return 1;
}

// ---------- J 知识教育 ----------
// 置信度刻度：平台规则 0.90 / 花艺师手册 0.85 / 行业资料 0.80
const KNOWLEDGE_SEED = [
  { knowledge_id: 'k_hydrate', category: '养护', title: '鲜花醒花标准流程', tags: ['醒花', '基础'], source: '行业资料', confidence: 0.80, body: '收到花后先拆除包装，根部斜剪45°、留叶醒花2-4小时（绣球可整朵浸水）；醒花后再去叶制作，可显著延长观赏期。' },
  { knowledge_id: 'k_spiral', category: '技法', title: '螺旋绑扎法要点', tags: ['绑扎', '技法'], source: '花艺师手册', confidence: 0.85, body: '左手虎口为支点，主花按同一方向逐支以螺旋角度加入，花头高度错落1-2cm；每加一支保持螺旋方向，最后在虎口处缠绕固定。' },
  { knowledge_id: 'k_fresh', category: '养护', title: '家庭保鲜延长花期', tags: ['保鲜', '养护'], source: '行业资料', confidence: 0.80, body: '每1-2天换水并重新斜剪根；水中加鲜花保鲜剂，或1小勺白糖+1滴84消毒液；远离阳光、空调风口与成熟水果（乙烯催凋）。' },
  { knowledge_id: 'k_sick', category: '场景', title: '探病花材避讳', tags: ['探病', '合规'], source: '平台规则', confidence: 0.90, body: '探病场景自动规避浓香/高花粉花材（如百合）。须主动提示：百合花药易沾污花瓣、过敏体质需避闻浓香。' },
  { knowledge_id: 'k_hydrangea', category: '养护', title: '绣球保湿要点', tags: ['绣球', '养护'], source: '行业资料', confidence: 0.80, body: '绣球花瓣极易失水，花头可整朵浸水2小时复水；根部十字剪，每日整花喷雾保湿，忌风口直吹。' },
  { knowledge_id: 'k_tulip', category: '养护', title: '郁金香向光弯曲处理', tags: ['郁金香', '养护'], source: '行业资料', confidence: 0.80, body: '郁金香茎向光生长会弯曲，冷水养护并撕去底部白皮斜剪；每半天转瓶180°保持直立。' },
  { knowledge_id: 'k_delivery', category: '履约', title: '同城鲜花配送时效', tags: ['配送', '履约'], source: '平台规则', confidence: 0.90, body: '同城闪送通常0.5-1天达；承诺时效须真实，不得虚假宣传"当日达"后又延迟；易垂头花材（绣球/洋桔梗）需浸水棉套保鲜。' },
  { knowledge_id: 'k_peony', category: '养护', title: '牡丹/洋牡丹醒花与防塌', tags: ['牡丹', '养护'], source: '行业资料', confidence: 0.80, body: '牡丹花瓣薄易失水，根部斜剪后整枝浅水醒花2-3h；置阴凉通风处，花头勿喷水，勿对空调风口。' },
  { knowledge_id: 'k_rose_care', category: '养护', title: '玫瑰去刺与防烂茎', tags: ['玫瑰', '养护'], source: '花艺师手册', confidence: 0.85, body: '去刺用剪刀轻刮而非硬扯，避免伤皮；茎基2-3cm 去叶防泡水解腐；1-2天换水斜剪，水中可加保鲜剂。' },
  { knowledge_id: 'k_lily_allergen', category: '合规', title: '百合花粉过敏提示', tags: ['百合', '过敏', '合规'], source: '平台规则', confidence: 0.90, body: '百合花粉易致敏且沾污衣物；探病/母婴/过敏史场景须主动提示并优先替换为非浓香花材，或去雄蕊后交付。' },
  { knowledge_id: 'k_season', category: '季节', title: '当季花材选择原则', tags: ['时令', '季节'], source: '行业资料', confidence: 0.80, body: '当季花材价优、状态好、花期长；非当季多依赖温室/进口且易垂头。方案优先取当月可售花，跨季花材谨慎使用。' },
  { knowledge_id: 'k_budget', category: '预算', title: '控制花束预算的技巧', tags: ['预算', '搭配'], source: '花艺师手册', confidence: 0.85, body: '主花选1-2种突出，配花叶材做量感；高价花（蝴蝶兰/帝王花/牡丹）少量点睛；用满天星/尤加利拉满层次可降本不降质。' },
  { knowledge_id: 'k_wrap', category: '技法', title: '包装与丝带基础', tags: ['包装', '技法'], source: '花艺师手册', confidence: 0.85, body: '雾面纸打底显高级，雪梨纸增层次，牛皮纸偏田园；丝带蝴蝶结方向与花束朝向一致；底部齐根收口防散。' },
  { knowledge_id: 'k_gift', category: '场景', title: '送礼贺卡与附卡', tags: ['送礼', '场景'], source: '平台规则', confidence: 0.90, body: '礼赠场景附手写贺卡更显心意；须核对收礼人姓名与祝福语；探病/丧事用素雅措辞，避免轻佻。' },
  { knowledge_id: 'k_office', category: '场景', title: '办公桌瓶花摆放', tags: ['办公', '瓶花', '场景'], source: '行业资料', confidence: 0.80, body: '办公桌宜小型瓶花，选耐放低敏花（洋桔梗/郁金香/尤加利）；避空调直吹与电脑散热口，每周换水。' },
  { knowledge_id: 'k_dry', category: '养护', title: '干花与永生花养护', tags: ['干花', '永生花', '养护'], source: '行业资料', confidence: 0.80, body: '干花/永生花忌水忌潮，摆放通风干燥处；勿暴晒防褪色；除尘用软毛刷轻扫，寿命可达数月到一年。' }
];
function seedKnowledge(d) {
  const stmt = d.prepare(`INSERT OR IGNORE INTO knowledge (knowledge_id,category,title,body,tags_json,source) VALUES (?,?,?,?,?,?)`);
  tx(d, () => {
    for (const k of KNOWLEDGE_SEED) stmt.run(k.knowledge_id, k.category, k.title, k.body, JSON.stringify(k.tags), k.source);
  });
  return KNOWLEDGE_SEED.length;
}

// ---------- K 合规信任 ----------
// 置信度：合规条目源自法规/平台规则，统一 0.95
const COMPLIANCE_SEED = [
  { rule_id: 'c_allergen', category: '消费者权益', title: '过敏花材提示义务', applies_to: '探病/母婴场景', source: '平台规则', confidence: 0.95, detail: '探病、母婴等敏感场景须主动提示百合等高花粉/浓香花材，并提供无过敏替代方案。' },
  { rule_id: 'c_price', category: '价格合规', title: '价格透明不得低价引流加价', applies_to: '全部订单', source: '价格法', confidence: 0.95, detail: '方案总价与门店价必须一致展示，价差透明；不得先以低价引流、下单后擅自加价。' },
  { rule_id: 'c_leadtime', category: '履约承诺', title: '配送时效不得虚假宣传', applies_to: '配送订单', source: '广告法', confidence: 0.95, detail: '配送时效承诺须真实可履约，不得宣传"当日达"等无法保证的时效。' },
  { rule_id: 'c_return', category: '退换货', title: '生鲜鲜花不适用七天无理由', applies_to: '全部订单', source: '消保条例', confidence: 0.95, detail: '鲜花属生鲜易耗品，不适用七天无理由退换；但枯败/货损须在签收后及时举证理赔。' },
  { rule_id: 'c_privacy', category: '隐私', title: '用户隐私仅用于履约', applies_to: '全部数据', source: '个人信息保护法', confidence: 0.95, detail: '用户地址、电话、画像仅用于订单履约与售后服务，不得用于无关营销或对外提供。' }
];
function seedCompliance(d) {
  const stmt = d.prepare(`INSERT OR IGNORE INTO compliance (rule_id,category,title,detail,applies_to,source) VALUES (?,?,?,?,?,?)`);
  tx(d, () => {
    for (const c of COMPLIANCE_SEED) stmt.run(c.rule_id, c.category, c.title, c.detail, c.applies_to, c.source);
  });
  return COMPLIANCE_SEED.length;
}

// ---------- G 物流履约（基础）----------
const LOGISTICS_SEED = [
  { zone_id: 'z_futian', region_ref: 'sz_futian', carrier: '同城闪送', lead_time_days: 0.5, fee: 15, source: '平台种子', confidence: 0.80 },
  { zone_id: 'z_nanshan', region_ref: 'sz_nanshan', carrier: '同城闪送', lead_time_days: 0.5, fee: 18, source: '平台种子', confidence: 0.80 },
  { zone_id: 'z_luohu', region_ref: 'sz_luohu', carrier: '同城闪送', lead_time_days: 0.5, fee: 12, source: '平台种子', confidence: 0.80 },
  { zone_id: 'z_baoan', region_ref: 'sz_baoan', carrier: '同城达达', lead_time_days: 1, fee: 15, source: '平台种子', confidence: 0.80 },
  { zone_id: 'z_longgang', region_ref: 'sz_longgang', carrier: '同城达达', lead_time_days: 1, fee: 18, source: '平台种子', confidence: 0.80 },
  { zone_id: 'z_longhua', region_ref: 'sz_longhua', carrier: '同城达达', lead_time_days: 1, fee: 14, source: '平台种子', confidence: 0.80 }
];
function seedLogistics(d) {
  const stmt = d.prepare(`INSERT OR IGNORE INTO logistics (zone_id,region_ref,carrier,lead_time_days,fee,supports_fresh) VALUES (?,?,?,?,?,1)`);
  tx(d, () => {
    for (const z of LOGISTICS_SEED) stmt.run(z.zone_id, z.region_ref, z.carrier, z.lead_time_days, z.fee);
  });
  return LOGISTICS_SEED.length;
}

// ---------- F 市场潮流（基线种子，上线后由真实行为累加）----------
// F 市场潮流：覆盖 12 个月，引用真实流行花材（含扩样新增花），让"当月潮流"洞察更贴近实际
const TREND_SEED = [
  { trend_id: 't_m1_rose', month: 1, flower_id: 'rose', score: 0.90, source: 'seed', confidence: 0.60 },
  { trend_id: 't_m1_amaryllis', month: 1, flower_id: 'amaryllis', score: 0.85, source: 'seed', confidence: 0.60 },
  { trend_id: 't_m2_rose', month: 2, flower_id: 'rose', score: 0.95, source: 'seed', confidence: 0.60 },
  { trend_id: 't_m2_carnation', month: 2, flower_id: 'carnation', score: 0.80, source: 'seed', confidence: 0.60 },
  { trend_id: 't_m2_tulip', month: 2, flower_id: 'tulip', score: 0.75, source: 'seed', confidence: 0.60 },
  { trend_id: 't_m3_tulip', month: 3, flower_id: 'tulip', score: 0.85, source: 'seed', confidence: 0.60 },
  { trend_id: 't_m3_ranunculus', month: 3, flower_id: 'ranunculus', score: 0.80, source: 'seed', confidence: 0.60 },
  { trend_id: 't_m3_freesia', month: 3, flower_id: 'freesia', score: 0.75, source: 'seed', confidence: 0.60 },
  { trend_id: 't_m4_ranunculus', month: 4, flower_id: 'ranunculus', score: 0.85, source: 'seed', confidence: 0.60 },
  { trend_id: 't_m4_peony', month: 4, flower_id: 'peony', score: 0.80, source: 'seed', confidence: 0.60 },
  { trend_id: 't_m4_stock', month: 4, flower_id: 'stock', score: 0.75, source: 'seed', confidence: 0.60 },
  { trend_id: 't_m5_carnation', month: 5, flower_id: 'carnation', score: 0.95, source: 'seed', confidence: 0.60 },
  { trend_id: 't_m5_viola', month: 5, flower_id: 'viola', score: 0.90, source: 'seed', confidence: 0.60 },
  { trend_id: 't_m5_hydrangea', month: 5, flower_id: 'hydrangea', score: 0.85, source: 'seed', confidence: 0.60 },
  { trend_id: 't_m6_dahlia', month: 6, flower_id: 'dahlia', score: 0.85, source: 'seed', confidence: 0.60 },
  { trend_id: 't_m6_agapanthus', month: 6, flower_id: 'agapanthus', score: 0.80, source: 'seed', confidence: 0.60 },
  { trend_id: 't_m6_delphinium', month: 6, flower_id: 'delphinium', score: 0.75, source: 'seed', confidence: 0.60 },
  { trend_id: 't_m7_dahlia', month: 7, flower_id: 'dahlia', score: 0.85, source: 'seed', confidence: 0.60 },
  { trend_id: 't_m7_sunflower', month: 7, flower_id: 'sunflower', score: 0.80, source: 'seed', confidence: 0.60 },
  { trend_id: 't_m7_lisianthus', month: 7, flower_id: 'lisianthus', score: 0.75, source: 'seed', confidence: 0.60 },
  { trend_id: 't_m8_rose', month: 8, flower_id: 'rose', score: 0.95, source: 'seed', confidence: 0.60 },
  { trend_id: 't_m8_lisianthus', month: 8, flower_id: 'lisianthus', score: 0.80, source: 'seed', confidence: 0.60 },
  { trend_id: 't_m9_dahlia', month: 9, flower_id: 'dahlia', score: 0.85, source: 'seed', confidence: 0.60 },
  { trend_id: 't_m9_calla', month: 9, flower_id: 'calla', score: 0.80, source: 'seed', confidence: 0.60 },
  { trend_id: 't_m10_rose', month: 10, flower_id: 'rose', score: 0.90, source: 'seed', confidence: 0.60 },
  { trend_id: 't_m10_peony', month: 10, flower_id: 'peony', score: 0.80, source: 'seed', confidence: 0.60 },
  { trend_id: 't_m11_calla', month: 11, flower_id: 'calla', score: 0.85, source: 'seed', confidence: 0.60 },
  { trend_id: 't_m11_protea', month: 11, flower_id: 'protea', score: 0.80, source: 'seed', confidence: 0.60 },
  { trend_id: 't_m12_phalaenopsis', month: 12, flower_id: 'phalaenopsis', score: 0.90, source: 'seed', confidence: 0.60 },
  { trend_id: 't_m12_amaryllis', month: 12, flower_id: 'amaryllis', score: 0.85, source: 'seed', confidence: 0.60 },
  { trend_id: 't_m12_camellia', month: 12, flower_id: 'camellia', score: 0.80, source: 'seed', confidence: 0.60 }
];
function seedTrends(d) {
  const stmt = d.prepare(`INSERT OR IGNORE INTO trends (trend_id,region_ref,month,flower_id,score,source) VALUES (?,?,?,?,?,?)`);
  tx(d, () => {
    for (const t of TREND_SEED) stmt.run(t.trend_id, 'sz_all', t.month, t.flower_id, t.score, t.source);
  });
  return TREND_SEED.length;
}

// ---------- H 供应链库存（初始库存基线，运行时随下单扣减）----------
function seedInventory(d) {
  const shops = loadJson('shops.json');
  const stmt = d.prepare('INSERT OR IGNORE INTO supply_inventory (flower_id,shop_id,stock_qty,updated_at) VALUES (?,?,?,?)');
  tx(d, () => {
    for (const s of shops) {
      for (const fid of (s.support_flowers || [])) {
        // 确定性库存（同店同花每次 seed 一致），区间 25~60
        const qty = 25 + ((fid.length * 7 + s.shop_id.length * 3 + fid.charCodeAt(0)) % 36);
        stmt.run(fid, s.shop_id, qty, new Date().toISOString());
      }
    }
  });
  const rows = d.prepare('SELECT COUNT(*) c FROM supply_inventory').get();
  return rows.c;
}

// ---------- L 营销权益（基线种子，上线后由运营活动累加）----------
const MARKETING_SEED = [
  { campaign_id: 'm_newuser', title: '新人首单立减20', benefit_type: 'discount', benefit_detail: '新用户首单满99减20', start_at: '2026-01-01', end_at: '2026-12-31', region_ref: 'sz_all', source: '平台运营', confidence: 0.90 },
  { campaign_id: 'm_mothersday', title: '母亲节鲜花特惠', benefit_type: 'gift', benefit_detail: '母亲节期间下单赠手写贺卡+养护卡', start_at: '2026-05-01', end_at: '2026-05-12', region_ref: 'sz_all', source: '平台运营', confidence: 0.90 },
  { campaign_id: 'm_weekend', title: '周末悦己小束', benefit_type: 'discount', benefit_detail: '周末瓶花/小型花束满69减10', start_at: '2026-01-01', end_at: '2026-12-31', region_ref: 'sz_all', source: '平台运营', confidence: 0.90 }
];
function seedMarketing(d) {
  const stmt = d.prepare('INSERT OR IGNORE INTO marketing (campaign_id,title,benefit_type,benefit_detail,start_at,end_at,region_ref) VALUES (?,?,?,?,?,?,?)');
  tx(d, () => {
    for (const m of MARKETING_SEED) stmt.run(m.campaign_id, m.title, m.benefit_type, m.benefit_detail, m.start_at, m.end_at, m.region_ref);
  });
  return MARKETING_SEED.length;
}

// ---------- M 竞品基准（基线种子，上线后由爬虫/运营补齐）----------
const COMPETITOR_SEED = [
  { competitor_id: 'c_floral', name: '花加 Floral', region_ref: 'sz_all', price_index: 1.05, rating: 4.6, note: '线上订阅花束，价格略高、品质稳定', source: '平台估算', confidence: 0.70 },
  { competitor_id: 'c_love', name: '爱尚鲜花', region_ref: 'sz_futian', price_index: 0.98, rating: 4.4, note: '本地批发档口，价格亲民走量', source: '平台估算', confidence: 0.70 },
  { competitor_id: 'c_orose', name: 'Roseonly', region_ref: 'sz_nanshan', price_index: 1.25, rating: 4.8, note: '高端礼赠定位，客单价高', source: '平台估算', confidence: 0.70 }
];
function seedCompetitors(d) {
  const stmt = d.prepare('INSERT OR IGNORE INTO competitors (competitor_id,name,region_ref,price_index,rating,note) VALUES (?,?,?,?,?,?)');
  tx(d, () => {
    for (const c of COMPETITOR_SEED) stmt.run(c.competitor_id, c.name, c.region_ref, c.price_index, c.rating, c.note);
  });
  return COMPETITOR_SEED.length;
}

function runAll() {
  const d = db.init();
  const result = {
    flowers: seedFlowers(d),
    regions: seedRegions(d),
    shops: seedShops(d),
    inventory: seedInventory(d),
    templates: seedTemplates(d),
    knowledge: seedKnowledge(d),
    compliance: seedCompliance(d),
    logistics: seedLogistics(d),
    trends: seedTrends(d),
    marketing: seedMarketing(d),
    competitors: seedCompetitors(d)
  };
  return result;
}

module.exports = { runAll, REGION_SEED, KNOWLEDGE_SEED, COMPLIANCE_SEED, LOGISTICS_SEED, TREND_SEED, MARKETING_SEED, COMPETITOR_SEED };
