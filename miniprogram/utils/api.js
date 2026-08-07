// 请求封装
const app = getApp();
// 每次请求现取最新 base（用户改完 storage 后无需重启 app，下一次请求即生效）
function getApiBase() {
  try {
    const stored = wx.getStorageSync('apiBase');
    if (stored && /^https?:\/\//.test(stored)) return stored;
  } catch (e) { /* 忽略 */ }
  return (app.globalData && app.globalData.apiBase) || '';
}
function request(path, method, data) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: getApiBase() + path,
      method: method || 'GET',
      data: data || {},
      header: { 'Content-Type': 'application/json' },
      success: (r) => resolve(r.data),
      fail: reject
    });
  });
}

// SSE 流式请求（打字机效果）。回调：
//   onMeta()            收到 meta 帧（服务端开始思考）
//   onToken(delta)      收到一段文本增量
//   onDone(payload)     收到 done 帧（完整响应体）
// 结束状态机：frame('done') → resolve；网络失败 → reject；收到 done 后不再 settle。
// 防重复：settle 是一次性的，重复回调/超时兜底不会造成二次请求或二次渲染。
function requestStream(path, method, data, handlers) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let doneReceived = false;
    const settleOnce = (fn, arg) => { if (!settled) { settled = true; fn(arg); } };

    const task = wx.request({
      url: getApiBase() + path,
      method: method || 'POST',
      data: data || {},
      header: { 'Content-Type': 'application/json' },
      enableChunked: true,
      responseType: 'arraybuffer',
      success: () => {},
      fail: (e) => settleOnce(reject, e)
    });

    let buf = '';
    const decoder = new TextDecoder('utf-8');
    const flush = (chunkText) => {
      buf += chunkText;
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        if (!frame) continue;
        const lines = frame.split('\n').filter((l) => l.startsWith('data:'));
        for (const l of lines) {
          try {
            const p = JSON.parse(l.slice(5).trim());
            if (p.type === 'meta') { if (handlers.onMeta) handlers.onMeta(p); }
            else if (p.type === 'token') { if (handlers.onToken && p.delta) handlers.onToken(p.delta); }
            else if (p.type === 'done') {
              doneReceived = true;
              if (handlers.onDone) handlers.onDone(p);
              settleOnce(resolve);
            }
            else if (p.type === 'error') { settleOnce(reject, new Error(p.message || 'stream error')); }
          } catch (e) { /* 忽略残帧 */ }
        }
      }
    };

    let chunkAttached = false;
    if (task.onChunkReceived) {
      task.onChunkReceived((r) => {
        if (!r || !r.data) return;
        flush(decoder.decode(r.data, { stream: true }));
      });
    } else {
      chunkAttached = false;
    }
    if (task.onHeadersReceived) {
      task.onHeadersReceived((h) => {
        const ct = h && h.header && h.header['Content-Type'];
        if (ct && ct.indexOf('text/event-stream') < 0) settleOnce(reject, new Error('stream unavailable'));
      });
    }
    // onComplete：仅在尚未通过 done / error settle 兜底 resolve 一次，
    // 避免 done 帧已处理后再走 fallback 造成"重复回答"。
    if (task.onComplete) task.onComplete(() => settleOnce(resolve));
    // 兜底：若基础库不支持流式（一直没收到任何数据且未结束）→ 超时降级由调用方处理。
    setTimeout(() => {
      if (!doneReceived && !settled) { settleOnce(reject, new Error('stream timeout')); }
    }, 30000);
  });
}

module.exports = { request, requestStream };