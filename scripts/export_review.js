// 知识质检流水线 · 导出专家审阅清单（离线、只读）
//
// 把 14 域种子（lib/seed.js 各数组）与 data/flowers.json 的 source/confidence
// 元数据聚合成一份可审阅清单，输出：
//   data/review/review_checklist.md   按域分组的审阅表（含摘要/上下文、复核状态）
//   data/review/review_checklist.csv  扁平表，便于在 Excel/表格里筛选排序
//   data/review/reviews.example.json  复核回写文件的模板
//
// 复核回写：在 data/review/reviews.json 中按 "<域>::<id>" 记录复核结果
//   { "A花卉::rose": { "status": "confirmed", "reviewer": "花艺师-王", "note": "无误" } }
// 再次运行本脚本会把复核结果合并进清单（status 列显示实际状态）。
//
// 注意：本脚本仅读取种子/JSON，不写入运行时库表。require seed 会顺带打开 DB，
// 故先把 FLORA_DATA_DIR 指到临时目录，隔离任何副作用。
const fs = require('fs');
const path = require('path');
const os = require('os');

// —— 隔离 DB 副作用：必须在 require('../lib/seed') 之前设置 ——
// 用固定临时目录（不每次新建），避免系统 temp 堆积；仅 require seed 会顺带打开它。
process.env.FLORA_DATA_DIR = path.join(os.tmpdir(), 'flora_qc_export');

// 静音 node:sqlite 的 ExperimentalWarning（require seed 会顺带打开临时库）
process.on('warning', (w) => {
  if (w && w.name === 'ExperimentalWarning' && /SQLite/.test(w.message || '')) return;
});

const SEED = require('../lib/seed');
const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const REVIEW_DIR = path.join(DATA_DIR, 'review');

const LOW_CONF = 0.6; // 低于该值标记为"优先复核"
const DOMAIN_ORDER = ['A花卉', 'D地区', 'F潮流', 'G物流', 'J知识', 'K合规', 'L营销', 'M竞品'];

function mk(domain, id, name, source, confidence, context) {
  return {
    domain, id, name: name || '',
    source: source || '',
    confidence: typeof confidence === 'number' ? confidence : null,
    status: 'pending', reviewer: '', note: '',
    context: context || ''
  };
}

function buildRecords() {
  const recs = [];
  const flowers = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'flowers.json'), 'utf8'));
  for (const f of flowers) {
    recs.push(mk('A花卉', f.id, `${f.name} (${f.en})`, f.source, f.confidence,
      `角色:${f.role}; 季节:${f.season}; 参考价:${f.price}${f.unit}; 过敏:${f.过敏 ? '是' : '否'}`));
  }
  for (const r of SEED.REGION_SEED) {
    recs.push(mk('D地区', r.region_id, `${r.city}${r.district}`, r.source, r.confidence, r.note));
  }
  for (const t of SEED.TREND_SEED) {
    recs.push(mk('F潮流', t.trend_id, `M${t.month} · ${t.flower_id}`, t.source, t.confidence, `流行度 score=${t.score}`));
  }
  for (const z of SEED.LOGISTICS_SEED) {
    recs.push(mk('G物流', z.zone_id, `${z.region_ref} / ${z.carrier}`, z.source, z.confidence, `时效 ${z.lead_time_days} 天 · 运费 ¥${z.fee}`));
  }
  for (const k of SEED.KNOWLEDGE_SEED) {
    recs.push(mk('J知识', k.knowledge_id, k.title, k.source, k.confidence, `[${k.category}] ${k.body}`));
  }
  for (const c of SEED.COMPLIANCE_SEED) {
    recs.push(mk('K合规', c.rule_id, c.title, c.source, c.confidence, `[${c.category}] 适用:${c.applies_to}`));
  }
  for (const m of SEED.MARKETING_SEED) {
    recs.push(mk('L营销', m.campaign_id, m.title, m.source, m.confidence, m.benefit_detail));
  }
  for (const c of SEED.COMPETITOR_SEED) {
    recs.push(mk('M竞品', c.competitor_id, c.name, c.source, c.confidence, c.note));
  }
  return recs;
}

function loadReviews() {
  const p = path.join(REVIEW_DIR, 'reviews.json');
  if (!fs.existsSync(p)) return {};
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) || {}; }
  catch (e) { console.warn('⚠️ reviews.json 解析失败，按未复核处理:', e.message); return {}; }
}

function mergeReviews(recs, reviews) {
  for (const r of recs) {
    const rv = reviews[`${r.domain}::${r.id}`];
    if (rv) {
      if (rv.status) r.status = rv.status;
      if (rv.reviewer) r.reviewer = rv.reviewer;
      if (rv.note) r.note = rv.note;
    }
  }
  return recs;
}

function csvCell(v) {
  const s = v == null ? '' : String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function mdCell(v) {
  return (v == null ? '' : String(v)).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function isLow(r) { return r.confidence != null && r.confidence < LOW_CONF; }

function writeCsv(recs) {
  const cols = ['domain', 'id', 'name', 'source', 'confidence', 'status', 'reviewer', 'note', 'context'];
  const lines = [cols.join(',')];
  for (const r of recs) lines.push(cols.map((c) => csvCell(r[c])).join(','));
  fs.writeFileSync(path.join(REVIEW_DIR, 'review_checklist.csv'), lines.join('\r\n') + '\r\n', 'utf8');
}

function writeMd(recs, reviews) {
  const groups = {};
  for (const r of recs) (groups[r.domain] = groups[r.domain] || []).push(r);

  const total = recs.length;
  const pending = recs.filter((r) => r.status === 'pending').length;
  const confirmed = recs.filter((r) => r.status === 'confirmed').length;
  const revised = recs.filter((r) => r.status === 'revised').length;
  const rejected = recs.filter((r) => r.status === 'rejected').length;
  const low = recs.filter(isLow);

  const out = [];
  out.push('# 知识质检 · 专家审阅清单');
  out.push('');
  out.push(`> 自动生成时间：${new Date().toISOString()}`);
  out.push('> 本清单汇集 14 域种子与花材库中的 source（来源）+ confidence（置信度）元数据，');
  out.push('> 供专家/运营逐条复核。置信度刻度：合规/法规 0.95 > 平台运营 0.90 > 花艺师手册 0.85 > 行业资料 0.80 > 平台种子 0.75 > 竞品估算 0.70 > 潮流基线 0.60。');
  out.push('> 低于 ' + LOW_CONF + ' 的条目已用 ⚠️ 标记，建议优先复核。');
  out.push('');
  out.push('## 总览');
  out.push('');
  out.push(`- 条目总数：**${total}**`);
  out.push(`- 待复核：${pending} · 已确认：${confirmed} · 已修订：${revised} · 已驳回：${rejected}`);
  out.push(`- 低置信度（优先复核）：${low.length}`);
  out.push('');
  out.push('| 域 | 条目数 | 已复核 | 低置信度 |');
  out.push('| --- | ---: | ---: | ---: |');
  for (const d of DOMAIN_ORDER) {
    const g = groups[d] || [];
    if (!g.length) continue;
    const done = g.filter((r) => r.status !== 'pending').length;
    const lo = g.filter(isLow).length;
    out.push(`| ${d} | ${g.length} | ${done} | ${lo} |`);
  }
  out.push('');

  if (low.length) {
    out.push('## ⚠️ 优先复核（低置信度）');
    out.push('');
    out.push('| 域 | ID | 名称 | 来源 | 置信度 | 当前状态 | 复核备注 |');
    out.push('| --- | --- | --- | --- | ---: | --- | --- |');
    for (const r of low) {
      out.push(`| ${mdCell(r.domain)} | ${mdCell(r.id)} | ${mdCell(r.name)} | ${mdCell(r.source)} | ${r.confidence} | ${mdCell(r.status)} | ${mdCell(r.note)} |`);
    }
    out.push('');
  }

  for (const d of DOMAIN_ORDER) {
    const g = groups[d];
    if (!g || !g.length) continue;
    out.push(`## ${d}（${g.length} 条）`);
    out.push('');
    out.push('| ID | 名称 | 来源 | 置信度 | 状态 | 复核人 | 复核备注 | 摘要/上下文 |');
    out.push('| --- | --- | --- | ---: | --- | --- | --- | --- |');
    for (const r of g) {
      const flag = isLow(r) ? ' ⚠️' : '';
      const ctx = mdCell((r.context || '').slice(0, 60));
      out.push(`| ${mdCell(r.id)} | ${mdCell(r.name)}${flag} | ${mdCell(r.source)} | ${r.confidence} | ${mdCell(r.status)} | ${mdCell(r.reviewer)} | ${mdCell(r.note)} | ${ctx} |`);
    }
    out.push('');
  }

  out.push('---');
  out.push('');
  out.push('## 复核回写说明');
  out.push('');
  out.push('在 `data/review/reviews.json` 中按键 `<域>::<id>` 记录复核结论，例如：');
  out.push('');
  out.push('```json');
  out.push(JSON.stringify({ 'A花卉::rose': { status: 'confirmed', reviewer: '花艺师-王', note: '无误' } }, null, 2));
  out.push('```');
  out.push('');
  out.push('`status` 取值：`pending`（待复核）/ `confirmed`（确认无误）/ `revised`（已修订，需同步回 data 或 seed）/ `rejected`（删除或下线）。');
  out.push('再次运行 `npm run review` 会合并这些结论并重写本清单。');
  out.push('');

  fs.writeFileSync(path.join(REVIEW_DIR, 'review_checklist.md'), out.join('\n'), 'utf8');
}

function writeExample() {
  const p = path.join(REVIEW_DIR, 'reviews.example.json');
  if (fs.existsSync(p)) return;
  const sample = {
    'A花卉::rose': { status: 'confirmed', reviewer: '花艺师-王', note: '无误' },
    'F潮流::t_m12_camellia': { status: 'revised', reviewer: '运营-李', note: '12月流行度偏低，score 建议下调至 0.65' },
    'M竞品::c_orose': { status: 'pending', reviewer: '', note: '' }
  };
  fs.writeFileSync(p, JSON.stringify(sample, null, 2) + '\n', 'utf8');
}

function main() {
  fs.mkdirSync(REVIEW_DIR, { recursive: true });
  let recs = buildRecords();
  const reviews = loadReviews();
  recs = mergeReviews(recs, reviews);
  writeCsv(recs);
  writeMd(recs, reviews);
  writeExample();

  const pending = recs.filter((r) => r.status === 'pending').length;
  const low = recs.filter(isLow).length;
  console.log(`✅ 已导出审阅清单：${recs.length} 条`);
  console.log(`   CSV  : data/review/review_checklist.csv`);
  console.log(`   MD   : data/review/review_checklist.md`);
  console.log(`   待复核 ${pending} 条 · 低置信度 ${low} 条（优先复核）`);
  console.log(`   复核回写模板：data/review/reviews.example.json（复制为 reviews.json 填写即可）`);
}

if (require.main === module) main();
module.exports = { buildRecords, loadReviews, mergeReviews };
