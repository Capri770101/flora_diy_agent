// app.js
App({
  globalData: {
    // 后端地址：开发者工具模拟器用 localhost；真机预览改回电脑局域网 IP（如 http://192.168.0.147:3000），上线后改为 HTTPS 域名
    apiBase: 'http://localhost:3000',
    // 定位（授权拒绝时回退深圳福田中心）
    location: { lat: 22.5431, lng: 114.0579 },
    locationReady: false
  },
  onLaunch() {
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
