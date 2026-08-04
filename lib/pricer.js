// 计价与预算回退

function priceItems(items, packCost) {
  let total = packCost || 0;
  for (const it of items) total += it.price * it.qty;
  return Math.round(total);
}

// 在预算内逐步降级，返回更新后的 plan
function ensureBudget(plan, req) {
  const budget = req.budget;
  if (!budget) {
    plan.total = priceItems(plan.items, plan.packCost);
    plan.budget_ok = true;
    plan.budget = null;
    return plan;
  }
  let guard = 0;
  while (priceItems(plan.items, plan.packCost) > budget && guard < 30) {
    guard++;
    // 1) 减少最贵主花数量
    const mains = plan.items.filter((i) => i.role === '主花').sort((a, b) => b.price - a.price);
    let reduced = false;
    for (const m of mains) {
      if (m.qty > 1) { m.qty--; reduced = true; break; }
    }
    if (reduced) continue;
    // 2) 移除最贵配花
    const fillers = plan.items.filter((i) => i.role === '配花').sort((a, b) => b.price - a.price);
    if (fillers.length) { plan.items = plan.items.filter((i) => i !== fillers[0]); continue; }
    // 3) 移除一片叶材
    const leaves = plan.items.filter((i) => i.role === '叶材');
    if (leaves.length) { plan.items = plan.items.filter((i) => i !== leaves[0]); continue; }
    // 4) 降低包装成本
    if (plan.packCost > 0) { plan.packCost = 0; continue; }
    break;
  }
  plan.total = priceItems(plan.items, plan.packCost);
  plan.budget = budget;
  plan.budget_ok = plan.total <= budget;
  return plan;
}

module.exports = { priceItems, ensureBudget };
