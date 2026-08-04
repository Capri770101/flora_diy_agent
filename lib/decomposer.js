// 需求拆分：规则引擎（默认）+ LLM（可插拔）
const llm = require('./llm/client');

const OCCASION_KW = {
  生日: '生日', 母亲节: '母亲节', 母亲: '母亲节', 妈: '母亲节', 老妈: '母亲节',
  婚礼: '婚礼', 结婚: '婚礼', 婚庆: '婚礼',
  探病: '探病', 住院: '探病', 看病: '探病',
  乔迁: '乔迁', 新房: '乔迁', 新家: '乔迁', 搬家: '乔迁',
  纪念: '纪念日', 周年: '纪念日', 纪念: '纪念日',
  表白: '表白', 告白: '表白', 求婚: '表白',
  装饰: '家居装饰', 家居: '家居装饰', 房间: '家居装饰', 客厅: '家居装饰', 卧室: '家居装饰', 布置: '家居装饰'
};
const RECIPIENT_KW = {
  妈: '母亲', 母亲: '母亲', 老妈: '母亲',
  女朋友: '恋人', 女友: '恋人', 老婆: '恋人', 爱人: '恋人',
  男朋友: '恋人', 男友: '恋人', 老公: '恋人',
  朋友: '朋友', 闺蜜: '朋友', 兄弟: '朋友',
  自己: '自己', 我: '自己',
  同事: '同事', 领导: '同事', 老板: '同事',
  老师: '老师', 教授: '老师',
  奶奶: '长辈', 爷爷: '长辈', 外公: '长辈', 外婆: '长辈', 长辈: '长辈'
};
const STYLE_KW = {
  温柔: '温柔', 淡雅: '温柔', 优雅: '高级', 高级: '高级', 轻奢: '高级', ins: '高级', 莫兰迪: '高级',
  浪漫: '浪漫', 少女: '浪漫',
  热烈: '热烈', 热情: '热烈', 喜庆: '热烈',
  复古: '复古', 怀旧: '复古', 文艺: '复古',
  极简: '极简', 简约: '极简', 性冷淡: '极简',
  田园: '田园', 森系: '田园', 自然: '田园',
  清新: '清新', 小清新: '清新', 清爽: '清新'
};
const CATEGORY_KW = { 花束: '花束', 束: '花束', 瓶花: '瓶花', 花瓶: '瓶花', 花盒: '花盒', 礼盒: '花盒', 手捧: '花束', 胸花: '花束' };
const PLACEMENT_KW = {
  茶几: '客厅茶几', 客厅: '客厅', 卧室: '卧室', 床头: '床头', 床: '床头',
  办公桌: '办公桌', 办公室: '办公桌', 工位: '办公桌',
  餐桌: '餐桌', 饭桌: '餐桌', 窗台: '窗台', 玄关: '玄关', 携带: '送礼携带', 送人: '送礼携带', 带走: '送礼携带'
};

function detect(text, map) {
  const keys = Object.keys(map).sort((a, b) => b.length - a.length); // 优先长词
  for (const k of keys) if (text.includes(k)) return map[k];
  return null;
}

function detectMulti(text, map) {
  const out = [];
  for (const k of Object.keys(map)) if (text.includes(k)) out.push(map[k]);
  return [...new Set(out)];
}

function detectColors(text) {
  const palette = ['紫', '蓝', '粉', '红', '白', '黄', '橙', '绿', '金', '香槟'];
  const out = [];
  for (const c of palette) if (text.includes(c)) out.push(c);
  if (text.includes('莫兰迪')) out.push('粉', '白', '绿');
  if (text.includes('暖')) out.push('橙', '黄');
  return [...new Set(out)];
}

function detectBudget(text) {
  const m = text.match(/(?:预算|大概|约|大约|控制在)?\s*(\d{2,4})\s*(?:元|块|块钱|rmb|￥|人民币)?/i);
  if (m) return parseInt(m[1], 10);
  if (/一百/.test(text)) return 100;
  if (/两百/.test(text)) return 200;
  return null;
}

function detectForbidden(text, flowers) {
  const out = [];
  // 过敏
  let avoidAllergen = false;
  if (/(过敏|花粉|哮喘)/.test(text)) avoidAllergen = true;
  // “不要/别用/忌/不用 + 花名”
  const neg = /(不要|别用|忌|不用|避开|别放|少放)\s*([\u4e00-\u9fa5]{1,4})/g;
  let mm;
  while ((mm = neg.exec(text)) !== null) {
    const word = mm[2];
    const hit = flowers.find((f) => f.name.includes(word) || word.includes(f.name));
    if (hit && !out.includes(hit.id)) out.push(hit.id);
  }
  return { forbidden: out, avoidAllergen };
}

function detectPreferred(text, flowers) {
  const out = [];
  const pos = /(喜欢|想要|要用|用点|加些|要)\s*([\u4e00-\u9fa5]{1,4})/g;
  let mm;
  while ((mm = pos.exec(text)) !== null) {
    // 避免把"不要 X"误判为偏好（"要"前是"不"则跳过）
    if (mm.index > 0 && text[mm.index - 1] === '不') continue;
    const word = mm[2];
    const hit = flowers.find((f) => f.name.includes(word) || word.includes(f.name));
    if (hit && !out.includes(hit.id)) out.push(hit.id);
  }
  return out;
}

function ruleDecompose(text) {
  const flowers = require('./flowerKB').all();
  const occasion = detect(text, OCCASION_KW);
  const recipient = detect(text, RECIPIENT_KW);
  const style = detectMulti(text, STYLE_KW);
  const color_tone = detectColors(text);
  const category = detect(text, CATEGORY_KW);
  const placement = detect(text, PLACEMENT_KW);
  const budget = detectBudget(text);
  const { forbidden, avoidAllergen } = detectForbidden(text, flowers);
  const preferred = detectPreferred(text, flowers);

  const intent = occasion || (category ? '家居装饰' : '其他');
  let size = '中型';
  if (category === '花盒' || placement === '客厅茶几') size = '大型';
  if (placement === '办公桌' || placement === '窗台') size = '小型';

  return {
    intent,
    recipient: recipient || null,
    occasion: occasion || null,
    style: style.length ? style : [],
    color_tone: color_tone.length ? color_tone : [],
    budget,
    category: category || null,
    size,
    forbidden,
    preferred,
    placement: placement || null,
    avoid_allergen: avoidAllergen,
    extras: []
  };
}

// 把 LLM 输出的花材中文名/别名归一化为 flower_id（LLM 常输出中文名）
function normalizeFlowerRefs(arr, flowers) {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((v) => {
      const s = String(v);
      const hit = flowers.find((f) => f.id === s || f.name === s || f.name.includes(s) || s.includes(f.name));
      return hit ? hit.id : s;
    })
    .filter(Boolean);
}

// 对外：先用 LLM（若有），否则规则引擎
async function decompose(text) {
  const llmRes = await llm.extractRequirements(text);
  if (llmRes && typeof llmRes === 'object') {
    const flowers = require('./flowerKB').all();
    // 兜底字段
    return Object.assign(ruleDecompose(text), llmRes, {
      style: llmRes.style || [],
      color_tone: llmRes.color_tone || [],
      forbidden: normalizeFlowerRefs(llmRes.forbidden, flowers),
      preferred: normalizeFlowerRefs(llmRes.preferred, flowers),
      extras: llmRes.extras || []
    });
  }
  return ruleDecompose(text);
}

module.exports = { decompose, ruleDecompose };
