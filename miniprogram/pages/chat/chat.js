// 对话页（流式输出 · 打字机动画 · 思考气泡 · 方案抽屉）
const { request, requestStream } = require('../../utils/api.js');

let seq = 0;

// 思考阶段文案（按真实加载进度出现，每阶段仅一次，不轮播）：
//   [0] 请求发出 → 收到 meta：理解需求
//   [1] 收到 meta → 首个 token：设计 / 选店
const THINKING_STEPS = ['正在理解你的需求…', '正在为你设计方案…'];

Page({
  data: {
    input: '', messages: [], plan: null, planDrawer: false,
    selectedShop: null, loading: false, sessionId: null, scroller: 'top',
    thinking: false, thinkingText: '', thinkingStep: 0
  },

  onLoad(q) {
    if (q && q.q) {
      // 需求1：仅将卡片默认指令预填到输入框（替换已有内容），不自动发送，等待用户确认后手动发送
      this.setData({ input: decodeURIComponent(q.q) });
    }
  },
  onInput(e) { this.setData({ input: e.detail.value }); },

  addMsg(role, text) {
    const msg = { id: 'm' + (++seq), role, text: text || '' };
    const messages = this.data.messages.concat(msg);
    this.setData({ messages, scroller: msg.id });
    return messages.length - 1;
  },

  patchMsg(index, patch) {
    const messages = this.data.messages.slice();
    messages[index] = Object.assign({}, messages[index], patch);
    this.setData({ messages, scroller: messages[index].id });
  },

  // 思考动画：阶段1（理解需求）——发送后立即出现
  startThinking() {
    this.setData({ thinking: true, thinkingStep: 0, thinkingText: THINKING_STEPS[0], scroller: 'thinking' });
  },

  // 收到 meta 帧：进入阶段2（设计/选店），文案只切这一次，不再轮播
  advanceThinking() {
    if (!this.data.thinking) return;
    this.setData({ thinkingStep: 1, thinkingText: THINKING_STEPS[1] });
  },

  stopThinking() {
    this.setData({ thinking: false });
  },

  // 打字机动画：把一次性文本按字符逐段追加到指定消息框
  typeText(index, text, step, done) {
    let i = 0;
    const total = text.length;
    const tick = () => {
      i = Math.min(total, i + step);
      this.patchMsg(index, { text: text.slice(0, i), typing: i < total });
      if (i < total) setTimeout(tick, 24);
      else if (done) done();
    };
    tick();
  },

  // 流式发消息（SSE 打字机）；失败回落普通请求（仍有打字机动画）
  async sendStream(body, fallback) {
    let started = false;
    await requestStream('/api/v1/chat/stream', 'POST', body, {
      onMeta: () => this.advanceThinking(), // 服务端完成理解，进入设计/选店阶段（仅一次）
      onToken: (delta) => {
        if (!started) {
          started = true;
          this.stopThinking();
          this.addMsg('bot', '');
        }
        const idx = this.findLastBot();
        if (idx >= 0) this.patchMsg(idx, { text: this.data.messages[idx].text + delta });
      },
      onDone: (payload) => {
        this._turnDone = true;
        this.stopThinking();
        const idx = this.findLastBot();
        if (idx >= 0) this.patchMsg(idx, { text: payload.reply_text || '', typing: false });
        else this.addMsg('bot', payload.reply_text || '');
        this.setData({ loading: false });
        this.applyResult(payload);
      }
    });
  },

  findLastBot() {
    for (let i = this.data.messages.length - 1; i >= 0; i--) {
      if (this.data.messages[i].role === 'bot') return i;
    }
    return -1;
  },

  // 一次性请求 → 本地打字机动画
  async sendFallback(body, fallback) {
    const data = await request('/api/v1/chat', 'POST', body);
    this._turnDone = true;
    this.stopThinking();
    const idx = this.addMsg('bot', '');
    this.typeText(idx, data.reply_text || '', 4, () => {
      this.patchMsg(idx, { typing: false });
      this.applyResult(data);
    });
  },

  async send() {
    const text = this.data.input.trim();
    if (!text || this.data.loading) return;
    this.addMsg('user', text);
    this.setData({ input: '', loading: true });
    this._turnDone = false; // 本轮是否已收到回复（防重复回答/重复请求）
    this.startThinking();
    const app = getApp();
    const body = {
      message: text,
      session_id: this.data.sessionId || null,
      location: app.globalData.location
    };
    try {
      await this.sendStream(body);
    } catch (e) {
      if (this._turnDone) return; // 已收到回复（done 帧），不要再发一次请求
      try { await this.sendFallback(body); }
      catch (e2) {
        this.stopThinking();
        this.addMsg('bot', '出错了：' + (e2.errMsg || e2.message));
        this.setData({ loading: false });
      }
    }
  },

  // 方案抽屉：打开/关闭（方案详情不占对话流，随时可回看）
  openPlanDrawer() { if (this.data.plan) this.setData({ planDrawer: true }); },
  closePlanDrawer() { this.setData({ planDrawer: false }); },

  applyResult(data) {
    const app = getApp();
    if (data.plan) {
      if (data.render_url && data.render_url.startsWith('/')) {
        data.render_url = app.globalData.apiBase + data.render_url;
        data.plan.render_url = data.render_url;
      }
      data.plan.shop_suggestions = data.shop_suggestions || [];
    }
    this.setData({
      plan: data.plan,
      planDrawer: false, // 新方案到来时关闭抽屉，回到对话
      selectedShop: data.shop_choice || null,
      sessionId: data.session_id,
      loading: false
    });
    if (data.plan) this.saveHistory(data.plan);
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
  },

  pickShop(e) {
    this.setData({ input: '选第' + e.currentTarget.dataset.idx + '家', planDrawer: false });
    this.send();
  },

  sendMore() {
    this.setData({ input: '看看其他店', planDrawer: false });
    this.send();
  },

  goOrder() {
    const p = this.data.plan;
    const c = this.data.selectedShop;
    if (p && c) {
      wx.navigateTo({ url: '/pages/order/order?plan_id=' + p.plan_id + '&shop_id=' + c.shop_id });
    }
  }
});