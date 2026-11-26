# NAI Atelier — 对话交接说明

> **这份文档是唯一主副本**（仓库 `docs/HANDOFF.md`，随代码一起 `git pull`）。工作区里的 `D:\DSH工作区\NAI-LLM\NAI-Atelier-HANDOFF.md` 只是指向这里的短说明，不要再往那边写内容。
> 两端（电脑 / 手机）用同一份代码 + 应用内「设备间同步」，不需要手工搬运；操作步骤见 [DEVICE-SYNC.md](DEVICE-SYNC.md)。
> 交接时间：2026-11-26 01:45（Asia/Shanghai）
> 最近维护：2026-11-26 03:45 — 版本 1.5.0：新增画册（真实文件夹 + 归档/筛选/重命名/删除）；新增单张作品删除；灯箱支持编辑最终提示词 / 负面词 / 模型后重画，并自动打开新图、用 ← → 快速翻页对比；修复「预设保存不生效」的根因——浏览器缓存旧 `app.js`，现在 `public/` 静态资源强制 no-store 且页面带 `?v=` 版本号。`npm run verify` 扩到 82 项，隔离 UI 审计 29 项、线上只读冒烟 16 项，全程假 Key，未消耗额度。
> 最近维护：2026-11-26 — 版本 1.6.0：新增画册封面、拖拽排序、批量操作 / 清空画廊 / 回收站、提示词收藏库、灯箱 Tag 权重编辑、单并发生成队列（取消 / 超时可视化），NovelAI 请求超时可配置；`npm run verify` 扩到 **183 项**（假上游 + 临时目录，不消耗额度），隔离 UI 交互审计 **113 项**、线上只读冒烟 **22 项**，服务已重启为 1.6.0。
> 最近维护：2026-11-26 — 版本 1.7.0：新增 **PNG 元数据 + 配套 JSON 导出**——生成 / 重画时自动把 A1111 兼容的 `parameters` 与完整元数据 JSON 写入 PNG 文本块（`tEXt` / `iTXt`），并在图片同目录生成 `.json` sidecar；画廊「元数据」一键补写全部作品并下载 ZIP、灯箱下载单张 JSON；新增 `/api/history/:id/metadata`、`/api/metadata/sync`、`/api/metadata/archive`；sidecar 随移动 / 删除 / 恢复同步。`npm run verify` 扩到 **235 项全部通过**，隔离 UI 元数据导出检查 **16 项**、线上只读冒烟 **19 项**；服务已重启为 1.7.0。代码已纳入 Git 并推送到**私有** GitHub 仓库 `y1090026806-eng/nai-atelier`（标签 `v1.7.0`）。
> 最近维护：2026-11-26 — 版本 1.8.0：新增**创作记录**——以用户原始输入为记录，记录下保存多个可编辑的 LLM Tag 版本（含 LLM 标题）和每个版本的多张图片；支持 Tag 重 roll、同层并排对比、从任意版本生图、记录标题 / Tags 编辑、原始输入回填；另新增 NovelAI 预设 JSON 导入 / 导出（不含 Key）、提示词铅笔大编辑器、历史原始输入展示。旧 `history.json` 会自动迁移为独立记录，新增 `data/records.json` 与 `/api/records`；`npm run verify` 扩到 **244 项全部通过**，隔离 UI 交互审计 **17/17**，真实数据只读检查通过。代码已提交（`4c4556a`）并推送到**私有** GitHub 仓库 `y1090026806-eng/nai-atelier`（标签 `v1.8.0`）。
> 最近维护：2026-11-26 — UI 可读性优化（未改后端 / 接口 / 版本号）：灯箱图片支持点击全屏查看原图（再点、`Esc` 或点击空白退出；`Esc` 先退全屏再关灯箱），详情栏改为内部滚动避免按钮被挤出；中文描述框、正 / 负提示词、提示词块与灯箱 Tag 编辑器放大字号并允许纵向拖拽。`npm run verify` 仍为 **235/235**，无头 Chrome 隔离 UI **20/20**，1366 / 1440 / 1920 与 390 宽度均无横向溢出。
> 最近维护：2026-11-26 — 布局再平衡（前端，未改后端 / 接口 / 版本号）：输入区改为紧凑命令条（默认 2 行、自动增高、可展开编辑），队列改为浮层抽屉不再挤占画廊；画廊新增详细 / 紧凑双密度（矮屏自动紧凑、可手动切换并持久化），短屏断点压缩顶栏 / 画廊头 / 画册栏；桌面侧栏可折叠、新增专注画廊（Esc 退出）。`npm run verify` 仍为 **235/235**，无头 Chrome 隔离 UI **30/30**，1272 / 1366 / 1440 / 1920 / 390 均无横向溢出。
> 最近维护：2026-11-27 — 版本 1.9.0：新增**设备间同步**（电脑 ↔ 手机）。两端各自离线生图，连同一 Wi-Fi 时在画廊头部「同步」面板里点「开始同步」，双向合并作品 / 画册 / 创作记录 / 回收站 / 提示词收藏；删除靠墓碑传播、排序靠时间戳、图片按 SHA-256 校验、同步前自动备份索引到 `data/backups/`。同步是**独立监听端口**（默认 `3801`，绑 `0.0.0.0`，只暴露 `/sync/*` 并要求 Bearer 口令），主应用仍只监听 `127.0.0.1`；`data/config.json` 里的 API Key **不参与同步**。`npm run verify` **244/244**，新增 `npm run test:sync`（10 项合并单测 + 32 项双实例端到端，全部通过）；文档见 [DEVICE-SYNC.md](DEVICE-SYNC.md) 与本文件 §13。
> 用途：在新对话中继续开发、维护或排查 NAI Atelier 时，先阅读本文件。
> 注意：本项目包含用户私密 API Key 与本地图片。不要读取、打印、复制或提交 `data/config.json` 的真实 Key；不要删除 `outputs/` 里的用户作品（现在也包括回收站 `outputs/.trash/` 与 `data/trash.json`）。

## 1. 项目是什么

一个本地运行的轻量级 WebUI：

**用户输入自然语言 → LLM 生成英文 Danbooru Tags → 与基础正向提示词/画师串/负面提示词拼接 → 请求 NovelAI 生图 → 后端在内存中解压 NovelAI 返回的 ZIP → 保存 PNG 到本地 → 前端画廊展示图片和最终 Tag。**

界面模仿 SillyTavern：深色 Catppuccin 风格、磨砂玻璃、左侧配置侧栏、右侧画廊、底部输入框和 Generate 按钮。无前端框架、无构建步骤。

## 2. 当前路径与运行状态

> 手机端（Termux / PRoot Ubuntu）项目在 `~/nai-atelier`，主应用端口 `3800`，同步端口同为 `3801`；除路径与端口外，功能、数据结构与排错方式与本文一致。两端代码都从同一个 `main` 分支 `git pull`。

| 项目 | 值 |
| --- | --- |
| 项目根目录 | `D:\NAI-Atelier` |
| 旧路径 | `C:\Users\10900\Documents\deepseek-harness\default-workspace\nai-atelier`（已迁移，已不存在） |
| 访问地址 | <http://127.0.0.1:3000> |
| 桌面快捷方式 | `C:\Users\10900\Desktop\NAI Atelier.lnk` |
| 一键启动脚本 | `D:\NAI-Atelier\start-nai-atelier.bat` |
| 快捷方式图标 | `D:\NAI-Atelier\nai-atelier.ico` |
| 当前版本 | 1.9.0（设备间同步：局域网双向合并作品 / 画册 / 记录 / 回收站 / 提示词；保留 1.8.0 创作记录、1.7.0 PNG 元数据 / 画册 / 队列 / 回收站等功能） |
| 当前服务状态 | 以实际 `/api/health` 为准；本次改完需重启服务才会返回 `version:"1.9.0"`。正常时进程以 `node server.js` 在 `D:\NAI-Atelier` 隐藏窗口运行，日志 `server.out.log` / `server.err.log`。桌面快捷方式可重新打开；若已停止，双击快捷方式即可重启 |
| 代码仓库 | **私有** GitHub：<https://github.com/y1090026806-eng/nai-atelier>（分支 `main`，最新标签 `v1.9.0`）；本地 `D:\NAI-Atelier` 已是 git 仓库，remote `origin` 指向它。1.8.0 为 `4c4556a` + 标签 `v1.8.0`；1.9.0 已本地提交并打标签 `v1.9.0`（远端推送状态见 §13 末尾）。 |
| 历史作品 | 数量以实际 `outputs/` 为准，全部是用户自己生成的，不要误删；`outputs/albums/` 与 `outputs/.trash/` 也属于用户数据；图片旁 `.json` sidecar 同样是用户数据；1.8.0 起 `data/records.json` 保存创作记录与 Tag 版本 |
| 用户已有数据 | 用户已有 LLM 预设、画册与作品（以实际 `data/` 与 `outputs/` 为准，不要清空 `presets`、`albums` 或用户作品）；旧作品已在首次 1.8.0 启动时迁移为独立记录（原始输入为空）；旧作品可在画廊点「元数据」补写 PNG 内嵌与 sidecar |

当前工作空间（本交接文档所在，2026-11-26 起由默认工作区迁来）：

```text
D:\DSH工作区\NAI-LLM
```

项目在 D 盘，不在工作空间内。继续开发时请显式进入 `D:\NAI-Atelier`，例如：

```powershell
cd D:\NAI-Atelier
```

## 3. 文件结构

```text
D:\NAI-Atelier\
├─ package.json
├─ package-lock.json
├─ server.js                    # 后端主文件
├─ README.md                    # 项目说明 / API / 配置文档
├─ scripts\
│  └─ verify.js                 # npm run verify：临时目录 + 假上游自检
├─ start-nai-atelier.bat        # Windows 一键启动
├─ nai-atelier.ico              # 桌面快捷方式图标
├─ public\
│  ├─ index.html                # 页面结构（批量选择条 / 队列 / 回收站 / 提示词库 / 权重编辑器 / 元数据按钮）
│  ├─ style.css                 # 深色磨砂玻璃样式、响应式布局（1.6.0 追加约 1300 行）
│  └─ app.js                    # 前端交互、SSE、画廊、拖拽排序、队列轮询、回收站、提示词库、元数据导出、灯箱
├─ data\
│  ├─ config.json               # 用户配置 + API Key（敏感，勿读/勿回显）
│  ├─ history.json              # 画廊元数据（含 relativePath / albumId / parentId / recordId / variantId / userText）
│  ├─ records.json              # 创作记录：原始输入、Tag 版本（标题 / llmTags）与时间
│  ├─ albums.json               # 画册列表（id / name / createdAt / coverId）
│  ├─ trash.json                # 回收站索引（1.6.0 新增）
│  └─ prompts.json              # 提示词收藏（1.6.0 新增）
└─ outputs\                     # 用户生成的 PNG 作品（勿删）
   ├─ albums\<画册ID>\          # 画册对应的真实文件夹（内含图片与同名 .json）
   ├─ .trash\                   # 回收站图片隐藏目录（勿手动删；只经 /trash-files 访问）
   └─ <图片同名>.json           # 每张图片的元数据 sidecar（1.7.0 新增，与 PNG 内嵌 JSON 相同）
```

### 各文件职责

- `server.js`
  - Express 服务、静态托管、CORS、错误处理。
  - `GET/POST /api/config` 配置读写。
  - `POST /api/llm/models` 拉取 OpenAI 兼容模型列表。
  - `POST /api/generate` / `POST /api/history/:id/rerender`（普通 JSON 和 POST SSE 两种响应）；1.6.0 起内部都进入同一个单并发任务队列。
  - 统一 OpenAI 兼容接口适配（DeepSeek / Gemini OpenAI 端点 / 中转站），含温度、Top P、`max_tokens`、`reasoning_effort`、超时。
  - `buildChatMessages()` 把 `promptBlocks` 拼成最终 messages：所有 `before` 段 → 用户描述 → 所有 `after` 段；`enabled: false` 或空内容会被跳过。
  - `buildFinalPrompt()` 的拼接顺序（1.4.0 起）：**画师串 → LLM Tags → 基础正向**，最后去重去空；1.6.0 起用 `tagDedupeKey()` 忽略权重语法去重（`(1girl:1.2)` 与 `1girl` 视为同一 tag，保留先出现者）。
  - `buildNaiPayload()` 的负面提示词：普通 `negative_prompt` 与 V4/V5 的 `v4_negative_prompt.caption.base_caption` 同时发送；V3 只有 `negative_prompt`。
  - NovelAI `ai/generate-image` 请求，超时读 `novelai.timeoutSeconds`（30–900，默认 300）。
  - 用 `adm-zip` 在内存中解析 ZIP，校验图片签名，保存到 `outputs/`；指定 `albumId` 时保存到 `outputs/albums/<画册ID>/`。
  - 画册：`GET/POST /api/albums`、`POST/DELETE /api/albums/:id`；新建/删除会创建/移除真实文件夹，重命名只改显示名。
  - `POST /api/albums/:id/cover`：设置/清除画册封面（`coverId`），只能设画册内作品；`GET /api/albums` 返回 `coverId` 与 `coverUrl`（未设置时回退最新作品）。
  - `POST /api/history/:id/album`：把图片文件移动到目标画册文件夹或移回根目录，并更新历史。
  - `POST /api/history/order`：按客户端当前可见子集重排历史，填回原位置；未列出的记录不动。
  - `POST /api/history/batch-album` / `POST /api/history/batch-delete`：批量移动 / 批量移入回收站。
  - `DELETE /api/history/:id`：默认移入回收站（`?permanent=1` 才彻底删除）；同时移除 sidecar `.json`。
  - 回收站：`GET /api/trash`、`POST /api/trash/:id/restore`、`DELETE /api/trash/:id`、`DELETE /api/trash`；图片存放在 `outputs/.trash/`，上限 300。
  - `/trash-files/<file>` 静态挂载回收站图片（`/outputs` 仍 deny dotfiles）。
  - 元数据导出（1.7.0）：`buildMetadataSnapshot()` 生成 `schema:"nai-atelier.metadata/1"` 元数据；`buildMetadataParametersText()` 生成 A1111 `parameters`；`embedPngMetadata()` 在 IEND 前插入/替换自有 `tEXt` / `iTXt` 文本块（`parameters` + `NAI-Atelier`，Latin-1 不安全时用 `iTXt`）；`attachMetadataForItem()` 同时写 PNG 内嵌与同目录 `<图片同名>.json` sidecar。
  - 元数据 API：`GET /api/history/:id/metadata`（`?download=1` 附件 JSON）、`POST /api/metadata/sync`（可选 `ids`，缺省全部，幂等）、`GET /api/metadata/archive`（ZIP：每张一个 JSON + `manifest.json`，响应头 `X-Metadata-Count`）。
  - sidecar 生命周期：`relocateHistoryItem()` 移动图片时一并移动并刷新 `.json`；删除 / 移入回收站时移除 sidecar（PNG 内嵌保留）；回收站恢复时 `attachMetadataForItem()` 重新生成；启动时不会自动补写旧图。
  - 提示词收藏：`GET/POST /api/prompts`、`DELETE /api/prompts/:id`，数据在 `data/prompts.json`，上限 100、重名拒绝。
  - 任务队列：`POST /api/jobs`（202）、`GET /api/jobs`、`POST /api/jobs/:id/cancel`、`POST /api/jobs/cancel-all`、`DELETE /api/jobs/:id`；单并发、保留最近 50 条、取消时中止上游 axios 请求。
  - `data/config.json`、`data/history.json`、`data/albums.json`、`data/trash.json`、`data/prompts.json` 原子写入。
  - `public/` 静态资源发送 `Cache-Control: no-store`（避免升级后仍用旧 `app.js`）；`/outputs` 图片仍缓存 7 天。
  - 环境变量：`PORT`、`HOST`、`DATA_DIR`、`OUTPUTS_DIR`。
  - `module.exports` 额外导出 `normalizeConfig`，供 `scripts/verify.js` 直接做纯归一化测试。
- `scripts/verify.js`
  - `npm run verify` 的实现：随机空闲端口 + 临时 `DATA_DIR`/`OUTPUTS_DIR` 启动 `server.js`，用本地假 LLM/NovelAI 上游（含 slow 模式）跑 **235** 项检查（183 项基础 + 52 项 1.7.0 元数据导出），结束时清理。
  - 不读取真实配置、不访问外网、不消耗额度；改动后端后应优先跑它。
- `public/index.html`
  - 左侧 LLM（预设 / 模型 / 参数 / 提示词结构）/ NovelAI（预设 / 模型 / 采样 / 请求超时）/ 提示词配置。
  - 右侧画册栏、历史画廊、批量选择条 `#selection-bar`、生成队列面板 `#queue-panel`、灯箱（可编辑提示词 / Tag 权重 / 设为封面 / 收藏 Tag / 翻页）、底部输入与生成按钮。
  - 元数据相关按钮（1.7.0）：画廊头部 `#export-metadata`（同步全部并下载 ZIP）、灯箱 `#lightbox-metadata`（下载单张 JSON）。
  - 预设命名对话框 `#preset-dialog`（LLM / NAI / 画册共用）、删除确认对话框 `#confirm-dialog`、回收站对话框 `#trash-dialog`、提示词库对话框 `#prompt-dialog`。
- `public/style.css`
  - 自定义属性色板、玻璃面板、滑杆、开关、卡片网格、模型列表、提示词块、预设/确认对话框、画册筛选条与封面缩略图、批量选择条、队列面板、回收站 / 提示词库对话框、Tag 权重编辑器、灯箱翻页与重画面板、响应式侧栏抽屉和 Toast（1.6.0 追加约 1300 行，含 900 / 600px 响应式）。
- `public/app.js`
  - 加载配置、历史、画册、回收站与提示词收藏。
  - 自动保存/手动保存配置。
  - 「拉取模型」按钮：`POST /api/llm/models`，把结果渲染成可见的 `.model-option` 列表（不再只依赖 datalist），并用局部 `POST /api/config` 持久化 `availableModels` / `availableModelsBaseUrl`。
  - LLM 预设：保存/重命名/更新/切换/删除，预设包含连接信息、参数、提示词块与模型列表；选中预设时按钮变为「更新预设」。
  - NovelAI 预设：保存/重命名/更新/切换/删除，预设不含 Key/Base URL/请求超时。
  - 共用命名对话框 `askPresetName()`，支持默认建议名、重名校验、取消/ESC；删除操作走 `askConfirm()`。
  - 提示词结构编辑器：增删提示词块、选择角色与插入位置、↑/↓ 排序。
  - 生成：1.6.0 起改用任务队列（`POST /api/jobs` + 800ms 轮询 `GET /api/jobs`），支持连续提交、排队位置、取消单个 / 取消全部、已用时间与超时上限显示。
  - 画册：筛选（全部 / 未分类 / 各画册）、新建、重命名、删除、封面缩略图、卡片/灯箱归档下拉；在某画册筛选下生成会直接保存进该画册。
  - 画廊：卡片拖拽排序、拖到画册标签跨画册移动、左上角多选与批量移动 / 删除、「清空画廊」。
  - 回收站：加载、恢复、彻底删除、清空。
  - 提示词库：新建 / 编辑 / 删除收藏，插入基础正向 / 负面 / 灯箱，复制，灯箱「收藏 Tag」。
  - 元数据导出（1.7.0）：画廊「元数据」先 `POST /api/metadata/sync`，成功后触发下载 `GET /api/metadata/archive`；灯箱「下载元数据」指向 `GET /api/history/:id/metadata?download=1`。导出期间按钮显示「导出中…」并在 toast 里报告 `synced` / `failed`。
  - 灯箱：Tag 权重芯片编辑（− / + 0.05、0.1–2.0、1.0 还原普通 Tag、重置）、设为封面、可编辑重画、← → 翻页、复用参数、复制 Tag、下载原图、下载元数据、删除。
  - 移动端抽屉。

## 4. 如何启动 / 停止

### 桌面一键启动

双击桌面：

```text
NAI Atelier.lnk
```

行为：

- 如果 `/api/health` 已可访问，只打开浏览器，不重复启动服务。
- 否则打开一个新的 `cmd` 窗口执行 `npm start`，等待约 3 秒后打开 <http://127.0.0.1:3000>。
- 服务窗口需要保持开启；关闭窗口即停止服务。

### 命令行启动

```powershell
cd D:\NAI-Atelier
npm install   # 仅在依赖损坏或换机器时需要
npm start
```

### 检查是否已运行

```powershell
Invoke-RestMethod http://127.0.0.1:3000/api/health
```

如果端口 3000 被占用，确认是否是本项目：

```powershell
Get-NetTCPConnection -State Listen -LocalPort 3000
```

不要直接杀未知进程；先检查对应 PID 的命令行是否指向 `D:\NAI-Atelier`。

### 修改后重启

- 改 `public/*`：浏览器刷新即可。
- 改 `server.js`：需要重启 Node 进程。

### 自检（改后端后先跑）

```powershell
cd D:\NAI-Atelier
npm run verify       # 244 项，约 30 秒
npm run test:sync    # 10 项合并单测 + 32 项双实例端到端，约 40 秒
```

- 在随机空闲端口 + 临时 `DATA_DIR`/`OUTPUTS_DIR` 启动真实 `server.js`，配合本地假 LLM/NovelAI 上游，跑 **244 项**检查（含 1.7.0 元数据、1.8.0 创作记录、1.9.0 同步路由的基础覆盖）。
- `test:sync` 会额外起**两个**独立实例（各自 data/outputs/端口 + 各自同步端口），验证首次全量、幂等零搬运、排序与回收站 / 彻底删除的双向传播、错口令 401、对方离线 502、重启后设置保留。
- 不读取真实配置、不访问外网、不消耗额度；结束自动清理临时目录。
- 当前最新代码为 **244/244 + 10/10 + 32/32**；失败行会打印具体检查名。
- 自检里的版本号从 `package.json` 读取，升版本只需改 `package.json` / `server.js` 的 `APP_VERSION` / `index.html` 徽章与 `?v=`。

### 代码提交与 GitHub 同步

GitHub CLI 在 `C:\Users\10900\AppData\Local\Programs\gh-cli\bin\gh.exe`（已加入用户 PATH），登录账号 `y1090026806-eng`；`git` 的 github.com 凭据已通过 `gh auth setup-git` 配好。仓库是**私有**的 <https://github.com/y1090026806-eng/nai-atelier>。

```powershell
cd D:\NAI-Atelier
git status                 # 确认没有 data/config.json、outputs/ 等被暂存
git add -A
git commit -m "描述本次改动"
git push origin main
git tag v1.7.1             # 需要发新版本时再打标签
git push origin --tags
```

注意：`.gitignore` 已忽略 `data/*.json`（含真实 API Key）、`outputs/`（作品与回收站）、`node_modules/`、`*.log`；提交前不要强行 `git add -f` 这些内容，也不要把 Key 写进 README/交接文档。

## 5. 当前技术栈

- Node.js：交接环境为 `v26.13.1`，`package.json` 要求 `>=18.17`。
- npm：`11.20.0`。
- 依赖（已安装，`package-lock.json` 已锁定）：
  - `express` 4.22.3
  - `axios` 1.21.1
  - `cors` 2.8.6
  - `adm-zip` 0.6.1
- 安全审计：`npm audit --omit=dev` 为 **0 vulnerabilities**（此前 `adm-zip` 有高危问题，已升级到 0.6.1 并复测 ZIP 管线）。
- 前端不使用框架、无构建步骤。

## 6. 功能与参数概况

### LLM

- **统一 OpenAI 兼容协议**（1.2.0 起）：`POST {Base URL}/chat/completions`；DeepSeek、Gemini 的 OpenAI 兼容端点、OpenAI、各类中转站都走同一套配置。
- 默认 Base URL `https://api.deepseek.com/v1`，默认模型 `deepseek-chat`。
- Gemini 用 `https://generativelanguage.googleapis.com/v1beta/openai`。
- 「拉取模型」调用 `POST /api/llm/models`（服务端请求 `GET {Base URL}/models`），结果渲染为**可见的 `.model-option` 列表**（1.3.0 修复：旧版只回填 datalist，Chrome 不点开输入框看不到）；列表通过局部 `POST /api/config` 持久化，刷新后仍在。也可手动输入任意模型名。
- 参数：温度 0–2（默认 0.4）、Top P 0–1（默认 1）、最大 Token 16–32768（默认 1024）、思考强度（`reasoning_effort`：默认不发送 / low / medium / high）、超时 10–600 秒（默认 120，仅 LLM 请求）。
- 旧版 Gemini 原生协议已移除；启动时会把旧配置自动迁移为 Gemini 的 OpenAI 兼容地址，Key 与模型保留。
- 部分推理模型不接受 `temperature` / `top_p`；「思考强度」也只有支持该参数的接口才生效。

### LLM 配置预设（1.3.0 新增，1.5.0 修复保存/缓存）

- 侧栏 LLM 区顶部：「当前配置」下拉 + 「保存预设 / 更新预设」+「删除」。
- 一个预设保存：`apiKey`、`baseUrl`、`model`、`temperature`、`topP`、`maxTokens`、`reasoningEffort`、`timeoutSeconds`、`promptBlocks`、`availableModels`、`availableModelsBaseUrl`。
- **自定义命名（1.4.0）**：点「保存预设」弹出 `#preset-dialog`，默认建议「主机名 · 模型名」，可改名；选中已有预设时按钮变为「更新预设」，进入「重命名 / 更新」模式，改名即重命名，重名会被拒绝。
- **1.5.0 根因修复**：1.4.0 的功能代码本身可用，但 Chrome 可能继续使用缓存的旧 `app.js`，外观仍是旧版、预设保存无反应。现在 `public/` 静态资源强制 `Cache-Control: no-store, must-revalidate`，`index.html` 的 CSS/JS 带 `?v=1.5.0`；浏览器刷新一次即可拿到新代码。保存失败时前端会回滚 `state.presets`，不会留下「看起来保存了其实没写入」的假预设。
- 切换预设会立即把整套设置填回表单并标记未保存；保存配置后持久化。切换/保存/删除都会调用 `POST /api/config`。
- 上限 30 个预设，服务端 `normalizeLlmPreset()` 会逐个归一化并丢弃无效项。

### 提示词结构（1.3.0 新增）

- 取代旧版单个 System Prompt。每段包含：角色（`system` / `assistant` / `user`）、插入位置（`before` = 用户输入之前，`after` = 之后）、内容、启用状态（UI 固定提交启用，服务端支持 `enabled`）。
- 发送顺序：所有 `before` 段（数组顺序）→ 用户输入的描述 → 所有 `after` 段（数组顺序）；空内容与 `enabled: false` 会被跳过；最多 24 段。
- 旧配置的 `systemPrompt` 在启动时迁移为一段 `system / before` 块，内容原样保留。
- 前端通过 `state.promptBlocks` 管理，增删改、上下移动都会重新渲染并标记未保存。

### NovelAI

- 模型下拉包含：
  - V5 Full / Curated
  - V4.5 Full / Curated
  - V4 Full / Curated Preview
  - V3
  - Furry V3
- 参数：Sampler、Noise Schedule、Steps、Guidance、CFG Rescale、Width、Height、Seed、Quality Tags。
- 宽高按 64 对齐（服务端归一化，范围 64–2048）。
- Seed 为 `-1` 时随机，并将实际 seed 写入历史。
- V5 使用 `params_version: 4`，V4 使用 `3`；V4/V5 会附带 `v4_prompt` / `v4_negative_prompt`。
- 请求成功后 NovelAI 返回 ZIP，后端不落临时 ZIP，直接在内存中找到第一张 PNG/JPEG/WebP，确认签名后保存。
- **请求超时（1.6.0）**：`novelai.timeoutSeconds` 默认 300 秒，范围 30–900（服务端钳制），侧栏「请求超时」可改；超时错误消息会带上配置秒数。该字段**不属于** NovelAI 预设。

### NovelAI 配置预设（1.4.0 新增）

- NAI 区顶部同样有「当前配置」下拉 +「保存预设 / 更新预设」+「删除」，复用同一个命名对话框。
- 预设包含：`model`、`sampler`、`noiseSchedule`、`steps`、`scale`、`cfgRescale`、`width`、`height`、`seed`、`qualityToggle`、`basePositive`、`artistPrompt`、`negativePrompt`。
- **不包含** `apiKey` / `baseUrl` / `timeoutSeconds`：切换预设不会改变请求账户、端点或单次请求超时（服务端 `normalizeNovelAiPreset()` 会显式剔除）。
- 上限 30 个；切换时 `applyNaiSettings()` 回填表单并标记未保存；选中已有预设时按钮显示「更新预设」。

### 画册（1.5.0 新增，1.6.0 扩展封面 / 排序 / 批量）

- 画廊顶部新增 `ALBUMS` 栏：默认「全部」「未分类」，每个画册显示作品数与封面缩略图；可 `+ 新建画册`、`重命名`、`删除画册`。
- 数据：`data/albums.json` 保存 `{ id, name, createdAt, coverId }`，上限 60 本，名称最长 40 字、同名（不区分大小写）拒绝。
- 文件夹：每本画册在 `outputs/albums/<画册ID>/` 下建立真实文件夹；新生成作品若当前处于某画册筛选，会直接保存进该画册目录。
- 归档：每张作品卡片底部与灯箱「所属画册」下拉可把图片移动到画册或移回未分类；服务端会实际 `rename` 图片文件并更新 `history.json` 的 `relativePath` / `url` / `albumId`。
- **封面（1.6.0）**：灯箱「设为封面」调用 `POST /api/albums/:id/cover`，只能设该画册内的作品；`GET /api/albums` 返回 `coverId`（有效封面，未设置时为最新作品兜底）、`coverUrl` 与 `explicitCoverId`（仅显式设置时非空）。作品移出画册 / 删除时自动清空封面。
- **排序（1.6.0）**：卡片拖拽调整顺序，`POST /api/history/order` 只接收当前可见子集，服务端把 id 按新顺序填回原位置；未列出的记录位置不变，结果持久化到 `history.json`。
- **批量（1.6.0）**：左上角多选后，`#selection-bar` 支持全选当前 / 取消 / 批量移动（`POST /api/history/batch-album`）/ 批量删除（`POST /api/history/batch-delete`）；把卡片（或整批选中）拖到画册标签上 = 跨画册移动。
- 删除画册：其中的作品移回 `outputs/` 根目录（未分类），图片不删除；确认对话框会说明数量。
- 删除单张作品（1.6.0 起默认进回收站）：卡片「删除」或灯箱「删除作品」，图片移到 `outputs/.trash/`，可恢复。

### 重绘、编辑提示词与对比翻页（1.1.0 新增，1.5.0 扩展）

- 灯箱操作：**应用修改并重画**、**复用参数**、**复制 Tag**、**下载原图**、**删除作品**。
- 最终 Tag 与负面提示词在灯箱内是可编辑的 `textarea`；可选择重画模型（V5 / V4.5 / V4 / V3 / Furry V3 等）和 Seed 模式（新随机 / 沿用原 Seed）。点「应用修改并重画」会把编辑内容提交给 `POST /api/history/:id/rerender`，跳过 LLM 直接请求 NovelAI。
- 新图生成后作为新作品追加到画廊顶部，记录带 `parentId` 指向原作品，并**自动在灯箱中打开**，方便与旧图对照。
- 灯箱图片两侧有上一张/下一张按钮、中间显示 `当前 / 总数`；打开灯箱后按 `←` / `→` 可快速翻页（焦点在输入框/下拉框时不拦截方向键）。
- **复用参数**：纯前端操作，把该作品的模型、Sampler、Noise Schedule、Steps、Guidance、CFG Rescale、宽高、Seed、Quality Tags 与负面提示词填回左侧表单，并标记为「有未保存的更改」；不会改动基础正向提示词与画师串。
- 重绘时接口地址与 API Key 始终使用当前配置；未提供的采样字段沿用原记录。
- 由于历史记录没有保存用户的自然语言输入，重绘不会再次调用 LLM；要重新提炼 Tags 请在底部输入框重新生成。

### 画册封面（1.6.0）

- 数据：`data/albums.json` 每条记录新增 `coverId`（存作品 id，空串表示未显式设置）。
- 接口：`POST /api/albums/:id/cover`，body `{ historyId }`；传 `null` / `""` / 省略表示清除。只能把**该画册内**的作品设为封面（否则 400 `COVER_NOT_IN_ALBUM`）。`GET /api/albums` 返回 `coverId` 与 `coverUrl`；未显式设置时 `coverUrl` 回退为该画册最新作品，空画册为空串。
- 自动清空：作品移到其他画册、移入回收站或删除时，`clearAlbumCoverForItem()` 会清掉指向它的封面；启动时也会丢弃指向不存在记录的 `coverId`。
- UI：画册标签左侧显示封面缩略图（无封面显示占位块）；灯箱「所属画册」行右侧「设为封面」，已是封面时按钮显示「当前封面」并禁用。

### 拖拽排序与跨画册移动（1.6.0）

- 卡片（或其缩略图）支持 HTML5 拖拽，拖到另一张卡片左/右半边出现插入提示线。
- 前端只把**当前筛选下可见**的顺序发给 `POST /api/history/order`（body `{ ids }`）；服务端 `reorderHistoryItems()` 把这些 id 按新顺序填回它们在 `history.json` 里的原槽位，未列出的记录位置不变，因此「全部 / 某画册 / 未分类」三种视图互不干扰。
- 把卡片拖到顶部画册标签上 = 移动到该画册；拖到「未分类」= 移回未分类；若拖动的卡片在多选集合里，则整批一起移动。
- 排序结果原子写入 `history.json`，重启后保持。

### 批量操作、清空画廊与回收站（1.6.0）

- 多选：卡片左上角选择按钮；`#selection-bar` 显示「已选 N 张」，支持全选当前、取消选择、选择目标画册后「移动」、「批量删除」。
- 批量接口：`POST /api/history/batch-album { ids, albumId }`（返回 `{ items, moved, failed, albums }`）、`POST /api/history/batch-delete { ids }`（返回 `{ trashed, failed, albums }`）；单次最多 200 个 id。
- 清空画廊：`#gallery-clear` 把当前视图（全部 / 未分类 / 某画册）的作品批量移入回收站，确认框写明数量。
- 回收站数据：`data/trash.json` 保存 `{ id, filename, trashFilename, item, deletedAt }`；图片实际移动到隐藏目录 `outputs/.trash/`，文件名加随机前缀避免冲突。
- 回收站接口：`GET /api/trash`（返回 `url` 为 `/trash-files/<file>`）、`POST /api/trash/:id/restore`、`DELETE /api/trash/:id`、`DELETE /api/trash`（清空）。上限 300 条，超出时自动删除最旧记录及其文件。
- 恢复：优先回到原画册；原画册已删除则回未分类；目标文件已存在时用 `makeOutputFilename()` 生成新的合法文件名。
- 旧接口变化：`DELETE /api/history/:id` **默认移入回收站**（返回 `{ deleted, filename, trashed }`），只有带 `?permanent=1` 才彻底删除文件。旧版「删除不可撤销」的说明不再成立。
- 访问控制：`/outputs` 仍 `dotfiles: 'deny'`，回收站图片只能经 `/trash-files` 挂载访问。

### 提示词收藏库（1.6.0）

- 数据：`data/prompts.json`，记录 `{ id, name, positive, negative, createdAt }`；上限 100 条，名称最长 60 字，名称不区分大小写去重。
- 接口：`GET /api/prompts`、`POST /api/prompts`（带 `id` 为更新，否则新建）、`DELETE /api/prompts/:id`；空名 `PROMPT_NAME_REQUIRED`、正负都空 `PROMPT_EMPTY`、重名 `PROMPT_EXISTS`、超限 `PROMPT_LIMIT`、不存在 `PROMPT_NOT_FOUND`。
- UI：画廊头部「提示词库」对话框，可新建 / 载入编辑 / 删除收藏；每条可「正向」（追加到基础正向）、「负面」（追加到负面提示词）、「灯箱」（追加到当前灯箱最终 Tag 与负面词）、「复制」。
- 灯箱「收藏 Tag」会把当前作品的 `prompt` 与 `negativePrompt` 预填进收藏表单（名称默认取前几个 tag 或日期）。

### Tag 权重编辑（1.6.0）

- 灯箱「FINAL PROMPT」下新增可展开的权重编辑器：把最终 Tag 拆成芯片，`−` / `+` 以 **0.05** 步进调整，范围 **0.1–2.0**，也可直接输入数字；权重 1.0 时还原为普通 Tag，非 1.0 写成 `(tag:1.2)`；支持一键重置。
- 编辑结果同步回灯箱 textarea，随「应用修改并重画」作为 `prompt` 提交给 `POST /api/history/:id/rerender`，最终发给 NovelAI。
- 后端 `tagDedupeKey()` 在拼接时忽略权重语法去重：`(1girl:1.2)` 与 `1girl` 视为同一 tag，保留先出现者及其写法；最多循环剥离 4 层括号。

### 生成队列、取消与请求超时（1.6.0）

- 单并发队列：所有 `POST /api/generate`、`POST /api/history/:id/rerender` 与 `POST /api/jobs` 都进入同一个 `jobQueue`，同一时间只有 1 个任务调用上游；任务记录保留最近 50 条。
- 任务接口：`POST /api/jobs`（202，body `{ kind:'generate', text, albumId }` 或 `{ kind:'rerender', historyId, ... }`）、`GET /api/jobs`（`{ jobs, running, queueLength, limits{llmTimeoutSeconds,naiTimeoutSeconds} }`）、`POST /api/jobs/:id/cancel`、`POST /api/jobs/cancel-all`（只取消排队中）、`DELETE /api/jobs/:id`（只删已结束记录，否则 409 `JOB_ACTIVE`）。
- 取消：排队中立即置为 `canceled` 并移出队列；运行中通过 `AbortController` 中止 axios 请求，最终 `canceled`，**不写入历史**。SSE 客户端断开也会触发取消（避免继续消耗额度）。
- 兼容：旧 JSON 接口会入队并等待结果再返回 `{ result }` / 错误（取消返回 499 `CANCELED`）；SSE 排队时先发 `stage: "queued"`，空闲时仍是 `llm → nai → unzip → save`。
- 超时：`novelai.timeoutSeconds`（默认 300，30–900 钳制）传给 axios；超时错误由 `cleanAxiosNetworkMessage()` 生成并带秒数。侧栏输入框 id `#nai-timeout`。
- UI：连续点生成 = 排队（按钮副文案变 `ADD TO QUEUE`）；`#queue-panel` 显示任务状态 / 排队位置 / 进度 / 取消；`#cancel-job` 取消当前运行任务；进度条上方显示 `已用 x.xs / 上限 Ns`，到 80% 加 `is-warning` 黄色样式。任务轮询间隔 800ms，页面加载时若已有运行中任务会自动恢复轮询。

### PNG 元数据 + 配套 JSON 导出（1.7.0）

- 自动导出：生成 / 重画在图片落盘并写入历史后，`attachMetadataForItem()` 会：读取 PNG → 在 `IEND` 前插入/替换两个自有文本块 → 写回图片；同时写同目录 `<图片同名>.json` sidecar。元数据写入是 **best effort**：失败只打印 warning，不影响生成结果。
- PNG 文本块：`parameters`（A1111 风格：第一行 prompt；有负面词时第二行 `Negative prompt: ...`；最后一行 `Steps: ..., Sampler: ..., Schedule type: ..., CFG scale: ..., Seed: ..., Size: WxH, Model: ..., NAI Atelier: <版本>`）与 `NAI-Atelier`（完整 JSON）。内容 Latin-1 安全时用 `tEXt`，否则用 `iTXt`；JPEG / WebP 只写 sidecar（不改动图片二进制）。
- 元数据字段：`schema:"nai-atelier.metadata/1"`、`app`、`appVersion`、`exportedAt`、`id`、`filename`、`relativePath`、`url`、`albumId`、`parentId`、`prompt`、`llmTags`、`negativePrompt`、`model`、`sampler`、`noiseSchedule`、`steps`、`scale`、`cfgRescale`、`width`、`height`、`seed`、`qualityToggle`、`llmProvider`、`llmModel`、`createdAt`、`elapsedMs`。
- 幂等：同步时会先删除旧的自有 `parameters` / `NAI-Atelier` 文本块再写入新的，不会累积重复 chunk。
- UI：画廊头部「元数据」（`#export-metadata`）先 `POST /api/metadata/sync`（全部），成功后再触发 `GET /api/metadata/archive` 下载 ZIP；灯箱「下载元数据」（`#lightbox-metadata`）下载单张 JSON（`?download=1`）。
- 归档 ZIP：每张历史作品一个 `<文件名>.json`（内容与 sidecar 一致）+ `manifest.json`（`schema` / `app` / `appVersion` / `exportedAt` / `count`）；响应头 `X-Metadata-Count` 为数量。归档由历史记录即时生成，不依赖 sidecar 是否存在。
- sidecar 生命周期：移动画册时随图片移动并刷新 `relativePath` / `albumId` / `url`；删除 / 移入回收站时移除 sidecar；回收站恢复时重新生成（文件名冲突换名后也按新名生成）；删除画册使作品移回根目录时 sidecar 一并回根目录。PNG 内嵌元数据随图片文件本身移动，所以回收站里的 PNG 仍保留参数。
- 兼容与隐私：`parameters` 是 A1111 / 常见 WebUI 约定，可用常见工具或脚本读取；`NAI-Atelier` JSON 覆盖完整记录，同类信息也在 sidecar 中。**元数据会随 PNG 被分享**（prompt / seed / 参数等），sidecar 也位于 `outputs/`；`outputs/` 已被 `.gitignore` 忽略，API Key 等凭据不会写入元数据。
- 旧图：1.7.0 之前生成的作品默认没有 sidecar / 内嵌元数据，需要点一次画廊「元数据」补写；`GET /api/history/:id/metadata` 始终可由历史记录即时生成，不依赖是否已补写。

### 提示词拼接

最终正向提示词顺序（1.4.0 调整，自动去重、去空）：

```text
画师串 → LLM 生成的 Tags → 基础正向提示词
```

负面提示词同时传给 NovelAI 的普通 `negative_prompt` 和 V4/V5 的结构化 `v4_negative_prompt`；V3 只有 `negative_prompt`。已用 mock 上游验证三种情况的请求体。

## 7. 后端 API 摘要

### `GET /api/health`

```json
{ "ok": true, "version": "1.7.0", "storageReady": true }
```

### `GET /api/config`

```json
{ "config": { "llm": { ... }, "novelai": { ... } } }
```

包含明文 API Key，仅限本机访问。绝不能把此响应或原配置内容写进日志/文档。

### `POST /api/config`

接受完整或部分配置，深合并后保存到 `data/config.json`。`llm` 支持：

```json
{
  "baseUrl": "https://api.deepseek.com/v1",
  "apiKey": "sk-...",
  "model": "deepseek-chat",
  "temperature": 0.4,
  "topP": 1,
  "maxTokens": 1024,
  "reasoningEffort": "medium",
  "timeoutSeconds": 120,
  "promptBlocks": [
    { "role": "system", "position": "before", "enabled": true, "content": "…" }
  ],
  "availableModels": ["deepseek-chat", "deepseek-reasoner"],
  "availableModelsBaseUrl": "https://api.deepseek.com/v1",
  "presets": []
},
"novelai": {
  "model": "nai-diffusion-4-5-full",
  "steps": 28,
  "timeoutSeconds": 300,
  "presets": [
    { "name": "V5 竖图", "model": "nai-diffusion-5-full", "steps": 28, "width": 832, "height": 1216 }
  ]
}
```

- `reasoningEffort` 只接受 `""` / `low` / `medium` / `high`，其余值归一化为 `""`（不发送）。
- `promptBlocks` 最多 24 段，`role` 只接受 system/assistant/user，`position` 只接受 before/after；缺省时由旧 `systemPrompt` 或默认提示词生成一段。
- `llm.presets` / `novelai.presets` 各最多 30 个；无效名称或非对象项会被丢弃。
- `novelai.presets` 会忽略 `apiKey` / `baseUrl` / `timeoutSeconds`，不随预设切换账户、端点或超时。
- `novelai.timeoutSeconds` 钳制到 30–900，默认 300。
- `availableModels` 最多 300 项，自动去重。

返回：

```json
{ "config": { ... }, "savedAt": "..." }
```

### `POST /api/llm/models`

```json
{ "baseUrl": "https://api.deepseek.com/v1", "apiKey": "sk-..." }
```

服务端请求 `GET {Base URL}/models`，兼容 `{data:[...]}` / `{models:[...]}` / 字符串数组，去掉 `models/` 前缀并排序，返回：

```json
{ "models": ["deepseek-chat", "deepseek-reasoner"], "fetchedAt": "..." }
```

错误码：`LLM_API_KEY_MISSING`、`LLM_BASE_URL_MISSING`、`INVALID_URL`、`LLM_MODELS_ERROR`、`LLM_NO_MODELS`。超时固定 30 秒。

### `POST /api/generate`

请求：

```json
{ "text": "自然语言画面描述", "albumId": "可选：目标画册 ID" }
```

- `albumId` 省略 / `null`：保存到 `outputs/` 根目录（未分类）；有效画册 ID：保存到 `outputs/albums/<画册ID>/`。
- 1.6.0 起内部作为任务进入单并发队列；普通 JSON 模式会等任务结束再同步返回 `{ "result": {...} }`，取消返回 499 `CANCELED`。
- `Accept: text/event-stream`（前端默认）：SSE 阶段事件：
  - 队列忙时先发 `stage: "queued"`；空闲时不发
  - `stage`: LLM → NAI → unzip → save，含 `message` 与 `progress`
  - `done`: `{ result }`
  - `error`: `{ message, code }`
  - 客户端断开时任务会被取消

图片结果包含 `id`、`filename`、`relativePath`、`url`（`/outputs/...`）、`albumId`、`parentId`、`prompt`（最终 Tag）、`llmTags`、模型/参数/seed、时间等。

### `POST /api/history/:id/rerender`

```json
{
  "seedMode": "new",
  "prompt": "可选：编辑后的最终 Tag",
  "negativePrompt": "可选",
  "model": "可选：nai-diffusion-5-full",
  "albumId": "可选：目标画册 ID 或 null"
}
```

- 跳过 LLM，沿用该历史记录的最终 Tag、负面提示词与采样参数重新请求 NovelAI，新图照常写入 `outputs/` 或画册文件夹并置顶历史。
- 可覆盖 `prompt` / `negativePrompt` / `model` / `sampler` / `noiseSchedule` / `steps` / `scale` / `cfgRescale` / `width` / `height` / `qualityToggle`；未提供字段沿用原记录。
- `prompt` 显式传空/纯空白返回 `EMPTY_PROMPT`；`albumId` 省略沿用原记录画册。
- `seedMode: "same"` 复用原 Seed 尽量复现；缺省 `new` 换随机 Seed。
- 新记录带 `parentId` 指向源作品，便于识别重画变体。
- 支持与 `/api/generate` 相同的 JSON / SSE 两种响应；1.6.0 起同样进入单并发队列，排队时 SSE 先发 `queued`，断开连接会取消任务。
- 错误码：`HISTORY_NOT_FOUND`、`HISTORY_FILE_MISSING`、`HISTORY_PROMPT_MISSING`、`NAI_API_KEY_MISSING`、`EMPTY_PROMPT`、`ALBUM_NOT_FOUND`。

### 画册 API（1.5.0，1.6.0 增封面）

- `GET /api/albums` → `{ albums: [{ id, name, createdAt, coverId, coverUrl, explicitCoverId, count }] }`；`coverId` / `coverUrl` 未显式设置封面时取该画册最新作品，`explicitCoverId` 只在显式设置时非空。
- `POST /api/albums` body `{ name }` → 新建画册并建立 `outputs/albums/<id>/`；重名 `409 ALBUM_EXISTS`，空名 `400 ALBUM_NAME_REQUIRED`，超过 60 本 `409 ALBUM_LIMIT`。
- `POST /api/albums/:id` body `{ name }` → 重命名（只改显示名，不移动文件）；不存在 `404 ALBUM_NOT_FOUND`。
- `POST /api/albums/:id/cover` body `{ historyId }`（`null` / 省略 = 清除）→ 返回 `{ album, albums }`；错误码 `ALBUM_NOT_FOUND`、`HISTORY_NOT_FOUND`、`COVER_NOT_IN_ALBUM`、`INVALID_COVER`。
- `DELETE /api/albums/:id` → 删除画册；其中作品移回未分类、文件夹移除，返回 `{ deleted, moved }`。
- `POST /api/history/:id/album` body `{ albumId }`（`null` = 未分类）→ 实际移动图片文件与同名 `.json` sidecar，并刷新元数据后更新历史，返回 `{ item }`；错误码 `HISTORY_NOT_FOUND`、`ALBUM_NOT_FOUND`、`HISTORY_FILE_MISSING`。
- `POST /api/history/order` body `{ ids }` → 按当前可见子集重排，填回原位置，返回 `{ items }`；`ORDER_IDS_REQUIRED`、`ORDER_IDS_INVALID`。
- `POST /api/history/batch-album` body `{ ids, albumId }` → 批量移动（sidecar 跟随），返回 `{ items, moved, failed, albums }`。
- `POST /api/history/batch-delete` body `{ ids }` → 批量移入回收站（移除 sidecar），返回 `{ trashed, failed, albums }`。
- `DELETE /api/history/:id` → **默认移入回收站**，返回 `{ deleted, filename, trashed }`；`?permanent=1` 才彻底删除；两种方式都会移除 sidecar；不存在 `404 HISTORY_NOT_FOUND`。

### 回收站 / 提示词收藏 / 任务队列 API（1.6.0）

- 回收站：`GET /api/trash`；`POST /api/trash/:id/restore`（回原画册，原画册没了回未分类，重名自动换新文件名，并重新生成 sidecar / 内嵌元数据）；`DELETE /api/trash/:id`；`DELETE /api/trash`（清空）。上限 300，超出自动清理最旧。错误码 `TRASH_NOT_FOUND`、`TRASH_FILE_MISSING`、`TRASH_INVALID`。图片只经 `/trash-files/<file>` 访问。
- 提示词收藏：`GET /api/prompts`；`POST /api/prompts` body `{ id?, name, positive, negative }`（带 `id` = 更新）；`DELETE /api/prompts/:id`。上限 100、名称 ≤60 字、正负至少一项、重名 `PROMPT_EXISTS`；`PROMPT_NAME_REQUIRED`、`PROMPT_EMPTY`、`PROMPT_LIMIT`、`PROMPT_NOT_FOUND`。
- 任务队列：`POST /api/jobs`（202，`kind` 为 `generate` / `rerender`）、`GET /api/jobs`（`{ jobs, running, queueLength, limits }`）、`POST /api/jobs/:id/cancel`、`POST /api/jobs/cancel-all`（只取消排队中）、`DELETE /api/jobs/:id`（只删已结束记录，否则 409 `JOB_ACTIVE`）。单并发、保留最近 50 条；运行中取消会 abort 上游请求，最终 `canceled` 且不写历史。

### `GET /api/history`

返回 `{ "items": [...] }`，最多 200 条索引，最新在前；每条包含 `filename`、`relativePath`、`url`、`albumId`、`parentId`、`recordId`、`variantId`、`userText`、`prompt`、采样参数与时间。1.6.0 起顺序可由 `POST /api/history/order` 调整并持久化。

### 创作记录 API（1.8.0）

- `GET /api/records` → `{ records: [{ id, userText, title, createdAt, updatedAt, variants: [{ id, title, llmTags, source, llmModel, imageCount }], variantCount, imageCount, coverId, coverUrl, latestImageAt, albumIds }] }`；按 `updatedAt` 倒序。
- `GET /api/records/:id` → `{ record }`；不存在 `404 RECORD_NOT_FOUND`。
- `PATCH /api/records/:id/variants/:variantId` body `{ title?, llmTags? }` → `{ record, variant }`；只修改版本元数据，不影响已生成图片。
- Tag 重 roll / 记录生图走任务队列：`POST /api/jobs` body `{ kind:'reroll', recordId }` 或 `{ kind:'render', recordId, variantId, albumId? }`；重 roll 只调 LLM 生成新版本，不生图；render 用指定版本 Tags + 当前 NAI 设置生图。
- `POST /api/generate` / `POST /api/jobs` 的 `generate`：若 `userText` 命中已有记录，会沿用该记录最新 Tag 版本追加图片（不再调用 LLM）；需要新 Tags 请在记录详情里重 roll。
- 旧 `history.json` 在 1.8.0 首次启动时自动补 `recordId` / `variantId` / `userText`（旧作品为空），并为每张旧图建立独立记录；新生成 / 重画 / 记录生图的图片都会带记录字段。

### 元数据导出 API（1.7.0）

- `GET /api/history/:id/metadata` → `{ metadata }`；元数据由历史记录即时生成（字段见 §6「PNG 元数据 + 配套 JSON 导出」）。`?download=1` 时按附件返回 JSON（`Content-Disposition: attachment; filename="<文件名>.json"`）。未知 id → `404 HISTORY_NOT_FOUND`。
- `POST /api/metadata/sync` body `{ ids?: [] }`（缺省全部）→ `{ synced, failed: [{ id, filename, message }], total }`；`total` 是当前历史总数；原图缺失的作品进 `failed`，不影响其他作品；幂等（替换旧 `parameters` / `NAI-Atelier` chunk，不重复堆叠）。
- `GET /api/metadata/archive` → ZIP：每张历史作品一个 `<文件名>.json` + `manifest.json`（`schema` / `app` / `appVersion` / `exportedAt` / `count`）；响应头 `X-Metadata-Count` 为数量；由历史记录即时打包，无需先 sync。

> 更完整的 API、配置和 NovelAI 请求说明见 `D:\NAI-Atelier\README.md`。

## 8. 本地数据与安全

- API Key 明文保存在 `D:\NAI-Atelier\data\config.json`，`.gitignore` 已忽略（`data/trash.json`、`data/prompts.json` 也已忽略）。
- 画册列表保存在 `D:\NAI-Atelier\data\albums.json`（含 `coverId`）；画册图片在 `outputs\albums\<画册ID>\`，移动/删除画册会真实移动或删除文件。
- 回收站索引在 `D:\NAI-Atelier\data\trash.json`，图片在隐藏目录 `outputs\.trash\`；**不要把 `outputs\.trash` 当垃圾手动删**，否则回收站记录会失效、无法恢复。
- 提示词收藏在 `D:\NAI-Atelier\data\prompts.json`。
- 同步数据（1.9.0）：`data/sync-state.json` 保存本机 `deviceId`、排序时间与删除墓碑；`data/backups/<时间戳>/` 是每次同步前自动备份的 5 个索引（保留 5 份）；`outputs/.incoming/` 是同步临时目录，结束时清空。**这些都不要手动删**（尤其是 `sync-state.json`，删了会让已删除的作品在下次同步时复活）。
- 同步设置（开关 / 端口 / 口令 / 设备名 / 上次对端）存在 `data/config.json` 的 `sync` 段，**不参与库同步**；API Key 也不会离开本机，两端各自保留自己的 Key 与模型设置。
- 元数据（1.7.0）：每张图片同目录有 `<图片同名>.json` sidecar，PNG 内也嵌入了 `parameters` / `NAI-Atelier` 文本块。**分享 PNG 或 `outputs/` 目录等于分享 prompt / seed / 参数**；API Key 等凭据不在元数据字段内。`outputs/` 已被 `.gitignore` 忽略，不要把 `outputs/` 或 sidecar 提交到仓库。
- `/outputs` 禁止访问 dotfiles；回收站图片只通过 `/trash-files/<file>` 挂载访问，不会出现在普通画廊。
- 项目默认只监听 `127.0.0.1`；CORS 只允许 localhost 来源。
- 不要把端口暴露到局域网/公网。
- 不要未经许可发起真实 NovelAI 请求：会消耗用户 Anlas / 订阅额度。
- 不要删除 `outputs/`（含 `outputs\.trash`）、`data/history.json`、`data/albums.json`、`data/trash.json` 或 `data/prompts.json`；用户已有作品。
- `public/` 强制 no-store，升级后刷新页面即可生效；`/outputs` 图片仍使用 7 天缓存（文件名唯一）。
- 迁移时已保留配置、历史和全部作品。

## 9. 已完成的验证

1. **后端**
   - 使用 mock LLM / mock NovelAI 完成全链路测试。
   - 验证 OpenAI 标签生成、Gemini URL 和请求体。
   - 验证 V4.5 与 V5 的 `params_version`、结构化 prompt 字段。
   - 验证 NovelAI ZIP → 内存解压 → PNG 签名 → `/outputs` 静态访问。
   - 验证配置读写、历史恢复、空输入 / ZIP 异常 / 上游错误处理。
   - 升级 `adm-zip` 后再次跑通 ZIP 全链路。
2. **前端（Chrome headless + CDP）**
   - 1440×900 桌面布局和 390×844 移动端布局。
   - 滑杆、分辨率预设、未保存/已保存状态。
   - SSE 实时阶段显示、生成完成、画廊顶部追加新卡片。
   - 灯箱、最终 Tag 复制、图片下载链接。
   - 配置保存、历史刷新、移动端抽屉。
   - 无页面运行时错误或 console error。
3. **最近一次维护回归（2026-11-26 01:54，隔离端口 3123 + mock 上游 3124）**
   - 在临时 `DATA_DIR` / `OUTPUTS_DIR` 上启动真实 `server.js`，未触碰真实配置与作品，未消耗额度。
   - 后端 **42 项检查全部通过**，覆盖：
     - 健康检查、默认配置归一化、配置深合并/非法类型回退。
     - SSE 阶段顺序 `llm → nai → unzip → save`、`done` / `error` 事件结构。
     - 最终提示词顺序与去重、LLM 代码围栏/客套话清理、文件名规则、seed 记录。
     - V4.5 `params_version: 3`、V5 `params_version: 4`、V4/V5 `v4_prompt` / `v4_negative_prompt`、Bearer Token、`n_samples`。
     - Gemini URL、`x-goog-api-key`、`systemInstruction` 与 `contents`。
     - PNG 落盘、`/outputs` 静态访问、路径穿越阻断、缺失文件 404。
     - 空输入 / 超长输入 / 非法 JSON / 3 MB 请求体 / 上游 402 / 无图片 ZIP。
     - 重启后配置、历史、图片均恢复。
   - 前端 **无头 Chrome CDP 冒烟**：桌面 1440×900 与移动端 390×844 无横向溢出、5 张历史卡片与灯箱正常、抽屉可开合、Esc 可关闭灯箱、9 个参数 chip 正常、无 console error / page error。
   - 依赖审计：`npm audit --omit=dev` 仍为 **0 vulnerabilities**。
   - 结论：**未发现需要修改的缺陷，本轮未改动业务代码**。
4. **重绘 / 复用参数回归（2026-11-26 02:05，版本 1.1.0，同一隔离方式）**
   - 新增 `POST /api/history/:id/rerender` 与灯箱两个按钮后，**30 项检查全部通过**：
     - 正常生成（JSON 与 SSE）未受重构影响，阶段仍为 `llm → nai → unzip → save`。
     - 重绘沿用原 `prompt` / `llmTags` / 负面词 / 模型 / Sampler / Steps / Guidance / CFG Rescale / 宽高，生成新文件与新历史记录。
     - `seedMode: "new"` 换种子、`seedMode: "same"` 复现原种子。
     - 重绘 SSE 阶段为 `nai → unzip → save`。
     - 错误路径：未知 id 404、原图缺失 404、缺 NovelAI Key 400。
     - 无头 Chrome：灯箱 4 个按钮、复用参数回填数值正确且标记未保存、点「再画一张」卡片 +1 并以成功态结束、上游失败时显示错误且不新增卡片、无 console error。
   - 已顺带把版本号提升到 **1.1.0**（`package.json`、`package-lock.json` 根版本、`server.js` 的 `APP_VERSION`、右上角 `v1.1`）。
5. **LLM 统一 + 自检脚本（2026-11-26 02:30，版本 1.2.0）**
   - `npm run verify`（`scripts/verify.js`）成为项目常驻自检，**45 项全部通过**：
     - 默认配置、参数钳制、旧 Gemini 配置自动迁移到 `/v1beta/openai`。
     - 拉取模型：`models/` 前缀去除、排序、Bearer 认证、缺 Key / 非法 URL 报错。
     - LLM 请求体：`temperature` / `top_p` / `max_tokens` / `reasoning_effort`（仅设置时发送）/ 超时配置。
     - 生成主流程、SSE、V4.5/V5、重绘、各类错误、路径穿越、重启恢复。
   - 前端 mock UI 检查 **10 项通过**：旧协议下拉移除、新参数表单、拉取模型回填与数量提示、模型为空自动选第一个、保存后参数写入配置、无 console error。
   - 线上只读检查：`version: 1.2.0`、新表单加载正确、无 console error；**没有点真实「拉取模型」**，避免用真实 Key 访问外网。
   - 版本提升到 **1.2.0**（`package.json`、`package-lock.json` 根版本、`server.js`、右上角 `v1.2`）；依赖审计仍为 0 vulnerabilities。
6. **模型列表修复 + 预设 + 提示词结构（2026-11-26 02:55，版本 1.3.0）**
   - `npm run verify` 扩到 **52 项全部通过**，新增覆盖：
     - 旧 `systemPrompt` → 提示词块的迁移、默认提示词块。
     - 提示词块按角色/位置/顺序发送（`SYSTEM-A` → `USER-B` → 用户描述 → `ASSIST-C`）。
     - 空提示词块只发送用户输入。
     - LLM 预设归一化（钳制、丢弃空名/非对象项）、预设内模型列表去重。
     - 已保存模型列表去重、`availableModelsBaseUrl`。
   - 前端 mock UI 检查 **24 项通过**：模型列表可见且可点击、数量/高亮、提示词块增删改与排序、预设保存/覆盖/切换/删除、无 console error。
   - 线上只读检查：`version: 1.3.0`、旧 `systemPrompt` 已迁移为 1 段 System 块（435 字符）、预设/模型列表为空、无 console error；**没有用真实 Key 请求模型列表**。
   - 结论：**「拉取模型」此前的问题已确认是 UX 缺陷**（结果只写入 `<datalist>`，Chrome 不点开输入框看不到），1.3.0 改为可见列表并持久化。
7. **自定义命名预设 + 提示词顺序 + 负面提示词（2026-11-26 03:20，版本 1.4.0）**
   - `npm run verify` 扩到 **59 项全部通过**，新增覆盖：
     - NovelAI 预设保存/归一化、预设不含 `apiKey` / `baseUrl`。
     - 最终提示词顺序 `artist:wlop, 1girl, solo, rain, city_lights, cinematic lighting`（Artist → LLM → Base）。
     - 负面提示词同时出现在 `negative_prompt` 与 `v4_negative_prompt`；V5 同样；V3 只有 `negative_prompt` 且无 v4 结构。
   - 前端 mock UI 检查 **24 项通过**：命名对话框默认名/自定义名、重命名预填、重名拦截、取消不保存、NAI 预设保存/切换/删除、顺序提示、负面说明、无 console error。
   - 线上只读检查：`version: 1.4.0`、顺序提示正确、NAI 预设下拉正常、负面说明可见、无 console error；用户已有预设与 12 张作品保留。
   - 负面提示词结论：**一直在发送**，不是缺陷；V4/V5 同时发送两份，V3 发送 `negative_prompt`。本次补充了明确的自动化断言与界面说明。
8. **画册 + 删除 + 可编辑重画 + 预设缓存修复（2026-11-26 03:45，版本 1.5.0）**
   - `npm run verify` 扩到 **82 项全部通过**，新增覆盖：
     - 画册创建/文件夹建立/重名与空名拒绝、作品生成进画册子文件夹、`/outputs/albums/...` 静态访问。
     - 作品移动到画册 / 移回未分类时真实文件移动、`relativePath` / `url` 更新；不存在的画册 404。
     - 画册列表数量、重命名（含保留自身名称）。
     - 编辑提示词 / 负面词 / 模型后重画：请求体使用新值、V5 `params_version`、`parentId`、同 Seed 复现；空提示词 400。
     - 重画结果保存到指定画册、删除作品同时删除文件与索引、删除不存在作品 404。
     - 删除画册把作品移回未分类并移除文件夹；未索引图片会被移出到根目录而不是随文件夹删除；重启后画册、画册图片路径与配置恢复。
   - 隔离 UI 审计（临时 `DATA_DIR`/`OUTPUTS_DIR` + 假 NovelAI + headless Chrome）**29/29 通过**：
     - LLM 预设自定义命名、刷新后仍在、选中后「更新预设」重命名；NAI 预设自定义命名。
     - 画册筛选、新建（真实文件夹）、重命名、卡片下拉归档、删除空画册、移动后筛选计数。
     - 卡片删除（确认框 → 文件与索引减少）。
     - 灯箱计数与下一张、方向键翻页、编辑提示词 + 换 V5 模型重画后自动打开新图且请求体正确、恢复原 Tag、灯箱内删除后灯箱仍可用。
     - 无 console/page error；桌面与 390×844 移动端无横向溢出。
   - 线上只读冒烟（真实 3000 端口，不点生成/不保存/不移动/不删除）**16/16 通过**：v1.5、已有预设加载、14 张卡片、画册栏、灯箱可编辑提示词/画册/模型/翻页、无 console error、桌面与移动端无横向溢出。
   - 用**真实 data/outputs 的副本**在隔离端口验证升级迁移：14 张作品 URL 全部 200、已有 LLM 预设保留、`albums.json` 自动创建、stderr 为空；真实目录未被测试改动。
   - 版本提升到 **1.5.0**（`package.json`、`package-lock.json` 根版本、`server.js` `APP_VERSION`、右上角 `v1.5`）。
9. **限制说明**
   - 没有使用用户的真实 LLM / NovelAI Key 发起过真实计费生成；用户自己的作品表示实际配置/调用可能已在会话外使用过。
   - 临时 UI 测试脚本与截图已清理（`%TEMP%\nai-ui-audit`）；`scripts/verify.js` 是保留的项目自检。
   - 1.6.0 已补齐批量删除 / 清空画廊 / 回收站 / 任务队列；仍**没有**鉴权、多用户或公网部署能力。
10. **1.6.0：队列 / 回收站 / 提示词 / 封面 / 排序 / 权重 + 183 项 verify（2026-11-26）**
    - `npm run verify` 扩到 **183 项全部通过**（单次约 23 秒）：使用本地假 LLM / 假 NovelAI（含 slow 模式）与隔离的临时 `DATA_DIR` / `OUTPUTS_DIR`，不读取真实配置、不访问外网、不消耗额度，结束自动清理。
    - 新增覆盖：加权 Tag 去重；画册封面设置 / 清除 / 只能设画册内作品 / 未设置时回退最新作品；`history/order` 只改可见子集且未被选中的作品位置不变；批量移动 / 批量删除；单张删除进回收站与 `?permanent=1` 彻底删除；回收站恢复（原画册已删回未分类、同名冲突换新文件名）、彻底删除、清空、上限清理；提示词收藏新建 / 更新 / 重名 / 空名 / 空内容 / 上限 / 删除；任务队列单并发、排队取消、运行中取消（slow 上游 abort）、取消全部、删除已结束记录、`limits` 超时字段；NovelAI 超时钳制与请求实际使用配置值；重启后封面 / 提示词 / 回收站 / 排序均持久化。
    - 版本提升到 **1.6.0**（`package.json`、`package-lock.json` 根版本、`server.js` `APP_VERSION`、`index.html` 的 `?v=1.6.0`、右上角 `v1.6`）。

11. **隔离 UI 交互审计（2026-11-26，版本 1.6.0）**
    - 临时 `DATA_DIR`/`OUTPUTS_DIR` + 假 LLM / 假 NovelAI（含 slow 模式）+ 无头 Chrome CDP：**113/113 项通过**，全程 0 页面异常、0 console error。
    - 覆盖：初始化；从 UI 连续生成两张；队列 running / queued 与取消（排队中、运行中、取消全部），取消后不新增历史与卡片；画册封面（兜底缩略图 → 显式设置 `POST /api/albums/:id/cover`）；拖拽排序（拖到目标卡片右半边 + `POST /api/history/order` 持久化 + 刷新后保持）；拖到画册标签跨画册移动；多选批量移动 / 批量删除 / 清空画廊；回收站恢复 / 彻底删除 / 清空；提示词库增删改与插入（基础正向、灯箱、灯箱「收藏 Tag」）；Tag 权重 − / + / 重置，并验证重画请求体权重；NAI 超时 120 秒 / 30 秒的「已用 x.xs / 上限 Ns」显示与 80% 黄色警示；桌面 1440×900 与移动端 390×844 无横向溢出；移动端面板 / 选择条 / 队列可用。
    - 审计中发现并已修复两个小问题：灯箱 `#stage-detail` 补上「已用」字样；`GET /api/albums` 新增 `explicitCoverId`，区分「显式封面」与「最新作品兜底」，使兜底封面也能被设为正式封面。
    - 隔离性：真实 `data/`、`outputs/` 与源码文件 mtime 前后未变；临时审计脚本、Chrome profile 与截图已清理。
12. **真实服务升级 + 线上只读冒烟（2026-11-26，版本 1.6.0）**
    - 3000 端口的旧 1.5.0 进程（PID 25168）已停止，并由 `node server.js` 在 `D:\NAI-Atelier` 重新启动（隐藏窗口，日志写 `server.out.log` / `server.err.log`）；`/api/health` 现返回 `{"ok":true,"version":"1.6.0","storageReady":true}`，stderr 为空。
    - 首次以 1.6.0 启动后自动创建 `data/trash.json`、`data/prompts.json` 与 `outputs/.trash/`；旧配置、历史、画册与作品全部保留（启动时 `normalizeConfig()` 只补充 `novelai.timeoutSeconds: 300` 等新字段）。
    - 线上只读冒烟 **22/22 通过**（仅 GET / 页面加载，不生成、不保存、不移动、不删除）：健康版本、历史与画册可读、回收站 / 提示词收藏 / 队列接口正常、抽样图片 URL 全部 200、首页引用 `?v=1.6.0`、画廊卡片数与历史一致（22 张）、LLM 预设正常加载（4 个）、NAI 超时默认 300、新 UI 元素齐全、桌面与 390×844 均无横向溢出、0 页面异常 / 0 console error。
    - 冒烟脚本与 Chrome 临时 profile 已清理；真实 `data/`、`outputs/` 未被测试写入。
13. **1.7.0：PNG 元数据 + 配套 JSON（2026-11-26）**
    - 生成 / 重画保存后自动写 PNG 文本块（Latin-1 安全用 `tEXt`，否则 `iTXt`；键为 `parameters` 与 `NAI-Atelier`），并在图片同目录生成 `<图片同名>.json` sidecar；画廊「元数据」先 `POST /api/metadata/sync` 再下载 `GET /api/metadata/archive`，灯箱「下载元数据」请求 `GET /api/history/:id/metadata?download=1`。
    - 已实现 sidecar 生命周期：移动画册随图片移动并刷新内容、删除 / 移入回收站时移除、恢复时重新生成、删除画册使作品回根目录时一并移动；PNG 内嵌元数据随图片文件本身移动，回收站里的 PNG 仍保留参数。
    - 版本提升到 **1.7.0**（`package.json`、`package-lock.json` 根版本、`server.js` `APP_VERSION`、`index.html` 的 `?v=1.7.0`、右上角 `v1.7`；`/api/health` 返回 `version:"1.7.0"`）。
    - 自检：在原有 183 项基础上新增 **52 项**元数据导出检查，当前 **235/235 全部通过**（单次约 24 秒）；使用假 LLM / 假 NovelAI + 隔离临时目录，不消耗额度。
14. **1.7.0 隔离 UI 元数据导出检查（2026-11-26）**
    - 临时 `DATA_DIR`/`OUTPUTS_DIR` + 假上游 + 无头 Chrome CDP：**16/16 项通过**，0 页面异常 / 0 console error。
    - 覆盖：页面版本 `v1.7`、画廊「元数据」按钮、灯箱「下载元数据」链接（`?download=1`、`.json` 文件名、整行布局）、点击「元数据」后旧图 sidecar 被补写且 JSON 内容正确、ZIP 导出可用、桌面 1440×900 与移动端 390×844 无横向溢出、按钮在移动端可见。
    - 真实服务只读冒烟 **19/19 通过**：`version:"1.7.0"`、22 张历史 / 2 本画册、单张元数据接口与下载头、ZIP 内有 22 个作品 JSON + manifest（内存生成不写盘）、首页引用 `?v=1.7.0`、22 张卡片、桌面与移动端无溢出、0 异常。
    - 真实作品未做批量补写（避免未经用户确认改写原图）：旧作品需在画廊点一次「元数据」才会写入 PNG 内嵌与 sidecar；新生成作品自动写入。
15. **Git 版本管理 + 私有 GitHub（2026-11-26）**
    - `D:\NAI-Atelier` 已 `git init`（分支 `main`），提交信息「NAI Atelier 1.7.0：本地 LLM Tags × NovelAI 工作台」。
    - `.gitignore` 忽略 `data/config.json`、`data/*.json`、`outputs/`（含 `.trash` 与 sidecar）、`node_modules/`、`*.log`；`.gitattributes` 统一 LF（`.bat` 保持 CRLF）。
    - 通过 GitHub CLI（`y1090026806-eng`）创建**私有**仓库 <https://github.com/y1090026806-eng/nai-atelier> 并推送 `main` 与标签 `v1.7.0`；`gh` 位于 `C:\Users\10900\AppData\Local\Programs\gh-cli\bin\gh.exe` 并已加入用户 PATH。

## 10. 新对话建议的第一步

1. 先确认服务是否运行：
   ```powershell
   Invoke-RestMethod http://127.0.0.1:3000/api/health
   ```
2. 进入项目：
   ```powershell
   cd D:\NAI-Atelier
   ```
3. 阅读代码前先浏览 `README.md`，再读 `server.js`、`public/app.js`、`public/index.html`、`public/style.css`；涉及手机 / 双端需求时先看 `docs/DEVICE-SYNC.md` 与本文件 §13。
4. 不要读取或输出 `data/config.json` 的内容；需要了解配置结构时，看 `server.js` 中的 `DEFAULT_CONFIG` 与 `normalizeConfig()`。
5. 修改前先确认用户需求；不要移动项目回旧路径、不要删除桌面快捷方式、不要删除图片或画册。
6. 如果用户要求继续开发，先说明会改动哪些文件；改完先跑 `npm run verify`，再浏览器刷新验证（`public/` 已 no-store，普通刷新即可；从旧版本升级时建议一次 `Ctrl+F5`），后端改动要重启服务。

## 11. 用户偏好 / 交流约定

- 用户使用中文，回复应使用中文。
- 用户偏好直接实现，而不是只给建议。
- 视觉偏好：深色主题、SillyTavern 风格、磨砂玻璃、紧凑专业排版。
- 不要输出完整 API Key。
- 用户明确要求本地 localhost 使用，不做公网部署。
- 项目已经转移到 D 盘并在桌面提供一键快捷方式；这些是用户明确要求的现状，不要回退。

## 12. 可选后续方向（尚未实现，等用户确认）

- ~~批量删除 / 清空画廊、回收站~~（1.6.0 已实现）。
- ~~生成队列、取消生成、请求超时 UI~~（1.6.0 已实现：单并发队列 + 取消 + NovelAI 超时可配）。
- ~~提示词预设/收藏、Tag 权重编辑~~（1.6.0 已实现：提示词库 + 灯箱权重编辑器）。
- ~~导出 PNG 元数据或配套 JSON~~（1.7.0 已实现：PNG `parameters` / `NAI-Atelier` 文本块 + `.json` sidecar + ZIP 导出）。
- ~~画册封面、拖拽排序、跨画册批量移动~~（1.6.0 已实现）。
- 打包为 Windows 独立启动器（Electron/服务封装）。
- ~~GitHub 版本管理~~（1.7.0 已实现：本地 Git + 私有仓库 <https://github.com/y1090026806-eng/nai-atelier>，标签 `v1.7.0` / `v1.8.0`；日常流程见 §4「代码提交与 GitHub 同步」）。
- ~~重新生成 / 复用历史参数~~（1.1.0 已实现：灯箱「应用修改并重画」与「复用参数」）。
- ~~LLM 统一 OpenAI 兼容 + 拉取模型 + 参数~~（1.2.0 已实现）。
- ~~自动化测试~~（1.2.0 已实现：`npm run verify`）。
- ~~LLM 配置预设~~（1.3.0 已实现：保存/切换/更新/删除）。
- ~~多段 System / Assistant / User 提示词与插入位置~~（1.3.0 已实现）。
- ~~可见的拉取模型列表~~（1.3.0 已修复并持久化）。
- ~~预设自定义命名~~（1.4.0 已实现：对话框命名/重命名，LLM 与 NAI 通用）。
- ~~NovelAI 配置预设~~（1.4.0 已实现：不含 Key/Base URL）。
- ~~正面提示词顺序 Artist → LLM → Base~~（1.4.0 已实现）。
- ~~历史画廊删除单张~~（1.5.0 已实现）。
- ~~画册分类 + 真实文件夹~~（1.5.0 已实现）。
- ~~编辑提示词 / 模型后重画 + 图片快捷翻页对比~~（1.5.0 已实现）。
- ~~预设保存被旧缓存掩盖~~（1.5.0 已修复：public no-store + `?v=` 版本号）。

16. **1.8.0：创作记录 + 预设导入导出 + 提示词大编辑器（2026-11-26）**
    - `npm run verify` 扩到 **244/244 全部通过**：新增记录标题解析（`TITLE:` / JSON）、原始输入、Tag 版本重 roll、版本生图、版本标题 / Tags 编辑、重复输入归组、记录 404 等检查；假上游 + 临时目录，不消耗额度。
    - 隔离 UI（临时 data/outputs + 假上游 + 无头 Chrome）：**17/17** 通过，覆盖记录视图、记录详情、重 roll、版本生图、版本编辑、铅笔大编辑器、图片视图、灯箱原始输入回填、NAI 预设 JSON 导入；无 console error。
    - 真实数据只读检查：35 条旧历史已迁移为 35 条记录，`/api/health` 返回 1.8.0，记录视图 35 条 / 35 张图，旧记录「填回输入框 / 重 roll」按设计禁用，无页面异常。
    - 真实 `data/history.json` 已补 `recordId` / `variantId` / `userText`，新增 `data/records.json`；`outputs/` 图片未改动。1.8.0 改动尚未提交 Git / 打标签。

## 13. 设备间同步（1.9.0）

### 为什么这样做

用户的目标是「电脑和手机都能离线用，联网时自动双向同步」，而不是把项目在两边搬来搬去。因此同步做进应用内部：**两边各自是完整的本地应用**，只在同一 Wi-Fi 下交换增量。没有云盘、没有账号、没有第三方服务。

### 架构

- 主应用照旧只监听 `127.0.0.1:3000`（手机上是 `:3800`）；同步是**第二条监听**：`0.0.0.0:<sync.port>`（默认 3801），只有启用同步时才打开。
- 同步监听只挂 `/sync/*`，所有请求必须带 `Authorization: Bearer <config.sync.token>`（`timingSafeEqual` 比较）。口令由服务端生成（`nai-xxxx-xxxx-xxxx`），不经过任何外部服务。
- 协议版本 `SNAPSHOT_VERSION = 1`，`/sync/ping` 返回 `{ok, version, deviceName, protocol}` 供「检查对方」用。

| 接口 | 作用 |
| --- | --- |
| `GET /sync/ping` | 探活：返回设备名、版本、协议号 |
| `GET /sync/snapshot` | 导出本机快照（索引 + 每个文件的 size/sha256，不含图片本体） |
| `GET /sync/file/:id?kind=image\|trash` | 下载单个文件 |
| `PUT /sync/file/:id?kind=...` | 上传单个文件，落 `outputs/.incoming/`，校验 `x-sha256` |
| `POST /sync/apply` | 接收合并后的快照，落盘并改写索引 |

本地接口（只在本机 127.0.0.1 上）：`GET /api/sync/status`、`POST /api/sync/settings`、`POST /api/sync/run`、`POST /api/sync/peer-check`（server.js 4311 起，路由在 4378–4420）。

### 一次同步的流程（`runLibrarySync`）

1. 取对端 `/sync/snapshot`；
2. 用 `lib/sync-merge.js` 的 `mergeSnapshots(local, remote)` 纯函数合并（不碰磁盘）；
3. 把对端有、本机没有的文件下载到 `outputs/.incoming/`（逐个校验 sha256）；
4. 本机 `applySyncSnapshot`：先 `backupLibraryFiles()` 备份索引，再把 `.incoming` 里的文件搬到最终位置（画册目录或 `.trash/`），清理不再被索引的旧文件与 sidecar，替换 5 个索引并持久化，重新生成 sidecar；
5. 把本机有、对端没有的文件 `PUT` 过去；
6. 把合并快照 `POST` 给对端 `apply`，让对端落到同一状态；
7. 写回 `lastPeerUrl` / `lastSyncAt`。

`syncRunning` 防重入，`syncProgress` 供前端轮询显示进度；单轮最多 300 个文件（`SYNC_MAX_FILES_PER_ROUND`），超出提示分批同步。

### 合并规则（`lib/sync-merge.js`）

纯函数，无 fs / 网络，方便单测：

- 实体：history（作品）、trash（回收站）、albums、records（创作记录 + 变体）、prompts；外加 `state`：`orderUpdatedAt` 与三类墓碑。
- 身份：作品 / 记录 / 画册 / 提示词用 `id`；回收站用 `itemId`（= 原作品 id，1.9.0 新增字段，旧数据回退 `item.id`）。
- 冲突：live 端用 `updatedAt||createdAt`、trash 用 `deletedAt`、墓碑用删除时间；时间新者胜。时间完全相同时按 `deleted > trashed > live`，再按内容 `sha256` 前 16 位裁决——两端算出的结果必然一致。
- 排序：`orderUpdatedAt` 较新的一端提供基序，另一端独有的作品按 `createdAt` 插到对应位置；两端都没排过序时按创建时间降序。
- 变体：records 内部按变体 `id` 合并、按 `updatedAt` 取新。
- config **不参与**：Key / 模型 / 提示词结构各端独立。

### 数据文件

- `data/sync-state.json`：`deviceId`、`orderUpdatedAt`、`historyTombstones` / `albumTombstones` / `promptTombstones`（上限 2000 条，超出裁最旧）。
- `data/backups/<时间戳>/`：每次 apply 前备份 5 个索引，保留 5 份。
- `outputs/.incoming/`：临时下载区，apply 结束清空。
- `data/config.json` 的 `sync` 段：`{enabled, port, token, deviceName, lastPeerUrl, lastSyncAt}`。

### 修改同步逻辑时注意

- 新增可同步实体时，要同时给它加 `updatedAt`、加墓碑表、在 `normalizeSyncState` / `buildSyncSnapshot` / `applySyncSnapshot` / `sync-merge.js` 四处接上，否则删除会「复活」。
- 删除 / 清空 / 移除类操作都要调 `markHistoryGone` / `markAlbumGone` / `markPromptGone`；只改索引不写墓碑 = 下次同步被对方加回来。
- 移动类操作（换画册）要 bump `item.updatedAt`，否则两端会各自保留旧路径。
- 改协议字段必须同时升 `SNAPSHOT_VERSION`，并在 `/sync/*` 上拒绝旧版本，避免新旧客户端互相写坏。
- 任何会改写索引的路径都要先 `backupLibraryFiles()`；`applySyncSnapshot` 已经内置。

### 验证记录（1.9.0，2026-11-27）

- `npm run verify`：**244/244**（版本号断言改为从 `package.json` 读，不再硬编码）。
- `node scripts/sync-selftest.js`：**10/10**（合并规则：时间戳胜负、墓碑优先、排序基序、左右对称、回收站 / 恢复、record 变体）。
- `node scripts/sync-e2e.js`：**32/32**（双实例：首次全量、二次幂等零搬运、新增作品 + 排序回传、回收站双向、彻底删除连文件一起传播、错口令 401、对方离线 502、重启后设置保留）。
- 冒烟：临时目录起服务，`/api/health` 返回 1.9.0，`/api/sync/status` 返回默认关闭 + `addresses:["192.168.10.36"]`，首页含 `sync-dialog` / `open-sync`，静态资源 `?v=1.9.0`。

### 交接方式（顺带解决「搬来搬去」的问题）
- **代码**：两端都只用 Git。改前 `git pull`，改后 `npm run verify && npm run test:sync` 再 `git push`；不要用 zip 或聊天传文件。仓库里 `data/`、`outputs/` 已被忽略，不会误传 Key 与作品。
- **数据**：用应用内同步，不要用网盘同步 `outputs/`（网盘会制造半写文件与冲突副本，sidecar 和索引对不上）。
- **状态**：只维护这一份交接文档 + `README.md` + `docs/DEVICE-SYNC.md`，新对话从这三份开始读，避免多份文档各说各话。
- **本次提交**：1.9.0 已在本地提交并打标签 `v1.9.0`。截至 2026-11-27 推送 GitHub 失败（本机连不上 `github.com:443`，`Connection was reset`）。网络恢复后执行 `git push origin main && git push origin v1.9.0`；手机端等推送成功后再 `git pull`。

---

需要快速接手时，优先参考：`D:\NAI-Atelier\README.md`。

> 安卓移植：见同目录 `NAI-Atelier-Android-HANDOFF.md`（仓库内 `docs/ANDROID-PORT-HANDOFF.md`）——DSH Go 本机引擎部署步骤、改动清单、验收与风险，当前为设计稿，未改代码。
