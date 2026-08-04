// 请求封装
const app = getApp();
function request(path, method, data) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: (app.globalData.apiBase || '') + path,
      method: method || 'GET',
      data: data || {},
      header: { 'Content-Type': 'application/json' },
      success: (r) => resolve(r.data),
      fail: reject
    });
  });
}
module.exports = { request };
