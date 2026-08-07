// 极端自然语言理解测试：纯规则引擎（LLM 关闭）
process.env.FLORA_DATA_DIR = require('os').tmpdir() + '/flora-x-' + Date.now();
const { ruleDecompose, decompose } = require('../lib/decomposer');
require('../lib/db').init();
require('../lib/seed').runAll();

const CASES = [
  // 口语/省略/方言
  '给我妈整个生日花束呗，二百以内吧',
  '我妈过生日，整个花，别太贵',
  '送老婆，搞个浪漫点的，预算5百左右',
  '对象生日！花！快！',
  '想给女朋友惊喜，红的粉的都要点',
  // 模糊/无主句
  '随便来点好看的',
  '花，要好看的',
  '来一束',
  '就那啥吧',
  // 网络梗/流行语
  'yyds的那种花',
  '氛围感拉满的花花',
  '绝绝子，冲',
  '安利一束花',
  // 中英混杂
  'give me 11 roses and some babysbreath',
  'budget 200, pink roses for my gf',
  '来点 rose 和 lily',
  // 数字花招
  '11朵红玫瑰和1朵满天星',
  '红玫瑰来个88朵',
  '一百零一朵玫瑰',
  '十三支百合',
  // 否定/禁忌
  '不要玫瑰，满天星可以',
  '别用百合，我对花粉过敏',
  '不想要向日葵和菊花',
  // 矛盾
  '预算一百但是要花五百的效果',
  '我过敏但我要百合',
  // 超长/啰嗦
  '我姐姐下周二过生日她喜欢粉色和白色喜欢郁金香和玫瑰不喜欢康乃馨预算大概两三百块家里有个小茶几想放个瓶花最好下午能送到',
  // 脏话/无关
  '草泥马的花',
  '今天天气怎么样',
  '给我讲个笑话',
  '会下国际象棋吗',
  '12345',
  '？？？？',
  // 表情/符号
  '🌸🌸🌸',
  '求一束花🙏🙏',
  // 特定场景
  '吊唁用的花圈',
  '开业花篮',
  '结婚手捧花',
  '探病送什么花好',
  '七夕要给女朋友什么花'
];

function fmt(r) {
  const f = [];
  f.push('intent=' + (r.intent || '-'));
  if (r.occasion) f.push('场合=' + r.occasion);
  if (r.recipient) f.push('对象=' + r.recipient);
  if (r.category) f.push('品类=' + r.category);
  if (r.budget != null) f.push('预算=' + r.budget);
  if (r.style && r.style.length) f.push('风格=' + r.style.join('/'));
  if (r.color_tone && r.color_tone.length) f.push('色系=' + r.color_tone.join('/'));
  if (r.forbidden && r.forbidden.length) f.push('禁忌=' + r.forbidden.join('/'));
  if (r.preferred && r.preferred.length) f.push('偏好=' + r.preferred.join('/'));
  if (r.quantity_spec && r.quantity_spec.length) f.push('组合=' + JSON.stringify(r.quantity_spec.map(x => x.flower_id + 'x' + x.qty)));
  return f.join(' | ') || '(空)';
}

(async () => {
  let pass = 0, fail = 0;
  console.log('══ 极端自然语言理解（纯规则） ══\n');
  for (const c of CASES) {
    const r = ruleDecompose(c);
    console.log('■ ' + c);
    console.log('  → ' + fmt(r) + '\n');
  }
  console.log('（手工判断合理性）');
})();
