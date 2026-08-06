// 澄清反问门面：经插件注册表解析启用的 clarify adapter（默认 'rule' 规则版）
// 新增澄清策略：新建 lib/plugins/clarify/xxx.js 并在此注册即可，无需改动主流程。
const config = require('../config');
const registry = require('../plugins/registry');

registry.register(require('../plugins/clarify/rule'));

const _default = require('../plugins/clarify/rule');
const resolve = () => registry.resolve('clarify', config) || _default;

function findMissingFields(req) {
  return resolve().findMissingFields(req);
}
function askClarification(missing) {
  return resolve().askClarification(missing);
}

// CRITICAL_FIELDS 保持"数组"形态（index.js 用 .includes），随当前插件实时解析
module.exports = {
  get CRITICAL_FIELDS() { return resolve().CRITICAL_FIELDS; },
  findMissingFields,
  askClarification
};