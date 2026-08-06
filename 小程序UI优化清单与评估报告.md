# 小程序 UI 现状评估与优化清单

> 审计对象：`miniprogram/`（微信原生源码，之前版本遗留，可作优化起点）
> 审计时间：2026-08-06
> 配套基准：《API契约文档.md》（字段以它为准）、《小程序对接指南》待补
> 分工：UI 由 Capri（你）vibe coding 优化；后端智能体由我负责 + 审 UI 代码

---

## 一、审计结论

**整体评价：可作为优化起点，不必从零重写。** 模块齐全、封装合理，但代码基于**较早版本的 API** 编写，当前智能体已演进（如 `steps` 从对象数组变为 `string[]`、门店计算字段调整、新增 `need_clarify`/`domain_insights`/`/feedback`），存在 **3 个严重问题 + 4 个中等问题 + 2 个轻量问题**。

**优点**
- 六大模块齐全：首页(index) / 对话(chat) / 方案(plan) / 下单(order) / 订单(orders) / 我的(mine)
- 请求层封装好：`utils/api.js` 统一 `request()`；`app.js` 管 `apiBase` 与定位回退
- 已对接核心链路：`/chat` → 选店 → `/orders` → `/orders/:id/pay`(mock) → 订单列表
- 本地历史：`chat.js` 存 `planMap`/`history` 到 storage，方案可回看

**待修（按严重度）**
| 级别 | 问题 | 影响 |
|---|---|---|
| 🔴 严重 | `plan.steps` 渲染错位 | DIY 步骤完全不显示 |
| 🔴 严重 | `/feedback` 完全没接 | 学习闭环断，智能体无法"越用越聪明" |
| 🔴 严重 | `session_id` 只存内存 | 切页/重载后多轮对话"失忆" |
| 🟡 中等 | `shop.coverage` 字段不存在 | 显示空白/"覆盖 %" |
| 🟡 中等 | `shop.price_diff` 字段不存在 | 价差展示不出来 |
| 🟡 中等 | `need_clarify`/`missing_fields` 未渲染 | 澄清回合无引导 |
| 🟢 轻量 | `domain_insights` 未展示 | 浪费"懂行专业感"展示位 |
| 🟢 轻量 | `render_url` 部署适配 | 真机/HTTPS 需注意域名 |

---

## 二、问题明细与修复

### 🔴 P1 `plan.steps` 渲染错位（chat.wxml / plan.wxml）
- **现象**：`chat.wxml:21-24`、`plan.wxml:32-36` 用 `item.t` / `item.d` 渲染步骤。
- **原因**：当前 API `plan.steps` 是 **`string[]`**（契约 4.2），旧代码按 `{t,d}` 对象数组写 → 取到 `undefined`，步骤不显示。
- **修复**：改为直接渲染字符串：
  ```xml
  <view class="step" wx:for="{{plan.steps}}" wx:key="index">
    <text class="num">{{index+1}}</text>
    <text class="step-t">{{item}}</text>
  </view>
  ```

### 🔴 P2 `/feedback` 未接（全项目无调用）
- **现象**：没有任何页面调用 `POST /api/v1/feedback`。
- **原因**：之前版本未实现学习回传。
- **影响**：用户"采纳/修改/评分"不回传 → 服务端 `N 域·元学习` 永远空 → 智能体不进化。这是你最在意的"越用越聪明"的命脉。
- **修复**：在方案卡片/订单页加反馈按钮，调用反馈接口。示例（chat.js）：
  ```js
  async sendFeedback(action, rating) {
    await request('/api/v1/feedback', 'POST', {
      session_id: this.data.sessionId,
      plan_id: this.data.plan.plan_id,
      user_id: this.userId(),
      action,                 // accepted | modified | abandoned | ordered | thumbs_up | thumbs_down
      rating,                 // 1-5
      edited_fields: []       // 修改时填被改字段名
    });
  }
  ```
  建议入口：方案卡片加「✅ 采纳 / ✏️ 修改了 / 👎 不要」，订单完成后加星级评分。

### 🔴 P3 `session_id` 不持久（chat.js）
- **现象**：`chat.js` 把 `sessionId` 存 `this.data`，切到 plan 页再回来变为 `null` → 新会话。
- **原因**：未存 storage。契约要求客户端自行保存并回传。
- **修复**：`onLoad` 读 `wx.getStorageSync('sessionId')`；`send` 成功后 `wx.setStorageSync('sessionId', data.session_id)`。

### 🟡 P4 `shop.coverage` 不存在（chat/plan/order.wxml）
- **现象**：多处用 `s.coverage` / `shop.coverage`。
- **原因**：契约 4.4 门店匹配只返回 `distance_km` / `price_total` / `missing[]`，**无 coverage**。
- **修复**：删除 coverage 展示，或换成真实字段（如 `rating`、`distance_km`）。

### 🟡 P5 `shop.price_diff` 不存在（plan/order.wxml）
- **现象**：用 `shop.price_diff` 展示门店价差。
- **原因**：`price_diff` 是 **order 级别**字段（契约 4.5），shop 级别没有。
- **修复**：门店处只显示 `price_total`；价差 `price_diff` 仅在订单详情（order 对象）展示。

### 🟡 P6 `need_clarify` / `missing_fields` 未渲染（chat.js / chat.wxml）
- **现象**：当前 API 有澄清回合（`need_clarify:true` + `missing_fields`），但 UI 没判断、没引导。
- **修复**：`send()` 里若 `data.need_clarify`，在气泡下加提示卡，列出 `missing_fields`（如"还缺：预算 / 收货日期"），引导用户补信息。

### 🟢 P7 `domain_insights` 未展示（chat.js 已返回但未用）
- **现象**：`/chat` 返回 `domain_insights`（潮流/地区/知识洞察），UI 完全没用。
- **修复**：在方案卡加"💡 懂行提示"标签区，展示 `domain_insights`（如"本月绣球当季价优""盐田区偏好清新海岛风"），强化专业可信感。

### 🟢 P8 `render_url` 部署适配
- **现象**：`chat.js` 仅当 `render_url` 以 `/` 开头时拼 `apiBase`；当前 server 返回完整 URL（含 `localhost`）。
- **注意**：真机/上线时 server 生成的 `render_url` 域名须与部署一致；开发期 localhost 直连 OK。

---

## 三、行动清单（你 vibe coding 改，我审）

### A · 必改（对齐当前 API + 补学习闭环）
- [ ] **A1** 修 `plan.steps` 渲染（string[]，见 P1）
- [ ] **A2** 接 `/feedback`：方案卡 + 订单页加采纳/修改/评分回传（见 P2）
- [ ] **A3** `session_id` 持久化到 storage（见 P3）

### B · 建议改（字段清理 + 交互完整）
- [ ] **B1** 清掉 `coverage` / `shop.price_diff` 不存在的字段引用（见 P4/P5）
- [ ] **B2** 渲染 `need_clarify` / `missing_fields` 澄清引导（见 P6）
- [ ] **B3** 展示 `domain_insights` 懂行标签（见 P7）

### C · 上线前（后端由我负责，你先用 dev-user 联调）
- [ ] **C1** 鉴权 `code2session` 换 token（上线必做；开发期 `user_id` 用 `dev-user` 或本地生成）
- [ ] **C2** `render_url` 真机/HTTPS 域名适配
- [ ] **C3** `plan` 带 `source` 可解释性（我接，UI 预留展示位）

---

## 四、本地联调（开发期）

1. 起后端：`node server.js`（默认 `http://localhost:3000`，看 `.env` 的 `PORT`）
2. 微信开发者工具：导入 `miniprogram/` 目录 → 详情 → 本地设置 → 勾选 **「不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书」**
3. `app.js` 的 `apiBase` 默认 `http://localhost:3000`；**真机预览**改成电脑局域网 IP（如 `http://192.168.x.x:3000`）
4. 调通顺序：首页场景 → 对话发需求 → 看方案+效果图 → 选店 → 下单 → 支付(mock) → 反馈回传
5. 上线前：后端部署到 **HTTPS 域名**，小程序后台配置 **request 合法域名**

---

## 五、我（后端）负责、你不用管

- 鉴权 `code2session`（C1）
- `plan` 带 `source` 可解释性字段（C3，接上后 UI 直接展示"据 XX 知识推荐"）
- 真实文生图接入与 `render_url` 域名策略（C2）
- `/feedback` 落库 + 聚合回写（已就绪，你只管调）

---

## 六、开发期接口速查

| 接口 | 请求 | 关键响应字段 |
|---|---|---|
| POST `/api/v1/chat` | `{message, session_id, location}` | `reply_text, plan, plan_version, render_url, shop_suggestions, need_clarify, missing_fields, domain_insights, feedback_signals, session_id` |
| POST `/api/v1/feedback` | `{session_id, plan_id, user_id, action, rating, edited_fields}` | `{ok, feedback_id}` |
| POST `/api/v1/orders` | `{plan_id, shop_id, user_id, delivery_type, address, remark}` | `order`（含 `price_total, price_diff, missing`） |
| POST `/api/v1/orders/:id/pay` | `{}` | `{order, payment(mock)}` |

> 完整字段定义见《API契约文档.md》，以它为准。
