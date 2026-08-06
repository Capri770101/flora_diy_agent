// 洞察插件 · 市场潮流（F 域）
// 接口：{ id, slot, priority, enabled(cfg), collect(ctx) → 对象片段 }
// ctx = { requirements, location, firstShopDistrict, month, dataLayer, flowerKB }
// collect 返回的字段会并入最终 insights 对象（键名唯一即安全）。
const dataLayer = require('../../dataLayer');
const flowerKB = require('../../flowerKB');

function currentMonth() {
  return new Date().getMonth() + 1;
}

function collect(ctx) {
  const req = ctx.requirements;
  const month = req.month || ctx.month || currentMonth();
  const trendRows = dataLayer.trendsAll()
    .filter((t) => t.month === month)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  const trends = trendRows.map((t) => {
    const f = flowerKB.byId(t.flower_id);
    return { month: t.month, flower_id: t.flower_id, name: f ? f.name : t.flower_id, score: t.score };
  });
  return trends.length ? { trends } : {};
}

module.exports = {
  id: 'trends',
  slot: 'insight',
  priority: 100,
  enabled: () => true,
  collect
};