// 回执文案 · 默认模板版（槽位 'reply'）
// 接口：{ id, slot, priority, enabled(cfg), buildReply(ctx) }
// ctx = { plan, version, diffText, shops, insights } → 返回回复文本
// 备注：寒暄/选店回合的短文案在 agent/index.js 内（与状态机耦合），此处只负责"方案回执"。
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

  // 领域洞察小贴士（insights 已由 insight 插件编排器产出）
  if (insights && (insights.trends.length || insights.region || insights.knowledge.length)) {
    const lines = [];
    if (insights.trends.length) lines.push('当下流行：' + insights.trends.map((t) => `${t.name}（${t.month}月）`).join('、'));
    if (insights.region) lines.push(`您所在的${insights.region.district}偏好${insights.region.popular_styles.join('/')}风格，客单价指数约${insights.region.price_index}`);
    if (insights.knowledge.length) lines.push('懂行知识：' + insights.knowledge.map((k) => k.title).join('、'));
    reply += '\n\n💡 ' + lines.join('；') + '。';
  }
  return reply;
}

module.exports = {
  id: 'template',
  slot: 'reply',
  priority: 0,
  enabled: () => true,
  buildReply
};