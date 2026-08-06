// 方案详情页
Page({
  data: { plan: null },
  onLoad(q) {
    const map = wx.getStorageSync('planMap') || {};
    this.setData({ plan: map[q.id] });
  },
  order(e) {
    const shopId = e.currentTarget.dataset.shop;
    wx.navigateTo({
      url: '/pages/order/order?plan_id=' + this.data.plan.plan_id + '&shop_id=' + shopId
    });
  }
});
