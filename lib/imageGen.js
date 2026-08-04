// 效果图生成：通义万象（DashScope）优先，其他兼容接口次之；未配置时回退到 SVG 风格预览
const preview = require('./preview');
const { buildImagePrompt, buildImagePromptZh } = require('./imagePrompt');

const DASHSCOPE_CREATE = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis';
const DASHSCOPE_TASK = 'https://dashscope.aliyuncs.com/api/v1/tasks/';
const DASHSCOPE_MODEL = process.env.IMAGE_MODEL || 'wanx2.1-t2i-turbo';
const POLL_INTERVAL = 3000;
const POLL_TIMEOUT = 120000;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// 通义万象：异步任务 + 轮询结果
async function callDashScope(prompt, size) {
  const key = process.env.IMAGE_API_KEY;
  const create = await fetch(DASHSCOPE_CREATE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + key,
      'X-DashScope-Async': 'enable'
    },
    body: JSON.stringify({
      model: DASHSCOPE_MODEL,
      input: { prompt },
      parameters: { size, n: 1 }
    })
  });
  if (!create.ok) {
    const body = await create.text();
    throw new Error('dashscope create http ' + create.status + ': ' + body.slice(0, 300));
  }
  const task = (await create.json()).output.task_id;
  if (!task) throw new Error('dashscope: no task_id in response');

  const deadline = Date.now() + POLL_TIMEOUT;
  for (;;) {
    await sleep(POLL_INTERVAL);
    const poll = await fetch(DASHSCOPE_TASK + task, {
      headers: { Authorization: 'Bearer ' + key }
    });
    if (!poll.ok) throw new Error('dashscope poll http ' + poll.status);
    const data = await poll.json();
    const out = data.output || {};
    const status = out.task_status;
    if (status === 'SUCCEEDED') {
      const url = out.results && out.results[0] && out.results[0].url;
      if (!url) throw new Error('dashscope: succeeded but no url');
      return { type: 'real_image', url, task_id: task, provider: 'dashscope' };
    }
    if (status === 'FAILED' || status === 'CANCELED') {
      throw new Error('dashscope task ' + status + ': ' + JSON.stringify(out).slice(0, 300));
    }
    if (Date.now() > deadline) throw new Error('dashscope poll timeout');
  }
}

// 通用兼容接口（OpenAI 兼容 / 各厂差异请按需改写）
async function callGenericAPI(prompt) {
  const api = process.env.IMAGE_API;
  const key = process.env.IMAGE_API_KEY;
  const resp = await fetch(api, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({ prompt, size: '1024x1024', n: 1 })
  });
  if (!resp.ok) throw new Error('image api http ' + resp.status);
  const data = await resp.json();
  const url = data.url || (data.data && data.data[0] && data.data[0].url);
  if (!url) throw new Error('no url in image api response');
  return { type: 'real_image', url, prompt, provider: 'configured' };
}

async function generate(plan, req) {
  const provider = (process.env.IMAGE_API || '').toLowerCase();
  const isDashScope = !process.env.IMAGE_API || provider === 'dashscope';
  const prompt = isDashScope ? buildImagePromptZh(plan, req) : buildImagePrompt(plan, req);
  const size = isDashScope ? '1024*1024' : '1024x1024';

  if (process.env.IMAGE_API_KEY && isDashScope) {
    try {
      const res = await callDashScope(prompt, size);
      return { ...res, prompt };
    } catch (e) {
      console.warn('[imageGen] dashscope failed, fallback to SVG:', e.message);
    }
  }
  if (process.env.IMAGE_API && process.env.IMAGE_API_KEY && !isDashScope) {
    try {
      return await callGenericAPI(prompt);
    } catch (e) {
      console.warn('[imageGen] real API failed, fallback to SVG:', e.message);
    }
  }
  const file = preview.save(plan, req);
  return {
    type: 'stylized_preview',
    url: `/preview/${plan.plan_id}.svg`,
    local: file,
    prompt,
    provider: 'svg-mock'
  };
}

module.exports = { generate, buildImagePrompt };
