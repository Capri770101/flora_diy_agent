// 领域洞察插件化测试（零依赖，node:assert）
// 验证：① 内置三插件默认生效 ② 新插件可叠加 ③ 插件抛错不影响整体 ④ 移除自定义插件可恢复默认
// 运行：node test/insights.test.js | node test/insights.test.js --seed
const assert = require('node:assert/strict');
const registry = require('../lib/plugins/registry');
const { buildInsights } = require('../lib/agent/insights');

let pass = 0;
function check(cond, msg) { assert.ok(cond, msg); pass++; }

const CTX = {
  requirements: { occasion: '生日', recipient: '母亲', intent: '生日送礼', month: 8 },
  location: { lat: 22.5431, lng: 114.0579 },
  firstShopDistrict: '福田区'
};

// ① 内置三插件按优先级注册在 insight 槽位
{
  const ids = registry.list('insight').map((a) => a.id);
  check(ids.includes('trends') && ids.includes('region') && ids.includes('knowledge'), '内置三插件已注册');
  const sorted = registry.list('insight').every((a, i, arr) => i === 0 || arr[i - 1].priority >= a.priority);
  check(sorted, 'insight 槽位按优先级降序');
}

// ② 默认编排产生三大域结果
{
  const ins = buildInsights(CTX);
  check(Array.isArray(ins.trends), 'insights.trends 为数组');
  check('region' in ins, 'insights.region 键存在');
  check('knowledge' in ins, 'insights.knowledge 键存在');
  check(ins.trends.length <= 3, '潮流最多 3 条');
  if (ins.trends.length) check(ins.trends[0].score >= ins.trends[ins.trends.length - 1].score, '潮流按分数降序');
}

// ③ 新增自定义插件可叠加（不覆盖已有键）
{
  const custom = {
    id: 'custom-advice',
    slot: 'insight',
    priority: 50,
    enabled: () => true,
    collect: () => ({ advice: '建议搭配满天星' })
  };
  registry.register(custom);
  const ins = buildInsights(CTX);
  check(ins.advice === '建议搭配满天星', '自定义插件字段并入');
  check(Array.isArray(ins.trends), '叠加后原有 trends 保留');
}

// ④ 插件抛错不影响整体（故障隔离）
{
  const bad = {
    id: 'bomb',
    slot: 'insight',
    priority: 200,
    enabled: () => true,
    collect: () => { throw new Error('boom'); }
  };
  registry.register(bad);
  const ins = buildInsights(CTX);
  check(Array.isArray(ins.trends), '抛错插件被跳过，insights 仍有值');
  // 清理测试插件，避免污染后续用例
  const list = registry.list('insight');
  const bi = list.findIndex((a) => a.id === 'bomb');
  if (bi >= 0) list.splice(bi, 1);
  const ci = list.findIndex((a) => a.id === 'custom-advice');
  if (ci >= 0) list.splice(ci, 1);
}

// ⑤ 清理后默认恢复
{
  const ins = buildInsights(CTX);
  check(ins.advice === undefined, '移除自定义插件后字段不再出现');
  check(Array.isArray(ins.trends), '内置插件仍正常工作');
}

console.log(`\n领域洞察插件测试：${pass} 通过`);