// 对话页（流式输出 · 打字机动画 · 思考气泡 · 结构化卡片）
const { request, requestStream } = require('../../utils/api.js');

let seq = 0;

// 思考阶段文案（按真实加载进度出现，每阶段仅一次，不轮播）
const THINKING_STEPS = ['正在理解你的需求…', '正在为你设计方案…'];

// 需求字段中文标签（用于确认卡 / 澄清卡展示）
const REQ_LABELS = {
  occasion: '场合', recipient: '对象', category: '品类', budget: '预算',
  style: '风格', color: '色系', preferred: '偏好', avoid: '忌讳',
  scene: '场景', quantity_spec: '数量', month: '月份'
};

function labelOf(k) { return REQ_LABELS[k] || k; }

Page({
  data: {
    input: '', messages: [], plan: null, planDrawer: false,
    selectedShop: null, loading: false, sessionId: null, scroller: 'top',
    thinking: false, thinkingText: '', thinkingStep: 0,
    // 结构化卡片（M19 契约）：按 card.kind 渲染，与对话流互不阻塞
    card: null, confirmRequirements: [], clarifyMissing: [], changed: false
  },

  onLoad(q) {
    if (q && q.q) {
      // 需求1：仅将卡片默认指令预填到输入框（替换已有内容），不自动发送，等待用户确认后手动发送
      this.setData({ input: decodeURIComponent(q.q) });
    }
    // 恢复 v7 欢迎气泡：首次进入主动发一条，避免"白屏未加载"观感（M21 重构时曾误删）
    if (!this.data.sessionId && this.data.messages.length === 0) {
      this.addMsg('bot', '你好呀～我是你的花艺小助手，说说场合、对象、品类和预算，我帮你设计专属方案 🌿');
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
  async sendStream(body) {
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
  async sendFallback(body) {
    const data = await request('/api/v1/chat', 'POST', body);
    this._turnDone = true;
    this.stopThinking();
    const idx = this.addMsg('bot', '');
    this.typeText(idx, data.reply_text || '', 4, () => {
      this.patchMsg(idx, { typing: false });
      this.applyResult(data);
    });
  },

  // 发送一段文本（用户输入或卡片按钮回发）
  async sendText(text) {
    text = (text || '').trim();
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

  send() {
    this.sendText(this.data.input);
  },

  // ── 结构化卡片交互（按钮回发对应意图文本，由后端状态机统一理解）──
  onConfirm() { this.sendText('确认'); },
  onChooseBranch(e) { this.sendText(e.currentTarget.dataset.choice); },     // '现有方案' | 'DIY'
  onChooseImage(e) { this.sendText(e.currentTarget.dataset.choice); },       // '要' | '不用'
  onPickShop(e) {
    const idx = e.currentTarget.dataset.idx;
    const shopId = e.currentTarget.dataset.shopId;
    // 即时高亮已选门店，提升反馈感
    const shops = (this.data.card && this.data.card.data && this.data.card.data.shops) || [];
    const shop = shops.find((s) => s.shop_id === shopId) || null;
    if (shop) this.setData({ selectedShop: shop });
    this.sendText('选第' + idx + '家');
  },
  onMoreShop() { this.sendText('看看其他店'); },

  // 方案抽屉：打开/关闭（方案详情不占对话流，随时可回看）
  openPlanDrawer() { if (this.data.plan) this.setData({ planDrawer: true }); },
  closePlanDrawer() { this.setData({ planDrawer: false }); },

  applyResult(data) {
    const app = getApp();
    const card = data.card || null;

    // 确认卡：展开需求字段为「标签-值」列表
    let confirmRequirements = [];
    if (card && card.kind === 'confirm' && card.data && card.data.requirements) {
      const req = card.data.requirements;
      confirmRequirements = Object.keys(req)
        .filter((k) => req[k] !== null && req[k] !== undefined && req[k] !== '')
        .map((k) => ({ key: labelOf(k), value: req[k] }));
    }

    // 澄清卡：缺失字段转中文标签
    let clarifyMissing = [];
    if (card && card.kind === 'clarify' && card.data && card.data.missing) {
      clarifyMissing = card.data.missing.map(labelOf);
    }

    // 方案：不内嵌店铺选择（选店在独立卡片，改进②）
    let plan = data.plan || null;
    if (plan && data.render_url && data.render_url.startsWith('/')) {
      const url = (app.globalData.apiBase || '') + data.render_url;
      plan.render_url = url;
    }

    this.setData({
      card,
      confirmRequirements,
      clarifyMissing,
      changed: !!data.changed,
      plan,
      planDrawer: false, // 新方案/新卡片到来时关闭抽屉，回到对话
      selectedShop: data.shop_choice || null,
      sessionId: data.session_id,
      loading: false,
      scroller: card ? ('card-' + card.kind) : 'top'
    });
    if (plan) this.saveHistory(plan);
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

  goOrder() {
    const p = this.data.plan;
    const c = this.data.selectedShop;
    if (p && c) {
      wx.navigateTo({ url: '/pages/order/order?plan_id=' + p.plan_id + '&shop_id=' + c.shop_id });
    }
  }
});
