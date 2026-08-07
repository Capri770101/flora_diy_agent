// 首页：场景入口 + 示例 + 历史方案（改进⑤）
const { getPlans } = require('../../utils/api.js');

Page({
  data: {
    scenes: [
      { icon: '🎂', label: '生日', q: '生日花束，温柔浪漫，预算120' },
      { icon: '💐', label: '母亲节', q: '送给妈妈的温柔花束，淡紫色，不要玫瑰，预算150' },
      { icon: '🏠', label: '乔迁', q: '朋友乔迁，高级感花盒，蓝白色系，预算200' },
      { icon: '🌿', label: '家居', q: '给自己做个清新极简瓶花放办公桌，预算80' }
    ],
    plans: []
  },
  onShow() { this.loadPlans(); },
  async loadPlans() {
    try {
      const list = await getPlans();
      const app = getApp();
      const base = app.globalData.apiBase || '';
      const plans = Array.isArray(list) ? list : [];
      this.setData({
        plans: plans.map((p) => Object.assign({}, p, {
          render_url: p.render_url && p.render_url.startsWith('/') ? base + p.render_url : p.render_url
        }))
      });
    } catch (e) {
      // 静默：历史加载失败不影响首页其余功能
    }
  },
  goChat(e) {
    const q = e.currentTarget.dataset.q;
    wx.navigateTo({ url: '/pages/chat/chat?q=' + encodeURIComponent(q) });
  },
  goPlan(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages/plan/plan?id=' + id });
  }
});
