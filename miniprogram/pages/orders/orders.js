// 订单列表页
const { request } = require('../../utils/api.js');

const STATUS_TEXT = {
  created: '待支付',
  paid: '已支付·制作中',
  making: '制作中',
  delivering: '配送中',
  done: '已完成',
  canceled: '已取消'
};

Page({
  data: { orders: [], loading: true },

  onShow() {
    this.load();
  },

  userId() {
    let id = wx.getStorageSync('devUserId');
    if (!id) {
      id = 'dev-user-' + Date.now().toString(36);
      wx.setStorageSync('devUserId', id);
    }
    return id;
  },

  async load() {
    try {
      const list = await request('/api/v1/orders?user_id=' + this.userId(), 'GET');
      this.setData({ orders: list, loading: false });
    } catch (e) {
      this.setData({ loading: false });
    }
  },

  statusText(s) { return STATUS_TEXT[s] || s; },

  openPlan(e) {
    wx.navigateTo({ url: '/pages/plan/plan?id=' + e.currentTarget.dataset.plan });
  },

  refresh() { this.load(); }
});
