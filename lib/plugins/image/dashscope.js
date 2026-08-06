// 文生图适配器 · dashscope（通义万象 DashScope 异步任务 + 轮询）
// 槽位方法：generate(plan, req) → { type, url, task_id, prompt, negative_prompt, provider }
const config = require('../../config');
const { buildImagePromptZh, buildNegativePrompt } = require('../../imagePrompt');

const DASHSCOPE_CREATE = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis';
const DASHSCOPE_TASK = 'https://dashscope.aliyuncs.com/api/v1/tasks/';
const POLL_INTERVAL = 3000;
const POLL_TIMEOUT = 120000;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function callCreate(key, prompt, size, negativePrompt) {
  const input = { prompt };
  if (negativePrompt) input.negative_prompt = negativePrompt;
  const create = await fetch(DASHSCOPE_CREATE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + key,
      'X-DashScope-Async': 'enable'
    },
    body: JSON.stringify({ model: config.get('IMAGE_MODEL'), input, parameters: { size, n: 1 } })
  });
  if (!create.ok) {
    const body = await create.text();
    throw new Error('dashscope create http ' + create.status + ': ' + body.slice(0, 300));
  }
  return (await create.json()).output.task_id;
}

async function poll(key, task) {
  const deadline = Date.now() + POLL_TIMEOUT;
  for (;;) {
    await sleep(POLL_INTERVAL);
    const poll = await fetch(DASHSCOPE_TASK + task, { headers: { Authorization: 'Bearer ' + key } });
    if (!poll.ok) throw new Error('dashscope poll http ' + poll.status);
    const out = (await poll.json()).output || {};
    const status = out.task_status;
    if (status === 'SUCCEEDED') {
      const url = out.results && out.results[0] && out.results[0].url;
      if (!url) throw new Error('dashscope: succeeded but no url');
      return url;
    }
    if (status === 'FAILED' || status === 'CANCELED') {
      throw new Error('dashscope task ' + status + ': ' + JSON.stringify(out).slice(0, 300));
    }
    if (Date.now() > deadline) throw new Error('dashscope poll timeout');
  }
}

async function generate(plan, req) {
  const key = config.get('IMAGE_API_KEY');
  const prompt = buildImagePromptZh(plan, req);
  const negative_prompt = buildNegativePrompt(plan);
  const task = await callCreate(key, prompt, '1024*1024', negative_prompt);
  const url = await poll(key, task);
  return { type: 'real_image', url, task_id: task, prompt, negative_prompt, provider: 'dashscope' };
}

module.exports = {
  id: 'dashscope',
  slot: 'image',
  priority: 200,
  enabled: (cfg) => cfg.get('image.provider') === 'dashscope',
  generate
};