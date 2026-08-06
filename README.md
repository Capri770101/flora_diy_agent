# 智能花卉 DIY 推荐智能体

把用户的自然语言需求拆分为结构化要素 → 基于花卉知识库生成可落地的 DIY 方案 → 构造图像 Prompt 并产出效果图 → 在微信小程序中展示与指导完成 DIY。

## 目录结构

```
flora-diy-agent/
├── server.js                 # 零依赖 Node 服务（编排入口）
├── package.json
├── lib/
│   ├── agent/                # 智能体核心（零副作用，可被 CLI/API 复用）
│   ├── db.js                 # SQLite 封装（14 域表结构 + kv + feedback，node:sqlite 零依赖）
│   ├── seed.js               # 14 域种子加载（幂等）
│   ├── dataLayer.js          # 统一数据访问层（优先 SQLite，JSON 回退）
│   ├── decomposer.js         # 需求拆分：规则引擎 + 可插拔 LLM
│   ├── flowerKB.js           # 花卉知识库检索打分（读 dataLayer）
│   ├── planner.js            # DIY 方案合成（读 dataLayer.templates）
│   ├── pricer.js             # 计价 + 预算回退
│   ├── imagePrompt.js        # 中/英图像 Prompt 构造（读 dataLayer.templates）
│   ├── preview.js            # 结构化 SVG 风格预览（兜底）
│   ├── imageGen.js           # 文生图接口（可配置，未配置回退 SVG）
│   ├── llm/client.js         # 可插拔大模型客户端（OpenAI 兼容）
│   └── util.js
├── scripts/
│   ├── agent-cli.js          # 交互式 CLI 开发入口
│   └── seed-db.js            # 14 域种子灌库（node scripts/seed-db.js）
├── data/
│   ├── agent.db              # SQLite 主存储（14 域 + plans/sessions/orders/feedback，node:sqlite 零依赖）
│   ├── flowers.json          # 花材库（24 种）· 种子源文件
│   ├── shops.json            # 门店库 · 种子源文件
│   ├── templates.json        # 场景/风格/摆放/品类模板 · 种子源文件
│   └── previews/             # 生成的 SVG 预览图
├── 数据模型与采集设计文档.md   # 14 域字段/类型/枚举/来源标记/建表时机
├── API契约文档.md             # 服务端↔客户端唯一对接协议
└── miniprogram/              # 微信小程序源码（开发者工具直接打开）
```

## 快速运行（本地）

```bash
# 启动后端 API 服务（默认 3000 端口）
node server.js
# 或自定义端口
PORT=8080 node server.js
```

无需 `npm install`（零运行时依赖，使用 Node 内置模块，含内置 `node:sqlite` 数据库）。

> 注：Web 预览前端已移除，本项目的**主要开发与调试入口是 CLI**（见下方「智能体独立开发」）。后端 API 服务保留，供微信小程序对接使用。

## 调用 API

```bash
curl -X POST http://localhost:3000/api/v1/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"想给我妈做个生日花束，她喜欢淡紫色，温柔一点，不要玫瑰，预算150左右，放在客厅茶几上"}'
```

返回包含：`requirements`（结构化需求）、`plan`（花材清单/步骤/价格）、`render_url`（效果图）、`image_prompt`、`shop_suggestions`（附近 Top3 花店）。

## 商城接口（店铺 / 订单 / 支付）

```bash
# 花店列表 / 详情
GET /api/v1/shops
GET /api/v1/shops/:id

# 创建订单（服务端按店铺 price_map 重新计价，返回报价与差价）
POST /api/v1/orders
#  { "plan_id": "pln_xxx", "shop_id": "shp_xxx", "user_id": "...",
#    "delivery_type": "delivery|pickup", "address": "...", "remark": "..." }

# 订单列表（?user_id=xxx 过滤）/ 详情
GET /api/v1/orders?user_id=xxx
GET /api/v1/orders/:id

# 支付（mock prepay，返回 wx.requestPayment 参数；接入真实商户号后替换实现）
POST /api/v1/orders/:id/pay
POST /api/v1/pay/notify          # 支付回调占位

# 状态流转：created → paid → making → delivering → done；created/paid → canceled
POST /api/v1/orders/:id/status   # { "status": "making" }

# API 冒烟测试
node test/api.smoke.js
```

## 接入真实大模型（可选）

默认用**规则引擎**做需求拆分（无需任何 key 即可运行）。若要使用真实 LLM，设置环境变量（OpenAI 兼容接口，如 DeepSeek / 通义 / 混元）：

```bash
LLM_BASE_URL=https://api.deepseek.com/v1 \
LLM_API_KEY=sk-xxx \
LLM_MODEL=deepseek-chat \
node server.js
```

## 接入真实文生图（可选）

默认无文生图时，后端生成一张**结构化 SVG 风格预览图**（按配色/花材可视化，标注"非真实照片"）。配置真实图像接口：

```bash
IMAGE_API=https://your-image-api/... \
IMAGE_API_KEY=xxx \
node server.js
```

接口约定：POST `{prompt, size}`，返回 `{url}` 或 `{data:[{url}]}`。

## 微信小程序

1. 用**微信开发者工具**打开 `miniprogram/` 目录（appid 可用测试号 `touristappid`）；
2. 把 `miniprogram/app.js` 里的 `apiBase` 改为你电脑的**局域网 IP + 端口**（如 `http://192.168.1.100:3000`），并确保手机/模拟器与后端在同一网络；
3. 点"快速开始"或自由描述需求，即可看到方案与配色预览；
4. 接好文生图 API 后，`render_url` 为 CDN 图片，可在小程序内直接展示真实效果图。

> 真机/上线需将后端部署到 HTTPS 域名，并在小程序后台配置 request 合法域名。

## 数据存储

运行期与种子数据统一落地 **SQLite**，使用 Node 内置的 `node:sqlite`（零依赖、零编译），解决了原 JSON 整文件读写的并发竞态、非原子写与无法聚合查询的问题。完整结构契约见 `数据模型与采集设计文档.md`。

- **14 域数据底座**（`data/agent.db`）：
  - 种子主数据域已建表并灌库：A 花卉详情 `flowers`、B 门店价格 `shops`+`shop_stock`、C 商家服务风格 `merchant_profiles`、D 地区差异 `regions`、F 市场潮流基线 `trends`、G 物流履约 `logistics`、J 知识教育 `knowledge`、K 合规信任 `compliance`；
  - 积累数据域先建空表，上线后由真实行为沉淀：H 供应链库存 `supply_inventory`、I 内容 UGC `ugc`、L 营销权益 `marketing`、M 竞品基准 `competitors`、N 智能体元学习 `meta_learning`；
  - **积累域运行时落库（学习闭环的数据写入）**：
    - H 供应链库存：下单时按「花材×门店」扣减 `supply_inventory`（`server.handleCreateOrder`）；
    - I 内容 UGC：下单成功、以及正向反馈（`accepted/ordered/thumbs_up` 关联方案）时沉淀「晒单/分享」；
    - L 营销权益 / M 竞品基准：运营/爬虫写入（种子已给示例基线）；
    - N 智能体元学习：每次反馈落库后，`feedbackStore.recordFeedback` 立即聚合并回写 `meta_learning`（采纳率、均分、各花材 penalty），供方案生成与监控消费。
  - 运行期数据 `kv`（plans/sessions/orders）+ `feedback`（结构化、支持 SQL 聚合，是学习闭环底座）。
  - 采用 **WAL 模式**（一写多读，读写互不阻塞），建表在 `lib/db.js` 内自动完成。
- **统一读取入口**：`lib/dataLayer.js` 优先读 SQLite；表为空/未建时回退 `data/*.json`，保证行为一致、可灰度。现有 164 项回归测试零改动通过。
- **种子灌库（幂等，可重复执行）**：
  ```bash
  node scripts/seed-db.js
  ```
  把 `data/flowers.json`、`shops.json`、`templates.json` 迁移进结构化表，并写入地区/知识/合规/物流/潮流基线等新增域种子。
- **JSON 文件的角色**：`data/*.json` 仍是种子**源文件**（人工维护、读多写少），灌库后被 SQLite 接管；`dataLayer` 在未灌库时自动回退，二者长期共存。

> CLI 与 API 服务共用 `lib/agent` → `dataLayer` → SQLite（未灌库时回退 JSON），反馈经 `/feedback` 写入 SQLite，学习信号由 `feedbackStore.getSignals()` 聚合回传。

## 智能体独立开发（CLI · 主要入口）

> **当前项目的核心开发入口就是 CLI。** Web 预览已移除，智能体逻辑全部在 `lib/agent/`，CLI 直接驱动它，不依赖服务器或小程序。

智能体已抽成独立模块 `lib/agent/`（零副作用：不写文件、不碰 HTTP，持久化由调用方负责）。可脱离服务器/小程序单独开发与测试：

```bash
# 交互式 CLI 开发调试（多轮追问 / 版本迭代 / 澄清反问 / 选店匹配）
node scripts/agent-cli.js

# 跳过真实文生图（快速调试，只出方案不出图）
AGENT_SKIP_IMAGE=1 node scripts/agent-cli.js

# 回归测试（9 组场景 · 160+ 断言）
node test/agent.test.js
```

CLI 内可用 `/help`、`/reset`、`/session`、`/location <纬度> <经度>`、`/shops`、`/shop <id>`、`/feedback` 查看/控制会话与位置、记录反馈。
`/feedback <动作> [评分1-5] [评语]`：自动关联当前会话最新方案，动作为 `accepted`/`modified`/`abandoned`/`ordered`/`thumbs_up`/`thumbs_down`；记录后打印累计学习信号（采纳率/均分/需降权花材）。

> 注意：Windows PowerShell 管道向 node 传中文时需先设置 UTF-8（`$OutputEncoding = [System.Text.Encoding]::UTF8`），否则中文会变乱码。

智能体接口（`lib/agent/index.js`）：

```js
await runAgent({ text, session, location, config })
// → { session_id, session, reply, plan, plan_version,
//     shop_suggestions, need_clarify, missing_fields,
//     domain_insights, feedback_signals }
```

- `session`：会话记忆（需求字段累积 + 方案版本历史），首次传 `null`
- `location`：`{ lat, lng }`，用于附近花店匹配
- `config`：`{ skip_image, shop_limit }`

## 关键设计

- **智能体四段式流水线**：理解（decompose，规则基底 + LLM 补缺）→ 澄清（缺字段反问）→ 方案合成（planner + 预算回退）→ 效果图 + 选店匹配（Top 3）；
- **多轮记忆**：追问在上一版需求上迭代——标量覆盖、色系/风格/偏好并集、禁忌只增不减，产出 v1/v2/v3 版本历史；
- **规则优先防覆盖**：LLM 返回稀疏/空值时不冲掉规则引擎已提取的准确字段，只补规则漏掉的；
- **时令约束**：非当季花材直接排除出候选（如 8 月不推蝴蝶兰）；

- **需求拆分双通道**：有 key 走 LLM，无 key 走规则引擎，结果结构一致；
- **预算回退**：方案超预算时自动降主花数量/移除高价配花/降包装，保证 `total ≤ budget`；
- **防幻觉**：方案仅从花材库选取，禁用 `forbidden` 与过敏花材；
- **学习闭环（反馈→信号→方案降权）**：`/feedback` 写入 `feedback` 表并聚合回写 `meta_learning`；`planner` 在选花时消费 `getSignals().low_adoption_flowers`（历史负面花材，penalty≥0.5 且样本≥3），自动降权排除，使方案随真实反馈进化；空库/无信号时行为不变；
- **懂行洞察（domain_insights）**：每次出方案时，从 F 潮流（按当月）、D 地区（按最近门店/经纬度）、J 知识（按场合/对象关键词）提炼相关洞察，作为 `domain_insights` 字段返回并在回执附「💡 懂行贴士」，让方案更"懂行"；该字段为空库时不影响方案结构，回归安全；
- **可运营**：花材、模板均为 JSON，无需发版即可上新。

详见 `智能花卉DIY智能体_工程文档.md`。

## 许可与使用条款

本项目为**专有软件**，受著作权法保护，**保留所有权利**。

- **禁止**复制、传播、分发、商用、修改后发布本项目全部或部分内容（详见 `LICENSE`）
- 著作权人本人可在任何设备克隆、使用本仓库；第三方使用需获得著作权人书面授权
- 未经许可的使用将追究法律责任
