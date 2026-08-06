// API 全链路冒烟测试（零依赖，node:fetch）
// 运行：node test/api.smoke.js [baseUrl]
const BASE = process.argv[2] || 'http://localhost:3000';

let pass = 0;
let fail = 0;
const failures = [];

function check(cond, msg) {
  if (cond) { pass++; console.log('  ✅ ' + msg); return; }
  fail++;
  failures.push(msg);
  console.log('  ❌ ' + msg);
}

async function api(path, method = 'GET', body = null) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

(async () => {
  console.log('1) chat → 方案 + 选店');
  const chat = await api('/api/v1/chat', 'POST', {
    message: '想给我妈做个生日花束，预算150，淡紫色，温柔一点，不要玫瑰',
    location: { lat: 22.5431, lng: 114.0579 },
    skip_image: true
  });
  check(chat.status === 200, 'chat 200');
  check(chat.data && chat.data.plan_id, '返回 plan_id');
  check(chat.data.session_id, '返回 session_id');
  check(chat.data.shop_suggestions && chat.data.shop_suggestions.length === 3, '返回 Top3 花店');
  const planId = chat.data.plan_id;
  const shopId = chat.data.shop_suggestions[0].shop_id;

  console.log('2) 多轮追问（同 session）');
  const follow = await api('/api/v1/chat', 'POST', {
    message: '换成粉色',
    session_id: chat.data.session_id,
    skip_image: true
  });
  check(follow.status === 200, '追问 200');
  check(follow.data.plan_version === 2, '追问后版本 = 2');
  check(follow.data.plan_id !== planId, '追问生成新方案');

  console.log('3) 创建订单（店铺计价）');
  const ord = await api('/api/v1/orders', 'POST', {
    plan_id: planId,
    shop_id: shopId,
    user_id: 'smoke-test',
    delivery_type: 'delivery',
    address: '福田区测试地址',
    remark: '冒烟测试'
  });
  check(ord.status === 200, '创建订单 200');
  check(ord.data.status === 'created', '初始状态 created');
  check(ord.data.price_total > 0, '店铺报价 > 0');
  check(typeof ord.data.price_diff === 'number', '含与方案价差');
  const orderId = ord.data.order_id;

  console.log('4) 支付（mock prepay）');
  const pay = await api('/api/v1/orders/' + orderId + '/pay', 'POST', {});
  check(pay.status === 200, '支付 200');
  check(pay.data.order.status === 'paid', '支付后 paid');
  check(pay.data.payment && pay.data.payment.package.startsWith('prepay_id='), '返回 wx.requestPayment 参数');

  console.log('5) 状态流转');
  const making = await api('/api/v1/orders/' + orderId + '/status', 'POST', { status: 'making' });
  check(making.data.status === 'making', 'making');
  const delivering = await api('/api/v1/orders/' + orderId + '/status', 'POST', { status: 'delivering' });
  check(delivering.data.status === 'delivering', 'delivering');
  const done = await api('/api/v1/orders/' + orderId + '/status', 'POST', { status: 'done' });
  check(done.data.status === 'done', 'done');

  console.log('6) 非法流转被拒');
  const bad = await api('/api/v1/orders/' + orderId + '/status', 'POST', { status: 'canceled' });
  check(bad.status === 400, 'done 之后 canceled 应 400');

  console.log('7) 订单列表与详情');
  const list = await api('/api/v1/orders?user_id=smoke-test');
  check(list.status === 200 && list.data.some((o) => o.order_id === orderId), '列表包含本订单');
  const detail = await api('/api/v1/orders/' + orderId);
  check(detail.status === 200 && detail.data.order_id === orderId, '详情可查');

  console.log('8) 花店列表/详情');
  const shops = await api('/api/v1/shops');
  check(shops.status === 200 && shops.data.length >= 3, '花店列表');
  const shop = await api('/api/v1/shops/' + shopId);
  check(shop.status === 200 && shop.data.shop_id === shopId, '花店详情');

  console.log('\nAPI 冒烟测试：' + pass + ' 通过 / ' + fail + ' 失败');
  if (failures.length) {
    console.log('\n失败明细：\n' + failures.join('\n'));
    process.exitCode = 1;
  }
})();
