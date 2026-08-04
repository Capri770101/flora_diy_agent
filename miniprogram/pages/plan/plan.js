// 方案详情页
Page({
  data: { plan: null },
  onLoad(q) {
    const map = wx.getStorageSync('planMap') || {};
    this.setData({ plan: map[q.id] });
  }
});
