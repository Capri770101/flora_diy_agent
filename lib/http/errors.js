// 统一错误体系：带 HTTP 状态码 + 机器可读错误码的异常
// 用法：throw new HttpError(404, 'NOT_FOUND', 'plan not found', { plan_id })
// HTTP 层统一将 { status, code, message, details } 序列化为响应。
class HttpError extends Error {
  constructor(status, code, message, details = null) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
  toJSON() {
    return { code: this.code, message: this.message, details: this.details };
  }
}

// 常用快捷构造
HttpError.badRequest = (msg, details) => new HttpError(400, 'BAD_REQUEST', msg || 'bad request', details);
HttpError.notFound = (msg) => new HttpError(404, 'NOT_FOUND', msg || 'resource not found');
HttpError.conflict = (msg) => new HttpError(409, 'CONFLICT', msg || 'conflict');
HttpError.rateLimited = (msg) => new HttpError(429, 'RATE_LIMITED', msg || 'too many requests');

// 已注册驱动错误 → 统一错误码
// 本函数不在本项目中使用，见 lib/http/middleware.js 的 toErrorPayload（驱动错误映射集中在服务端）。
module.exports = { HttpError };