// 需求拆分：规则引擎（默认）+ LLM（可插拔）
const llm = require('./llm/client');

const OCCASION_KW = {
  生日: '生日', 母亲节: '母亲节', 母亲: '母亲节', 妈: '母亲节', 老妈: '母亲节',
  婚礼: '婚礼', 结婚: '婚礼', 婚庆: '婚礼',
  探病: '探病', 住院: '探病', 看病: '探病',
  乔迁: '乔迁', 新房: '乔迁', 新家: '乔迁', 搬家: '乔迁',
  纪念: '纪念日', 周年: '纪念日', 纪念日: '纪念日',
  表白: '表白', 告白: '表白', 求婚: '表白', 七夕: '表白', 情人节: '表白',
  装饰: '家居装饰', 家居: '家居装饰', 房间: '家居装饰', 客厅: '家居装饰', 卧室: '家居装饰', 布置: '家居装饰'
};
const RECIPIENT_KW = {
  妈: '母亲', 母亲: '母亲', 老妈: '母亲', 妈妈: '母亲',
  姐姐: '家人', 妹妹: '家人', 哥哥: '家人', 弟弟: '家人', 爸爸: '家人', 老爸: '家人', 父亲: '家人', 女儿: '家人', 儿子: '家人',
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
  // “花粉”里的粉不是粉色，先剔除再扫色系
  const cleaned = text.replace(/花粉/g, '花');
  const palette = ['紫', '蓝', '粉', '红', '白', '黄', '橙', '绿', '金', '香槟'];
  const out = [];
  for (const c of palette) if (cleaned.includes(c)) out.push(c);
  if (cleaned.includes('莫兰迪')) out.push('粉', '白', '绿');
  if (cleaned.includes('暖')) out.push('橙', '黄');
  return [...new Set(out)];
}

// 中文数字 → 阿拉伯数字（支持到千位，如 十三=13、一百零一=101、两三百≈300）
function cn2num(s) {
  const digits = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const units = { 十: 10, 百: 100, 千: 1000 };
  let total = 0, cur = 0;
  for (const ch of s) {
    if (digits[ch] != null) cur = digits[ch];
    else if (units[ch] != null) { total += (cur || 1) * units[ch]; cur = 0; }
    else return null;
  }
  total += cur;
  return total || null;
}

function detectBudget(text) {
  // 必须有预算类关键词或货币单位，避免把“11朵”里的 11 误判为预算。
  // 覆盖自然语言：预算改到500 / 预算调到500 / 预算改成500 / 预算500 / 500预算 /
  // 不超过300 / 最多200 / 上限500 / 大概200元 / 价位150。
  const patterns = [
    /(?:预算|价位|想花|花费|花销)\s*(?:改|调|变|加|升|涨|提高|调整|设置|设|定|控制)?\s*(?:到|为|成|至|在|是)?\s*(\d{2,4})\s*(?:元|块|块钱|rmb|￥|人民币)?/i,
    /(\d{2,4})\s*(?:元|块|块钱|rmb|￥|人民币)?\s*预算/i,
    /(?:不超过|至多|最多|上限|控制在)\s*(?:为|是|约)?\s*(\d{2,4})\s*(?:元|块|块钱|rmb|￥|人民币)?/i,
    /(?:大概|大约|约|差不多|左右)\s*(?:是|为|花)?\s*(\d{2,4})\s*(?:元|块|块钱|rmb|￥|人民币)?/i
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return parseInt(m[1], 10);
  }
  // 一位数字+百：如“5百”“8百”
  const bm = text.match(/(?:预算|加到|提高到|控制在|不超过|最多|至多|大概|大约|约|想花|价位)\s*(?:到|以内|之内)?\s*(\d)\s*百\s*(?:以内|左右|块|元)?/i);
  if (bm) return parseInt(bm[1], 10) * 100;
  // 中文数字：必须带预算语境（前缀词，或后缀 以内/左右/元/块），且不是花材数量
  const cnPre = text.match(/(?:预算|加到|提高到|控制在|不超过|最多|至多|大概|大约|约|想花|价位)\s*(?:到|以内|之内|上下)?\s*([零一二两三四五六七八九十百千]+)/);
  const cnPost = text.match(/([零一二两三四五六七八九十百千]+)\s*(?:以内|左右|上下|块钱?|块|元|rmb)/);
  const cnRaw = cnPre && cnPre[1] ? cnPre[1] : (cnPost && cnPost[1] ? cnPost[1] : null);
  if (cnRaw) {
    const n = cn2num(cnRaw);
    if (n != null) return n;
  }
  return null;
}

function detectForbidden(text, flowers) {
  const out = [];
  // 过敏
  let avoidAllergen = false;
  if (/(过敏|花粉|哮喘)/.test(text)) avoidAllergen = true;
  // “不要/别用/忌/不用/不想要/不喜欢 + 花名（可能多个）”
  const neg = /(?:不要|别用|忌|不用|避开|别放|少放|不放|不想要|不喜欢|不爱|讨厌|去掉)\s*(?:的)?\s*([\u4e00-\u9fa5]{1,8})/g;
  let mm;
  while ((mm = neg.exec(text)) !== null) {
    for (const f of flowers) {
      if (mm[1].includes(f.name) && !out.includes(f.id)) out.push(f.id);
    }
  }
  return { forbidden: out, avoidAllergen };
}

// 花名匹配：支持"小雏菊"被说成"雏菊"这类省略
function flowerMentioned(text, f) {
  if (text.includes(f.name)) return true;
  if (f.name.length > 2 && text.includes(f.name.slice(1))) return true; // 去首字（小/大）后仍 ≥2 字
  return false;
}

function detectPreferred(text, flowers) {
  const out = [];
  // 句中有正向偏好词才扫描；避免"不要 X"被误判
  if (!/(喜欢|偏爱|想要|要用|用点|加些|一定要|加上|再加|要些|要点|要)/.test(text)) return out;
  for (const f of flowers) {
    if (!flowerMentioned(text, f)) continue;
    const full = text.indexOf(f.name);
    const idx = full >= 0 ? full : text.indexOf(f.name.slice(1)); // 用去首字后的最小子串定位
    const before = text.slice(Math.max(0, idx - 4), idx);
    if (/(不要|别用|不用|忌|别放|少放|不放)/.test(before)) continue;
    if (!out.includes(f.id)) out.push(f.id);
  }
  return out;
}

// 解析自然语言中的「数量 + 花名」：如 "11朵红玫瑰和1朵满天星" → [{rose,11},{babybreath,1}]
// 支持 数字+单位+花名 / 花名+数字+单位 两种语序；单位(朵/支/扎…)仅作提示，计价以花材自身 unit 为准。
function flowerByText(t, flowers) {
  const hit = flowers.find((f) => t.includes(f.name));
  if (hit) return hit;
  const byAlias = flowers.find((f) => f.name.length > 2 && t.includes(f.name.slice(1)));
  return byAlias || null;
}

function extractQuantities(text, flowers) {
  const out = [];
  const seen = new Set();
  const units = '朵|支|枝|根|扎|把|束|个';
  const reA = new RegExp('(\\d+)\\s*(' + units + ')?\\s*([\\u4e00-\\u9fa5]{1,4})', 'g');
  let m;
  while ((m = reA.exec(text)) !== null) {
    const f = flowerByText(m[3], flowers);
    if (f && !seen.has(f.id)) { seen.add(f.id); out.push({ flower_id: f.id, qty: parseInt(m[1], 10), unit: m[2] || null }); }
  }
  const reB = new RegExp('([\\u4e00-\\u9fa5]{1,4})\\s*(\\d+)\\s*(' + units + ')?', 'g');
  while ((m = reB.exec(text)) !== null) {
    const f = flowerByText(m[1], flowers);
    if (f && !seen.has(f.id)) { seen.add(f.id); out.push({ flower_id: f.id, qty: parseInt(m[2], 10), unit: m[3] || null }); }
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
  const quantity_spec = extractQuantities(text, flowers);

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
    quantity_spec,
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

// 对外：规则引擎为基底（关键词提取结果可信且稳定），LLM 只负责补缺
//  - 标量字段：规则已提取则规则优先，防止 LLM 返回稀疏/空值冲掉准确结果
//  - 数组字段：并集（禁忌/偏好并集永不丢约束）
async function decompose(text) {
  const base = ruleDecompose(text);
  const llmRes = await llm.extractRequirements(text);
  if (!llmRes || typeof llmRes !== 'object') return base;
  const flowers = require('./flowerKB').all();
  const merged = { ...base };
  for (const k of ['intent', 'recipient', 'occasion', 'category', 'size', 'placement']) {
    if (merged[k] == null && llmRes[k] != null && llmRes[k] !== '') merged[k] = llmRes[k];
  }
  if (llmRes.avoid_allergen) merged.avoid_allergen = true;
  for (const k of ['style', 'color_tone', 'forbidden', 'preferred', 'extras']) {
    const arr = Array.isArray(llmRes[k]) ? llmRes[k] : [];
    if (!arr.length) continue;
    const normalized = k === 'forbidden' || k === 'preferred' ? normalizeFlowerRefs(arr, flowers) : arr;
    merged[k] = [...new Set([...(merged[k] || []), ...normalized])];
  }
  // 数量规格：规则引擎已提取则规则优先，LLM 仅补缺未出现的花材
  if (Array.isArray(llmRes.quantity_spec) && llmRes.quantity_spec.length) {
    const have = new Set((merged.quantity_spec || []).map((x) => x.flower_id));
    for (const q of llmRes.quantity_spec) {
      if (q && q.flower_id && !have.has(q.flower_id) && q.qty) {
        have.add(q.flower_id);
        merged.quantity_spec.push({ flower_id: q.flower_id, qty: Number(q.qty), unit: q.unit || null });
      }
    }
  }
  // 预算：规则引擎权威（关键词驱动），LLM 仅作兜底且须通过合理性校验，
  // 防止把“11朵”误读为 budget=11（LLM 常把数量数字当预算）。
  if (base.budget != null) {
    merged.budget = base.budget;
  } else if (llmRes && llmRes.budget != null) {
    const b = Number(llmRes.budget);
    const qtys = (merged.quantity_spec || []).map((q) => Number(q.qty));
    if (Number.isFinite(b) && b >= 20 && !qtys.includes(b)) merged.budget = b;
    // 否则丢弃：疑似把数量数字当预算，宁缺毋滥
  }
  return merged;
}

module.exports = { decompose, ruleDecompose };
