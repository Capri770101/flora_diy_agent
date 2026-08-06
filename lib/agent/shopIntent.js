// 选店意图：识别用户在对话里选择/翻看花店的说法（纯规则，不依赖 LLM）
// 返回：{ type: 'select'|'more'|null, index?, name?, shop? }

const CN_NUM = { 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };

const RE_MORE = /看看其他店|其他店|别的店|换一家|多?几家|还有别的|不想选|都不合适|再看[一1]?家/;
const RE_IDX = /(?:选|定|要|换)(?:择|成|到)?(?:第)?([一二两三四五六1-6])(?:家|个|号|家店|家花店)/;
const RE_FIRST = /(?:就|要|定)(?:这家|那家|第一家|这家吧|这家店)/;

function toIdx(token) {
  return CN_NUM[token] != null ? CN_NUM[token] : parseInt(token, 10);
}

function detectShopIntent(text, shops) {
  const t = (text || '').trim();
  if (!t) return { type: null };
  if (RE_MORE.test(t)) return { type: 'more' };

  let m = t.match(RE_IDX);
  if (!m) m = t.match(RE_FIRST);
  if (m) {
    const idx = toIdx(m[1]) || 1;
    const list = shops || [];
    return { type: 'select', index: idx, shop: list[idx - 1] || null };
  }

  if (shops && shops.length) {
    for (const s of shops) {
      if (t.includes(s.name)) return { type: 'select', index: null, shop: s };
    }
  }
  return { type: null };
}

module.exports = { detectShopIntent };
