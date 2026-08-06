// 声明式路由：{ method, pattern, handler(ctx) } 注册 + 匹配 + 参数提取
// ctx = { req, res, params, query, body, url, method, remoteAddr }
// pattern 支持 :param 段（如 /api/v1/orders/:id），handler 抛出的错误由中间件统一处理。
function compile(pattern) {
  const names = [];
  const reSrc = pattern
    .split('/')
    .map((seg) => {
      if (seg.startsWith(':')) {
        names.push(seg.slice(1));
        return '([^/]+)';
      }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { re: new RegExp('^' + reSrc + '$'), names };
}

class Router {
  constructor() {
    this.routes = [];
  }
  // 注册路由。handler: async (ctx) => void（应负责写响应）
  add(method, pattern, handler) {
    if (!/^(GET|POST|PUT|DELETE|PATCH|OPTIONS)$/.test(method)) {
      throw new Error(`router: 不支持的方法 ${method}`);
    }
    this.routes.push({ method, pattern, handler, compiled: compile(pattern) });
    return this;
  }
  get(pattern, h) { return this.add('GET', pattern, h); }
  post(pattern, h) { return this.add('POST', pattern, h); }
  put(pattern, h) { return this.add('PUT', pattern, h); }
  delete(pattern, h) { return this.add('DELETE', pattern, h); }
  options(pattern, h) { return this.add('OPTIONS', pattern, h); }

  // 匹配一个请求。返回 { handler, params } 或 null
  match(method, pathname) {
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const m = r.compiled.re.exec(pathname);
      if (!m) continue;
      const params = {};
      r.compiled.names.forEach((n, i) => { params[n] = decodeURIComponent(m[i + 1]); });
      return { handler: r.handler, params };
    }
    return null;
  }

  // 列出全部路由（供 OpenAPI / 调试）
  list() {
    return this.routes.map((r) => ({ method: r.method, pattern: r.pattern }));
  }
}

module.exports = { Router };