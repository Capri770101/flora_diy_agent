// 上下文对话门面：LLM 负责自然回复，规则引擎负责方案结构。
// 输入：{ templateReply, role, ctx } 其中 ctx 含 requirements/plan/shops/insights/transcript 等
// 返回：LLM 可用且成功 → LLM 文本；否则原样返回 templateReply（零侵入回退）。
// 设计要点：
//  - 所有结构化事实（方案明细/店铺/预算）由规则引擎产出并注入 prompt，LLM 只做语言组织，
//    防止 LLM 编造价格、花材或店铺（方案数据仍以 plan/shop_suggestions 字段为准）。
//  - 会话历史（transcript）随请求附带，LLM 可基于多轮上下文自然应答。
const { chatReply } = require('../llm/client');
const flowerKB = require('../flowerKB');

const ROLE_SYSTEM = {
  plan: `你是花卉 DIY 平台的贴心花艺顾问，正在与用户多轮对话。
务必遵守：
1. 回复要自然、口语化、有温度，可以简短追问，但不要啰嗦重复。
2. 只可使用下方提供的"方案事实"，不得编造花材、价格、店铺、距离等信息。
3. 方案摘要/店铺信息必须与事实一致；引导用户进一步选店或调整需求。
4. 不要输出 markdown 标题或列表符号以外的多余格式，回复控制在 120 字内。`,
  clarify: `你是花卉 DIY 平台的花艺顾问，正在向用户补充询问需求。
务必遵守：
1. 基于会话历史，用户已经说过的信息不要再重复追问。
2. 只追问仍未确定的关键信息（预算/场合/对象/风格等），一次最多问 2 个。
3. 语气自然亲切，像真人导购，不要逐字念字段名。
4. 回复控制在 80 字内。`,
  greet: `你是花卉 DIY 平台的花艺顾问。用户在寒暄/闲聊。
务必遵守：
1. 亲切自然地回应，并顺势引导用户说出：送给谁、什么场合、预算多少、喜欢的风格。
2. 不要假设任何需求，不要出方案。回复控制在 60 字内。`,
  shop: `你是花卉 DIY 平台的贴心店员，正在帮用户选花店。
务必遵守：
1. 只使用下方提供的店铺事实，不得编造店名、价格、距离、评分。
2. 明确列出几家可选的店及其要点，引导用户回复"选第 N 家"或"看看其他店"。
3. 回复控制在 120 字内。`
};

function flowerNames(ids) {
  return (ids || []).map((id) => {
    const f = flowerKB.byId(id);
    return f ? f.name : id;
  }).join('、') || '无';
}

function formatRequirements(req) {
  if (!req) return '（尚无需求信息）';
  const rows = [];
  if (req.recipient) rows.push(`对象：${req.recipient}`);
  if (req.occasion) rows.push(`场合：${req.occasion}`);
  if (req.category) rows.push(`品类：${req.category}`);
  if (req.size) rows.push(`尺寸：${req.size}`);
  if (req.budget != null) rows.push(`预算：${req.budget} 元`);
  if (req.style && req.style.length) rows.push(`风格：${req.style.join('、')}`);
  if (req.color_tone && req.color_tone.length) rows.push(`色系：${req.color_tone.join('、')}`);
  if (req.placement) rows.push(`摆放：${req.placement}`);
  if (req.preferred && req.preferred.length) rows.push(`偏好花材：${flowerNames(req.preferred)}`);
  if (req.forbidden && req.forbidden.length) rows.push(`禁忌花材：${flowerNames(req.forbidden)}`);
  return rows.length ? rows.join('\n') : '（尚无需求信息）';
}

function formatPlan(plan) {
  if (!plan) return '（暂无方案）';
  const items = (plan.items || []).map((i) => `${i.name}×${i.qty}`).join('、');
  return [
    `方案摘要：${plan.summary || '（无）'}`,
    `花材：${items || '（无）'}`,
    `总价：约 ¥${plan.total}`,
    plan.budget != null ? `预算：¥${plan.budget}` : null
  ].filter(Boolean).join('\n');
}

function formatShops(shops) {
  if (!shops || !shops.length) return '（暂无候选花店）';
  return shops.map((s, i) => {
    const miss = s.missing && s.missing.length ? `（缺 ${s.missing.map((m) => m.name).join('、')}）` : '';
    return `第${i + 1}家 ${s.name}：${s.distance_km != null ? s.distance_km + 'km' : '附近'}，评分 ${s.rating}，约 ¥${s.price_total}${miss}`;
  }).join('\n');
}

function buildSystemPrompt(role, ctx) {
  const base = ROLE_SYSTEM[role] || ROLE_SYSTEM.greet;
  const facts = [
    '========== 当前需求 ==========',
    formatRequirements(ctx.requirements),
    '========== 当前方案 ==========',
    formatPlan(ctx.plan),
    '========== 候选花店 ==========',
    formatShops(ctx.shops)
  ];
  return base + '\n\n' + facts.join('\n') + '\n========== 请基于以上事实回复用户 ==========';
}

// 组装消息：system + 历史对话（去掉已有的事实冗余，保留纯对话轮次）
function buildMessages(ctx) {
  const history = ctx.transcript || [];
  return history
    .filter((t) => t && t.role && t.content)
    .slice(-8)
    .map((t) => ({ role: t.role === 'assistant' ? 'assistant' : 'user', content: t.content }));
}

// 对外：返回最终回复文本。LLM 不可用/超时/失败 → 原样返回 templateReply。
async function chatReplyFor({ role, ctx, templateReply }) {
  const system = buildSystemPrompt(role, ctx);
  const history = buildMessages(ctx);
  const out = await chatReply({ system, history, temperature: 0.8, max_tokens: 400 });
  return out || templateReply;
}

module.exports = { chatReplyFor, buildSystemPrompt, formatRequirements, formatPlan, formatShops };