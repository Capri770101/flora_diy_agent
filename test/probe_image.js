// 探针：实测真文生图（dashscope）是否能在当前环境跑通（带硬超时保护）
const fs = require('fs');
const path = require('path');
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
const { generate } = require('../lib/imageGen');
const { composePlan } = require('../lib/planner');

(async () => {
  console.log('image provider:', require('../lib/config').get('image.provider'));
  const hardTimeout = setTimeout(() => { console.log('!! 文生图硬超时 90s，强制退出（说明网络挂起/轮询卡死）'); process.exit(0); }, 90000);
  const start = Date.now();
  const req = { category: '花束', occasion: '生日', recipient: '母亲', style: ['温柔', '浪漫'], color_tone: ['粉'], budget: 150, forbidden: [], preferred: ['rose'], size: '中型', placement: '送礼携带' };
  try {
    const plan = composePlan(req);
    console.log('方案合成 OK，花材:', plan.items.map((i) => i.flower_id).join(','));
    const img = await generate(plan, req);
    console.log('文生图耗时:', ((Date.now() - start) / 1000).toFixed(1) + 's');
    console.log('图片结果:', JSON.stringify({ type: img.type, provider: img.provider, url_head: (img.url || '').slice(0, 70), local: img.local }));
  } catch (e) {
    console.log('文生图失败:', e.message);
  }
  clearTimeout(hardTimeout);
  process.exit(0);
})();
