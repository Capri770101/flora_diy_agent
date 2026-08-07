// 智能体唯一入口（重设计：需求确认门禁 + 现有/DIY 分支 + 出图询问 + 独立选店）
// 契约（零副作用，由调用方负责持久化）：
//   runAgent({ text, session, location, config })
//     → { session_id, session, reply, plan, plan_version,
//         shop_suggestions, shop_choice, need_clarify, missing_fields,
//         changed, card }
//   card: { kind: 'clarify'|'confirm'|'branch'|'image_ask'|'shop_select'|null, data }
// config: { skip_image?: boolean, shop_limit?: number, shop_context?: object, onReplyChunk? }
//
// 状态机（phase 存于 session）：
//   gathering ──关键需求未齐──▶ 澄清(不出方案)
//   gathering ──关键需求齐──▶ confirm(发确认卡片，不出方案)
//   confirm ──用户确认──▶ branch(问 现有/DIY)
//   branch ──现有──▶ 商家预设方案(含效果图) ──▶ shop_select
//   branch ──DIY──▶ 现算方案(不出图) ──▶ diy_img(问是否出图) ──▶ shop_select
//   shop_select ──选店──▶ done
// 关键需求(KEY_FIELDS)：场合 / 对象 / 品类 / 预算 —— 未齐禁止制定方案。
const decomposer = require('../decomposer');
const { composePlan } = require('../planner');
const { generate } = require('../imageGen');
const { buildSummary } = require('../imagePrompt');
const sessionStore = require('./sessionStore');
const { findMissingFields, askClarification, CRITICAL_FIELDS } = require('./clarify');
const { matchShops } = require('./shopMatcher');
const { detectShopIntent } = require('./shopIntent');
const { buildInsights } = require('./insights');
const { chatReplyFor, chatReplyStreamFor } = require('./chat');
const { smartReplyFor, smartReplyStreamFor } = require('./takeover');
const MERCHANT = require('./merchantPlans');
const flowerKB = require('../flowerKB');

// 纯打招呼/寒暄（无任何需求信息）→ 不触发需求流程
const RE_PURE_GREETING = /^(你?好+|您好+|hi+|hello|hey|嗨|哈喽|在吗|在不在|早上好|中午好|下午好|晚上好|谢谢|感谢|辛苦)[!！~～。，,.?？\s]*$/i;

// 关键需求：未齐 → 禁止制定方案
const KEY_FIELDS = ['occasion', 'recipient', 'category', 'budget'];
function keyRequirementsMet(req) {
  if (!req) return false;
  return KEY_FIELDS.every((f) => req[f] != null && req[f] !== '' && req[f] !== 0);
}

// 拆解结果是否完全没提取到任何需求（闲聊、语气词等）
function isEmptyFresh(fresh) {
  if (!fresh) return true;
  if (fresh.intent && fresh.intent !== '其他') return false;
  if (fresh.recipient || fresh.occasion || fresh.category || fresh.size || fresh.placement) return false;
  if (fresh.budget != null) return false;
  if (fresh.month != null) return false;
  if (fresh.avoid_allergen) return false;
  if (Array.isArray(fresh.quantity_spec) && fresh.quantity_spec.length) return false;
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

// 信息太少（关键字段缺）且用户没表达任何花材偏好 → 自然反问，不出方案
function shouldClarify(requirements, missing) {
  if (requirements.quantity_spec && requirements.quantity_spec.length) return false;
  const criticalMissing = missing.filter((f) => CRITICAL_FIELDS.includes(f));
  if (criticalMissing.length < 2) return false;
  if (requirements.preferred && requirements.preferred.length) return false;
  return true;
}

// ── 意图识别（新增）──
function detectConfirmIntent(text) {
  const t = (text || '').trim();
  if (/^(不|别|不用|暂?时|等等|再|改|修|换|调整|不对)/i.test(t)) return false;
  return /^(确认|可以|行|好(的)?|没问题|就按|按这个|生成吧|出方案吧|确定|同意|ok|okay|yes|可以呀)/i.test(t);
}
function detectBranchIntent(text) {
  const t = (text || '').trim();
  if (/diy|自己(做|设计|来|搭|弄|diy)|手工|定制|自己?做|我自己/i.test(t)) return 'diy';
  if (/现有|商家|现成|套餐|模板|直接(用|给|选)|方案库|成品/i.test(t)) return 'existing';
  return null;
}
function detectImageIntent(text) {
  const t = (text || '').trim();
  if (/^(不|别|不用|不要|算了|暂?时|跳过|免了|不用了)/i.test(t)) return false;
  if (/^(要|生成|出|给|行|可以|好的?|ok|yes|需?要|来一张)/i.test(t)) return true;
  return null;
}

function fmtShopLine(i, s) {
  const miss = s.missing && s.missing.length ? `（缺 ${s.missing.map((m) => m.name).join('、')}，可替换）` : '';
  return `第${i + 1}家「${s.name}」${s.distance_km != null ? s.distance_km + 'km' : '附近'}、评分 ${s.rating}、约 ¥${s.price_total}${miss}`;
}

function summarizeRequirements(req) {
  const rows = [];
  if (req.occasion) rows.push('场合：' + req.occasion);
  if (req.recipient) rows.push('对象：' + req.recipient);
  if (req.category) rows.push('品类：' + req.category);
  if (req.budget != null) rows.push('预算：¥' + req.budget);
  if (req.style && req.style.length) rows.push('风格：' + req.style.join('、'));
  if (req.color_tone && req.color_tone.length) rows.push('色系：' + req.color_tone.join('、'));
  if (req.quantity_spec && req.quantity_spec.length) {
    const names = req.quantity_spec.map((q) => {
      const f = flowerKB.byId(q.flower_id);
      return (f ? f.name : q.flower_id) + '×' + q.qty;
    });
    rows.push('花材：' + names.join('、'));
  }
  if (req.placement) rows.push('摆放：' + req.placement);
  return rows.length ? rows.join('\n') : '（尚无需求信息）';
}

// ④ 领域洞察
function buildDomainInsights(req, location, firstShopDistrict) {
  return buildInsights({ requirements: req, location, firstShopDistrict });
}

// ⑤ 回执文案
function buildReply(ctx) {
  return require('./reply').buildReply(ctx);
}

// 选店回合：锁定门店 or 翻看更多店
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

// 收尾：模板生成回复 → LLM 可用则接管（润色 / 盲区智能应答）→ 记录 assistant 轮次
async function finalizeReply(ctx, role, partial, cfg, scenario) {
  const stream = cfg && cfg.onReplyChunk ? cfg.onReplyChunk : null;
  const chatCtx = { requirements: ctx.requirements, plan: partial.plan || null, shops: partial.shop_suggestions || [], transcript: ctx.transcript };
  let reply;
  if (scenario) {
    reply = stream
      ? await smartReplyStreamFor({ scenario, ctx: chatCtx, templateReply: partial.reply, onChunk: stream })
      : await smartReplyFor({ scenario, ctx: chatCtx, templateReply: partial.reply });
  } else if (stream) {
    reply = await chatReplyStreamFor({ role, ctx: chatCtx, templateReply: partial.reply, onChunk: stream });
  } else {
    reply = await chatReplyFor({ role, ctx: chatCtx, templateReply: partial.reply });
  }
  sessionStore.pushTurn(ctx, 'assistant', reply);
  return { ...partial, reply };
}

// ── 各阶段卡片发送 ──
function clarifyReply(ctx, requirements, missing, cfg) {
  return finalizeReply(ctx, 'clarify', {
    session_id: ctx.session_id, session: ctx,
    reply: `好的～为了给您设计合适的花束，还想确认：${askClarification(missing)}`,
    plan: null, plan_version: ctx.history ? ctx.history.length : 0,
    shop_suggestions: [], shop_choice: ctx.shop_choice || null,
    need_clarify: true, missing_fields: missing, changed: false,
    card: { kind: 'clarify', data: { missing } }
  }, cfg, 'clarify');
}

function sendConfirmCard(ctx, req, cfg, prefix, changed) {
  const summary = summarizeRequirements(req);
  const reply = `${prefix}\n${summary}\n确认无误请回复「确认」，或补充修改需求。`;
  ctx.phase = 'confirm';
  return finalizeReply(ctx, 'confirm', {
    session_id: ctx.session_id, session: ctx, reply,
    plan: null, plan_version: ctx.history ? ctx.history.length : 0,
    shop_suggestions: [], shop_choice: ctx.shop_choice || null,
    need_clarify: false, missing_fields: findMissingFields(req), changed: !!changed,
    card: { kind: 'confirm', data: { requirements: req } }
  }, cfg, 'confirm');
}

function sendBranchCard(ctx, cfg, prefix) {
  const reply = `${prefix || '在生成方案前，想先确认一下：'}\n您希望直接选用商家提供的现有方案（含成品效果图），还是自己 DIY 设计？回复「现有方案」或「DIY」即可。`;
  ctx.phase = 'branch';
  return finalizeReply(ctx, 'confirm', {
    session_id: ctx.session_id, session: ctx, reply,
    plan: null, plan_version: ctx.history ? ctx.history.length : 0,
    shop_suggestions: [], shop_choice: ctx.shop_choice || null,
    need_clarify: false, missing_fields: [], changed: false,
    card: { kind: 'branch', data: {} }
  }, cfg, 'confirm');
}

function sendImageAskCard(ctx, cfg, prefix) {
  const reply = prefix || '要不要我再生成一张效果图给您参考？回复「要」或「不用」。';
  ctx.phase = 'diy_img';
  return finalizeReply(ctx, 'plan', {
    session_id: ctx.session_id, session: ctx, reply,
    plan: ctx.latest_plan, plan_version: ctx.history ? ctx.history.length : 0,
    shop_suggestions: [], shop_choice: ctx.shop_choice || null,
    need_clarify: false, missing_fields: [], changed: false,
    card: { kind: 'image_ask', data: {} }
  }, cfg);
}

async function sendDiyPlan(ctx, location, cfg) {
  const plan = composePlan(ctx.requirements);
  plan.summary = buildSummary(plan, ctx.requirements);
  plan.render_url = null; plan.render_type = null; plan.render_local = null;
  const plan_version = sessionStore.pushPlan(ctx, { requirements: ctx.requirements, plan });
  plan.version = plan_version;
  ctx.latest_plan = plan;
  ctx.plan_mode = 'diy';
  return sendImageAskCard(ctx, cfg, `已为您生成 DIY 方案：${plan.summary} 总价约 ¥${plan.total}。要不要我再生成一张效果图给您参考？回复「要」或「不用」。`);
}

async function sendExistingPlan(ctx, location, cfg) {
  const mp = MERCHANT.pickMerchantPlan(ctx.requirements);
  if (!mp) return sendDiyPlan(ctx, location, cfg); // 无匹配现有方案 → 退回 DIY
  const plan = MERCHANT.normalizeMerchantPlan(mp, ctx.requirements);
  const plan_version = sessionStore.pushPlan(ctx, { requirements: ctx.requirements, plan });
  plan.version = plan_version;
  ctx.latest_plan = plan;
  ctx.plan_mode = 'existing';
  return enterShopSelect(ctx, location, cfg);
}

async function enterShopSelect(ctx, location, cfg) {
  const plan = ctx.latest_plan;
  const shops = matchShops(plan, { location, limit: cfg.shop_limit || 3 });
  ctx.last_shops = shops;
  ctx.phase = 'shop_select';
  const reply = `已准备好方案${plan.mode === 'existing' ? '（商家现有方案）' : ''}。以下是可选的附近花店，点选一家即可锁定下单：\n` + shops.map((s, i) => fmtShopLine(i, s)).join('\n');
  return finalizeReply(ctx, 'shop', {
    session_id: ctx.session_id, session: ctx, reply,
    plan, plan_version: plan.version,
    shop_suggestions: shops, shop_choice: ctx.shop_choice || null,
    need_clarify: false, missing_fields: [], changed: false,
    card: { kind: 'shop_select', data: { shops } }
  }, cfg);
}

function keepPlanReply(ctx, cfg) {
  const plan = ctx.latest_plan;
  const shops = ctx.last_shops || [];
  const shopText = shops.length ? `\n\n附近花店还在，回复「选第二家」或「看看其他店」继续选店。` : '';
  const reply = `好的，收到。当前方案保持不变：${plan.summary} 总价约 ¥${plan.total}${shopText}`;
  return finalizeReply(ctx, 'plan', {
    session_id: ctx.session_id, session: ctx, reply,
    plan, plan_version: ctx.history ? ctx.history.length : 0,
    shop_suggestions: shops, shop_choice: ctx.shop_choice || null,
    need_clarify: false, missing_fields: [], changed: false,
    card: shops.length ? { kind: 'shop_select', data: { shops } } : null
  }, cfg, 'confirm');
}

async function runAgent({ text, session, location, config }) {
  const cfg = config || {};
  const ctx = session || sessionStore.createSession();
  if (!ctx.phase) ctx.phase = 'gathering';
  const lastPlan = sessionStore.latestPlan(ctx);
  sessionStore.pushTurn(ctx, 'user', text);

  // ── 寒暄回合：不拆解、不出方案（仅初始 gathering 且无方案时）──
  if (RE_PURE_GREETING.test((text || '').trim()) && ctx.phase === 'gathering' && !lastPlan) {
    return await finalizeReply(ctx, 'greet', {
      session_id: ctx.session_id, session: ctx,
      reply: chitChatReply(true), plan: null, plan_version: ctx.history ? ctx.history.length : 0,
      shop_suggestions: [], shop_choice: ctx.shop_choice || null,
      need_clarify: false, missing_fields: [], changed: false
    }, cfg);
  }

  // ── 选店阶段（独立卡片）：shop_select 或 done 后仍在点店 ──
  if (ctx.phase === 'shop_select' || (ctx.phase === 'done' && ctx.last_shops && ctx.last_shops.length)) {
    const intent = detectShopIntent(text, ctx.last_shops || []);
    if (intent.type) {
      const out = handleShopIntent(intent, ctx, lastPlan, location, cfg);
      if (intent.type === 'select') ctx.phase = 'done';
      return await finalizeReply(ctx, 'shop', {
        session_id: ctx.session_id, session: ctx, reply: out.reply,
        plan: out.plan, plan_version: out.version, shop_suggestions: out.shops,
        shop_choice: ctx.shop_choice || null, need_clarify: out.need_clarify,
        missing_fields: missingOf(ctx), changed: false,
        card: { kind: 'shop_select', data: { shops: out.shops } }
      }, cfg);
    }
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
  const changed = !sessionStore.isSame(prevReq, requirements);

  // ── 闲聊兜底：拆解不到任何需求且没有历史方案 → LLM 接管判断意图并诚实回答 ──
  if (isEmptyFresh(fresh) && !lastPlan && ctx.phase === 'gathering') {
    return await finalizeReply(ctx, 'greet', {
      session_id: ctx.session_id, session: ctx,
      reply: chitChatReply(false), plan: null, plan_version: ctx.history ? ctx.history.length : 0,
      shop_suggestions: [], shop_choice: ctx.shop_choice || null,
      need_clarify: false, missing_fields: missing, changed: false
    }, cfg, 'chitchat');
  }

  // ── CONFIRM 阶段 ──
  if (ctx.phase === 'confirm') {
    if (detectConfirmIntent(text)) {
      ctx.phase = 'branch';
      return sendBranchCard(ctx, cfg);
    }
    if (changed) {
      if (keyRequirementsMet(requirements)) return sendConfirmCard(ctx, requirements, cfg, '需求已更新，请再确认：', true);
      return clarifyReply(ctx, requirements, missing, cfg);
    }
    return sendConfirmCard(ctx, requirements, cfg, '请确认以上需求，确认后我为您设计方案：', false);
  }

  // ── BRANCH 阶段 ──
  if (ctx.phase === 'branch') {
    const choice = detectBranchIntent(text);
    if (choice === 'existing') return await sendExistingPlan(ctx, location, cfg);
    if (choice === 'diy') return await sendDiyPlan(ctx, location, cfg);
    return sendBranchCard(ctx, cfg, '您想选用商家现有方案，还是自己 DIY 呢？回复「现有方案」或「DIY」。');
  }

  // ── DIY_IMG 阶段 ──
  if (ctx.phase === 'diy_img') {
    const want = detectImageIntent(text);
    if (want === null) return sendImageAskCard(ctx, cfg, '要不要我再生成一张效果图给您参考？回复「要」或「不用」。');
    if (want && !cfg.skip_image) {
      const plan = ctx.latest_plan;
      const img = await generate(plan, ctx.requirements);
      plan.render_url = img.url;
      plan.render_type = img.type;
      plan.image_prompt = img.prompt;
      plan.negative_prompt = img.negative_prompt;
      plan.render_local = img.local || null;
    }
    return await enterShopSelect(ctx, location, cfg);
  }

  // ── 默认 / gathering（含 done 后的再编辑）──
  if (lastPlan && !changed && keyRequirementsMet(requirements)) {
    return keepPlanReply(ctx, cfg);
  }
  // 用户已明确指定花材+数量 → 直接现算真实方案，跳过开放设计的确认门禁（M17 现算路径）
  if (requirements.quantity_spec && requirements.quantity_spec.length) {
    return await sendDiyPlan(ctx, location, cfg);
  }
  if (!keyRequirementsMet(requirements)) {
    return clarifyReply(ctx, requirements, missing, cfg);
  }
  // 关键需求齐全 → 确认卡片（不直接出方案）
  ctx.phase = 'confirm';
  return sendConfirmCard(ctx, requirements, cfg, '需求已收集，请确认：', changed);
}

function missingOf(ctx) {
  return findMissingFields(ctx.requirements || {});
}

module.exports = { runAgent, shouldClarify, buildReply, detectShopIntent, detectConfirmIntent, detectBranchIntent, detectImageIntent, keyRequirementsMet, KEY_FIELDS };
