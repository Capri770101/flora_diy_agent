// 文生图适配器 · svg（结构化风格预览兜底，零依赖、无网络）
// 槽位方法：generate(plan, req) → { type, url, local, prompt, negative_prompt, provider }
const preview = require('../../preview');
const { buildImagePromptZh, buildNegativePrompt } = require('../../imagePrompt');

function generate(plan, req) {
  const prompt = buildImagePromptZh(plan, req);
  const negative_prompt = buildNegativePrompt(plan);
  const file = preview.save(plan, req);
  return {
    type: 'stylized_preview',
    url: `/preview/${plan.plan_id}.svg`,
    local: file,
    prompt,
    negative_prompt,
    provider: 'svg-mock'
  };
}

module.exports = {
  id: 'svg',
  slot: 'image',
  priority: 0,
  enabled: () => true, // 永远可用的最后兜底
  generate
};