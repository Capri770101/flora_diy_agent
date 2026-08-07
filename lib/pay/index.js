// 支付模块（接口化 + mock 实现）
// 设计：下单支付统一走 createPayment(order)，当前 provider='mock' 返回模拟支付参数；
// 生产环境接入微信支付时，仅需在此新增 wechat provider 实现相同签名契约，调用方无需改动。
//
// 契约：createPayment(order) -> Promise<{ timeStamp, nonceStr, package, signType, paySign }>

const PROVIDER = process.env.PAY_PROVIDER || 'mock';

async function mockCreatePayment(order) {
  return {
    timeStamp: String(Math.floor(Date.now() / 1000)),
    nonceStr: Math.random().toString(36).slice(2, 12),
    package: 'prepay_id=mock_' + order.order_id,
    signType: 'RSA',
    paySign: 'MOCK_SIGN_' + order.order_id
  };
}

// 预留真实微信支付实现位置（当前未启用）：
// async function wechatCreatePayment(order) { ... 调用微信统一下单 JSAPI ... }

async function createPayment(order) {
  if (PROVIDER === 'mock') return mockCreatePayment(order);
  // if (PROVIDER === 'wechat') return wechatCreatePayment(order);
  throw new Error('unknown pay provider: ' + PROVIDER);
}

module.exports = { createPayment, provider: PROVIDER };
