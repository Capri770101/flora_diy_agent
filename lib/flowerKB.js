// 花卉知识库：加载 + 检索打分
const dataLayer = require('./dataLayer');

let _cache = null;
function all() {
  if (!_cache) _cache = dataLayer.flowersAll();
  return _cache;
}

function score(flower, req) {
  let s = 0;
  if (req.style && req.style.some((st) => flower.styleTags.includes(st))) s += 3;
  if (req.occasion && flower.occasions.includes(req.occasion)) s += 3;
  if (req.color_tone && req.color_tone.some((c) => flower.colors.some((col) => col.name === c))) s += 2;
  if (req.preferred && req.preferred.includes(flower.id)) s += 4;
  if (req.forbidden && req.forbidden.includes(flower.id)) s -= 100;
  if (req.avoid_allergen && flower.过敏) s -= 100;
  // 时令收敛：非当季花材强烈降权，直接排除出候选。
  // month 可由门店按所在地区/季节传入（如北方冬季传 12），默认取系统当前月。
  const month = req.month || new Date().getMonth() + 1;
  const months = flower.months || [];
  if (!months.length) s += 1;              // 全年可售
  else if (months.includes(month)) s += 2; // 当季加分
  else s -= 100;                           // 非当季：不可落地
  return s;
}

function search(req, role) {
  return all()
    .filter((f) => f.role === role)
    .map((f) => ({ ...f, _score: score(f, req) }))
    .sort((a, b) => b._score - a._score);
}

function byId(id) {
  return all().find((f) => f.id === id);
}

module.exports = { all, search, byId, score };
