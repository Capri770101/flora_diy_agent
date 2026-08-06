// 智能体独立开发 CLI：不依赖 HTTP/小程序，直接在命令行里迭代智能体
// 用法：
//   node scripts/agent-cli.js
// 命令：
//   /help                帮助
//   /reset               重置会话
//   /session             查看会话需求累积与版本历史
//   /location 22.5 114.1 设置用户位置（默认深圳福田中心）
//   /shop <shop_id>      查看花店详情
//   /exit                退出
const fs = require('fs');
const path = require('path');
const readline = require('readline');

try {
  const envFile = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
} catch (e) { /* 无 .env 也可运行（规则引擎 + SVG 兜底） */ }

const { runAgent } = require('../lib/agent');
const { loadShops } = require('../lib/agent/shopMatcher');
const feedbackStore = require('../lib/agent/feedbackStore');

const DEFAULT_LOCATION = { lat: 22.5431, lng: 114.0579 }; // 深圳福田中心

const state = {
  session: null,
  location: { ...DEFAULT_LOCATION }
};

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function banner() {
  console.log('──────────────────────────────────────────────');
  console.log('🌸 智能花卉 DIY 智能体 · 独立开发 CLI');
  console.log('  输入 /help 查看命令；直接输入需求开始对话');
  console.log(`  默认位置：深圳福田中心 (${state.location.lat}, ${state.location.lng})`);
  if (process.env.LLM_API_KEY) console.log('  LLM 通道：已启用 (' + (process.env.LLM_MODEL || 'default') + ')');
  else console.log('  LLM 通道：未启用（规则引擎）');
  if (process.env.IMAGE_API_KEY) console.log('  文生图：已启用');
  else console.log('  文生图：未启用（SVG 风格预览兜底）');
  console.log('──────────────────────────────────────────────');
}

function fmtRequirements(req) {
  if (!req) return '  (空)';
  const parts = [];
  if (req.occasion) parts.push(`场合:${req.occasion}`);
  if (req.recipient) parts.push(`对象:${req.recipient}`);
  if (req.category) parts.push(`品类:${req.category}`);
  if (req.style && req.style.length) parts.push(`风格:${req.style.join('/')}`);
  if (req.color_tone && req.color_tone.length) parts.push(`色系:${req.color_tone.join('/')}`);
  if (req.budget != null) parts.push(`预算:${req.budget}`);
  if (req.size) parts.push(`尺寸:${req.size}`);
  if (req.placement) parts.push(`摆放:${req.placement}`);
  if (req.preferred && req.preferred.length) parts.push(`偏好:${req.preferred.join(',')}`);
  if (req.forbidden && req.forbidden.length) parts.push(`禁忌:${req.forbidden.join(',')}`);
  if (req.avoid_allergen) parts.push('避开过敏源');
  return '  ' + (parts.join('  ') || '(仅默认)');
}

function fmtPlan(plan) {
  if (!plan) return '';
  const lines = [`  第 ${plan.version} 版 · ${plan.category} · ${plan.summary}`];
  for (const it of plan.items) {
    lines.push(`    - ${it.name}(${it.role}) ×${it.qty}${it.unit} @¥${it.price} = ¥${(it.price * it.qty).toFixed(0)}`);
  }
  lines.push(`  包装：${plan.package}`);
  const budget = plan.budget != null ? ` / 预算 ¥${plan.budget}` : '';
  lines.push(`  总价：约 ¥${plan.total}${budget}${plan.budget_ok === false ? '（已超预算，请调整）' : ''}`);
  if (plan.render_url) lines.push(`  效果图：${plan.render_url}${plan.render_type ? '（' + plan.render_type + '）' : ''}`);
  return lines.join('\n');
}

function fmtShops(shops) {
  if (!shops || !shops.length) return '  暂无匹配花店';
  return shops
    .map((s, i) => {
      const dist = s.distance_km != null ? `${s.distance_km}km` : '位置未知';
      const miss = s.missing && s.missing.length ? ` 缺[${s.missing.map((m) => m.name).join('、')}]可替换` : ' 全覆盖';
      return `  ${i + 1}. ${s.name}（${s.district}）${dist} 评分${s.rating} 覆盖${s.coverage}%${miss}\n     报价约 ¥${s.price_total}${s.price_diff != null ? `（vs 方案价 ${s.price_diff >= 0 ? '+' : ''}${s.price_diff}）` : ''} 总分${s.score}`;
    })
    .join('\n');
}

function handleCommand(cmd, arg) {
  switch (cmd) {
    case 'help':
      console.log(bannerHelp());
      return true;
    case 'reset':
      state.session = null;
      console.log('✅ 会话已重置');
      return true;
    case 'session':
      if (!state.session) { console.log('  当前无会话'); return true; }
      console.log('  会话 ' + state.session.session_id);
      console.log('  累积需求：' + fmtRequirements(state.session.requirements));
      console.log('  版本历史：');
      for (const h of state.session.history || []) {
        console.log(`    v${h.version} ${h.category} ¥${h.total} ${h.plan_id}  ${h.summary}`);
      }
      return true;
    case 'location': {
      const nums = (arg || '').split(/[\s,]+/).map(Number);
      if (nums.length >= 2 && nums[0] && nums[1]) {
        state.location = { lat: nums[0], lng: nums[1] };
        console.log(`📍 位置已更新为 (${nums[0]}, ${nums[1]})`);
      } else {
        console.log('用法：/location <纬度> <经度>，例如 /location 22.5431 114.0579');
      }
      return true;
    }
    case 'shop': {
      const shop = loadShops().find((s) => s.shop_id === arg);
      if (!shop) { console.log('未找到花店，可用 /shops 查看列表'); return true; }
      console.log(JSON.stringify(shop, null, 2));
      return true;
    }
    case 'shops': {
      for (const s of loadShops()) console.log(`  ${s.shop_id}  ${s.name}（${s.district}）评分${s.rating} 花材${s.support_flowers.length}种`);
      return true;
    }
    case 'feedback': {
      const parts = (arg || '').trim().split(/\s+/).filter(Boolean);
      if (!parts.length) {
        console.log('用法：/feedback <动作> [评分1-5] [评语...]');
        console.log('  动作: accepted | modified | abandoned | ordered | thumbs_up | thumbs_down');
        console.log('  自动关联当前会话最新方案；例：/feedback thumbs_up 5 很满意');
        return true;
      }
      const action = parts[0];
      let rating = null;
      let comment = '';
      const rest = parts.slice(1);
      if (rest.length && /^\d(\.\d)?$/.test(rest[0])) { rating = Number(rest[0]); comment = rest.slice(1).join(' '); }
      else comment = rest.join(' ');
      const planId = state.session && state.session.latest_plan ? state.session.latest_plan.plan_id : null;
      if (!planId) { console.log('⚠️ 当前没有可反馈的方案，先聊出一份方案再反馈'); return true; }
      try {
        const rec = feedbackStore.recordFeedback({ session_id: state.session.session_id, plan_id: planId, action, rating, comment });
        const sig = feedbackStore.getSignals();
        console.log('✅ 已记录反馈：' + action + (rating != null ? (' 评分' + rating) : '') + (comment ? ('「' + comment + '」') : ''));
        console.log('   学习信号：累计 ' + sig.total_feedback + ' 条，采纳率 ' + (sig.adoption_rate == null ? '—' : sig.adoption_rate + '%') + '，均分 ' + (sig.avg_rating == null ? '—' : sig.avg_rating));
        if (sig.low_adoption_flowers.length) console.log('   需降权花材：' + sig.low_adoption_flowers.join(', '));
      } catch (e) {
        console.log('❌ ' + (e.message));
      }
      return true;
    }
    case 'exit':
      console.log('👋 再见');
      process.exit(0);
  }
  return false;
}

function bannerHelp() {
  return [
    '可用命令：',
    '  /help                帮助',
    '  /reset               重置会话',
    '  /session             查看会话需求与版本历史',
    '  /location <lat> <lng> 设置用户位置',
    '  /shops               列出全部花店',
    '  /shop <shop_id>      查看花店详情',
    '  /feedback <动作> [评分] [评语]  记录方案反馈（沉淀学习信号）',
    '  /exit                退出'
  ].join('\n');
}

let closed = false;
let busy = 0;
let queued = 0;

function maybeExit() {
  if (closed && busy === 0 && queued === 0) process.exit(0);
}

async function onInput(line) {
  const text = (line || '').trim();
  if (!text) return;
  if (text.startsWith('/')) {
    const [cmd, ...rest] = text.slice(1).split(' ');
    if (!handleCommand(cmd, rest.join(' '))) console.log('未知命令，输入 /help 查看');
    return;
  }
  console.log('\n🧠 思考中…');
  busy++;
  try {
    const res = await runAgent({
      text,
      session: state.session,
      location: state.location,
      config: { skip_image: process.env.AGENT_SKIP_IMAGE === '1' }
    });
    state.session = res.session;
    console.log('\n🤖 ' + res.reply);
    console.log('\n【需求 v' + res.plan_version + '】' + fmtRequirements(res.session.requirements));
    if (res.plan) {
      console.log('\n【方案】');
      console.log(fmtPlan(res.plan));
    }
    if (res.domain_insights && (res.domain_insights.trends.length || res.domain_insights.region || res.domain_insights.knowledge.length)) {
      const ins = res.domain_insights;
      const parts = [];
      if (ins.trends.length) parts.push('当下流行：' + ins.trends.map((t) => `${t.name}(${t.month}月)`).join('、'));
      if (ins.region) parts.push(`区域(${ins.region.district})偏好${ins.region.popular_styles.join('/')}`);
      if (ins.knowledge.length) parts.push('懂行：' + ins.knowledge.map((k) => k.title).join('、'));
      console.log('\n💡 ' + parts.join('  |  '));
    }
    if (!res.need_clarify && res.shop_suggestions && res.shop_suggestions.length) {
      console.log('\n【附近花店】');
      console.log(fmtShops(res.shop_suggestions));
    } else if (res.need_clarify) {
      console.log('\n（信息不足，先反问用户，暂不出方案与花店匹配）');
    }
  } catch (e) {
    console.log('❌ 出错了：' + (e && e.message));
  } finally {
    busy--;
    maybeExit();
  }
}

banner();
// 串行处理输入：保证多句连续输入时会话上下文按顺序累积（并发会导致 session 竞态）
let inputQueue = Promise.resolve();
rl.on('line', (line) => {
  queued++;
  inputQueue = inputQueue
    .then(() => onInput(line))
    .finally(() => { queued--; maybeExit(); });
});
rl.on('close', () => {
  closed = true;
  maybeExit();
});
