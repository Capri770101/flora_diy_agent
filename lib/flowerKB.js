// 花卉知识库：加载 + 检索打分
const { readJson } = require('./util');

let _cache = null;
function all() {
  if (!_cache) _cache = readJson('flowers.json');
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
  // 当季加分
  if (flower.season.includes('全年')) s += 1;
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
