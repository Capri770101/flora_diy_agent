// 洞察插件 · 地区差异（D 域）
// 优先用最近门店的 district 对应 region，否则按经纬度推断。
// collect 返回 { region } 或 {}。
const dataLayer = require('../../dataLayer');

function regionByLocation(location) {
  if (!location) return null;
  const regions = dataLayer.regionsAll();
  if (!regions.length) return null;
  const shops = dataLayer.shopsAll();
  let best = null;
  let bestD = Infinity;
  for (const s of shops) {
    if (typeof s.lat !== 'number' || typeof s.lng !== 'number') continue;
    const d = (s.lat - location.lat) ** 2 + (s.lng - location.lng) ** 2;
    if (d < bestD) { bestD = d; best = s; }
  }
  if (!best) return null;
  return regions.find((r) => r.district === best.district) || null;
}

function collect(ctx) {
  let region = ctx.firstShopDistrict
    ? dataLayer.regionsAll().find((r) => r.district === ctx.firstShopDistrict)
    : null;
  if (!region) region = regionByLocation(ctx.location);
  if (!region) return {};
  return {
    region: {
      district: region.district,
      city: region.city,
      price_index: region.price_index,
      popular_styles: JSON.parse(region.popular_styles_json || '[]'),
      note: region.note
    }
  };
}

module.exports = {
  id: 'region',
  slot: 'insight',
  priority: 90,
  enabled: () => true,
  collect
};