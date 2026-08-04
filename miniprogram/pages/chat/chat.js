// 对话页
const { request } = require('../../utils/api.js');

Page({
  data: { input: '', messages: [], plan: null, loading: false },

  onLoad(q) {
    if (q && q.q) {
      this.setData({ input: decodeURIComponent(q.q) });
      this.send();
    }
  },
  onInput(e) { this.setData({ input: e.detail.value }); },

  async send() {
    const text = this.data.input.trim();
    if (!text || this.data.loading) return;
    const msgs = this.data.messages.concat([{ role: 'user', text }]);
    this.setData({ messages: msgs, input: '', loading: true });
    try {
      const data = await request('/api/v1/chat', 'POST', { message: text });
      const botMsgs = this.data.messages.concat([{ role: 'bot', text: data.reply_text }]);
      this.setData({ messages: botMsgs, plan: data.plan, loading: false });
      this.saveHistory(data.plan);
    } catch (e) {
      const err = this.data.messages.concat([{ role: 'bot', text: '出错了：' + (e.errMsg || e.message) }]);
      this.setData({ messages: err, loading: false });
    }
  },

  saveHistory(plan) {
    let map = wx.getStorageSync('planMap') || {};
    map[plan.plan_id] = plan;
    wx.setStorageSync('planMap', map);
    let hist = wx.getStorageSync('history') || [];
    hist.unshift({ plan_id: plan.plan_id, summary: plan.summary, total: plan.total, created_at: plan.created_at });
    wx.setStorageSync('history', hist.slice(0, 50));
  },

  openPlan() {
    if (this.data.plan) {
      wx.navigateTo({ url: '/pages/plan/plan?id=' + this.data.plan.plan_id });
    }
  }
});
