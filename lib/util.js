// 通用工具函数
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');

// 数据目录统一由配置层提供（默认项目 data/，可用环境变量 FLORA_DATA_DIR 覆盖）
const DATA_DIR = config.FLORA_DATA_DIR;

function readJson(rel) {
  const p = path.join(DATA_DIR, rel);
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

function writeJson(rel, obj) {
  const p = path.join(DATA_DIR, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf-8');
}

function uid(prefix) {
  return (prefix || 'id') + '_' + crypto.randomBytes(6).toString('hex');
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

// 简单的数组去重（按 key 函数）
function uniqBy(arr, keyFn) {
  const seen = new Set();
  const out = [];
  for (const x of arr) {
    const k = keyFn(x);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(x);
    }
  }
  return out;
}

module.exports = { DATA_DIR, readJson, writeJson, uid, clamp, uniqBy };
