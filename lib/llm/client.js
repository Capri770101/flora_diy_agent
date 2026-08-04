// 可插拔 LLM 客户端（OpenAI 兼容接口）
// 仅当配置了 LLM_API_KEY + LLM_BASE_URL 时启用真实大模型，否则返回 null（走规则引擎）。
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

async function callLLM(text) {
  const base = process.env.LLM_BASE_URL;
  const key = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL || 'default';
  const resp = await fetch(base + '/chat/completions', {
    method: 'POST',
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
  if (!resp.ok) throw new Error('LLM http ' + resp.status);
  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content;
  return JSON.parse(content);
}

// 对外：返回结构化需求或 null
async function extractRequirements(text) {
  if (process.env.LLM_API_KEY && process.env.LLM_BASE_URL) {
    try {
      return await callLLM(text);
    } catch (e) {
      console.warn('[llm] extract failed, fallback to rule:', e.message);
      return null;
    }
  }
  return null;
}

module.exports = { extractRequirements };
