// 会话记忆：需求字段的增量合并 + 方案版本历史
// 语义约定：
//  - 标量字段（预算/场合/品类…）：新值覆盖旧值
//  - 数组字段（风格/色系/偏好）：并集累积
//  - 禁忌（forbidden）：只增不减（一旦说过"不要玫瑰"就永远排除）
const { uid } = require('../util');
const flowerKB = require('../flowerKB');

const SCALAR_FIELDS = ['intent', 'recipient', 'occasion', 'budget', 'category', 'size', 'placement'];
const ARRAY_FIELDS = ['style', 'color_tone', 'forbidden', 'preferred', 'extras'];

function createSession() {
  return { session_id: uid('ses'), requirements: null, history: [], transcript: [], created_at: new Date().toISOString() };
}

// 追加一条对话记录（user/assistant），保留最近 MAX_TRANSCRIPT 条（控制 token 成本）
const MAX_TRANSCRIPT = 12;
function pushTurn(session, role, content) {
  if (!session.transcript) session.transcript = [];
  session.transcript.push({ role, content: String(content || '') });
  if (session.transcript.length > MAX_TRANSCRIPT) {
    session.transcript = session.transcript.slice(session.transcript.length - MAX_TRANSCRIPT);
  }
}

// 最近 N 条对话（供 LLM 上下文）；不含最新轮用户输入（由调用方追加）
function recentTranscript(session, n = 8) {
  if (!session.transcript) return [];
  return session.transcript.slice(-n);
}

// 把新拆解出的需求合并进会话累积需求
function mergeRequirements(prev, next) {
  if (!next) return prev ? { ...prev } : null;
  if (!prev) return { ...next };
  const out = { ...prev };
  for (const k of SCALAR_FIELDS) {
    if (k === 'intent') continue; // intent 是派生字段，最后统一重算
    const v = next[k];
    if (v != null && v !== '' && v !== 0) out[k] = v;
  }
  // intent 由合并后的 occasion/category 推导：occasion 未变化时保持旧值，避免追问句把"生日"覆盖成"其他"
  if (next.intent && next.intent !== '其他') {
    out.intent = next.intent;
  } else if (!out.occasion && out.category) {
    out.intent = out.intent && out.intent !== '其他' ? out.intent : '家居装饰';
  } else if (out.occasion) {
    out.intent = out.occasion;
  }
  for (const k of ARRAY_FIELDS) {
    const merged = [...new Set([...(prev[k] || []), ...(next[k] || [])])];
    if (merged.length) out[k] = merged;
  }
  if (next.avoid_allergen) out.avoid_allergen = true;
  if (next.month != null) out.month = next.month;
  if (next.price_map) out.price_map = next.price_map;
  if (next.cost_map) out.cost_map = next.cost_map;
  if (next.margin_rate != null) out.margin_rate = next.margin_rate;
  if (next.pack_cost != null) out.pack_cost = next.pack_cost;
  // 自定义花材（花材+数量组合）：整表替换（用户自己点的组合直接覆盖，不叠加合并）
  if (Array.isArray(next.quantity_spec) && next.quantity_spec.length) {
    out.quantity_spec = next.quantity_spec;
  }
  return out;
}

// 记录一个方案版本，返回版本号（1 起）
function pushPlan(session, { requirements, plan }) {
  session.history = session.history || [];
  const version = session.history.length + 1;
  session.history.push({
    version,
    requirements: JSON.parse(JSON.stringify(requirements)),
    plan_id: plan.plan_id,
    category: plan.category,
    total: plan.total,
    budget: plan.budget,
    summary: plan.summary,
    created_at: plan.created_at
  });
  return version;
}

function flowerName(id) {
  const f = flowerKB.byId(id);
  return f ? f.name : id;
}

// 上一版 vs 当前需求的变更摘要（用于第 n 版回复里说明"改了哪里"）
function diffVersions(session) {
  if (!session.history || session.history.length < 2) return [];
  const prev = session.history[session.history.length - 2].requirements;
  const curr = session.history[session.history.length - 1].requirements;
  const parts = [];
  const labels = {
    intent: '用途', recipient: '对象', occasion: '场合', budget: '预算',
    category: '品类', size: '尺寸', placement: '摆放位置',
    style: '风格', color_tone: '色系', forbidden: '禁忌', preferred: '偏好'
  };
  for (const k of SCALAR_FIELDS) {
    const a = prev[k], b = curr[k];
    if (a != null && b != null && String(a) !== String(b)) {
      parts.push(`${labels[k] || k}：${a} → ${b}`);
    }
  }
  for (const k of ['forbidden', 'preferred']) {
    const added = (curr[k] || []).filter((x) => !(prev[k] || []).includes(x));
    if (added.length) parts.push(`新增${labels[k]}：${added.map(flowerName).join('、')}`);
  }
  for (const k of ['style', 'color_tone']) {
    const added = (curr[k] || []).filter((x) => !(prev[k] || []).includes(x));
    if (added.length) parts.push(`新增${labels[k]}：${added.join('、')}`);
  }
  return parts;
}

// 判断一轮新输入是否对累积需求产生了实质变化（忽略门店上下文等瞬态字段）
function isSame(prev, next) {
  if (!prev || !next) return false;
  const keys = [...SCALAR_FIELDS, ...ARRAY_FIELDS, 'avoid_allergen', 'quantity_spec'];
  for (const k of keys) {
    if (JSON.stringify(prev[k] || null) !== JSON.stringify(next[k] || null)) return false;
  }
  return true;
}

// 取会话最新一版方案（无副作用）
function latestPlan(session) {
  return session && session.latest_plan ? session.latest_plan : null;
}

module.exports = { createSession, mergeRequirements, pushPlan, diffVersions, isSame, latestPlan, pushTurn, recentTranscript, SCALAR_FIELDS, ARRAY_FIELDS };
