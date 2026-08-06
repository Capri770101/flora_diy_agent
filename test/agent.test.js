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

function runExpectations(fixtureId, res, expect) {
  const { plan, session } = res;
  const req = session.requirements;
  const ids = plan ? planFlowerIds(plan) : new Set();

  // 通用断言：防幻觉 + 结构完整性（澄清回合无方案则跳过）
  if (plan) {
    for (const it of plan.items) {
      check(flowerKB.byId(it.flower_id) != null, `花材 ${it.flower_id} 必须来自花材库（防幻觉）`, fixtureId);
      check(it.qty > 0 && it.price > 0, `${it.name} 数量与单价必须为正`, fixtureId);
    }
    check(plan.total > 0, '方案总价必须为正', fixtureId);
  }
  check(res.plan_version === session.history.length, 'plan_version 必须与版本历史一致', fixtureId);

  if (expect.occasion != null) check(req.occasion === expect.occasion, `场合应为 ${expect.occasion}，实际 ${req.occasion}`, fixtureId);
  if (expect.recipient != null) check(req.recipient === expect.recipient, `对象应为 ${expect.recipient}，实际 ${req.recipient}`, fixtureId);
  if (expect.category != null) check(plan && plan.category === expect.category, `品类应为 ${expect.category}，实际 ${plan && plan.category}`, fixtureId);
  if (expect.budget != null) check(req.budget === expect.budget, `预算应为 ${expect.budget}，实际 ${req.budget}`, fixtureId);
  if (expect.size != null) check(req.size === expect.size, `尺寸应为 ${expect.size}，实际 ${req.size}`, fixtureId);
  if (expect.placement != null) check(req.placement === expect.placement, `摆放应为 ${expect.placement}，实际 ${req.placement}`, fixtureId);
  if (expect.avoid_allergen != null) check(!!req.avoid_allergen === expect.avoid_allergen, `过敏规避应为 ${expect.avoid_allergen}`, fixtureId);

  for (const c of expect.style_contains || []) check((req.style || []).includes(c), `风格应包含 ${c}，实际 [${req.style}]`, fixtureId);
  for (const c of expect.color_contains || []) check((req.color_tone || []).includes(c), `色系应包含 ${c}，实际 [${req.color_tone}]`, fixtureId);
  for (const f of expect.forbidden_contains || []) check((req.forbidden || []).includes(f), `禁忌应包含 ${f}，实际 [${req.forbidden}]`, fixtureId);
  for (const f of expect.preferred_contains || []) check((req.preferred || []).includes(f), `偏好应包含 ${f}，实际 [${req.preferred}]`, fixtureId);

  for (const f of expect.plan_excludes || []) check(plan && !ids.has(f), `方案中不应出现 ${f}`, fixtureId);
  for (const f of expect.plan_contains || []) check(plan && ids.has(f), `方案中应包含 ${f}，实际 [${[...ids].join(',')}]`, fixtureId);
  if (expect.no_allergen_flowers) {
    const bad = plan ? (plan.items || []).filter((i) => { const f = flowerKB.byId(i.flower_id); return f && f.过敏; }) : [];
    check(plan && bad.length === 0, `过敏场景下方案不应出现致敏花材：${bad.map((i) => i.name).join('、')}`, fixtureId);
  }

  if (expect.total_le_budget) check(plan && plan.total <= req.budget, `总价 ${plan && plan.total} 应 ≤ 预算 ${req.budget}`, fixtureId);
  if (expect.plan_has_total) check(plan && plan.total > 0, '应有总价', fixtureId);
  if (expect.versions != null) check(res.plan_version === expect.versions, `版本数应为 ${expect.versions}，实际 ${res.plan_version}`, fixtureId);
  if (expect.need_clarify != null) check(res.need_clarify === expect.need_clarify, `need_clarify 应为 ${expect.need_clarify}，实际 ${res.need_clarify}`, fixtureId);
  for (const f of expect.missing_fields_contains || []) check((res.missing_fields || []).includes(f), `缺失字段应包含 ${f}，实际 [${res.missing_fields}]`, fixtureId);
  if (expect.shops_top3 && plan) {
    check(Array.isArray(res.shop_suggestions) && res.shop_suggestions.length === 3, `应返回 Top3 花店，实际 ${res.shop_suggestions.length} 家`, fixtureId);
    check(res.shop_suggestions[0].score >= res.shop_suggestions[1].score && res.shop_suggestions[1].score >= res.shop_suggestions[2].score, '花店应按分数降序', fixtureId);
    for (const s of res.shop_suggestions) {
      check(typeof s.price_total === 'number' && s.price_total > 0, `${s.name} 应有报价`, fixtureId);
      check(typeof s.coverage === 'number' && s.coverage >= 0 && s.coverage <= 100, `${s.name} 覆盖率应在 0-100`, fixtureId);
    }
  }
}

async function runFixture(fx) {
  let session = null;
  for (const turn of fx.turns) {
    const res = await runAgent({ text: turn, session, location: LOCATION, config: CONFIG });
    session = res.session;
    if (turn === fx.turns[fx.turns.length - 1]) {
      runExpectations(fx.id, res, fx.expect);
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

  // ── 选店与无变化回合（shop-intent 分支，纯规则可复现）──
  {
    const turns = [
      '帮我做一束送给女朋友的生日花束，预算300以内，喜欢粉色',
      '选第二家吧',
      '看看其他店',
      '就要这家花间集吧',
      '嗯嗯'
    ];
    let session = null;
    const versions = [];
    const results = [];
    for (const t of turns) {
      const res = await runAgent({ text: t, session, location: LOCATION, config: CONFIG });
      session = res.session;
      versions.push(res.plan_version);
      results.push(res);
    }
    check(results[0].need_clarify === false, '完整信息不反问', 'shopflow');
    check(results[0].shop_suggestions.length === 3, '首轮给出 3 家花店', 'shopflow');
    check(results[1].shop_choice && results[1].shop_choice.name === results[0].shop_suggestions[1].name, '选第二家锁定列表第 2 家店', 'shopflow');
    check(versions[1] === versions[0], '选店回合不推新版本', 'shopflow');
    check(results[2].shop_suggestions.length === 5, '看看其他店扩展到 5 家', 'shopflow');
    check(results[3].shop_choice && results[3].shop_choice.name === '花间集·福田店', '按店名锁定花间集', 'shopflow');
    check(results[4].plan.summary === results[3].plan.summary, '无变化回合方案不变', 'shopflow');
    check(versions[4] === versions[0], '无变化回合不推新版本', 'shopflow');
    check(results[4].shop_choice !== null, '无变化回合保留选择', 'shopflow');
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

  // ── 澄清回合：自然反问，不再展示草稿方案 ──
  {
    const c = await runAgent({ text: '想给我妈做花', location: LOCATION, config: CONFIG });
    check(c.plan === null, '信息不足不出草稿方案', 'clarify2');
    check(c.need_clarify === true, '信息不足进入澄清', 'clarify2');
    check(c.shop_suggestions.length === 0, '澄清阶段不配店', 'clarify2');
    check(c.reply.includes('预算'), '反问包含预算问题', 'clarify2');
    check(!c.reply.includes('草稿'), '反问不展示草稿推理过程', 'clarify2');
    check(!c.reply.includes('方案：'), '反问不附带方案摘要', 'clarify2');
    const full = await runAgent({ text: '预算150，生日送我妈，温柔一点', session: c.session, location: LOCATION, config: CONFIG });
    check(full.plan !== null && full.need_clarify === false, '补齐信息后出正式方案', 'clarify2');
    check(full.plan_version === 1, '正式方案才是第 1 版（澄清不占版本）', 'clarify2');
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
