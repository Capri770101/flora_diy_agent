// LLM 能力门面：经插件注册表解析启用的 LLM 适配器
// 未配置任何 LLM（无 key/base）→ 返回 null，调用方走规则引擎回退。
// 新增提供方：在 lib/plugins/llm/ 新建适配器并注册即可，无需改动此处。
const config = require('../config');
const registry = require('../plugins/registry');

registry.register(require('../plugins/llm/openai-compatible'));

// 对外：返回结构化需求或 null（适配器不可用 / 调用失败 → null，规则引擎兜底）
async function extractRequirements(text) {
  const adapter = registry.resolve('llm', config);
  if (!adapter) return null;
  try {
    return await adapter.extract(text);
  } catch (e) {
    console.warn('[llm] extract failed, fallback to rule:', e && e.message);
    return null;
  }
}

// 对外：生成自然语言对话回复或 null（不可用 / 失败 → null，模板兜底）
async function chatReply({ system, history, temperature, max_tokens }) {
  const adapter = registry.resolve('llm', config);
  if (!adapter || typeof adapter.chat !== 'function') return null;
  try {
    const out = await adapter.chat({ system, history, temperature, max_tokens });
    return typeof out === 'string' && out.trim() ? out.trim() : null;
  } catch (e) {
    console.warn('[llm] chat failed, fallback to template:', e && e.message);
    return null;
  }
}

module.exports = { extractRequirements, chatReply };