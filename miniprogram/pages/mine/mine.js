// 我的：历史方案 + API 地址设置
const app = getApp();
Page({
  data: {
    list: [],
    apiBase: '',
    apiStatus: '',
    apiStatusClass: ''
  },
  onShow() {
    // 读 storage 里最新的 apiBase（input 也要反映），不在这里写
    const stored = wx.getStorageSync('apiBase') || (app.globalData && app.globalData.apiBase) || '';
    this.setData({
      list: wx.getStorageSync('history') || [],
      apiBase: stored
    });
  },
  open(e) {
    wx.navigateTo({ url: '/pages/plan/plan?id=' + e.currentTarget.dataset.id });
  },
  goOrders() {
    wx.navigateTo({ url: '/pages/orders/orders' });
  },
  // API 地址设置：保存到 storage，下次请求生效
  onApiInput(e) {
    this.setData({ apiBase: e.detail.value, apiStatus: '', apiStatusClass: '' });
  },
  saveApi() {
    const v = (this.data.apiBase || '').trim();
    if (!v) {
      this.setData({ apiStatus: '地址不能为空', apiStatusClass: 'api-err' });
      return;
    }
    if (!/^https?:\/\//i.test(v)) {
      this.setData({ apiStatus: '须以 http:// 或 https:// 开头', apiStatusClass: 'api-err' });
      return;
    }
    // 去掉末尾的 /，避免拼接出 //xxx
    const normalized = v.replace(/\/+$/, '');
    wx.setStorageSync('apiBase', normalized);
    if (app.globalData) app.globalData.apiBase = normalized;
    this.setData({ apiBase: normalized, apiStatus: '已保存，请求将使用此地址', apiStatusClass: 'api-ok' });
  },
  testApi() {
    // 触发一次轻量接口，验证地址可达
    const self = this;
    const url = (this.data.apiBase || '').trim() + '/health';
    if (!/^https?:\/\//i.test(url)) {
      this.setData({ apiStatus: '请先填写并保存有效地址', apiStatusClass: 'api-err' });
      return;
    }
    this.setData({ apiStatus: '测试中…', apiStatusClass: '' });
    wx.request({
      url,
      method: 'GET',
      timeout: 5000,
      success: (r) => {
        if (r.statusCode === 200) {
          self.setData({ apiStatus: '✓ 后端可达，状态正常', apiStatusClass: 'api-ok' });
        } else {
          self.setData({ apiStatus: '✗ 状态码 ' + r.statusCode, apiStatusClass: 'api-err' });
        }
      },
      fail: (e) => {
        self.setData({ apiStatus: '✗ 连不上：' + (e.errMsg || '网络错误'), apiStatusClass: 'api-err' });
      }
    });
  }
});
