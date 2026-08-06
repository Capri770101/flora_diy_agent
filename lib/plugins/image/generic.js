// 文生图适配器 · generic（通用 OpenAI 兼容文生图接口，30s 超时防挂起）
// 槽位方法：generate(plan, req) → { type, url, prompt, provider }
const config = require('../../config');
const { buildImagePrompt, buildNegativePrompt } = require('../../imagePrompt');

async function generate(plan, req) {
  const api = config.get('IMAGE_API');
  const key = config.get('IMAGE_API_KEY');
  const prompt = buildImagePrompt(plan, req);
  const negative_prompt = buildNegativePrompt(plan);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000); // 30s 超时，避免第三方挂起卡死请求
  try {
    const resp = await fetch(api, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({ prompt, size: '1024x1024', n: 1 }),
      signal: ctrl.signal
    });
    if (!resp.ok) throw new Error('image api http ' + resp.status);
    const data = await resp.json();
    const url = data.url || (data.data && data.data[0] && data.data[0].url);
    if (!url) throw new Error('no url in image api response');
    return { type: 'real_image', url, prompt, negative_prompt, provider: 'configured' };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  id: 'generic',
  slot: 'image',
  priority: 200,
  enabled: (cfg) => cfg.get('image.provider') === 'generic',
  generate
};