// 统一配置层：集中声明配置项（默认值 / 类型 / 校验 / 来源），供所有模块一致性读取
// 来源优先级：环境变量 > 默认值（.env 由入口 server.js / CLI 提前加载进 process.env）
// 用法：
//   const config = require('./config')
//   config.get('llm.provider')   // 派生的运行时取值
//   config.get('PORT')           // 原始 env 值（带类型转换）
//   config.enabled('llm')        // 该槽位当前是否有可用提供方
const path = require('path');

const FLORA_DATA_DIR = process.env.FLORA_DATA_DIR
  ? path.resolve(process.env.FLORA_DATA_DIR)
  : path.join(__dirname, '..', 'data');

// ---------- 原始 env 配置字典：key -> { type, default } ----------
// type: int | number | bool | str
const DEFAULTS = {
  PORT: { type: 'int', default: 3000 },
  LLM_BASE_URL: { type: 'str', default: '' },
  LLM_API_KEY: { type: 'str', default: '' },
  LLM_MODEL: { type: 'str', default: 'deepseek-chat' },
  IMAGE_API: { type: 'str', default: '' },
  IMAGE_API_KEY: { type: 'str', default: '' },
  IMAGE_MODEL: { type: 'str', default: 'wanx2.1-t2i-turbo' }
};

const SLOTS = { llm: 'llm', image: 'image' };

// ---------- 派生配置：运行时根据 env 计算 ----------
const DERIVED = {
  'llm.enabled': (e) => Boolean(e.LLM_API_KEY && e.LLM_BASE_URL),
  'llm.provider': (e) => (e.LLM_API_KEY && e.LLM_BASE_URL ? 'openai-compatible' : 'none'),
  'image.enabled': (e) => Boolean(e.IMAGE_API_KEY),
  // provider 推导：generic（通用 OpenAI 兼容）> dashscope（通义万象）> 未配置即 svg 兜底
  'image.provider': (e) => {
    const api = (e.IMAGE_API || '').toLowerCase();
    if (api && api !== 'dashscope') return 'generic';
    if (e.IMAGE_API_KEY) return 'dashscope';
    return 'svg';
  }
};

function envVal(key) {
  return process.env[key] !== undefined && process.env[key] !== ''
    ? process.env[key] : null;
}

function cast(key, raw) {
  const def = DEFAULTS[key];
  if (raw === null || raw === undefined) return def.default;
  const t = def.type;
  if (t === 'int') {
    const n = parseInt(raw, 10);
    if (Number.isNaN(n)) throw new Error(`config ${key}: 期望整数，收到 "${raw}"`);
    return n;
  }
  if (t === 'number') {
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new Error(`config ${key}: 期望数字，收到 "${raw}"`);
    return n;
  }
  if (t === 'bool') return /^(true|1|yes|on)$/i.test(String(raw));
  return String(raw);
}

// 原始 env 配置项（带类型转换与默认值）
function get(key) {
  if (DEFAULTS[key]) return cast(key, envVal(key));
  if (DERIVED[key]) {
    const e = {};
    for (const k of Object.keys(DEFAULTS)) e[k] = envVal(k);
    return DERIVED[key](e);
  }
  throw new Error(`config: 未知配置项 "${key}"`);
}

// 某能力槽位是否启用（llm / image）。未启动 → 各调用方走回退（规则引擎 / SVG）
function enabled(slot) {
  const k = slot + '.enabled';
  if (!DERIVED[k]) throw new Error(`config: 未知能力槽位 "${slot}"`);
  return get(k) === true;
}

// 键名检查：支持原始 env 名或派生名
function has(key) {
  return Boolean(DEFAULTS[key] || DERIVED[key]);
}

module.exports = { get, enabled, has, all: () => ({ llm: get('llm.provider'), image: get('image.provider') }),
  DEFAULT_DATA_DIR: FLORA_DATA_DIR, FLORA_DATA_DIR, DEFAULTS, SLOTS };