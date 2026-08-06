// 洞察插件 · 知识教育（J 域）
// 按 occasion/recipient/intent 关键词匹配知识库，最多 3 条。
// collect(): 返回 { knowledge } 或 {}。
const dataLayer = require('../../dataLayer');

const MAX = 3;

function collect(ctx) {
  const req = ctx.requirements;
  const kw = [req.occasion, req.recipient, req.intent].filter(Boolean);
  if (!kw.length) return {};
  const all = dataLayer.knowledgeAll();
  const hit = [];
  for (const k of all) {
    const hay = (k.title + ' ' + k.body + ' ' + (k.tags_json || '')).toLowerCase();
    if (kw.some((w) => hay.includes(String(w).toLowerCase()))) {
      hit.push({ knowledge_id: k.knowledge_id, title: k.title, category: k.category });
    }
    if (hit.length >= MAX) break;
  }
  return hit.length ? { knowledge: hit } : {};
}

module.exports = {
  id: 'knowledge',
  slot: 'insight',
  priority: 80,
  enabled: () => true,
  collect
};