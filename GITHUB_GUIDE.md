# git 与 GitHub 使用指南（零基础版）

> 你的电脑已装好：git 2.53（D:\Git）+ VS Code（D:\Microsoft VS Code）
> 本指南只教单个人开发够用的部分，不涉及分支协作。

## 一、git 和 GitHub 是什么

| | git（已装在电脑里） | GitHub（网站） |
|---|---|---|
| 是什么 | 本地版本管理工具，给代码拍快照、能回滚 | 代码云端托管平台，备份与协作 |
| 比喻 | 游戏里的"存档系统" | 云端存档仓库 |
| 关系 | 先在本地用 git 存档（commit）→ 再上传到 GitHub（push） | |

日常流程一句话：**本地 git 存档 → 上传 GitHub → 电脑坏了/换了就拉回来。**

## 二、在哪里输入命令

打开终端（任选一个，推荐第 1 个）：

1. **VS Code 内置终端（推荐）**：VS Code 打开项目文件夹 → 菜单栏 `终端` → `新建终端`（或 Ctrl+`）
   —— 打开时自动定位在项目目录，git 命令直接生效
2. Git Bash：开始菜单搜 "Git Bash"（你的装在 D:\Git）
3. Windows PowerShell：开始菜单搜 "PowerShell"

> 关键概念：git 命令只对"当前所在文件夹"生效。VS Code 内置终端自动在项目文件夹里，所以推荐它。

## 三、首次配置（只做一次，每台电脑一次）

在终端里逐行输入并回车：

```
git config --global user.name "你的名字"
git config --global user.email "你的邮箱"
```

`--global` = 这台电脑所有项目生效。配置错了可重跑覆盖。

## 四、把项目上传到 GitHub（首次，7 步）

### 第 1 步：注册 GitHub 账号 + 新建仓库
1. 打开 github.com 注册
2. 右上角 `+` → **New repository** → 仓库名如 `flora-diy-agent` → 选 **Private（私有）** → Create
3. 记下地址：`https://github.com/你的名字/flora-diy-agent.git`

### 第 2 步：在项目文件夹的终端里执行

```
git init                     # 1. 初始化本地存档（此项目已完成）
git add .                    # 2. 把所有文件放进"待存档区"
git commit -m "第一次提交"    # 3. 正式存档
git remote add origin https://github.com/你的名字/flora-diy-agent.git
git branch -M main
git push -u origin main      # 4. 上传（首次会弹窗登录 GitHub）
```

## 五、日常开发循环（以后每次都这样）

```
改代码
→ git add .
→ git commit -m "改了什么，一句话"
→ git push
```

后悔药（还没 commit 的改动）：
```
git checkout -- <文件名>     # 撤销某个文件的改动
git checkout -- .           # 撤销所有未存档改动
```

看历史/看改动：
```
git log --oneline           # 提交历史（一行一条）
git status                  # 当前哪些文件有改动
git diff                    # 具体改了什么
```

换电脑/重装系统拉回代码：
```
git clone https://github.com/你的名字/flora-diy-agent.git
```

## 六、生死攸关：.env 绝不能上传！

`.env` 里有通义万象 API key。项目的 `.gitignore` 已排除它（还排除了日志、运行期数据）。

验证命令：`git status` 里**不应**出现 `.env`。如果出现了，立刻告诉懂技术的人处理（改 key）。

## 七、vibe coding 视角：为什么必须用 git/GitHub

| 场景 | 没有 git | 有 git |
|---|---|---|
| AI 改坏代码 | 手动找错，痛苦 | `git checkout` 一键回滚 |
| 对比 AI 改前改后 | 没有 | `git diff` |
| 电脑坏了 | 全没了 | clone 回来 |
| 同事评审 | 发压缩包 | 发仓库链接 |
| 给老板看进度 | 截图 | commit 记录 |

## 八、常见报错与处理

| 报错 | 原因与处理 |
|---|---|
| `git config user.name` 报错/commit 被拒 | 没配置身份 → 重跑第三节两条命令 |
| `fatal: not a git repository` | 不在项目目录 → 确认终端在 workbuddytest 文件夹 |
| `push` 提示登录 | 首次授权 GitHub 账号 |
| `Remote origin already exists` | 重复 add remote → 用 `git remote set-url origin <新地址>` |
| 不想传的文件出现在 add 里 | 先补进 .gitignore，再 `git add .` |

## 九、逛开源项目：GitHub 的正确打开方式

### 项目页面看什么
| 区域 | 是什么 | 你的用法 |
|---|---|---|
| README | 项目说明书（干什么/怎么装/怎么用） | 第一优先看，决定要不要用 |
| ⭐ Star | 收藏/点赞 | 好项目点一下 = 我的收藏（右上角头像 → Your stars） |
| Fork | 复制一份到你的账号 | 想魔改或保存副本时用 |
| Code 按钮 | 获取地址 | Download ZIP 直接下载；复制 URL 用于 clone |
| Issues | 问题讨论区 | 看已知 bug、学别人怎么描述问题 |
| Releases | 发行版 | 下载现成安装包 |

### 找项目的 3 个入口
1. github.com/explore —— 分类推荐
2. github.com/trending —— 今日热榜，可筛语言
3. 搜索高级语法：
```
stars:>1000 聊天机器人
language:javascript 花卉
topic:chatbot
awesome xxx          # 主题精选合集，新手强烈推荐
```

### 把一个项目"用起来"的四步
1. 看 README（有安装说明吗）
2. Star 收藏
3. `git clone <项目地址>` 到本地
4. 按 README 跑起来 —— 跑不通就换一个，别硬啃

### 用开源项目学编程
- 黄金法则：README 好懂 + star<5000 + 有"快速开始"章节 → 通读源码收获最大（star 几十万的顶级项目太大，现阶段别碰）
- clone 下来用 VS Code 打开，挑 100 行内的小文件通读，让 AI 逐行讲解（与学习计划同款方法）
- 去 Issues 搜 bug 看讨论，学真实世界的排错思路
- 魔改：Fork → clone 自己副本 → 改 → 想贡献给原作者点 `New Pull Request`（先看 CONTRIBUTING.md）

### 换设备/重装的密钥配置
- clone 下来的版本不含 `.env`（密钥）—— 属正常设计
- 新设备流程：`git clone <仓库>` → `copy .env.example .env` → 填自己的 key → `node server.js`
- `.env.example` 是安全模板可随处传；`.env` 是私密的，永远不提交

### 私有仓库换设备（会报认证失败，需要登录）
私有仓库 clone 需要身份认证，直接 clone 会报 "Authentication failed"。流程：

**方式一：浏览器登录（推荐，最省事）**
Windows 的 git 自带凭据管理器，新设备 clone 私有仓库时会自动弹出浏览器 → 登录 GitHub 账号 → 自动记住，以后不用再登。

**方式二：Personal Access Token**
1. 在已登录的浏览器上：头像 → Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token，勾选 `repo` 权限，生成后立即复制（只显示一次）
2. 新设备先配置：
```
git config --global user.name "你的GitHub用户名"
git config --global user.email "你的邮箱"
git config --global http.proxy http://127.0.0.1:7890   # 若新设备开了代理
git config --global https.proxy http://127.0.0.1:7890
```
3. clone 时用户名填 GitHub 名，密码栏粘贴 token：
```
git clone https://github.com/你的名字/flora_diy_agent.git
```
或地址直接带 token：`git clone https://用户名:token@github.com/你的名字/flora_diy_agent.git`
4. clone 完补 key：`copy .env.example .env` → 填 key → `node server.js`

> 注意：token 就是新设备上的"密码"，别发群里别提交仓库；泄露了去 GitHub 作废重新生成即可。


