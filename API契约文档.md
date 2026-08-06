# 智能花卉 DIY 智能体 · API 契约文档

> 版本：v0.1（草案，2026-08-05）
> 定位：智能体服务端 ↔ 任何客户端（微信小程序 / Web / CLI）之间**唯一对接协议**
> 状态图例：✅ 已实现（代码已运行）｜📝 草案（待实现）

---

## 1. 文档目的与定位

- **本契约是服务端与客户端的唯一对接点。** 数据主权在服务端智能体；微信小程序只是"客户端壳"，可自由重写/替换，不影响平台数据。
- LLM 是**无状态被调用的工具**，记忆与学习全部在服务端（见《数据模型与采集设计》N 域·智能体元学习）。
- 本文档与代码一一对应：标注 ✅ 的接口已在 `server.js` 中运行（含 `/feedback` 与 `/feedback/stats`）。标注 📝 的仅剩存储升级与鉴权等平台化项，见第 8 节。

---

## 2. 通用约定

| 项 | 说明 |
|---|---|
| Base URL | 生产 `https://<your-domain>/api/v1`；本地 `http://localhost:3000/api/v1` |
| 编码 | 所有请求/响应 `Content-Type: application/json; charset=utf-8` |
| 会话保持 | **LLM 无状态**。多轮对话需客户端自行保存 `session_id`，并在每次请求回传（服务端据此合并需求、保留版本历史） |
| 价格安全 | 凡金额，服务端以 `data/shops.json` 为准；客户端在 `shop` 中传入的价格字段（`price_map/cost_map/margin_rate/pack_cost`）**被忽略**，不可信 |
| 错误格式 | 统一 `{ "code": "<机器可读错误码>", "message": "<人读信息>", "details": <可选> }`，HTTP 状态码见各接口。错误码表：`BAD_REQUEST`(400) / `NOT_FOUND`(404) / `INVALID_TRANSITION`(400) / `NOT_PAYABLE`(400) / `BAD_FEEDBACK`(400) / `RATE_LIMITED`(429) / `INTERNAL_ERROR`(500) |
| 限流 | 可选：`RATE_LIMIT_PER_MIN`（每 IP 每分钟请求上限，0 关闭），超限返回 429 + `Retry-After: 60` |
| CORS | 已放开（`Access-Control-Allow-Origin: *`），便于 Web 端联调；小程序不受 CORS 约束 |
| 鉴权 | 当前 dev 态无鉴权；上线建议在网关前置 `Authorization: Bearer <token>`（小程序走微信 `code2session` 换平台 token） |

---

## 3. 接口目录

| 方法 | 路径 | 说明 | 状态 |
|---|---|---|---|
| POST | `/api/v1/chat` | 自然语言 → 理解 → 方案 → 出图 → 选店 | ✅ |
| GET | `/api/v1/plan/:plan_id` | 取方案详情 | ✅ |
| GET | `/api/v1/shops` | 门店列表 | ✅ |
| GET | `/api/v1/shops/:shop_id` | 门店详情 | ✅ |
| POST | `/api/v1/orders` | 下单（服务端按门店价重算） | ✅ |
| GET | `/api/v1/orders?user_id=` | 订单列表（按用户过滤） | ✅ |
| GET | `/api/v1/orders/:id` | 订单详情 | ✅ |
| POST | `/api/v1/orders/:id/status` | 订单状态流转（状态机） | ✅ |
| POST | `/api/v1/orders/:id/pay` | 模拟支付 / 返回 `wx.requestPayment` 参数 | ✅ |
| POST | `/api/v1/pay/notify` | 支付结果回调（改状态为 paid） | ✅ |
| GET | `/api/v1/preview/:plan_id.svg` | 效果图（SVG 兜底或真实图 URL 渲染） | ✅ |
| GET | `/api/v1/health` | 健康检查 | ✅ |
| POST | `/api/v1/feedback` | 交互反馈（闭环学习、智能体进化来源） | ✅ 已实现 |
| GET | `/api/v1/feedback/stats` | 反馈聚合统计（采纳率/花材级信号，供学习回灌） | ✅ 已实现 |

---

## 4. 核心数据模型

### 4.1 `requirements` —— 智能体对外的「理解契约」

这是智能体把自然语言拆分后的结构化需求，也是它理解用户的"词汇表"。客户端可只读展示，也可在高级场景直接构造。

| 字段 | 类型 | 取值 / 说明 |
|---|---|---|
| `intent` | string | 生日 / 母亲节 / 婚礼 / 探病 / 乔迁 / 纪念日 / 表白 / 家居装饰 / 其他 |
| `recipient` | string\|null | 母亲 / 恋人 / 朋友 / 同事 / 长辈 / 老师 / 自己 |
| `occasion` | string\|null | 同上意图维度，场景标签 |
| `style` | string[] | 温柔 / 高级 / 浪漫 / 热烈 / 复古 / 极简 / 田园 / 清新 |
| `color_tone` | string[] | 紫 / 蓝 / 粉 / 红 / 白 / 黄 / 橙 / 绿 / 金 / 香槟 |
| `budget` | number\|null | 预算（元），如 `150` |
| `category` | string\|null | 花束 / 瓶花 / 花盒 |
| `size` | string | 小型 / 中型 / 大型 |
| `placement` | string\|null | 客厅 / 卧室 / 办公桌 / 餐桌 / 窗台 / 玄关 / 送礼携带 |
| `forbidden` | string[] | **禁忌花材**，`flower_id` 列表（来自 `data/flowers.json`） |
| `preferred` | string[] | **偏好花材**，`flower_id` 列表 |
| `avoid_allergen` | boolean | 是否规避花粉/过敏花材（探病场景自动 true） |
| `extras` | string[] | 其他自由备注（如"加贺卡"） |
| `month` | number\|null | 1–12，影响时令花材与价格 |
| `price_map` / `cost_map` / `margin_rate` / `pack_cost` | object/number | **仅门店上下文**传入；客户端普通对话不应设置，服务端以 `shops.json` 为准 |

> 合并规则（服务端 `sessionStore.mergeRequirements`）：标量字段覆盖、数组字段并集、`forbidden` 只增不减。这是多轮对话"越聊越准"的保证。

### 4.2 `plan` —— DIY 方案

| 字段 | 类型 | 说明 |
|---|---|---|
| `plan_id` | string | 方案唯一 ID（`pln_xxx`） |
| `version` | number | 版本号，多轮调整递增 |
| `category` | string | 花束 / 瓶花 / 花盒 |
| `requirements` | object | 见 4.1 |
| `items` | array | 花材清单（见 4.3） |
| `package` | string | 包装描述 |
| `structure` | string | 结构说明（如"主花居中、配花环绕"） |
| `steps` | string[] | DIY 步骤 |
| `care_tips` | string[] | 养护要点 |
| `bg` | string | 预览底色（hex） |
| `total` | number | 方案总价（元） |
| `budget` | number\|null | 预算 |
| `budget_ok` | boolean | 总价是否 ≤ 预算（否则已自动降级） |
| `packCost` | number | 包装费 |
| `pack_cost_source` | string | merchant / global |
| `summary` | string | 一句话方案摘要 |
| `render_url` | string\|null | 效果图地址（SVG 或真实图 URL） |
| `render_type` | string\|null | `svg` / `real_image` |
| `image_prompt` | string\|null | 文生图英文 prompt（接真实出图时用） |
| `negative_prompt` | string\|null | 反向 prompt |
| `render_local` | string\|null | 本地 SVG 文件路径 |
| `created_at` | string | ISO 时间 |

### 4.3 `plan.items[]` —— 单支花材

| 字段 | 类型 | 说明 |
|---|---|---|
| `flower_id` | string | 花材 ID（必来自 `flowers.json`，防幻觉硬约束） |
| `name` / `en` | string | 中文名 / 英文名 |
| `role` | string | 主花 / 配花 / 叶材 |
| `price` | number | 单价（来源见下） |
| `price_source` | string | merchant / cost / global |
| `unit` | string | 支 / 束 |
| `qty` | number | 数量 |
| `colorName` / `color` | string | 颜色名 / hex |
| `花语` / `花期` / `season` / `care` | string | 知识字段 |

### 4.4 `shop` —— 门店

基础字段（来自 `data/shops.json`）：`shop_id`、`name`、`district`、`lat`、`lng`、`rating`、`price_map`、`cost_map`、`margin_rate`、`pack_cost`。

匹配接口额外返回（计算字段）：`distance_km`（距用户）、`price_total`（该方案在本店总价）、`missing[]`（门店缺货花材，可替换）。

### 4.5 `order` —— 订单

| 字段 | 类型 | 说明 |
|---|---|---|
| `order_id` | string | `ord_xxx` |
| `plan_id` / `plan_summary` | string | 关联方案 |
| `shop_id` / `shop_name` | string | 锁定门店 |
| `user_id` | string | 用户（dev 默认 `dev-user`） |
| `status` | string | 见状态机 |
| `items[]` | array | `{ ...plan item, price, price_source:'merchant' }` |
| `missing[]` | array | 门店缺货项 |
| `pack_cost` | number | 包装费（取自门店） |
| `price_total` | number | 服务端重算总价 |
| `plan_total` | number | 方案原总价 |
| `price_diff` | number | `price_total - plan_total`（价差，透明展示） |
| `delivery_type` | string | delivery / pickup |
| `address` / `remark` | string | 配送信息 |
| `created_at` / `paid_at` | string | 时间 |

**订单状态机**：`created → paid → making → delivering → done`；`created/paid → canceled`。非法流转返回 400。

---

## 5. 接口详述

### 5.1 POST `/api/v1/chat` ✅

**请求体**
```json
{
  "message": "给我妈做个淡紫色生日花束，预算150，不要玫瑰",
  "session_id": "ses_xxx（可选，多轮必传）",
  "location": { "lat": 22.54, "lng": 114.06 },
  "shop": { "shop_id": "shop_1", "month": 8 },
  "skip_image": false,
  "shop_limit": 3
}
```
> `shop` 仅 `shop_id` + `month` 有效，价格字段被服务端覆盖。

**响应体（200）**
```json
{
  "session_id": "ses_xxx",
  "plan_id": "pln_xxx",
  "reply_text": "为您生成第 1 版方案：……",
  "plan": { /* 见 4.2 */ },
  "plan_version": 1,
  "render_url": "http://localhost:3000/preview/pln_xxx.svg",
  "render_type": "svg",
  "image_prompt": "A soft ...",
  "negative_prompt": "…",
  "shop_suggestions": [ /* shop[] + 计算字段 */ ],
  "shop_choice": null,
  "need_clarify": false,
  "missing_fields": []
}
```
**回合类型**（由 `message` 决定，客户端据此渲染不同 UI）：
- 寒暄回合（`plan: null`，纯闲聊）
- 澄清回合（`need_clarify: true`，`missing_fields` 提示缺什么）
- 选店回合（"选第二家 / 看看其他店"，`plan` 不变）
- 正常回合（`plan` 生成/更新，`plan_version` 递增）

### 5.2 POST `/api/v1/feedback` ✅ 已实现（闭环学习核心）

> **已实现**：智能体"从历史学习"依赖经验回流。服务端已落库（原子写，见 `lib/agent/feedbackStore.js`），每次交互结果（采纳/修改/放弃/下单/赞踩）写入经验库；`/chat` 响应附 `feedback_signals` 将历史信号回传，供 N 域元学习聚合（权重回写、few-shot 注入预留）。

**请求体**
```json
{
  "session_id": "ses_xxx",
  "plan_id": "pln_xxx",
  "user_id": "u_xxx",
  "action": "accepted | modified | abandoned | ordered | thumbs_up | thumbs_down",
  "rating": 1-5,
  "comment": "可选自由文本",
  "edited_fields": ["budget", "style", "items"]   // 被修改的字段名数组，用于定位"哪类需求总被改"
}
```
**响应（200）**
```json
{ "ok": true, "feedback_id": "fb_xxx" }
```
**说明**：当前落库于 `data/feedback.json`（原子写）；聚合见 `GET /feedback/stats`。下一步可接入 SQLite → 定时回写到知识库权重与信号表；`modified` 时比对 `edited_fields` 与原 `requirements`，定位"哪类需求总被改"。

---

### 5.3 GET `/api/v1/feedback/stats` ✅ 已实现（学习信号聚合）

> 供"智能体学习"使用：从所有历史反馈中提炼采纳率、均分、花材级负面信号。空库返回 `total:0`，不干扰现有逻辑。

**响应（200）**
```json
{
  "total": 4,
  "by_action": { "accepted": 1, "modified": 1, "abandoned": 1, "thumbs_down": 1 },
  "adoption_rate": 25,
  "avg_rating": 3.33,
  "flower_stats": {
    "hydrangea": { "positive": 1, "negative": 2, "sample": 3, "penalty": 0.667 }
  },
  "low_adoption_flowers": ["hydrangea", "viola"]
}
```
- `low_adoption_flowers`：样本 ≥3 且负面比例 ≥0.5 的花材，会进入"学习信号"供方案生成阶段降权。

---

## 6. 典型调用时序

```
客户端                智能体服务端
  │                        │
  │─ POST /chat ──────────▶│  拆需求→合成方案→出图→选店
  │◀─ 200 plan+shops ─────│
  │  (保存 session_id)     │
  │─ POST /chat(ses_id)───▶│  合并需求→新版本方案
  │◀─ 200 plan v2 ────────│
  │─ POST /orders ────────▶│  服务端重算价→建单
  │◀─ 200 order ──────────│
  │─ POST /orders/:id/pay─▶│  模拟支付
  │◀─ 200 payment ────────│
  │─ POST /feedback ──────▶│  ✅ 经验回流（智能体进化来源）
  │◀─ 200 ok ─────────────│
```

---

## 7. 给小程序对接方（含非专业开发者）的注意事项

1. **`session_id` 必须存本地并在每次对话回传**，否则智能体会"失忆"，每轮都当新会话。
2. **价格不要自己算**，直接用服务端返回的 `plan.total` / `order.price_total`；价差 `price_diff` 透明展示即可。
3. **效果图用 `render_url`**：当前是 SVG 兜底图（标注"非真实照片"），接真实文生图后自动变为照片 URL，无需改客户端。
4. **`/feedback` 必接**：把用户"采纳/修改/放弃/下单"回传，这是智能体持续变聪明的唯一数据来源。
5. **门店是服务端匹配结果**，客户端只负责展示 `shop_suggestions` 与"选第 N 家"的意图文本。
6. 真机上线前：后端须部署到 **HTTPS 域名**，并在小程序后台配置 **request 合法域名**。

---

## 8. 待办（实现清单）

- [x] 实现 `POST /api/v1/feedback`（服务端落库 + 聚合回写 + `/feedback/stats`）
- [ ] 存储从整文件 JSON 升级到 SQLite（并发安全 + 聚合查询）
- [ ] 接入鉴权（微信 `code2session` → 平台 token）
- [ ] 真实文生图接入后，补充 `render_type: real_image` 的 CDN 缓存策略
