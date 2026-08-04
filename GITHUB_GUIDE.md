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
