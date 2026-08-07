// app.js
App({
  globalData: {
    // 后端地址默认（开发者工具模拟器用 localhost；真机预览须改成电脑局域网 IP 如 http://192.168.0.147:3000）
    // 真机用户可在「我的」页 → API 设置里改；改动写入 wx.storage，启动时优先读 storage
    apiBase: 'http://localhost:3000',
    // 定位（授权拒绝时回退深圳福田中心）
    location: { lat: 22.5431, lng: 114.0579 },
    locationReady: false
  },
  onLaunch() {
    // 优先用 storage 里用户改过的地址（真机换 Wi-Fi 不用重新打包）
    try {
      const stored = wx.getStorageSync('apiBase');
      if (stored && /^https?:\/\//.test(stored)) {
        this.globalData.apiBase = stored;
      }
    } catch (e) { /* storage 不可用时继续用默认 */ }
    this.fetchLocation();
  },
  fetchLocation() {
    const self = this;
    wx.getLocation({
      type: 'gcj02',
      success(res) {
        self.globalData.location = { lat: res.latitude, lng: res.longitude };
        self.globalData.locationReady = true;
      },
      fail() {
        console.warn('getLocation 失败，使用默认位置（深圳福田中心）');
      }
    });
  }
});
