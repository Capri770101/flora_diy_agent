# 第 1 周：逐文件讲解清单

> 用法：把对应文件内容贴给 AI，依次问清单问题；答完后向 AI 复述你的理解，让 AI 判定是否过关，再进入下一个文件。
> 最终考核：不看代码，向同事讲一遍"用户说'给我妈做淡紫色花束'→ 系统返回方案+效果图"的完整过程。

| # | 文件 | 作用一句话 | 问 AI 的问题 | 过关标准 |
|---|---|---|---|---|
| 1 | `package.json` | 项目名/启动命令 | 这个文件是干嘛的？scripts 里 start/dev 区别？ | 能说出 `npm start` 等价于 `node server.js` |
| 2 | `.env` | 密钥配置 | 为什么 key 要放这里而不是代码里？哪些字段可选？ | 能说出 IMAGE_API_KEY 缺了会怎样（回退 SVG） |
| 3 | `server.js` | 唯一入口 | ①服务器怎么启动？②有哪些路由？③一条 chat 请求的处理顺序？④plan 存到哪？ | 能画出完整数据流：POST /api/v1/chat → decompose→plan→image→存 plans.json→返回 |
| 4 | `lib/util.js` | 工具函数 | readJson/writeJson/uid 各干什么？DATA_DIR 指向哪？ | 能说出"所有数据读写都发生在 data/ 目录" |
| 5 | `lib/decomposer.js` | 需求拆分 | ①关键词规则怎么工作的？②LLM 通道在哪启用？③两者结果结构为什么一致？ | 能说出"拆出的结构是 style/color/budget/forbidden 等字段" |
| 6 | `lib/llm/client.js` | LLM 客户端 | system prompt(EXTRACT_SCHEMA) 起什么作用？没配 key 会怎样？ | 能说出"模型被要求只输出固定结构 JSON，防止乱来" |
| 7 | `data/flowers.json` | 花材知识库 | ①有哪些字段？②过敏字段怎么防？③我加一朵花要动哪几处？ | 能说出"方案里的花只会来自这个文件（防幻觉）" |
| 8 | `data/templates.json` | 场景模板 | occasions/styles/placements/category_defaults/care_tips 各管什么？ | 能说出"改包装风格只改这里，不用改代码" |
| 9 | `lib/flowerKB.js` | 检索打分 | score() 的加分/减分规则有哪些？分数怎么影响选花？ | 能复述：风格+3、场合+3、颜色+2、喜欢+4、禁忌-100 |
| 10 | `lib/planner.js` | 方案合成 | ①主花/配花/叶材怎么选？②颜色怎么定？③兜底逻辑是什么？ | 能说出"候选花太少时会用默认玫瑰+洋桔梗兜底" |
| 11 | `lib/pricer.js` | 计价回退 | ensureBudget 的 4 级降级顺序是什么？ | 能复述：减主花数量→删配花→删叶材→砍包装 |
| 12 | `lib/imagePrompt.js` | Prompt 构造 | ①英文 prompt 和中文 prompt 各给谁用？②summary 干嘛的？ | 能说出"通义万象用的是中文 prompt" |
| 13 | `lib/imageGen.js` | 文生图 | ①通义万象为什么分"创建+轮询"两步？②失败回退到哪？ | 能说出"失败自动降级成 SVG 预览图，服务不崩" |
| 14 | `lib/preview.js` | SVG 兜底图 | 它和真实图片的关系？ | 能说出"它是没配 key 时的替代效果图" |
| 15 | `web/index.html+app.js+styles.css` | Web 版前端 | ①页面怎么调后端？②方案卡片怎么渲染？③改了主题色动哪个文件？ | 能说出"前端只负责展示后端返回的 plan" |
| 16 | `miniprogram/` | 微信小程序 | ①4 个页面分别是什么？②apiBase 指哪？③和 Web 版关系？ | 能说出"小程序=移动端壳，调同一套后端 API" |
| 17 | `data/plans.json` + `data/previews/` | 运行期产物 | 它们什么时候被写入？ | 能说出"每次对话生成一个方案存起来" |

## 周内 git/GitHub 演练（约 2 小时，详见 GITHUB_GUIDE.md）

1. 建 `.gitignore`（已完成，排除 .env 等敏感文件）
2. `git init` → commit → 建 GitHub 私有仓库 → push
3. 故意改坏一个文件 → `git checkout` 还原 → 再 commit push 验证
