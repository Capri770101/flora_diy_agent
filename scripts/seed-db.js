// 14 域数据底座 · 种子加载入口（幂等，可重复执行）
// 用法：node scripts/seed-db.js
const seed = require('../lib/seed');

const result = seed.runAll();
console.log('[seed] 14 域数据底座种子加载完成：');
console.log(JSON.stringify(result, null, 2));
