// 智能体回归测试（零依赖，node:assert）
// 运行：node test/agent.test.js
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
// 使用隔离的临时数据目录：避免历史 feedback 污染"固定方案"断言，也不污染主库
const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'flora-test-'));
process.env.FLORA_DATA_DIR = TEST_DIR;
process.on('exit', () => { try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch (e) {} });
const fixtures = require('./fixtures.json');
const { runAgent } = require('../lib/agent');
// 隔离库灌入种子数据（flowers/shops/templates 等）；feedback 表保持为空 → 方案固定可复现
require('../lib/db').init();
require('../lib/seed').runAll();
const flowerKB = require('../lib/flowerKB');

const LOCATION = { lat: 22.5431, lng: 114.0579 }; // 深圳福田中心（与 CLI 默认一致）
const CONFIG = { skip_image: true }; // 测试不出图、不写文件

let pass = 0;
let fail = 0;
const failures = [];

function check(cond, msg, fixtureId) {
  if (cond) { pass++; return; }
  fail++;
  failures.push(`  [${fixtureId}] ${msg}`);
}

function planFlowerIds(plan) {
  return new Set((plan.items || []).map((i) => i.flower_id));
}

// 新流程：关键需求(场合/对象/品类/预算)齐 → 确认卡片；确认 → 分支卡片；
// DIY → 现算方案(出图询问)；不用 → 独立选店卡片。此 helper 从 confirm 阶段驱动到 DIY 方案+选店。
async function driveToDiyPlan(session) {
  const branchRes = await runAgent({ text: '确认', session, location: LOCATION, config: CONFIG });
  const planRes = await runAgent({ text: 'DIY', session: branchRes.session, location: LOCATION, config: CONFIG });
  const shopRes = await runAgent({ text: '不用', session: planRes.session, location: LOCATION, config: CONFIG });
  return { branchRes, planRes, shopRes };
}

// 对需求（会话累积）做断言：无论是否出方案都可校验（拆解器正确性）
function checkRequirements(fixtureId, req, expect) {
  if (expect.occasion != null) check(req.occasion === expect.occasion, `场合应为 ${expect.occasion}，实际 ${req.occasion}`, fixtureId);
  if (expect.recipient != null) check(req.recipient === expect.recipient, `对象应为 ${expect.recipient}，实际 ${req.recipient}`, fixtureId);
  if (expect.budget != null) check(req.budget === expect.budget, `预算应为 ${expect.budget}，实际 ${req.budget}`, fixtureId);
  if (expect.size != null) check(req.size === expect.size, `尺寸应为 ${expect.size}，实际 ${req.size}`, fixtureId);
  if (expect.placement != null) check(req.placement === expect.placement, `摆放应为 ${expect.placement}，实际 ${req.placement}`, fixtureId);
  if (expect.avoid_allergen != null) check(!!req.avoid_allergen === expect.avoid_allergen, `过敏规避应为 ${expect.avoid_allergen}`, fixtureId);
  for (const c of expect.style_contains || []) check((req.style || []).includes(c), `风格应包含 ${c}，实际 [${req.style}]`, fixtureId);
  for (const c of expect.color_contains || []) check((req.color_tone || []).includes(c), `色系应包含 ${c}，实际 [${req.color_tone}]`, fixtureId);
  for (const f of expect.forbidden_contains || []) check((req.forbidden || []).includes(f), `禁忌应包含 ${f}，实际 [${req.forbidden}]`, fixtureId);
  for (const f of expect.preferred_contains || []) check((req.preferred || []).includes(f), `偏好应包含 ${f}，实际 [${req.preferred}]`, fixtureId);
}

// 对方案做断言：结构完整性 + 花材/预算约束
function checkPlan(fixtureId, plan, req, expect) {
  check(plan != null, '应生成方案', fixtureId);
  if (!plan) return;
  const ids = planFlowerIds(plan);
  for (const it of plan.items) {
    check(flowerKB.byId(it.flower_id) != null, `花材 ${it.flower_id} 必须来自花材库（防幻觉）`, fixtureId);
    check(it.qty > 0 && it.price > 0, `${it.name} 数量与单价必须为正`, fixtureId);
  }
  check(plan.total > 0, '方案总价必须为正', fixtureId);
  if (expect.plan_category != null) check(plan.category === expect.plan_category, `品类应为 ${expect.plan_category}，实际 ${plan.category}`, fixtureId);
  for (const f of expect.plan_excludes || []) check(!ids.has(f), `方案中不应出现 ${f}`, fixtureId);
  for (const f of expect.plan_contains || []) check(ids.has(f), `方案中应包含 ${f}，实际 [${[...ids].join(',')}]`, fixtureId);
  if (expect.no_allergen_flowers) {
    const bad = (plan.items || []).filter((i) => { const f = flowerKB.byId(i.flower_id); return f && f.过敏; });
    check(bad.length === 0, `过敏场景下方案不应出现致敏花材：${bad.map((i) => i.name).join('、')}`, fixtureId);
  }
  if (expect.total_le_budget) check(plan.total <= req.budget, `总价 ${plan.total} 应 ≤ 预算 ${req.budget}`, fixtureId);
  if (expect.plan_has_total) check(plan.total > 0, '应有总价', fixtureId);
}

async function runFixture(fx) {
  const expect = fx.expect;
  let session = null;
  let lastRes = null;
  for (const turn of fx.turns) {
    lastRes = await runAgent({ text: turn, session, location: LOCATION, config: CONFIG });
    session = lastRes.session;
  }
  const req = session.requirements;
  checkRequirements(fx.id, req, expect);

  if (expect.need_clarify) {
    // 门禁：关键需求未齐 → 澄清，绝不出方案
    check(lastRes.need_clarify === true, `need_clarify 应为 true，实际 ${lastRes.need_clarify}`, fx.id);
    check(lastRes.plan === null, '澄清回合不得出方案（需求①门禁）', fx.id);
    check(lastRes.card && lastRes.card.kind === 'clarify', `应发澄清卡片，实际 ${lastRes.card && lastRes.card.kind}`, fx.id);
    for (const f of expect.missing_fields_contains || []) check((lastRes.missing_fields || []).includes(f), `缺失字段应包含 ${f}，实际 [${lastRes.missing_fields}]`, fx.id);
    return;
  }

  if (expect.drive_to_plan) {
    // 门禁：关键需求齐 → 先确认卡片、不得直接出方案（需求①核心）
    check(lastRes.card && lastRes.card.kind === 'confirm', `关键需求齐应发确认卡片，实际 ${lastRes.card && lastRes.card.kind}`, fx.id);
    check(lastRes.plan === null, '确认前不得出方案（需求①门禁）', fx.id);
    check(lastRes.need_clarify === false, '确认阶段不是澄清', fx.id);
    // 驱动 确认→DIY→不用
    const { branchRes, planRes, shopRes } = await driveToDiyPlan(session);
    check(branchRes.card && branchRes.card.kind === 'branch', '确认后应发分支卡片（现有/DIY）', fx.id);
    check(branchRes.plan === null, '分支阶段仍未出方案', fx.id);
    check(planRes.card && planRes.card.kind === 'image_ask', 'DIY 后应发出图询问卡片', fx.id);
    check(planRes.plan != null, 'DIY 后应出方案', fx.id);
    check(planRes.plan_version === 1, `首个确认方案应为第 1 版，实际 ${planRes.plan_version}`, fx.id);
    check(planRes.plan.mode !== 'existing', 'DIY 方案 mode 不应为 existing', fx.id);
    checkPlan(fx.id, planRes.plan, planRes.session.requirements, expect);
    // 选店独立卡片（需求②：方案卡不含选店）
    check(shopRes.card && shopRes.card.kind === 'shop_select', '出图询问后应进入独立选店卡片', fx.id);
    if (expect.shops_top3) {
      const shops = shopRes.shop_suggestions || [];
      check(shops.length === 3, `应返回 Top3 花店，实际 ${shops.length} 家`, fx.id);
      check(shops[0].score >= shops[1].score && shops[1].score >= shops[2].score, '花店应按分数降序', fx.id);
      for (const s of shops) {
        check(typeof s.price_total === 'number' && s.price_total > 0, `${s.name} 应有报价`, fx.id);
        check(typeof s.coverage === 'number' && s.coverage >= 0 && s.coverage <= 100, `${s.name} 覆盖率应在 0-100`, fx.id);
      }
    }
  }
}

(async () => {
  for (const fx of fixtures) {
    try {
      await runFixture(fx);
    } catch (e) {
      fail++;
      failures.push(`  [${fx.id}] 运行异常：${e.message}`);
    }
  }

  // ── 选店与无变化回合（先驱动到独立选店卡片，再测 shop-intent 分支）──
  {
    // 关键需求齐 → confirm → 确认 → DIY → 不用 → 独立选店卡片
    const r0 = await runAgent({ text: '帮我做一束送给女朋友的生日花束，预算300以内，喜欢粉色', location: LOCATION, config: CONFIG });
    check(r0.card && r0.card.kind === 'confirm', '完整信息先发确认卡片（不直接选店）', 'shopflow');
    const { shopRes } = await driveToDiyPlan(r0.session);
    check(shopRes.card && shopRes.card.kind === 'shop_select', '进入独立选店卡片', 'shopflow');
    check(shopRes.shop_suggestions.length === 3, '选店卡片给出 3 家花店', 'shopflow');
    const baseVersion = shopRes.plan_version;

    const r1 = await runAgent({ text: '选第二家吧', session: shopRes.session, location: LOCATION, config: CONFIG });
    check(r1.shop_choice && r1.shop_choice.name === shopRes.shop_suggestions[1].name, '选第二家锁定列表第 2 家店', 'shopflow');
    check(r1.plan_version === baseVersion, '选店回合不推新版本', 'shopflow');

    const r2 = await runAgent({ text: '看看其他店', session: r1.session, location: LOCATION, config: CONFIG });
    check(r2.shop_suggestions.length === 5, '看看其他店扩展到 5 家', 'shopflow');
    check(r2.card && r2.card.kind === 'shop_select', '看更多仍是选店卡片', 'shopflow');

    const r3 = await runAgent({ text: '就要这家花间集吧', session: r2.session, location: LOCATION, config: CONFIG });
    check(r3.shop_choice && r3.shop_choice.name === '花间集·福田店', '按店名锁定花间集', 'shopflow');

    const r4 = await runAgent({ text: '嗯嗯', session: r3.session, location: LOCATION, config: CONFIG });
    check(r4.plan && r4.plan.summary === r3.plan.summary, '无变化回合方案不变', 'shopflow');
    check(r4.shop_choice !== null, '无变化回合保留选择', 'shopflow');
  }

  // ── 澄清阶段说"选店"应回到追问，而不是误报 ──
  {
    const res = await runAgent({ text: '随便弄一束花', location: LOCATION, config: CONFIG });
    const r2 = await runAgent({ text: '选第二家吧', session: res.session, location: LOCATION, config: CONFIG });
    check(r2.need_clarify === true, '无店可选的选店话术回到澄清', 'shopflow');
    check(r2.shop_choice === null, '澄清阶段不产生锁定', 'shopflow');
  }

  // ── 寒暄回合：不出方案、不推版本、正常对话 ──
  {
    const g = await runAgent({ text: '你好', location: LOCATION, config: CONFIG });
    check(g.plan === null, '打招呼不出方案', 'greet');
    check(g.plan_version === 0, '打招呼不推版本', 'greet');
    check(g.need_clarify === false, '打招呼不是澄清状态', 'greet');
    check(!g.reply.includes('方案'), '打招呼回复不含方案内容', 'greet');
    const g2 = await runAgent({ text: 'hi', location: LOCATION, config: CONFIG });
    check(g2.plan === null, 'hi 不出方案', 'greet');
  }

  // ── 澄清回合：自然反问，不再展示草稿方案；补齐 4 字段后进入确认(不直接出方案) ──
  {
    const c = await runAgent({ text: '想给我妈做花', location: LOCATION, config: CONFIG });
    check(c.plan === null, '信息不足不出草稿方案', 'clarify2');
    check(c.need_clarify === true, '信息不足进入澄清', 'clarify2');
    check(c.card && c.card.kind === 'clarify', '信息不足发澄清卡片', 'clarify2');
    check(c.shop_suggestions.length === 0, '澄清阶段不配店', 'clarify2');
    check(!c.reply.includes('草稿'), '反问不展示草稿推理过程', 'clarify2');
    check(!c.reply.includes('方案：'), '反问不附带方案摘要', 'clarify2');
    // 补齐场合/品类/预算(对象已有) → 关键需求齐 → 确认卡片（需求①：确认后才出方案）
    const full = await runAgent({ text: '预算150，生日送我妈做个花束，温柔一点', session: c.session, location: LOCATION, config: CONFIG });
    check(full.plan === null, '需求齐也先确认、不直接出方案（需求①门禁）', 'clarify2');
    check(full.card && full.card.kind === 'confirm', '补齐信息后发确认卡片', 'clarify2');
    check(full.need_clarify === false, '确认阶段不是澄清', 'clarify2');
    // 确认 → DIY → 出方案 v1
    const b = await runAgent({ text: '确认', session: full.session, location: LOCATION, config: CONFIG });
    check(b.card && b.card.kind === 'branch', '确认后进入现有/DIY 分支', 'clarify2');
    const p = await runAgent({ text: '自己做', session: b.session, location: LOCATION, config: CONFIG });
    check(p.plan !== null, '选 DIY 后出正式方案', 'clarify2');
    check(p.plan_version === 1, '正式方案才是第 1 版（澄清/确认不占版本）', 'clarify2');
  }

  console.log(`\n智能体回归测试：${pass} 通过 / ${fail} 失败（共 ${fixtures.length} 个用例）`);
  if (failures.length) {
    console.log('\n失败明细：');
    console.log(failures.join('\n'));
    process.exitCode = 1;
  } else {
    console.log('✅ 全部通过');
  }
})();
