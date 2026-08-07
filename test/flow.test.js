// 状态机流程测试（零依赖，node:assert）：覆盖 6 项产品改进的后端契约
// 运行：node test/flow.test.js
//   ① 需求未明确前禁止出方案：关键需求齐 → 确认卡片(无方案)；缺任一关键字段 → 澄清(无方案)
//   ② 选店独立卡片：方案卡/确认卡不含店铺；shop_select 为独立 card.kind
//   ③ 出方案前询问 现有/DIY 分支
//   ④ 现有 → 商家效果图(mode=existing, 无出图询问直接选店)；DIY → 询问是否出图
//   ⑤ 历史方案字段完整（供 GET /api/v1/plans 列表）
//   ⑥ 下单支付接口化（mock provider）
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'flora-flow-'));
process.env.FLORA_DATA_DIR = TEST_DIR;
process.on('exit', () => { try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch (e) {} });
const agent = require('../lib/agent');
const { runAgent, detectConfirmIntent, detectBranchIntent, detectImageIntent, keyRequirementsMet, KEY_FIELDS } = agent;
const MERCHANT = require('../lib/agent/merchantPlans');
const pay = require('../lib/pay');
require('../lib/db').init();
require('../lib/seed').runAll();

const LOCATION = { lat: 22.5431, lng: 114.0579 };
const CONFIG = { skip_image: true };

let pass = 0;
let fail = 0;
const failures = [];
function check(cond, msg) {
  if (cond) { pass++; return; }
  fail++;
  failures.push('  ' + msg);
}

// 把新会话推进到「确认卡片」阶段（关键需求齐）
async function toConfirm(text) {
  const r = await runAgent({ text: text || '给女朋友做个生日花束，预算200，喜欢粉色', location: LOCATION, config: CONFIG });
  return r;
}

(async () => {
  // ── 意图识别单元 ──
  {
    check(detectConfirmIntent('确认') === true, 'detectConfirmIntent 确认→true');
    check(detectConfirmIntent('可以') === true, 'detectConfirmIntent 可以→true');
    check(detectConfirmIntent('好的') === true, 'detectConfirmIntent 好的→true');
    check(detectConfirmIntent('不对') === false, 'detectConfirmIntent 不对→false');
    check(detectConfirmIntent('改一下颜色') === false, 'detectConfirmIntent 改一下→false');

    check(detectBranchIntent('现有方案') === 'existing', 'detectBranchIntent 现有方案→existing');
    check(detectBranchIntent('用商家现成的') === 'existing', 'detectBranchIntent 商家现成→existing');
    check(detectBranchIntent('DIY') === 'diy', 'detectBranchIntent DIY→diy');
    check(detectBranchIntent('我自己做') === 'diy', 'detectBranchIntent 自己做→diy');
    check(detectBranchIntent('随便') === null, 'detectBranchIntent 无关→null');

    check(detectImageIntent('要') === true, 'detectImageIntent 要→true');
    check(detectImageIntent('生成一张') === true, 'detectImageIntent 生成→true');
    check(detectImageIntent('不用') === false, 'detectImageIntent 不用→false');
    check(detectImageIntent('嗯这个问题') === null, 'detectImageIntent 无关→null');
  }

  // ── keyRequirementsMet 单元（需求①：场合/对象/品类/预算）──
  {
    check(Array.isArray(KEY_FIELDS) && KEY_FIELDS.length === 4, 'KEY_FIELDS 为 4 个关键字段');
    check(keyRequirementsMet({ occasion: '生日', recipient: '恋人', category: '花束', budget: 200 }) === true, '四字段齐→true');
    check(keyRequirementsMet({ occasion: '生日', recipient: '恋人', category: '花束' }) === false, '缺预算→false');
    check(keyRequirementsMet({ recipient: '恋人', category: '花束', budget: 200 }) === false, '缺场合→false');
    check(keyRequirementsMet({ occasion: '生日', category: '花束', budget: 200 }) === false, '缺对象→false');
    check(keyRequirementsMet({ occasion: '生日', recipient: '恋人', budget: 200 }) === false, '缺品类→false');
    check(keyRequirementsMet(null) === false, 'null→false');
  }

  // ── ① 门禁：关键需求齐 → 确认卡片、不出方案 ──
  const c = await toConfirm();
  check(c.card && c.card.kind === 'confirm', '① 关键需求齐发确认卡片');
  check(c.plan === null, '① 确认前不出方案');
  check(c.need_clarify === false, '① 确认阶段非澄清');
  check((c.shop_suggestions || []).length === 0, '② 确认卡片不含店铺');
  check(c.card.data && c.card.data.requirements, '确认卡片携带需求摘要数据');

  // ── ① 门禁：缺关键字段 → 澄清、不出方案 ──
  {
    const r = await runAgent({ text: '给朋友随便做束花', location: LOCATION, config: CONFIG });
    check(r.plan === null, '① 缺关键字段不出方案');
    check(r.need_clarify === true, '① 缺关键字段进入澄清');
    check(r.card && r.card.kind === 'clarify', '① 澄清卡片');
  }

  // ── ③ 确认 → 分支卡片（现有/DIY）──
  const branch = await runAgent({ text: '确认', session: c.session, location: LOCATION, config: CONFIG });
  check(branch.card && branch.card.kind === 'branch', '③ 确认后发分支卡片');
  check(branch.plan === null, '③ 分支阶段仍不出方案');

  // ── ④ 现有方案分支：商家效果图 + 直接选店(无出图询问) ──
  {
    const cc = await toConfirm('给女朋友做个生日花束，预算200，喜欢粉色');
    const bb = await runAgent({ text: '确认', session: cc.session, location: LOCATION, config: CONFIG });
    const ex = await runAgent({ text: '现有方案', session: bb.session, location: LOCATION, config: CONFIG });
    check(ex.plan && ex.plan.mode === 'existing', '④ 现有分支产出 mode=existing 方案');
    check(ex.plan.render_url && ex.plan.render_url.indexOf('/preview/merchant-') === 0, '④ 现有方案直接用商家效果图');
    check(ex.card && ex.card.kind === 'shop_select', '④ 现有方案不问出图、直接进选店卡片');
    check((ex.shop_suggestions || []).length > 0, '④ 现有方案进入选店给出门店');
  }

  // ── ④ DIY 分支：先问是否出图，再选店 ──
  {
    const cc = await toConfirm('给女朋友做个生日花束，预算200，喜欢粉色');
    const bb = await runAgent({ text: '确认', session: cc.session, location: LOCATION, config: CONFIG });
    const diy = await runAgent({ text: 'DIY', session: bb.session, location: LOCATION, config: CONFIG });
    check(diy.plan && diy.plan.mode !== 'existing', '④ DIY 分支产出现算方案(非 existing)');
    check(diy.card && diy.card.kind === 'image_ask', '④ DIY 后询问是否出图');
    check(!diy.plan.render_url, '④ DIY 方案默认未出图(render_url 空)');
    check((diy.shop_suggestions || []).length === 0, '② DIY 方案卡片不含店铺(选店独立)');
    // 不出图 → 独立选店
    const noimg = await runAgent({ text: '不用', session: diy.session, location: LOCATION, config: CONFIG });
    check(noimg.card && noimg.card.kind === 'shop_select', '④ 不出图后进入独立选店卡片');
    check((noimg.shop_suggestions || []).length === 3, '② 独立选店卡片给出 Top3');
    check(noimg.card.data && Array.isArray(noimg.card.data.shops), '选店卡片数据含 shops 列表');
  }

  // ── ④ DIY 分支：要出图（skip_image 下走占位，不真调外部）──
  {
    const cc = await toConfirm('给女朋友做个生日花束，预算200，喜欢粉色');
    const bb = await runAgent({ text: '确认', session: cc.session, location: LOCATION, config: CONFIG });
    const diy = await runAgent({ text: 'DIY', session: bb.session, location: LOCATION, config: CONFIG });
    const yes = await runAgent({ text: '要', session: diy.session, location: LOCATION, config: CONFIG });
    check(yes.card && yes.card.kind === 'shop_select', '④ 出图询问答“要”后进入选店');
  }

  // ── ⑤ 历史方案字段完整（供 GET /api/v1/plans 列表）──
  {
    const cc = await toConfirm('给女朋友做个生日花束，预算200，喜欢粉色');
    const bb = await runAgent({ text: '确认', session: cc.session, location: LOCATION, config: CONFIG });
    const diy = await runAgent({ text: 'DIY', session: bb.session, location: LOCATION, config: CONFIG });
    const p = diy.plan;
    for (const f of ['plan_id', 'summary', 'total', 'budget', 'category', 'created_at']) {
      check(p[f] != null, `⑤ 历史方案字段 ${f} 完整`);
    }
    check('mode' in p || 'render_url' in p, '⑤ 历史方案含 mode/render_url 字段位');
  }

  // ── merchantPlans 单元（③④ 现有方案匹配）──
  {
    const mp = MERCHANT.pickMerchantPlan({ category: '花束', occasion: '生日' });
    check(mp && mp.plan_id === 'mp-birthday-bouquet', 'pickMerchantPlan 生日花束→生日惊喜花束');
    const none = MERCHANT.pickMerchantPlan({ category: '花环', occasion: '婚礼' });
    check(none === null, 'pickMerchantPlan 无匹配→null');
    const norm = MERCHANT.normalizeMerchantPlan(mp, { category: '花束', occasion: '生日', budget: 200 });
    check(norm.mode === 'existing', 'normalizeMerchantPlan mode=existing');
    check(norm.render_url.indexOf('/preview/merchant-') === 0, 'normalizeMerchantPlan 商家效果图路径');
    check(norm.total > 0 && norm.items.length > 0, 'normalizeMerchantPlan 有花材与总价');
    check(norm.budget === 200, 'normalizeMerchantPlan 采用用户预算');
    check(Array.isArray(norm.steps) && norm.steps.length > 0, 'normalizeMerchantPlan 步骤为成品交付');
  }

  // ── ⑥ 支付接口化（mock provider）──
  {
    check(pay.provider === 'mock', '⑥ 默认支付 provider=mock');
    const payment = await pay.createPayment({ order_id: 'ord_test123' });
    for (const f of ['timeStamp', 'nonceStr', 'package', 'signType', 'paySign']) {
      check(payment[f] != null && payment[f] !== '', `⑥ 支付参数 ${f} 存在`);
    }
    check(payment.package.indexOf('prepay_id=') === 0, '⑥ package 含 prepay_id');
    check(payment.paySign.indexOf('MOCK_SIGN_') === 0, '⑥ mock 签名标识');
    check(payment.paySign.indexOf('ord_test123') >= 0, '⑥ 支付参数绑定订单号');
  }

  console.log(`\n状态机流程测试：${pass} 通过 / ${fail} 失败`);
  if (fail) {
    console.log('失败明细：\n' + failures.join('\n'));
    process.exit(1);
  }
  console.log('🎉 全部通过');
})().catch((e) => { console.error('测试运行异常：', e); process.exit(1); });
