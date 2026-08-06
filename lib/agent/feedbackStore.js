// 反馈存储与聚合 —— 智能体"从历史学习"的闭环数据层
// 纯逻辑，不依赖 HTTP；服务端 server.js 调用它落库与统计。
// LLM 本身无状态、不会记住任何东西；记忆与学习都落在这一层（你自己的系统）。
// 存储后端为 SQLite（lib/db）：feedback 为结构化表，支持 SQL 聚合与未来 14 域信号分析。
const { uid } = require('../util');
const db = require('../db');

// 反馈动作枚举（与 API 契约文档一致）
const ACTIONS = ['accepted', 'modified', 'abandoned', 'ordered', 'thumbs_up', 'thumbs_down'];

// 所有反馈记录（结构化表），返回 map 便于按 id 取
function loadFeedback() {
  const m = {};
  for (const r of db.allFeedback()) m[r.feedback_id] = r;
  return m;
}

// 记录一条反馈；校验后落库，返回完整记录
function recordFeedback(input = {}) {
  if (!input || typeof input.action !== 'string' || !ACTIONS.includes(input.action)) {
    const err = new Error('invalid or missing action; allowed: ' + ACTIONS.join(', '));
    err.code = 'INVALID_ACTION';
    throw err;
  }
  const rec = {
    feedback_id: uid('fb'),
    session_id: input.session_id || null,
    plan_id: input.plan_id || null,
    shop_id: input.shop_id || null,
    user_id: input.user_id || 'dev-user',
    action: input.action,
    rating: typeof input.rating === 'number' ? Math.max(1, Math.min(5, Math.round(input.rating))) : null,
    edited_fields: Array.isArray(input.edited_fields) ? input.edited_fields.slice(0, 20) : null,
    comment: typeof input.comment === 'string' && input.comment.length ? input.comment.slice(0, 500) : null,
    created_at: new Date().toISOString()
  };
  db.insertFeedback(rec);

  // 积累域 I UGC：正向动作且有关联方案时，沉淀一条"晒单/分享"
  if (['accepted', 'ordered', 'thumbs_up'].includes(rec.action) && rec.plan_id) {
    const plan = db.kvGet('plans', rec.plan_id);
    if (plan && plan.summary) {
      db.writeUgc({ type: 'order_share', ref_id: rec.plan_id, content: plan.summary, rating: rec.rating || null, author: rec.user_id || 'anon' });
    }
  }

  // 积累域 N 元学习：每次落库后聚合回写信号，让方案生成可消费"学到什么"
  const agg = aggregate();
  db.writeMetaLearning('N', 'adoption_rate', 'rate', agg.adoption_rate == null ? 0 : agg.adoption_rate);
  db.writeMetaLearning('N', 'avg_rating', 'score', agg.avg_rating == null ? 0 : agg.avg_rating);
  for (const [fid, st] of Object.entries(agg.flower_stats || {})) {
    db.writeMetaLearning('F', fid, 'penalty', st.penalty);
  }
  for (const fid of agg.low_adoption_flowers || []) {
    db.writeMetaLearning('F', fid + '_low', 'flag', 1);
  }

  return rec;
}

// 通过 plan_id 关联出方案里的花材 id（用于花材级学习信号）
function planFlowers(planId) {
  if (!planId) return [];
  const p = db.kvGet('plans', planId);
  return p && Array.isArray(p.items) ? p.items.map((i) => i.flower_id).filter(Boolean) : [];
}

// 聚合统计：从所有历史反馈中提炼"智能体可以学习的信号"
function aggregate() {
  const all = db.allFeedback();
  const total = all.length;
  if (!total) {
    return { total: 0, by_action: {}, adoption_rate: null, avg_rating: null, flower_stats: {}, low_adoption_flowers: [] };
  }
  const by_action = {};
  let adopted = 0;
  let rated = 0;
  let ratingSum = 0;
  const flowerStat = {}; // flower_id -> {pos, neg}

  for (const f of all) {
    by_action[f.action] = (by_action[f.action] || 0) + 1;
    if (f.action === 'accepted' || f.action === 'ordered') adopted++;
    if (typeof f.rating === 'number') {
      rated++;
      ratingSum += f.rating;
    }
    let effect = 0;
    if (f.action === 'accepted' || f.action === 'ordered' || f.action === 'thumbs_up') effect = 1;
    else if (f.action === 'abandoned' || f.action === 'thumbs_down') effect = -1;
    else if (f.action === 'modified') {
      const ef = f.edited_fields || [];
      if (ef.some((k) => /flowers?|items?|花材|搭配/.test(k))) effect = -1;
    }
    if (effect !== 0) {
      for (const fid of planFlowers(f.plan_id)) {
        if (!flowerStat[fid]) flowerStat[fid] = { pos: 0, neg: 0 };
        if (effect > 0) flowerStat[fid].pos++;
        else flowerStat[fid].neg++;
      }
    }
  }

  const flower_stats = {};
  const low_adoption_flowers = [];
  for (const [fid, s] of Object.entries(flowerStat)) {
    const sample = s.pos + s.neg;
    const penalty = s.neg / sample;
    flower_stats[fid] = { positive: s.pos, negative: s.neg, sample, penalty: Math.round(penalty * 1000) / 1000 };
    if (penalty >= 0.5 && sample >= 3) low_adoption_flowers.push(fid);
  }

  return {
    total,
    by_action,
    adoption_rate: Math.round((adopted / total) * 1000) / 10,
    avg_rating: rated ? Math.round((ratingSum / rated) * 100) / 100 : null,
    flower_stats,
    low_adoption_flowers
  };
}

// 供方案生成阶段注入的"学习信号"。空库时返回零信号，完全不干扰现有方案逻辑（回归测试安全）
function getSignals() {
  const agg = aggregate();
  return {
    total_feedback: agg.total,
    low_adoption_flowers: agg.low_adoption_flowers,
    adoption_rate: agg.adoption_rate,
    avg_rating: agg.avg_rating
  };
}

module.exports = { ACTIONS, recordFeedback, aggregate, getSignals };
