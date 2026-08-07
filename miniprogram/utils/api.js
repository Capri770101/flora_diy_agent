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

// ============================================================================
// 领域接口封装（对齐后端 M19 契约）
// ----------------------------------------------------------------------------
// 对话结构化卡片协议（后端在 /api/v1/chat 与 /api/v1/chat/stream 的 done 帧
// 透传 `card` 字段，前端按 kind 渲染对应交互卡，均不阻塞对话流）：
//   kind=null            普通文本轮，无特殊卡片
//   'clarify'            关键需求未齐 → 回显缺失字段，引导用户补充（不出方案）
//   'confirm'            关键需求齐 → 方案确认卡（含 requirements 摘要）；用户确认后才进入分支
//   'branch'             确认后 → 询问「现有方案 / DIY」二选一
//   'image_ask'          DIY 分支 → 询问是否生成效果图（原有商家效果图则跳过此步）
//   'shop_select'        方案定稿后 → 独立选店卡（Top3 门店），与方案卡分离
// 重要：方案卡（plan）不含店铺选择；店铺选择只在 shop_select 卡片内呈现（改进②）。
// 历史方案：GET /api/v1/plans 返回服务端持久化列表（改进⑤，跨设备）。
// 下单支付：POST /api/v1/orders 创建；POST /api/v1/orders/:id/pay 调支付接口
//          （当前 provider=mock，返回 MOCK_SIGN_ 签名；预留微信支付替换点，改进⑥）。
// ============================================================================

// 一次性对话（非流式）：返回完整响应体（含 card / plan / shop_suggestions）
function chat(body) {
  return request('/api/v1/chat', 'POST', body);
}

// 流式对话（打字机）：handlers.onDone(payload) 中的 payload 同样含 card / plan / shop_suggestions
function chatStream(body, handlers) {
  return requestStream('/api/v1/chat/stream', 'POST', body, handlers);
}

// 历史方案列表（服务端持久化，跨设备）
function getPlans() {
  return request('/api/v1/plans', 'GET');
}

// 单个方案详情
function getPlan(id) {
  return request('/api/v1/plans/' + id, 'GET');
}

// 单个订单详情
function getOrder(id) {
  return request('/api/v1/orders/' + id, 'GET');
}

// 创建订单（plan_id + shop_id 必填）
function createOrder(body) {
  return request('/api/v1/orders', 'POST', body);
}

// 调起支付（当前 mock；生产接入微信支付后签名契约不变）
function payOrder(id) {
  return request('/api/v1/orders/' + id + '/pay', 'POST', {});
}

module.exports = { request, requestStream, chat, chatStream, getPlans, getPlan, getOrder, createOrder, payOrder };