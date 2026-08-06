// 领域洞察编排器：把全部已启用的 insight 插件（槽位 'insight'）的 collect() 结果叠加成单一对象
// 默认内置三个插件（trends / region / knowledge，见 lib/plugins/insight/）；
// 新洞察能力 = 新建插件 + register，无需改动智能体主流程。
const registry = require('../plugins/registry');
const config = require('../config');

// 内置洞察插件
registry.register(require('../plugins/insight/trends'));
registry.register(require('../plugins/insight/region'));
registry.register(require('../plugins/insight/knowledge'));

const BASE = { trends: [], region: null, knowledge: [] };

// ctx 必含 { requirements }，可选 { location, firstShopDistrict, month }
function buildInsights(ctx) {
  const insights = { ...BASE, trends: [], knowledge: [] };
  const plugins = registry.resolveAll('insight', config);
  for (const p of plugins) {
    let part = {};
    try {
      part = p.collect(ctx) || {};
    } catch (e) {
      console.warn(`[insight] plugin ${p.id} collect failed:`, e && e.message);
      continue;
    }
    if (typeof part !== 'object') continue;
    // 各插件返回的字段并集；保留未知键以便未来插件自由扩展
    for (const [k, v] of Object.entries(part)) {
      if (k === 'trends' || k === 'knowledge') insights[k] = [...insights[k], ...(Array.isArray(v) ? v : [])];
      else insights[k] = v;
    }
  }
  return insights;
}

module.exports = { buildInsights };