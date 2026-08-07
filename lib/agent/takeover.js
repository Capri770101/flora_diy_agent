// LLM 智能接管层：规则盲区场景（闲聊兜底 / 澄清 / 无变化确认）的兜底对话。
// 原则：
//  - 规则引擎仍负责方案事实（花材/价格/店铺），本层不产出任何结构化数据；
//  - LLM 读取「完整对话历史 + 当前规则状态」，自主判断用户意图并自然、诚实地回答；
//  - 判断不准或请求超出平台能力 → 明说能力边界并引导回花艺主题，禁止编造、禁止模板腔；
//  - LLM 不可用 / 超时 / 失败 → 原样返回 templateReply（零侵入回退）。
const { chatReply, chatStreamReply } = require('../llm/client');
const { formatRequirements, formatPlan, formatShops } = require('./chat');

const SYSTEM = {
  chitchat: `你是花卉 DIY 平台的花艺顾问。系统未能从用户这条消息中识别出明确的花艺需求，请基于完整对话历史自行判断并自然回应：
1. 用户在闲聊寒暄 → 亲切回应，顺势引导说出：送给谁、什么场合、预算、喜欢的风格或花材。
2. 用户其实在表达花艺需求，只是说得模糊或用了非常规说法 → 顺着他的话自然追问具体化（对象/场合/预算/风格/花材），一次最多问 2 个。
3. 用户的请求与花艺无关或超出平台能力（例如其他领域的问题、无法实现的复杂要求）→ 坦诚说明你只擅长花艺定制、暂时帮不上这块，并引导回花艺话题。不要假装能办，不要编造任何信息。
禁止使用"为了给您设计合适的花束还需要些信息"这类套话。回复控制在 80 字内。`,

  clarify: `你是花卉 DIY 平台的花艺顾问。系统判定用户提供的信息还不足以下单，需要补充询问。
请基于完整对话历史与下方"当前已确认需求"：
1. 只追问仍然缺失的关键信息（预算/对象/场合/风格等），用户已说过的绝不再重复问；一次最多问 2 个。
2. 提问要口语化、贴合上下文，像真人导购，不要逐字念字段名。
3. 若用户意图明显超出平台能力，坦诚说明边界并引导。不要编造需求或方案。
回复控制在 80 字内。`,

  confirm: `你是花卉 DIY 平台的花艺顾问。系统判定用户这条消息没有带来可识别的新需求。请基于完整对话历史与下方"当前方案事实"判断：
1. 用户确实只是确认、满意或闲聊 → 自然回应，简要确认当前方案状态，顺势引导下一步（调整花材/预算/风格，或选店下单）。
2. 用户其实在表达调整意愿（换包装、改颜色、大小、花材等自定义说法）→ 接住它：复述你的理解，追问关键调整细节，说明能做到的部分；不要假装已经修改。
3. 用户请求超出能力 → 坦诚说明并引导。
不要使用"当前方案保持不变"这类固定话术。回复控制在 100 字内。`
};

function buildFacts(ctx) {
  return [
    '========== 当前已确认需求 ==========',
    formatRequirements(ctx.requirements),
    '========== 当前方案事实 ==========',
    formatPlan(ctx.plan),
    '========== 候选花店 ==========',
    formatShops(ctx.shops)
  ].join('\n');
}

function buildHistory(ctx) {
  const history = ctx.transcript || [];
  return history
    .filter((t) => t && t.role && t.content)
    .slice(-8)
    .map((t) => ({ role: t.role === 'assistant' ? 'assistant' : 'user', content: t.content }));
}

async function smartReplyFor({ scenario, ctx, templateReply }) {
  const system = SYSTEM[scenario] + '\n\n' + buildFacts(ctx) + '\n========== 请基于以上事实与对话回复用户 ==========';
  const out = await chatReply({ system, history: buildHistory(ctx), temperature: 0.8, max_tokens: 300 });
  return out || templateReply;
}

async function smartReplyStreamFor({ scenario, ctx, templateReply, onChunk }) {
  const system = SYSTEM[scenario] + '\n\n' + buildFacts(ctx) + '\n========== 请基于以上事实与对话回复用户 ==========';
  const out = await chatStreamReply({ system, history: buildHistory(ctx), temperature: 0.8, max_tokens: 300, onChunk });
  return out || templateReply;
}

module.exports = { smartReplyFor, smartReplyStreamFor };
