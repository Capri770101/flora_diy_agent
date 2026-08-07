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

// 对外：流式对话回复。onChunk(delta) 逐段回调；返回完整文本或 null（失败回落模板）。
// 不可用 / 无流式能力 / 失败 → 返回 null 且不回调，由调用方一次性发送模板。
async function chatStreamReply({ system, history, temperature, max_tokens, onChunk }) {
  const adapter = registry.resolve('llm', config);
  if (!adapter || typeof adapter.chatStream !== 'function') return null;
  try {
    let full = '';
    const out = await adapter.chatStream({
      system, history, temperature, max_tokens,
      onChunk: (d) => {
        if (typeof d !== 'string' || !d) return;
        full += d;
        if (typeof onChunk === 'function') onChunk(d);
      }
    });
    return typeof out === 'string' && out.trim() ? out.trim() : (full.trim() ? full.trim() : null);
  } catch (e) {
    console.warn('[llm] chatStream failed, fallback to template:', e && e.message);
    return null;
  }
}

module.exports = { extractRequirements, chatReply, chatStreamReply };