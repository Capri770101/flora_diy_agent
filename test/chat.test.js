// 上下文对话测试：验证 LLM 对话门面（lib/agent/chat.js）+ runAgent 接入
// 运行：node test/chat.test.js
// 设计：不依赖真实 LLM —— 直接注入 fake chat 适配器 / 模拟失败，验证：
//   1) LLM 可用时回复被替换为 LLM 文本，且结构化数据（plan/shops）不受影响
//   2) LLM 失败/不可用时回落到模板回复（与旧行为完全一致）
//   3) transcript 记录多轮上下文，且随会话累积
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'flora-chat-'));
process.env.FLORA_DATA_DIR = TEST_DIR;
process.on('exit', () => { try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch (e) {} });
const registry = require('../lib/plugins/registry');
const config = require('../lib/config');
const { chatReplyFor, chatReplyStreamFor, buildSystemPrompt, formatRequirements } = require('../lib/agent/chat');
const { chatStreamReply } = require('../lib/llm/client');
const { runAgent } = require('../lib/agent');
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
  failures.push(`  ${msg}`);
}

(async () => {
  // ── 0) 无 LLM 时 chatReplyFor 原样返回模板 ──
  {
    const out = await chatReplyFor({ role: 'plan', ctx: { requirements: { budget: 200 }, plan: { summary: '测试方案' }, shops: [] }, templateReply: '模板回复' });
    check(out === '模板回复', '未配置 LLM 时回落模板');
  }

  // ── 1) 注入 fake chat 适配器：chat 生效 ──
  const fake = {
    id: 'fake-chat',
    slot: 'llm',
    priority: 999,
    enabled: () => true,
    extract: async () => null,
    chat: async ({ system, history }) => `（LLM）你说了：${(history[history.length - 1] || {}).content || ''}`,
    chatStream: async ({ system, history, onChunk }) => {
      const full = `（LLM流）你说了：${(history[history.length - 1] || {}).content || ''}`;
      for (const ch of full) onChunk(ch); // 逐字回调模拟真实流式
      return full;
    }
  };
  registry.register(fake);
  {
    const out = await chatReplyFor({ role: 'plan', ctx: { requirements: { budget: 200 }, plan: { summary: '测试方案' }, shops: [], transcript: [{ role: 'user', content: '再来一束' }] }, templateReply: '模板回复' });
    check(out.startsWith('（LLM）'), 'LLM 可用时替换模板回复');
    check(out.includes('再来一束'), 'LLM 能看到最近用户消息');
    const sys = buildSystemPrompt('plan', { requirements: { budget: 200 }, plan: { summary: '测试方案' }, shops: [] });
    check(sys.includes('测试方案') && sys.includes('200'), 'system prompt 注入方案事实');
    const fr = formatRequirements({ recipient: '恋人', budget: 300 });
    check(fr.includes('恋人') && fr.includes('300'), '需求格式化正确');
  }

  // ── 1.5) chatStreamReplyFor：逐段回调 + 返回完整文本 ──
  {
    const chunks = [];
    const out = await chatReplyStreamFor({ role: 'plan', ctx: { requirements: {}, plan: null, shops: [], transcript: [{ role: 'user', content: '你好' }] }, templateReply: '兜底', onChunk: (d) => chunks.push(d) });
    check(out.startsWith('（LLM流）'), '流式返回完整 LLM 文本');
    check(chunks.length > 1, 'onChunk 被逐段调用');
    check(chunks.join('') === out, '分片拼接等于完整文本');
  }
  // 无流式能力的适配器（只有 chat，priority 最高被 resolve）→ chatStreamReply 返回 null 且不回调
  {
    const onlyChat = {
      id: 'only-chat', slot: 'llm', priority: 2000, enabled: () => true,
      extract: async () => null,
      chat: async () => '只有 chat'
    };
    registry.register(onlyChat);
    const chunks = [];
    const out = await chatStreamReply({ system: 's', history: [], onChunk: (d) => chunks.push(d) });
    check(out === null, '无 chatStream 能力 → 返回 null 走模板');
    check(chunks.length === 0, '无 chatStream 能力 → 不回调');
    const arr = registry.registry.get('llm');
    const i = arr.findIndex((a) => a.id === 'only-chat');
    if (i >= 0) arr.splice(i, 1);
  }

  // ── 2) 模拟 chat 抛错：回落模板 ──
  {
    const broken = {
      id: 'broken-chat', slot: 'llm', priority: 1000, enabled: () => true,
      extract: async () => null,
      chat: async () => { throw new Error('LLM 超时'); }
    };
    registry.register(broken);
    const out = await chatReplyFor({ role: 'plan', ctx: { requirements: {}, plan: null, shops: [] }, templateReply: '兜底模板' });
    check(out === '兜底模板', 'LLM 抛错回落模板');
  }
  // 移除 broken（它的 priority 更高，会一直压制 fake，导致后续链路测试误走失败分支）
  {
    const arr = registry.registry.get('llm');
    const i = arr.findIndex((a) => a.id === 'broken-chat');
    if (i >= 0) arr.splice(i, 1);
  }

  // ── 3) runAgent 整链路：fake LLM 生效 + 确认门禁 + 确认后结构化数据由规则引擎产出 + transcript 累积 ──
  {
    const r1 = await runAgent({ text: '帮我做一束送给女朋友的生日花束，预算300以内，喜欢粉色', location: LOCATION, config: CONFIG });
    check(r1.reply.startsWith('（LLM）'), 'runAgent 回复被 LLM 接管');
    check(r1.card && r1.card.kind === 'confirm', '完整需求先发确认卡片（需求①门禁）');
    check(r1.plan === null, '确认前不出方案');
    check(r1.session.transcript.length >= 2, 'transcript 记录 user+assistant 两轮');
    // 确认 → DIY → 结构化方案 + 选店由规则引擎产出
    const b = await runAgent({ text: '确认', session: r1.session, location: LOCATION, config: CONFIG });
    check(b.card && b.card.kind === 'branch', '确认后进入现有/DIY 分支卡片');
    const p = await runAgent({ text: 'DIY', session: b.session, location: LOCATION, config: CONFIG });
    check(p.plan && p.plan.total > 0, '方案结构化数据仍由规则引擎产出');
    const s = await runAgent({ text: '不用', session: p.session, location: LOCATION, config: CONFIG });
    check(s.shop_suggestions.length === 3, '候选店仍由规则引擎产出（独立选店卡片）');
    // 修改预算 → 识别为实质变化并合并（重新进入确认）
    const r2 = await runAgent({ text: '预算加到500吧', session: s.session, location: LOCATION, config: CONFIG });
    check(r2.reply.includes('预算加到500吧'), '第二轮 LLM 能看到上一轮上下文');
    check(r2.changed === true, '新需求被规则引擎识别为实质变化');
    check(r2.session.requirements.budget === 500, '多轮需求字段正确合并');
  }

  // ── 3.5) runAgent 流式模式：onReplyChunk 逐段收到、回复完整、确认后结构不变 ──
  {
    const chunks = [];
    const cfg = Object.assign({}, CONFIG, { onReplyChunk: (d) => chunks.push(d) });
    const r = await runAgent({ text: '帮我做一束送给女朋友的生日花束，预算300以内，喜欢粉色', location: LOCATION, config: cfg });
    check(chunks.length > 1, '流式模式 onReplyChunk 被逐段调用');
    check(chunks.join('') === r.reply, '流式分片拼接等于最终回复');
    check(r.reply.startsWith('（LLM流）'), '流式模式走 chatStream');
    check(r.card && r.card.kind === 'confirm', '流式模式完整需求先发确认卡片');
    // 驱动到 DIY 方案 + 选店（仍走流式）
    const b = await runAgent({ text: '确认', session: r.session, location: LOCATION, config: cfg });
    const p = await runAgent({ text: 'DIY', session: b.session, location: LOCATION, config: cfg });
    check(p.plan && p.plan.total > 0, '流式模式方案数据不变');
    const s = await runAgent({ text: '不用', session: p.session, location: LOCATION, config: cfg });
    check(s.shop_suggestions.length === 3, '流式模式候选店不变');
  }

  // 清理测试插件，避免污染其他测试进程无关（注册表是进程内 Map，无害）
  registry.list('llm').filter((a) => a.id === 'fake-chat' || a.id === 'broken-chat').forEach((a) => {
    const arr = registry.registry.get('llm');
    const i = arr.indexOf(a);
    if (i >= 0) arr.splice(i, 1);
  });

  console.log(`\n上下文对话测试：${pass} 通过 / ${fail} 失败`);
  if (fail) {
    console.log('失败明细：\n' + failures.join('\n'));
    process.exit(1);
  }
  console.log('🎉 全部通过');
})().catch((e) => { console.error('测试运行异常：', e); process.exit(1); });