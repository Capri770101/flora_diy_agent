// 智能体唯一入口：寒暄 → 理解 → 澄清 → 方案 → 效果图 → 选店 → 锁定门店
// 契约（零副作用，由调用方负责持久化）：
//   runAgent({ text, session, location, config })
//     → { session_id, session, reply, plan, plan_version,
//         shop_suggestions, shop_choice, need_clarify, missing_fields,
//         changed }
// config: { skip_image?: boolean, shop_limit?: number, shop_context?: object }
// 回合类型：
//  - 寒暄回合（"你好 / hi"）：纯闲聊，不出方案
//  - 选店回合（"选第二家 / 看看其他店"）：不动方案、不出图、不推版本
//  - 澄清回合（信息不足）：自然反问，不出草稿方案
//  - 无变化回合（"嗯 / 好看点"没提供新信息）：确认现状、不重生成
//  - 正常回合：合并需求 → 出方案 → 出图 → 配店 → 推版本
const decomposer = require('../decomposer');
const { composePlan } = require('../planner');
const { generate } = require('../imageGen');
const { buildSummary } = require('../imagePrompt');
const sessionStore = require('./sessionStore');
const { findMissingFields, askClarification, CRITICAL_FIELDS } = require('./clarify');
const { matchShops } = require('./shopMatcher');
const { detectShopIntent } = require('./shopIntent');
const { buildInsights } = require('./insights');

// 纯打招呼/寒暄（无任何需求信息）→ 不触发需求流程
const RE_PURE_GREETING = /^(你?好+|您好+|hi+|hello|hey|嗨|哈喽|在吗|在不在|早上好|中午好|下午好|晚上好|谢谢|感谢|辛苦)[!！~～。，,.?？\s]*$/i;

// 拆解结果是否完全没提取到任何需求（闲聊、语气词等）
function isEmptyFresh(fresh) {
  if (!fresh) return true;
  if (fresh.intent && fresh.intent !== '其他') return false;
  if (fresh.recipient || fresh.occasion || fresh.category || fresh.size || fresh.placement) return false;
  if (fresh.budget != null) return false;
  if (fresh.month != null) return false;
  if (fresh.avoid_allergen) return false;
  for (const k of ['style', 'color_tone', 'forbidden', 'preferred', 'extras']) {
    if (fresh[k] && fresh[k].length) return false;
  }
  return true;
}

function chitChatReply(greeting) {
  return greeting
    ? '你好呀～我是您的花艺小助手 🌸\n想做一束花送给谁呢？可以告诉我用途（生日、表白、开业……）、大概预算和喜欢的风格或花材，我帮您设计专属花束，还能直接匹配附近花店下单哦。'
    : '好的，收到～ 为了给您设计一束合适的花，还需要些信息：这束花是送人还是自用？大概预算多少？喜欢什么风格或花材呢？';
}

// 信息太少（关键字段缺 2+ 个，且用户没有表达任何花材偏好）→ 自然反问，不出方案
function shouldClarify(requirements, missing) {
  const criticalMissing = missing.filter((f) => CRITICAL_FIELDS.includes(f));
  if (criticalMissing.length < 2) return false;
  if (requirements.preferred && requirements.preferred.length) return false;
  return true;
}

function fmtShopLine(i, s) {
  const miss = s.missing && s.missing.length ? `（缺 ${s.missing.map((m) => m.name).join('、')}，可替换）` : '';
  return `第${i + 1}家「${s.name}」${s.distance_km != null ? s.distance_km + 'km' : '附近'}、评分 ${s.rating}、约 ¥${s.price_total}${miss}`;
}

// ④ 领域洞察：交给插件编排器（lib/agent/insights.js），内置 trends/region/knowledge 三个插件，
// 可自由新增 insight 插件而无需改动主流程。见 lib/plugins/insight/。
function buildDomainInsights(req, location, firstShopDistrict) {
  return buildInsights({ requirements: req, location, firstShopDistrict });
}

function buildReply(ctx) {
  const { plan, version, diffText, shops, insights } = ctx;
  const head = version > 1 ? `收到，已在第 ${version - 1} 版基础上调整。` : `为您生成第 1 版方案：`;
  const priceText = plan.budget != null ? `总价约 ¥${plan.total}（预算 ¥${plan.budget}）` : `总价约 ¥${plan.total}`;

  let reply = head;
  if (version > 1 && diffText && diffText.length) {
    reply += `\n调整内容：${diffText.join('；')}。`;
  }
  reply += `\n${plan.summary} ${priceText}`;

  if (shops && shops.length) {
    const s = shops[0];
    const miss = s.missing && s.missing.length ? `（缺 ${s.missing.map((m) => m.name).join('、')}，可替换）` : '';
    reply += `\n\n为您匹配到 ${shops.length} 家附近花店，首推「${s.name}」${s.distance_km != null ? s.distance_km + 'km' : '附近'}、评分 ${s.rating}、约 ¥${s.price_total}${miss}。可直接回复「选第二家」等选店，或回复「看看其他店」。`;
  }

  // ④ 让方案"更懂行"：把潮流/地区/知识作为回执小贴士（不改动方案结构，回归安全）
  if (insights && (insights.trends.length || insights.region || insights.knowledge.length)) {
    const lines = [];
    if (insights.trends.length) lines.push('当下流行：' + insights.trends.map((t) => `${t.name}（${t.month}月）`).join('、'));
    if (insights.region) lines.push(`您所在的${insights.region.district}偏好${insights.region.popular_styles.join('/')}风格，客单价指数约${insights.region.price_index}`);
    if (insights.knowledge.length) lines.push('懂行知识：' + insights.knowledge.map((k) => k.title).join('、'));
    reply += '\n\n💡 ' + lines.join('；') + '。';
  }
  return reply;
}

// 选店回合：锁定门店 or 翻看更多店，不动方案、不出图
function handleShopIntent(intent, ctx, plan, location, cfg) {
  const missing = findMissingFields(ctx.requirements);
  if (intent.type === 'more') {
    const shops = plan ? matchShops(plan, { location, limit: cfg.shop_limit ? cfg.shop_limit + 2 : 5 }) : [];
    ctx.last_shops = shops;
    if (!shops.length) {
      return { reply: '附近暂时没有可选的花店，您可以继续完善需求或换个位置。', plan, version: ctx.history ? ctx.history.length : 0, need_clarify: true, missing, shops: [] };
    }
    const lines = shops.map((s, i) => fmtShopLine(i, s)).join('\n');
    return {
      reply: `再为您罗列几家附近花店：\n${lines}\n\n回复「选第 N 家」即可锁定，例如「选第二家」。`,
      plan, version: ctx.history ? ctx.history.length : 0, need_clarify: false, missing: [], shops
    };
  }

  // select
  if (intent.shop) {
    const s = intent.shop;
    ctx.shop_choice = { shop_id: s.shop_id, name: s.name, district: s.district, price_total: s.price_total, rating: s.rating };
    return {
      reply: `好的，已为您锁定「${s.name}」（${s.district || ''}，约 ¥${s.price_total}）。\n确认的话直接下单即可；想换一家告诉我「看看其他店」就行。`,
      plan, version: ctx.history ? ctx.history.length : 0, need_clarify: false, missing: [], shops: ctx.last_shops || []
    };
  }
  return {
    reply: `您选的店铺不在刚才的推荐里，试试回复「看看其他店」或「选第二家」~`,
    plan, version: ctx.history ? ctx.history.length : 0, need_clarify: false, missing: [], shops: ctx.last_shops || []
  };
}

async function runAgent({ text, session, location, config }) {
  const cfg = config || {};
  const ctx = session || sessionStore.createSession();
  const lastPlan = sessionStore.latestPlan(ctx);

  // ── 寒暄回合：不拆解、不出方案 ──
  if (RE_PURE_GREETING.test((text || '').trim())) {
    return {
      session_id: ctx.session_id,
      session: ctx,
      reply: chitChatReply(true),
      plan: null,
      plan_version: ctx.history ? ctx.history.length : 0,
      shop_suggestions: [],
      shop_choice: ctx.shop_choice || null,
      need_clarify: false,
      missing_fields: [],
      changed: false
    };
  }

  // ── 选店回合：优先于一切，不动方案不出图（仅当存在可选的店）──
  const intent = detectShopIntent(text, ctx.last_shops || []);
  if (intent.type && lastPlan && ctx.last_shops && ctx.last_shops.length) {
    const out = handleShopIntent(intent, ctx, lastPlan, location, cfg);
    return {
      session_id: ctx.session_id,
      session: ctx,
      reply: out.reply,
      plan: out.plan,
      plan_version: out.version,
      shop_suggestions: out.shops,
      shop_choice: ctx.shop_choice || null,
      need_clarify: out.need_clarify,
      missing_fields: missingOf(ctx),
      changed: false
    };
  }

  const fresh = await decomposer.decompose(text);
  const prevReq = ctx.requirements;
  const requirements = sessionStore.mergeRequirements(prevReq, fresh);

  // 门店上下文：价格/成本/包装费/当月（只影响本轮的计价，不入会话记忆）
  const sc = cfg.shop_context;
  if (sc && typeof sc === 'object') {
    if (sc.month != null && requirements.month == null) requirements.month = sc.month;
    if (sc.price_map && typeof sc.price_map === 'object') requirements.price_map = Object.assign({}, requirements.price_map, sc.price_map);
    if (sc.cost_map && typeof sc.cost_map === 'object') requirements.cost_map = Object.assign({}, requirements.cost_map, sc.cost_map);
    if (sc.margin_rate != null) requirements.margin_rate = sc.margin_rate;
    if (sc.pack_cost != null) requirements.pack_cost = sc.pack_cost;
  }
  ctx.requirements = requirements;

  const missing = findMissingFields(requirements);
  const need_clarify = shouldClarify(requirements, missing);
  const changed = !sessionStore.isSame(prevReq, requirements);

  // ── 闲聊兜底：拆解不到任何需求且没有历史方案 ──
  if (isEmptyFresh(fresh) && !lastPlan) {
    return {
      session_id: ctx.session_id,
      session: ctx,
      reply: chitChatReply(false),
      plan: null,
      plan_version: ctx.history ? ctx.history.length : 0,
      shop_suggestions: [],
      shop_choice: ctx.shop_choice || null,
      need_clarify: false,
      missing_fields: missing,
      changed: false
    };
  }

  // ── 澄清回合：自然反问，不出草稿方案 ──
  if (need_clarify) {
    return {
      session_id: ctx.session_id,
      session: ctx,
      reply: `好的，没问题～ 为了给您设计合适的花束，还想确认：${askClarification(missing)}`,
      plan: null,
      plan_version: ctx.history ? ctx.history.length : 0,
      shop_suggestions: [],
      shop_choice: ctx.shop_choice || null,
      need_clarify: true,
      missing_fields: missing,
      changed: false
    };
  }

  // ── 无变化回合：不重生成方案/效果图，确认现状 ──
  if (!changed && lastPlan) {
    const shops = ctx.last_shops || [];
    const shopText = shops.length ? `\n\n附近花店还在，回复「选第二家」或「看看其他店」继续选店。` : '';
    const reply = `好的，收到。当前方案保持不变：${lastPlan.summary} 总价约 ¥${lastPlan.total}${shopText}\n\n想调整花材、预算或风格，直接告诉我即可。`;
    return {
      session_id: ctx.session_id,
      session: ctx,
      reply,
      plan: lastPlan,
      plan_version: ctx.history ? ctx.history.length : 0,
      shop_suggestions: ctx.last_shops || [],
      shop_choice: ctx.shop_choice || null,
      need_clarify: false,
      missing_fields: missing,
      changed: false
    };
  }

  // ── 正常回合：出方案 ──
  const plan = composePlan(requirements);

  if (!cfg.skip_image) {
    const img = await generate(plan, requirements);
    plan.render_url = img.url;
    plan.render_type = img.type;
    plan.image_prompt = img.prompt;
    plan.negative_prompt = img.negative_prompt;
    plan.render_local = img.local || null;
  } else {
    plan.render_url = null;
    plan.render_type = null;
    plan.render_local = null;
  }
  plan.summary = buildSummary(plan, requirements);

  const plan_version = sessionStore.pushPlan(ctx, { requirements, plan });
  plan.version = plan_version;
  ctx.latest_plan = plan;

  const shop_suggestions = matchShops(plan, { location, limit: cfg.shop_limit || 3 });
  ctx.last_shops = shop_suggestions;

  const diffText = plan_version > 1 ? sessionStore.diffVersions(ctx) : [];
  const domain_insights = buildDomainInsights(requirements, location, shop_suggestions[0] && shop_suggestions[0].district);
  const reply = buildReply({ plan, version: plan_version, diffText, shops: shop_suggestions, insights: domain_insights });

  return {
    session_id: ctx.session_id,
    session: ctx,
    reply,
    plan,
    plan_version,
    shop_suggestions,
    shop_choice: ctx.shop_choice || null,
    domain_insights,
    need_clarify: false,
    missing_fields: missing,
    changed: true
  };
}

function missingOf(ctx) {
  return findMissingFields(ctx.requirements || {});
}

module.exports = { runAgent, shouldClarify, buildReply, detectShopIntent };
