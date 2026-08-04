# 智能花卉 DIY 推荐智能体

把用户的自然语言需求拆分为结构化要素 → 基于花卉知识库生成可落地的 DIY 方案 → 构造图像 Prompt 并产出效果图 → 在微信小程序（及 Web 预览）中展示与指导完成 DIY。

## 目录结构

```
flora-diy-agent/
├── server.js                 # 零依赖 Node 服务（编排入口）
├── package.json
├── lib/
│   ├── decomposer.js         # 需求拆分：规则引擎 + 可插拔 LLM
│   ├── flowerKB.js           # 花卉知识库检索打分
│   ├── planner.js            # DIY 方案合成
│   ├── pricer.js             # 计价 + 预算回退
│   ├── imagePrompt.js        # 中/英图像 Prompt 构造
│   ├── preview.js            # 结构化 SVG 风格预览（兜底）
│   ├── imageGen.js           # 文生图接口（可配置，未配置回退 SVG）
│   ├── llm/client.js         # 可插拔大模型客户端（OpenAI 兼容）
│   └── util.js
├── data/
│   ├── flowers.json          # 花材库（24 种）
│   ├── templates.json        # 场景/风格/摆放/品类模板
│   └── previews/             # 生成的 SVG 预览图
├── web/                      # Web 预览前端（模拟小程序聊天 UI）
└── miniprogram/              # 微信小程序源码（开发者工具直接打开）
```

## 快速运行（本地）

```bash
# 1) 启动后端（默认 3000 端口）
node server.js
# 或自定义端口
PORT=8080 node server.js

# 2) 浏览器打开
http://localhost:3000
```

无需 `npm install`（零运行时依赖，使用 Node 内置模块）。

## 调用 API

```bash
curl -X POST http://localhost:3000/api/v1/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"想给我妈做个生日花束，她喜欢淡紫色，温柔一点，不要玫瑰，预算150左右，放在客厅茶几上"}'
```

返回包含：`requirements`（结构化需求）、`plan`（花材清单/步骤/价格）、`render_url`（效果图）、`image_prompt`。

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

## 关键设计

- **需求拆分双通道**：有 key 走 LLM，无 key 走规则引擎，结果结构一致；
- **预算回退**：方案超预算时自动降主花数量/移除高价配花/降包装，保证 `total ≤ budget`；
- **防幻觉**：方案仅从花材库选取，禁用 `forbidden` 与过敏花材；
- **可运营**：花材、模板均为 JSON，无需发版即可上新。

详见 `智能花卉DIY智能体_工程文档.md`。

## 许可与使用条款

本项目为**专有软件**，受著作权法保护，**保留所有权利**。

- **禁止**复制、传播、分发、商用、修改后发布本项目全部或部分内容（详见 `LICENSE`）
- 著作权人本人可在任何设备克隆、使用本仓库；第三方使用需获得著作权人书面授权
- 未经许可的使用将追究法律责任
