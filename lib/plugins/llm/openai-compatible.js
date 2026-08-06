// LLM 适配器 · openai-compatible（OpenAI 兼容 chat/completions，如 DeepSeek/通义/混元）
// 槽位方法：
//   extract(text) → 结构化需求对象 | null（失败抛错由调用方兜底）
//   chat({ system, history, temperature?, max_tokens? }) → 文本回复（失败抛错由调用方兜底）
// 健壮性：所有外部 fetch 强制超时（DEFAULT_TIMEOUT_MS），超时/网络错立即抛错，
//          由调用方 try/catch 降级到规则引擎，绝不无限挂起拖死出方案流程。
const config = require('../../config');

const EXTRACT_SCHEMA = `请从用户需求中抽取以下字段并以 JSON 返回，缺失且非必要则置 null 或空数组：
{
  "intent": "生日送礼|家居装饰|纪念|节日|其他",
  "recipient": "母亲|恋人|朋友|自己|同事|长辈|老师|null",
  "occasion": "生日|母亲节|婚礼|探病|乔迁|纪念日|表白|家居装饰|null",
  "style": ["温柔","浪漫","热烈","复古","极简","田园","高级","清新"],
  "color_tone": ["紫","蓝","粉","红","白","黄","橙","绿","香槟"],
  "budget": number|null,
  "category": "花束|瓶花|花盒|null",
  "size": "小型|中型|大型|null",
  "forbidden": ["flower_id..."],
  "preferred": ["flower_id..."],
  "placement": "客厅茶几|卧室|办公桌|餐桌|窗台|玄关|送礼携带|null",
  "avoid_allergen": boolean,
  "extras": []
}
仅输出 JSON，不要解释。`;

const DEFAULT_TIMEOUT_MS = 20000;

async function extract(text) {
  const base = config.get('LLM_BASE_URL').replace(/\/+$/, '');
  const key = config.get('LLM_API_KEY');
  const model = config.get('LLM_MODEL');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT_MS);
  let resp;
  try {
    resp = await fetch(base + '/chat/completions', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: EXTRACT_SCHEMA },
          { role: 'user', content: text }
        ],
        temperature: 0.2,
        response_format: { type: 'json_object' }
      })
    });
  } catch (e) {
    clearTimeout(timer);
    // 区分超时与网络错误，便于日志诊断，但不泄露 key
    const reason = e.name === 'AbortError' ? `超时(${DEFAULT_TIMEOUT_MS}ms)` : '网络不可达';
    throw new Error(`LLM 请求${reason}`);
  }
  clearTimeout(timer);
  if (!resp.ok) throw new Error('LLM http ' + resp.status);
  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content;
  return JSON.parse(content);
}

// 上下文对话：根据 system 指令 + 历史消息（含结构化方案数据）生成自然语言回复
async function chat({ system, history, temperature = 0.7, max_tokens = 800 }) {
  const base = config.get('LLM_BASE_URL').replace(/\/+$/, '');
  const key = config.get('LLM_API_KEY');
  const model = config.get('LLM_MODEL');
  const messages = [
    { role: 'system', content: system },
    ...(Array.isArray(history) ? history : [])
  ];
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT_MS);
  let resp;
  try {
    resp = await fetch(base + '/chat/completions', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens,
        stream: false
      })
    });
  } catch (e) {
    clearTimeout(timer);
    const reason = e.name === 'AbortError' ? `超时(${DEFAULT_TIMEOUT_MS}ms)` : '网络不可达';
    throw new Error(`LLM 请求${reason}`);
  }
  clearTimeout(timer);
  if (!resp.ok) throw new Error('LLM http ' + resp.status);
  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('LLM 空回复');
  return content;
}

module.exports = {
  id: 'openai-compatible',
  slot: 'llm',
  priority: 100,
  enabled: (cfg) => cfg.enabled('llm'),
  extract,
  chat
};
