// 选店匹配门面：经插件注册表解析启用的 shop-match adapter（默认 'geo-score'）
// 新增匹配策略（如按 H 供应链库存匹配 / 外部 OMS 匹配）：新建 lib/plugins/shop-match/xxx.js
// 并在此注册即可，无需改动主流程与 server.js（loadShops/effPrice 导出保持兼容）。
const config = require('../config');
const registry = require('../plugins/registry');

registry.register(require('../plugins/shop-match/geo-score'));

const _default = require('../plugins/shop-match/geo-score');
const resolve = () => registry.resolve('shop-match', config) || _default;

function matchShops(plan, opts = {}) {
  return resolve().matchShops(plan, opts);
}
function loadShops() {
  return resolve().loadShops();
}
function effPrice(shop, flowerId) {
  return resolve().effPrice(shop, flowerId);
}

module.exports = { matchShops, loadShops, effPrice };