// 下单页：确认店铺报价 → 创建订单 → mock 微信支付
const { request } = require('../../utils/api.js');

Page({
  data: {
    plan: null,
    shop: null,
    deliveryType: 'delivery',
    address: '',
    remark: '',
    order: null,
    submitting: false,
    missing: []
  },

  onLoad(q) {
    const planId = q.plan_id;
    const shopId = q.shop_id;
    const map = wx.getStorageSync('planMap') || {};
    const plan = map[planId];
    const shop = (plan && plan.shop_suggestions || []).find((s) => s.shop_id === shopId) || null;
    this.setData({ plan, shop, missing: shop ? shop.missing : [] });
    if (!shop) this.loadShop(shopId);
  },

  async loadShop(shopId) {
    try {
      const shop = await request('/api/v1/shops/' + shopId, 'GET');
      this.setData({ shop });
    } catch (e) { /* 店铺信息缺失不影响下单 */ }
  },

  setDelivery(e) { this.setData({ deliveryType: e.detail.value }); },
  onAddress(e) { this.setData({ address: e.detail.value }); },
  onRemark(e) { this.setData({ remark: e.detail.value }); },

  userId() {
    let id = wx.getStorageSync('devUserId');
    if (!id) {
      id = 'dev-user-' + Date.now().toString(36);
      wx.setStorageSync('devUserId', id);
    }
    return id;
  },

  async submit() {
    if (this.data.submitting) return;
    this.setData({ submitting: true });
    try {
      const body = {
        plan_id: this.data.plan.plan_id,
        shop_id: this.data.shop.shop_id,
        user_id: this.userId(),
        delivery_type: this.data.deliveryType,
        address: this.data.address,
        remark: this.data.remark
      };
      const order = await request('/api/v1/orders', 'POST', body);
      this.setData({ order });
    } catch (e) {
      wx.showToast({ title: '下单失败：' + (e.errMsg || e.message), icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  },

  async pay() {
    if (!this.data.order || this.data.order.status !== 'created') return;
    try {
      const data = await request('/api/v1/orders/' + this.data.order.order_id + '/pay', 'POST', {});
      this.setData({ order: data.order });
      const p = data.payment;
      if (p) {
        wx.requestPayment({
          timeStamp: p.timeStamp,
          nonceStr: p.nonceStr,
          package: p.package,
          signType: p.signType,
          paySign: p.paySign,
          success: () => this.paid('支付成功'),
          fail: () => this.paid('已跳过 mock 支付（订单已标记已支付）')
        });
      } else {
        this.paid('订单已支付');
      }
    } catch (e) {
      wx.showToast({ title: '支付失败：' + (e.errMsg || e.message), icon: 'none' });
    }
  },

  paid(title) {
    wx.showToast({ title, icon: 'none' });
    setTimeout(() => wx.navigateTo({ url: '/pages/orders/orders' }), 800);
  }
});
