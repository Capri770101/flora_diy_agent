// 回执文案门面：经插件注册表解析启用的 reply adapter（默认 'template'）
// 新增话术风格：新建 lib/plugins/reply/xxx.js 并在此注册即可，无需改动主流程。
const config = require('../config');
const registry = require('../plugins/registry');

registry.register(require('../plugins/reply/template'));

const _default = require('../plugins/reply/template');
const resolve = () => registry.resolve('reply', config) || _default;

function buildReply(ctx) {
  return resolve().buildReply(ctx);
}

module.exports = { buildReply };