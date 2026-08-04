// Web 预览前端：调用后端 /api/v1/chat
const $messages = document.getElementById('messages');
const $input = document.getElementById('input');
const $send = document.getElementById('send');

function addBubble(text, cls) {
  const el = document.createElement('div');
  el.className = 'bubble ' + cls;
  el.textContent = text;
  $messages.appendChild(el);
  $messages.scrollTop = $messages.scrollHeight;
  return el;
}

function tag(text) {
  return `<span class="tag">${text}</span>`;
}

function renderPlan(data) {
  const p = data.plan;
  const req = p.requirements;
  const tags = [];
  if (req.occasion) tags.push(tag(req.occasion));
  if (req.recipient) tags.push(tag('送:' + req.recipient));
  (req.style || []).forEach((s) => tags.push(tag(s)));
  (req.color_tone || []).forEach((c) => tags.push(tag(c + '色')));
  if (req.budget) tags.push(tag('预算¥' + req.budget));
  if (req.placement) tags.push(tag(req.placement));

  const flowers = p.items
    .map((i) => `
      <div class="flower-card">
        <div class="flower-head">
          <span class="dot" style="background:${i.color}"></span>
          <b>${i.name}</b> ×${i.qty}${i.unit}
          <span class="flower-price">¥${i.price * i.qty}</span>
          <span class="role">${i.role}</span>
        </div>
        <div class="flower-meta">花语：${i.花语} · 花期：${i.花期} · 时令：${i.season || '全年'}</div>
        <div class="flower-care">💧 ${i.care}</div>
      </div>`)
    .join('');

  const steps = p.steps.map((s) => `<li><b>${s.t}</b>：${s.d}</li>`).join('');
  const cares = (p.care_tips || []).map((c) => `<li>${c}</li>`).join('');

  const card = document.createElement('div');
  card.className = 'plan-card';
  card.innerHTML = `
    <h3>🌿 你的专属花艺方案${p.budget_ok === false ? '<span class="badge">已超预算·已自动降级</span>' : ''}</h3>
    <div class="tag-row">${tags.join('')}</div>
    <div class="summary">${p.summary}</div>
    <img class="render" src="${data.render_url}" alt="效果图" />
    <div class="price">约 ¥${p.total}${req.budget ? ` <small>/ 预算 ¥${req.budget}</small>` : ''} · ${p.package}</div>
    <div class="section-title">花材清单 · 花语与寓意</div>
    <div class="flower-list">${flowers}</div>
    <div class="section-title">门店执行工单（${p.structure}）</div>
    <ol class="steps">${steps}</ol>
    <div class="section-title">💧 日常养护建议</div>
    <ul class="steps cares">${cares}</ul>
  `;
  $messages.appendChild(card);
  $messages.scrollTop = $messages.scrollHeight;
}

async function send(text) {
  if (!text.trim()) return;
  addBubble(text, 'user');
  $input.value = '';
  $send.disabled = true;
  const loading = addBubble('正在设计你的花艺方案…', 'bot');
  loading.classList.add('loading');

  try {
    const resp = await fetch('/api/v1/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text })
    });
    const data = await resp.json();
    $messages.removeChild(loading);
    addBubble(data.reply_text, 'bot');
    renderPlan(data);
  } catch (e) {
    loading.textContent = '出错了：' + e.message;
  } finally {
    $send.disabled = false;
  }
}

$send.addEventListener('click', () => send($input.value));
$input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send($input.value); });
document.querySelectorAll('.chip').forEach((c) =>
  c.addEventListener('click', () => send(c.getAttribute('data-q')))
);
