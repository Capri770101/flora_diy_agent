// 探针：实测真 LLM 是否能在当前环境跑通（带硬超时保护，绝不卡死）
const fs = require('fs');
const path = require('path');
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
const config = require('../lib/config');
const { extractRequirements } = require('../lib/llm/client');

(async () => {
  console.log('当前配置:', JSON.stringify(config.all()));
  const hardTimeout = setTimeout(() => { console.log('!! 探针硬超时 25s，强制退出（说明网络挂起）'); process.exit(0); }, 25000);
  const start = Date.now();
  try {
    const r = await extractRequirements('生日送妈妈的粉色花束，预算150，温柔浪漫风格');
    console.log('LLM 调用耗时:', ((Date.now() - start) / 1000).toFixed(1) + 's');
    console.log('LLM 返回:', JSON.stringify(r).slice(0, 400));
  } catch (e) {
    console.log('LLM 调用失败:', e.message);
  }
  clearTimeout(hardTimeout);
  process.exit(0);
})();
