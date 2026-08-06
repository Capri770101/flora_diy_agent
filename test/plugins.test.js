// 插件注册表自测：验证可插拔机制本身（注册 / 解析 / 优先级 / 覆盖）
// 运行：node test/plugins.test.js
const assert = require('node:assert/strict');
const registry = require('../lib/plugins/registry');
const config = require('../lib/config');
// 触发 llm / image 槽位的内置适配器注册（对应 facede 模块的加载副作用）
require('../lib/llm/client');
require('../lib/imageGen');

let pass = 0;
function check(cond, msg) {
  assert.ok(cond, msg);
  pass++;
}

(async () => {
  // 1) llm 槽位：无 key 时不解析出适配器（规则引擎兜底）
  check(registry.resolve('llm', config) === null, '无 LLM 配置时 llm 槽位不解析出适配器');

  // 2) image 槽位：无 key 时回退到 svg（永远 enabled 的兜底）
  const img = registry.resolve('image', config);
  check(img && img.id === 'svg', '无 IMAGE_API_KEY 时解析到 svg 兜底');

  // 3) data 槽位：默认 sqlite-json
  const data = registry.resolve('data', config);
  check(data && data.id === 'sqlite-json', 'data 槽位默认 sqlite-json');

  // 4) 模拟自定义 adapter 注册并覆盖 data 槽位
  const customData = {
    id: 'mock-data',
    slot: 'data',
    priority: 100,
    enabled: () => true,
    shopsAll: () => [{ shop_id: 'mock_1', name: '模拟花店' }]
  };
  registry.register(customData);
  const resolved = registry.resolve('data', config);
  check(resolved.id === 'mock-data', '注册高优先级 adapter 后 data 槽位解析到自定义实现');
  const d2 = resolved.shopsAll();
  check(d2.length === 1 && d2[0].shop_id === 'mock_1', '自定义 adapter 的方法被调用');

  // 5) 优先级：列表按 priority 降序
  const list = registry.list('data');
  check(list[0].id === 'mock-data' && list[1].id === 'sqlite-json', 'data 槽位按优先级降序');

  // 6) 幂等注册：重复注册不产生重复条目
  registry.register(customData);
  check(registry.list('data').filter((a) => a.id === 'mock-data').length === 1, '重复注册幂等');

  // 7) 非法注册被拒
  let threw = false;
  try { registry.register({ slot: 'llm', enabled: () => true }); } catch (e) { threw = true; }
  check(threw, '缺少 id 的适配器注册被拒绝');

  console.log(`\n插件注册表自测：${pass} 通过`);
})();
