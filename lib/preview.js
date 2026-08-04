// 结构化 SVG 风格预览图生成（在无文生图 API 时的可视化兜底）
const fs = require('fs');
const path = require('path');

const BG = {
  'soft cream': ['#FFF8F0', '#FDEBD0'],
  'warm blush': ['#FDEEF2', '#F6D5DE'],
  'warm sun': ['#FFF6E0', '#FCE3B4'],
  'vintage sepia': ['#F3E9DC', '#E0C9A6'],
  'clean white': ['#FFFFFF', '#EEF2F5'],
  'garden green': ['#EAF3E6', '#CFE3C4'],
  'studio grey': ['#F2F2F4', '#D9D9DE'],
  'fresh sky': ['#EAF4FB', '#CFE6F5']
};
const WRAP = {
  温柔: '#F3E2D0', 浪漫: '#F6D5DE', 热烈: '#E8C39E', 复古: '#D9C2A0',
  极简: '#E8EEF0', 田园: '#D8C7A0', 高级: '#E6E6E6', 清新: '#EAF1F4'
};

function hashSeed(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

function generateSVG(plan, req) {
  const bg = BG[plan.bg] || BG['soft cream'];
  const wrapColor = WRAP[(req.style && req.style[0])] || '#F0E6DA';
  const seed = hashSeed(plan.plan_id);
  const rand = rng(seed);

  // 构造花头列表（限制数量避免过密）
  const heads = [];
  plan.items.forEach((it) => {
    const cap = it.role === '主花' ? 5 : it.role === '配花' ? 6 : 3;
    const n = Math.min(it.qty, cap);
    for (let i = 0; i < n; i++) heads.push({ color: it.color, role: it.role });
  });

  const cx = 300, cy = 360;
  let body = '';
  // 先画叶材作为底层
  heads.filter((h) => h.role === '叶材').forEach(() => {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand());
    const x = cx + Math.cos(a) * 150 * r;
    const y = cy + Math.sin(a) * 150 * r - 10;
    const rot = Math.floor(rand() * 360);
    body += `<g transform="translate(${x.toFixed(1)},${y.toFixed(1)}) rotate(${rot})"><ellipse rx="22" ry="9" fill="#7FA87F" opacity="0.85"/></g>`;
  });
  // 再画花头
  heads.filter((h) => h.role !== '叶材').forEach((h) => {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand());
    const x = cx + Math.cos(a) * 140 * r;
    const y = cy + Math.sin(a) * 135 * r - 20;
    const rad = h.role === '主花' ? 21 : 15;
    body += `<g><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${rad}" fill="${h.color}" stroke="rgba(0,0,0,0.12)" stroke-width="1.5"/><circle cx="${(x - rad * 0.3).toFixed(1)}" cy="${(y - rad * 0.3).toFixed(1)}" r="${(rad * 0.45).toFixed(1)}" fill="rgba(255,255,255,0.45)"/></g>`;
  });

  const title = `${((req.style && req.style[0]) || '自然')} · ${(req.occasion || req.intent || '鲜花')}${plan.category}`;
  const priceText = plan.total ? `约 ¥${plan.total}` + (plan.budget ? ` / 预算 ¥${plan.budget}` : '') : '';
  const list = plan.items.map((i) => `${i.name}×${i.qty}`).join('  ');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 800" width="600" height="800">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${bg[0]}"/>
      <stop offset="100%" stop-color="${bg[1]}"/>
    </linearGradient>
  </defs>
  <rect width="600" height="800" fill="url(#bg)"/>
  <text x="300" y="56" text-anchor="middle" font-family="PingFang SC, Microsoft YaHei, sans-serif" font-size="30" font-weight="700" fill="#3a3a3a">${escapeXml(title)}</text>
  ${priceText ? `<text x="300" y="92" text-anchor="middle" font-family="sans-serif" font-size="22" fill="#b5651d">${escapeXml(priceText)}</text>` : ''}
  <g transform="translate(0,40)">${body}</g>
  <polygon points="225,600 375,600 300,720" fill="${wrapColor}" stroke="rgba(0,0,0,0.1)"/>
  <polygon points="255,600 345,600 300,690" fill="rgba(255,255,255,0.25)"/>
  <text x="300" y="770" text-anchor="middle" font-family="PingFang SC, sans-serif" font-size="18" fill="#555">${escapeXml(truncate(list, 46))}</text>
  <text x="300" y="792" text-anchor="middle" font-family="sans-serif" font-size="13" fill="#999">风格预览图（结构化示意，非真实照片）</text>
</svg>`;
}

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
}
function truncate(s, n) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function save(plan, req) {
  const dir = path.join(__dirname, '..', 'data', 'previews');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, plan.plan_id + '.svg');
  fs.writeFileSync(file, generateSVG(plan, req), 'utf-8');
  return file;
}

module.exports = { generateSVG, save };
