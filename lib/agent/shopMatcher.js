// 选店匹配：把方案花材清单匹配到附近花店，输出 Top N
// 评分（100 分制）：
//   花材覆盖 40 分  × 可提供数量占比
//   价格吻合 30 分  × (1 - 店价合计与方案价差占比)
//   距离     20 分  × (1 - km/15)，无位置时给 10 分
//   评分     10 分  × rating/5
//   缺货惩罚：每缺一种花材 -12 分
// 缺货花店不剔除，保留在结果中并标记"缺 X，可替换"（对应真实撮合场景）
const dataLayer = require('../dataLayer');
const flowerKB = require('../flowerKB');

function loadShops() {
  return dataLayer.shopsAll();
}

function haversineKm(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

// 店铺有效单价：price_map 覆盖 > 全局库价
function effPrice(shop, flowerId) {
  if (shop.price_map && shop.price_map[flowerId] != null) return Number(shop.price_map[flowerId]);
  const f = flowerKB.byId(flowerId);
  return f ? f.price : null;
}

// opts: { location?: {lat, lng}, limit?: number }
function matchShops(plan, opts = {}) {
  const location = opts.location || null;
  const limit = opts.limit || 3;
  const items = plan.items || [];
  const totalQty = items.reduce((s, i) => s + i.qty, 0) || 1;

  const results = loadShops()
    .filter((s) => s.status !== 'closed')
    .map((shop) => {
      const missing = [];
      let availQty = 0;
      let priceTotal = shop.pack_cost != null ? Number(shop.pack_cost) : plan.packCost || 0;
      for (const it of items) {
        const p = effPrice(shop, it.flower_id);
        if (p == null) { missing.push({ flower_id: it.flower_id, name: it.name, qty: it.qty }); continue; }
        availQty += it.qty;
        priceTotal += p * it.qty;
      }
      const coverage = availQty / totalQty;
      const distanceKm = location ? haversineKm(location, shop) : null;
      const priceDiff = Math.abs(priceTotal - (plan.total || 0)) / Math.max(plan.total || 1, 1);

      let score = 0;
      const coverageScore = coverage * 40;
      const priceScore = Math.max(0, 1 - priceDiff) * 30;
      const distanceScore = distanceKm != null ? Math.max(0, 1 - distanceKm / 15) * 20 : 10;
      const ratingScore = ((shop.rating || 4) / 5) * 10;
      score = coverageScore + priceScore + distanceScore + ratingScore - missing.length * 12;

      return {
        shop_id: shop.shop_id,
        name: shop.name,
        district: shop.district || shop.city || '',
        address: shop.address || '',
        rating: shop.rating || 4,
        open_hours: shop.open_hours || '',
        coverage: Math.round(coverage * 100),
        missing: missing.map((m) => ({ flower_id: m.flower_id, name: m.name, qty: m.qty })),
        price_total: Math.round(priceTotal),
        price_diff: plan.total != null ? Math.round(priceTotal - plan.total) : null,
        distance_km: distanceKm != null ? Math.round(distanceKm * 10) / 10 : null,
        score: Math.round(score * 10) / 10,
        score_breakdown: {
          coverage: Math.round(coverageScore),
          price: Math.round(priceScore),
          distance: Math.round(distanceScore),
          rating: Math.round(ratingScore)
        }
      };
    })
    .sort((a, b) => b.score - a.score);

  return results.slice(0, limit);
}

module.exports = { matchShops, loadShops, haversineKm, effPrice };
