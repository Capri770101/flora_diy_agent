// 文生图能力门面：经插件注册表解析启用的 image adapter，多级回退
// 优先级由 adapter.priority 决定；全部失败最后落 SVG 兜底。
// 新增提供方：在 lib/plugins/image/ 新建适配器并注册即可，无需改动此处。
const config = require('./config');
const registry = require('./plugins/registry');
const svgAdapter = require('./plugins/image/svg');

registry.register(svgAdapter);
registry.register(require('./plugins/image/generic'));
registry.register(require('./plugins/image/dashscope'));

// 返回 { type, url, local, prompt, negative_prompt, provider }；任何真实图失败回退 SVG
async function generate(plan, req) {
  const adapter = registry.resolve('image', config);
  if (!adapter) {
    return svgAdapter.generate(plan, req);
  }
  try {
    return await adapter.generate(plan, req);
  } catch (e) {
    console.warn(`[imageGen] ${adapter.id} failed, fallback to SVG:`, e && e.message);
    return svgAdapter.generate(plan, req);
  }
}

module.exports = { generate, buildImagePrompt: require('./imagePrompt').buildImagePrompt };