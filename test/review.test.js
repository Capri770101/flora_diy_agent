// 知识质检流水线 · 导出脚本测试（零依赖，node:assert）
// 运行：node test/review.test.js   （已由 npm test 串联）
//
// 本测试只验证导出脚本的"聚合/合并"逻辑，不触碰运行时库（require 时已把
// FLORA_DATA_DIR 指向临时目录，隔离任何 DB 副作用）。
const assert = require('node:assert/strict');

let pass = 0, fail = 0;
const failures = [];
function check(cond, msg) {
  if (cond) { pass++; return; }
  fail++;
  failures.push('  ' + msg);
}

const review = require('../scripts/export_review');

// 1) 聚合：覆盖 8 个域，共 123 条
const recs = review.buildRecords();
check(recs.length === 123, `应聚合 123 条，实际 ${recs.length}`);
const domains = new Set(recs.map((r) => r.domain));
check(domains.size === 8, `应覆盖 8 个域，实际 ${domains.size}`);
for (const d of ['A花卉', 'D地区', 'F潮流', 'G物流', 'J知识', 'K合规', 'L营销', 'M竞品']) {
  check(domains.has(d), `应覆盖域 ${d}`);
}

// 2) 每条都有 source + 数值 confidence（质检字段齐全）
check(recs.every((r) => typeof r.source === 'string' && r.source.length > 0), '所有条目都应有 source');
check(recs.every((r) => typeof r.confidence === 'number'), '所有条目都应有数值 confidence');

// 3) 关键条目置信度符合刻度约定
const rose = recs.find((r) => r.domain === 'A花卉' && r.id === 'rose');
check(rose && rose.confidence === 0.75, 'A花卉::rose 置信度应为 0.75（平台种子）');
const allergen = recs.find((r) => r.domain === 'K合规' && r.id === 'c_allergen');
check(allergen && allergen.confidence === 0.95, 'K合规::c_allergen 置信度应为 0.95（法规）');
const trend = recs.find((r) => r.domain === 'F潮流');
check(trend && trend.confidence === 0.60, 'F潮流 置信度应为 0.60（基线启发式）');

// 4) 复核回写合并：status/reviewer/note 被正确覆盖
const merged = review.mergeReviews(recs.map((r) => ({ ...r })), {
  'A花卉::rose': { status: 'confirmed', reviewer: '花艺师-王', note: '无误' }
});
const m = merged.find((r) => r.domain === 'A花卉' && r.id === 'rose');
check(m.status === 'confirmed' && m.reviewer === '花艺师-王' && m.note === '无误', '合并应更新状态/复核人/备注');

// 5) loadReviews 在无 sidecar 时返回空对象（容错）
check(typeof review.loadReviews() === 'object' && Object.keys(review.loadReviews()).length === 0, '无 reviews.json 时应容错返回空对象');

console.log(`review.test: ${pass} passed, ${fail} failed`);
if (fail) {
  console.error('FAILURES:\n' + failures.join('\n'));
  process.exit(1);
}
