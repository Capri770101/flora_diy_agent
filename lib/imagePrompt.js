// 英文图像 Prompt 构造
const dataLayer = require('./dataLayer');
const flowerKB = require('./flowerKB');

function placementPhrase(placement) {
  const templates = dataLayer.templatesAll();
  if (placement && templates.placements[placement]) return templates.placements[placement];
  return 'on a clean studio background';
}

function uniqueColorNames(plan) {
  const set = new Set();
  plan.items.forEach((i) => i.colorName && set.add(i.colorName));
  return [...set];
}

// 用户禁忌花材 → 中文名列表（用于正面排除与负面 prompt）
function forbiddenNames(plan) {
  const req = plan.requirements || {};
  return [...new Set((req.forbidden || [])
    .map((id) => { const f = flowerKB.byId(id); return f ? f.name : null; })
    .filter(Boolean))];
}

// 负面词：禁忌花材 + 通用低质词（写进文生图 negative_prompt，防模型自由发挥）
function buildNegativePrompt(plan) {
  return [...forbiddenNames(plan), '水印', '文字', '低质量', '模糊', '畸变', '杂乱背景'].join('，');
}

function buildImagePrompt(plan, req) {
  const styleStr = (req.style && req.style.length ? req.style.join(', ') : 'elegant');
  const catStr = (req.category || 'bouquet');
  const colorStr = uniqueColorNames(plan).join(', ') || 'mixed';
  const flowers = plan.items.filter((i) => i.role !== '叶材').map((i) => i.en);
  const flowerEn = [...new Set(flowers)].join(', ');
  const bg = placementPhrase(req.placement);
  const pkg = plan.package || 'wrapping paper';
  return `A ${styleStr} ${req.occasion || ''} ${catStr} in ${colorStr} tones, featuring ${flowerEn}, ${pkg}, ${bg}, photorealistic, soft studio lighting, high detail, 8k`;
}

// 中文图像 Prompt（通义万象等中文模型效果更好）
function buildImagePromptZh(plan, req) {
  const styleStr = req.style && req.style.length ? req.style.join('、') : '优雅';
  const catStr = req.category || '花束';
  const colors = uniqueColorNames(plan).join('、') || '淡雅';
  const flowerZh = [...new Set(plan.items.filter((i) => i.role !== '叶材').map((i) => i.name))].join('、');
  const forbid = forbiddenNames(plan);
  const forbidStr = forbid.length ? `，画面中严禁出现${forbid.join('、')}` : '';
  const occ = req.occasion || '鲜花';
  const pkg = plan.package || '简约包装纸';
  const bg = placementPhrase(req.placement);
  return `一束${styleStr}风格的${occ}${catStr}，主花材仅由${flowerZh}构成${forbidStr}，整体${colors}色调，${pkg}，${bg}，写实摄影风格，柔和的影棚灯光，浅色简洁背景，高细节，8K画质，无文字无水印`;
}

// 中文方案摘要（用于界面展示）
function buildSummary(plan, req) {
  const names = plan.items.map((i) => `${i.name}${i.qty}${i.unit}`).join('、');
  const styleStr = req.style && req.style.length ? req.style.join('/') : '自然';
  const occ = req.occasion || req.intent || '鲜花';
  return `一份${styleStr}风格的${occ}${plan.category}：${names}，配${plan.package}。`;
}

module.exports = { buildImagePrompt, buildImagePromptZh, buildNegativePrompt, buildSummary, placementPhrase };
