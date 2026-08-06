// 澄清反问 · 默认规则版（槽位 'clarify'）
// 接口：{ id, slot, priority, enabled(cfg), CRITICAL_FIELDS, findMissingFields(req), askClarification(missing) }
const CRITICAL_FIELDS = ['budget', 'category', 'occasion'];

const QUESTIONS = {
  budget: '您大概的预算是多少呢？（例如：150 元左右）',
  category: '您想要哪种形式？花束 / 瓶花 / 花盒，都可以定制',
  occasion: '这束花是准备在什么场合用呢？（生日、母亲节、婚礼、探病、乔迁……）',
  style: '您希望是哪种风格？温柔、浪漫、热烈、极简、复古、田园都可以',
  recipient: '这束花是送给谁的呢？（母亲、恋人、朋友、同事……）'
};

// 返回缺失的关键字段列表（按优先级排序）
function findMissingFields(req) {
  const missing = [];
  if (req.budget == null) missing.push('budget');
  if (!req.category) missing.push('category');
  if (!req.occasion) missing.push('occasion');
  if (!req.style || !req.style.length) missing.push('style');
  if (!req.recipient) missing.push('recipient');
  return missing;
}

// 只取最关键的一个缺失字段，返回反问话术
function askClarification(missing) {
  const top = missing[0];
  return QUESTIONS[top] || '能再多描述一下您的需求吗？';
}

module.exports = {
  id: 'rule',
  slot: 'clarify',
  priority: 0,
  enabled: () => true,
  CRITICAL_FIELDS,
  findMissingFields,
  askClarification
};