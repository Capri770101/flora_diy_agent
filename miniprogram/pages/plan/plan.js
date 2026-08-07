// 方案详情页（改进②：仅展示设计，选店/下单回到对话）
const { getPlan } = require('../../utils/api.js');

function fixPlan(p) {
  const app = getApp();
  if (p && p.render_url && p.render_url.startsWith('/')) {
    return Object.assign({}, p, { render_url: (app.globalData.apiBase || '') + p.render_url });
  }
  return p;
}

Page({
  data: { plan: null },
  onLoad(q) {
    const map = wx.getStorageSync('planMap') || {};
    const local = map[q.id];
    if (local) {
      this.setData({ plan: fixPlan(local) });
    } else {
      // 跨设备 / 本地缓存缺失：拉服务端详情
      getPlan(q.id)
        .then((p) => this.setData({ plan: fixPlan(p) }))
        .catch(() => {});
    }
  },
  // 选店下单：回到对话，由独立选店卡片完成（与历史方案 / 对话共用同一下单链路）
  goChat() {
    wx.navigateTo({ url: '/pages/chat/chat' });
  }
});
