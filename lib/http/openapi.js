// OpenAPI 3.0 契约生成：从 Router 路由表 + 端点描述元数据生成 JSON 文档
// 挂载为 GET /api/v1/openapi.json，供客户端联调与文档站点使用。

// 端点元数据：`METHOD pattern` -> spec（body 字段列表、路径参数、响应说明）
const ENDPOINTS = {
  'GET /api/v1/health': { summary: '健康检查', resp: { 200: '服务在线' } },
  'POST /api/v1/chat': {
    summary: '对话生成花艺方案',
    body: ['message', 'session_id', 'location', 'shop', 'skip_image', 'shop_limit'],
    resp: { 200: 'session_id / plan / reply_text / shop_suggestions 等' }
  },
  'GET /api/v1/shops': { summary: '花店列表', resp: { 200: '花店数组' } },
  'GET /api/v1/shops/:id': { summary: '花店详情', params: { id: { type: 'string' } }, resp: { 200: '花店对象', 404: 'NOT_FOUND' } },
  'POST /api/v1/orders': { summary: '创建订单（店铺重新计价）', body: ['plan_id', 'shop_id', 'delivery_type', 'user_id', 'address'], resp: { 200: '订单对象', 404: 'NOT_FOUND' } },
  'GET /api/v1/orders': { summary: '订单列表（?user_id= 过滤）', resp: { 200: '订单数组' } },
  'GET /api/v1/orders/:id': { summary: '订单详情', params: { id: { type: 'string' } }, resp: { 200: '订单对象', 404: 'NOT_FOUND' } },
  'POST /api/v1/orders/:id/status': { summary: '订单状态流转', params: { id: { type: 'string' } }, body: ['status'], resp: { 200: '订单对象', 400: 'INVALID_TRANSITION' } },
  'POST /api/v1/orders/:id/pay': { summary: '支付（mock prepay，返回 wx.requestPayment 参数）', params: { id: { type: 'string' } }, resp: { 200: 'order + payment', 400: 'NOT_PAYABLE' } },
  'POST /api/v1/pay/notify': { summary: '支付回调占位', resp: { 200: 'ok' } },
  'POST /api/v1/feedback': { summary: '记录方案反馈（学习闭环）', body: ['plan_id', 'action', 'rating', 'comment'], resp: { 200: 'ok + feedback', 400: 'BAD_FEEDBACK' } },
  'GET /api/v1/feedback/stats': { summary: '反馈聚合信号', resp: { 200: 'aggregate 对象' } }
};

function pathKey(method, pattern) {
  return method + ' ' + pattern;
}

function toOpenApiPath(pattern) {
  // /api/v1/orders/:id -> /api/v1/orders/{id}
  return pattern.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

function buildOpenApi(router) {
  const paths = {};
  for (const r of router.list()) {
    const meta = ENDPOINTS[pathKey(r.method, r.pattern)];
    const path = toOpenApiPath(r.pattern);
    const p = paths[path] = paths[path] || {};
    const params = (meta && meta.params
      ? Object.entries(meta.params).map(([name, s]) => ({ name, in: 'path', required: true, schema: { type: s.type || 'string' } }))
      : []);
    p[r.method.toLowerCase()] = {
      summary: meta ? meta.summary : '（见 API 契约文档.md）',
      tags: ['flora'],
      operationId: 'op_' + path.replace(/[^\w]/g, '_') + '_' + r.method.toLowerCase(),
      parameters: params,
      requestBody: meta && meta.body
        ? { required: true, content: { 'application/json': { schema: { type: 'object', properties: Object.fromEntries(meta.body.map((b) => [b, { type: b === 'skip_image' ? 'boolean' : 'string' }])) } } } }
        : undefined,
      responses: meta
        ? Object.fromEntries(Object.entries(meta.resp).map(([code, desc]) => [code, { description: desc }]))
        : { 200: { description: 'OK' } }
    };
  }
  return {
    openapi: '3.0.3',
    info: { title: 'Flora DIY Agent API', version: '1.0.0', description: '智能花卉 DIY 推荐智能体 REST 接口（微信小程序后端）' },
    paths
  };
}

module.exports = { buildOpenApi, ENDPOINTS };