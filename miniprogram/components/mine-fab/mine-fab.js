// 全局「我的」悬浮按钮：固定在右下角，点击跳转「我的」页面
// 通过外部样式类 fab-pos 控制 bottom（避开各页底部输入栏等）
Component({
  externalClasses: ['fab-pos'],
  methods: {
    goMine() {
      wx.navigateTo({ url: '/pages/mine/mine' });
    }
  }
});
