// 全链路冒烟：验证 ① 扣库存/UGC/meta_learning ② 信号回灌 ④ domain_insights
const BASE = 'http://localhost:3000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DB = require('C:/Users/Capri/Desktop/workbuddytest/lib/db');

async function wait() {
  for (let i = 0; i < 25; i++) {
    try { const r = await fetch(BASE + '/api/v1/health'); if (r.ok) { console.log('server ready'); return; } } catch (e) {}
    await sleep(300);
  }
  throw new Error('server not ready');
}
async function j(url, opt) {
  const r = await fetch(BASE + url, opt);
  return { status: r.status, body: await r.json() };
}

(async () => {
  await wait();

  // 1) chat 生成方案
  const chat = await j('/api/v1/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: '帮我做一束送给妈妈的生日花束，预算200，喜欢粉色温柔风', skip_image: true })
  });
  const plan = chat.body.plan;
  console.log('CHAT', chat.status, '| plan_id', plan && plan.plan_id);
  console.log('  items:', plan && plan.items.map((i) => i.name).join(', '));
  console.log('  reply has 💡:', (chat.body.reply || '').includes('💡'));
  console.log('  domain_insights:', JSON.stringify(chat.body.domain_insights));
  console.log('  ② hydrangea 被历史信号排除?', plan ? !plan.items.some((i) => i.flower_id === 'hydrangea') : 'n/a');

  const shopId = chat.body.shop_suggestions[0].shop_id;
  const pid = plan.plan_id;
  const stockSum = () => DB.ensure().prepare('SELECT SUM(stock_qty) s FROM supply_inventory WHERE shop_id=?').get(shopId).s;
  const ugcRows = () => DB.ensure().prepare('SELECT COUNT(*) c FROM ugc').get().c;

  // 2) 下单前库存
  const invBefore = stockSum();
  const ugcBefore = ugcRows();
  const metaBefore = DB.allMetaLearning().length;

  // 3) 下单
  const order = await j('/api/v1/orders', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plan_id: pid, shop_id: shopId, user_id: 'smoke' })
  });
  console.log('ORDER', order.status, '| total ¥', order.body.price_total, '| shop', shopId);
  const invAfter = stockSum();
  const ugcAfterOrder = ugcRows();
  console.log('  ① 库存扣减:', invBefore, '->', invAfter, '(Δ', invAfter - invBefore, ')');
  console.log('  ① UGC(订单)新增:', ugcAfterOrder - ugcBefore);

  // 4) 反馈 thumbs_up（正向）→ 触发 UGC + meta_learning 回写
  const fb = await j('/api/v1/feedback', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plan_id: pid, action: 'thumbs_up', rating: 5, comment: '很满意' })
  });
  console.log('FEEDBACK', fb.status);
  const ugcAfterFb = ugcRows();
  const metaAfter = DB.allMetaLearning().length;
  console.log('  ① UGC(反馈)新增:', ugcAfterFb - ugcAfterOrder, '| ① meta_learning 新增:', metaAfter - metaBefore);

  // 5) stats
  const stats = await j('/api/v1/feedback/stats');
  console.log('STATS total', stats.body.total, '| adoption%', stats.body.adoption_rate, '| avg', stats.body.avg_rating);
  console.log('  low_adoption_flowers:', JSON.stringify(stats.body.low_adoption_flowers));
  console.log('\n✅ 冒烟完成');
})().catch((e) => { console.error('SMOKE ERR', e.message); process.exit(1); });
