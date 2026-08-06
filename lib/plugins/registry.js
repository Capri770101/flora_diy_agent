// 可插拔插件注册表：能力槽位（slot）挂载适配器（adapter），按优先级解析当前生效的实现
// 槽位：llm（需求理解）、image（文生图）、data（数据源，预留）
// 适配器接口：
//   { id: string, slot: string, priority: number, enabled(config): boolean,
//     ... 槽位特定方法（如 llm.extract, image.generate）}
// 用法：
//   const plugins = require('./plugins/registry')
//   plugins.register(llmAdapter)
//   const llm = plugins.resolve('llm')  // 返回当前启用的适配器或 null
//   const all = plugins.list('llm')     // 按优先级降序的所有已注册适配器
const registry = new Map(); // slot -> adapter[]

function register(adapter) {
  if (!adapter || typeof adapter !== 'object' || typeof adapter.id !== 'string') {
    throw new Error('plugin: 适配器必须包含字符串 id');
  }
  if (!adapter.slot || !adapter.enabled) {
    throw new Error(`plugin ${adapter.id}: 必须包含 slot 与 enabled(config)`);
  }
  const list = registry.get(adapter.slot) || [];
  if (list.some((a) => a.id === adapter.id)) return list; // 幂等注册
  list.push(adapter);
  list.sort((a, b) => (b.priority || 0) - (a.priority || 0));
  registry.set(adapter.slot, list);
  return list;
}

function resolve(slot, config) {
  const list = registry.get(slot) || [];
  return list.find((a) => a.enabled(config)) || null;
}

// 解析该槽位下全部启用的适配器（用于"多实现叠加"型能力，如领域洞察插件）。
// 返回按优先级降序的数组；调用方负责合并结果。
function resolveAll(slot, config) {
  const list = registry.get(slot) || [];
  return list.filter((a) => a.enabled(config));
}

function list(slot) {
  return registry.get(slot) || [];
}

function slots() {
  return [...registry.keys()];
}

module.exports = { register, resolve, resolveAll, list, slots, registry };
