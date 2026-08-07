// M17 · 数量解析 + 知识库现算（减少预设，按自然语言理解后现算方案）
const assert = require('node:assert');
const { decompose } = require('../lib/decomposer');
const { composePlan } = require('../lib/planner');

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.error('  ✗', name); }
}

(async () => {
  console.log('— M17 数量解析 —');
  const req = await decompose('我需要11朵红玫瑰和1朵满天星，预算不限');
  ok('quantity_spec 解析到 2 项', req.quantity_spec && req.quantity_spec.length === 2);
  const rose = req.quantity_spec.find((x) => x.flower_id === 'rose');
  const bb = req.quantity_spec.find((x) => x.flower_id === 'babybreath');
  ok('红玫瑰 qty = 11', rose && rose.qty === 11);
  ok('满天星 qty = 1', bb && bb.qty === 1);
  ok('“预算不限” → budget 为 null', req.budget == null);

  console.log('— M17 知识库现算方案 —');
  const plan = composePlan(req);
  ok('plan.mode = custom_spec', plan.mode === 'custom_spec');
  const roseItem = plan.items.find((i) => i.flower_id === 'rose');
  const bbItem = plan.items.find((i) => i.flower_id === 'babybreath');
  ok('方案含 11 支红玫瑰', roseItem && roseItem.qty === 11 && roseItem.unit === '支');
  ok('方案含 1 单位满天星', bbItem && bbItem.qty === 1);
  const expected = roseItem.price * 11 + bbItem.price * 1 + plan.packCost;
  ok('现算总价 = 花材×数量 + 包装 (实际 ¥' + plan.total + ')', plan.total === expected);
  ok('现算价在 60~90 区间（≈¥77）', plan.total >= 60 && plan.total <= 90);
  ok('summary 含数量与花名', /11.*红玫瑰/.test(plan.summary) && /满天星/.test(plan.summary));
  ok('budget_ok（不限预算）', plan.budget_ok === true);

  console.log('— M17 其它语序 / 花材 —');
  const req2 = await decompose('3支百合加上2扎尤加利');
  ok('百合+尤加利 解析 2 项', req2.quantity_spec && req2.quantity_spec.length === 2);
  const plan2 = composePlan(req2);
  ok('plan2 现算 items 数 = 2', plan2.items.length === 2);

  console.log('— M17 兼容：无数量仍走默认搭配 —');
  const req3 = await decompose('送女朋友的浪漫花束');
  ok('无数量 → quantity_spec 空', !req3.quantity_spec || req3.quantity_spec.length === 0);
  const plan3 = composePlan(req3);
  ok('无数量 → 走默认方案且有 items', plan3.items.length > 0 && plan3.mode !== 'custom_spec');

  console.log('— M18 预算自然语言理解 —');
  const b1 = await decompose('预算改到500吧');
  ok('“预算改到500” → budget 500', b1.budget === 500);
  const b2 = await decompose('预算500');
  ok('“预算500” → budget 500', b2.budget === 500);
  const b3 = await decompose('不超过300元');
  ok('“不超过300元” → budget 300', b3.budget === 300);
  const b4 = await decompose('大概200块');
  ok('“大概200块” → budget 200', b4.budget === 200);
  const b5 = await decompose('我要11朵红玫瑰');
  ok('“我要11朵红玫瑰” → budget 为 null', b5.budget == null);
  ok('  且 quantity_spec 含 1 项', b5.quantity_spec && b5.quantity_spec.length === 1);

  console.log('— M18 LLM 预算污染防护 —');
  const llm = require('../lib/llm/client');
  const orig = llm.extractRequirements;
  llm.extractRequirements = async () => ({ budget: 11, quantity_spec: [{ flower_id: 'rose', qty: 11 }] });
  const p1 = await decompose('我要11朵红玫瑰');
  ok('LLM 返回 budget=11 被丢弃（与数量撞车）', p1.budget == null);
  llm.extractRequirements = async () => ({ budget: 11 });
  const p2 = await decompose('帮我配束花');
  ok('LLM 返回 budget=11 被丢弃（<20 不合理）', p2.budget == null);
  llm.extractRequirements = async () => ({ budget: 200 });
  const p3 = await decompose('想要贵一点的');
  ok('LLM 返回 budget=200（合理）被保留', p3.budget === 200);
  llm.extractRequirements = orig;

  console.log('— M19 极端自然语言理解（纯规则） —');
  const e1 = await decompose('一百零一朵玫瑰');
  ok('“一百零一朵玫瑰” → 组合 玫瑰×101 而非预算', e1.quantity_spec && e1.quantity_spec[0].qty === 101 && e1.budget == null);
  const e2 = await decompose('十三支百合');
  ok('“十三支百合” → 组合 百合×13', e2.quantity_spec && e2.quantity_spec[0].qty === 13 && e2.quantity_spec[0].flower_id === 'lily');
  const e3 = await decompose('不想要向日葵和菊花');
  ok('“不想要向日葵” → 禁忌 sunflower 而非偏好', e3.forbidden.includes('sunflower') && !e3.preferred.includes('sunflower'));
  const e4 = await decompose('别用百合，我对花粉过敏');
  ok('“别用百合+花粉过敏” → 禁忌 lily 且不误判粉色', e4.forbidden.includes('lily') && !e4.color_tone.includes('粉'));
  ok('  且 avoid_allergen = true', e4.avoid_allergen === true);
  const e5 = await decompose('预算5百左右');
  ok('“预算5百左右” → budget 500', e5.budget === 500);
  const e6 = await decompose('二百以内吧');
  ok('“二百以内吧” → budget 200', e6.budget === 200);
  const e7 = await decompose('我姐姐过生日喜欢郁金香不喜欢康乃馨');
  ok('“姐姐” → 对象家人', e7.recipient === '家人');
  ok('“不喜欢康乃馨” → 禁忌而非偏好', e7.forbidden.includes('carnation') && !e7.preferred.includes('carnation'));
  ok('“喜欢郁金香” → 偏好保留', e7.preferred.includes('tulip'));
  const e8 = await decompose('七夕要给女朋友什么花');
  ok('“七夕” → 场合表白', e8.occasion === '表白');
  const e9 = await decompose('预算一百零一');
  ok('“预算一百零一” → budget 101', e9.budget === 101);

  console.log(`\n数量现算测试：${pass} 通过, ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('测试异常:', e); process.exit(1); });
