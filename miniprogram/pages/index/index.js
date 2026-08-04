// 首页：场景入口 + 示例
Page({
  data: {
    scenes: [
      { icon: '🎂', label: '生日', q: '生日花束，温柔浪漫，预算120' },
      { icon: '💐', label: '母亲节', q: '送给妈妈的温柔花束，淡紫色，不要玫瑰，预算150' },
      { icon: '🏠', label: '乔迁', q: '朋友乔迁，高级感花盒，蓝白色系，预算200' },
      { icon: '🌿', label: '家居', q: '给自己做个清新极简瓶花放办公桌，预算80' }
    ]
  },
  goChat(e) {
    const q = e.currentTarget.dataset.q;
    wx.navigateTo({ url: '/pages/chat/chat?q=' + encodeURIComponent(q) });
  }
});
