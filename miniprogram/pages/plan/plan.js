// 方案详情页：直接选店 + 下单（独立闭环，不强制回对话）
const { getPlan, getPlanShops } = require('../../utils/api.js');

function fixPlan(p) {
  const app = getApp();
  if (p && p.render_url && p.render_url.startsWith('/')) {
    return Object.assign({}, p, { render_url: (app.globalData.apiBase || '') + p.render_url });
  }
  return p;
}

// 写入本地方案缓存，保证跳订单页时 order.js 能从 planMap 取到方案
function savePlanToMap(p) {
  const map = wx.getStorageSync('planMap') || {};
  map[p.plan_id] = p;
  wx.setStorageSync('planMap', map);
}

Page({
  data: { plan: null, shops: [], selectedShop: null, loadingShops: false },

  async onLoad(q) {
    const id = q && q.id;
    if (!id) return;
    const map = wx.getStorageSync('planMap') || {};
    let plan = map[id];
    if (!plan) {
      try { plan = await getPlan(id); } catch (e) { plan = null; }
    }
    if (plan) {
      plan = fixPlan(plan);
      this.setData({ plan });
      savePlanToMap(plan); // 保证跳 order 时 planMap 可取
    }
    // 拉该方案的匹配花店（独立选店区块，改进②：选店不塞进方案卡）
    this.loadShops(id);
  },

  async loadShops(planId) {
    this.setData({ loadingShops: true });
    try {
      const app = getApp();
      const shops = await getPlanShops(planId, app.globalData.location);
      this.setData({ shops });
    } catch (e) {
      this.setData({ shops: [] });
    } finally {
      this.setData({ loadingShops: false });
    }
  },

  // 选店：高亮并解锁下单
  onPickShop(e) {
    const shopId = e.currentTarget.dataset.shopId;
    const shop = (this.data.shops || []).find((s) => s.shop_id === shopId) || null;
    this.setData({ selectedShop: shop });
  },

  // 去下单：携带 plan_id + shop_id 跳订单页
  goOrder() {
    const p = this.data.plan;
    const c = this.data.selectedShop;
    if (p && c) {
      wx.navigateTo({ url: '/pages/order/order?plan_id=' + p.plan_id + '&shop_id=' + c.shop_id });
    }
  },

  // 备选：回到对话，由独立选店卡片完成（与历史方案 / 对话共用同一下单链路）
  goChat() {
    wx.navigateTo({ url: '/pages/chat/chat' });
  }
});
