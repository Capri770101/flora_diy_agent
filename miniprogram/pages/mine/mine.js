// 我的：历史方案
Page({
  data: { list: [] },
  onShow() {
    this.setData({ list: wx.getStorageSync('history') || [] });
  },
  open(e) {
    wx.navigateTo({ url: '/pages/plan/plan?id=' + e.currentTarget.dataset.id });
  },
  goOrders() {
    wx.navigateTo({ url: '/pages/orders/orders' });
  }
});
