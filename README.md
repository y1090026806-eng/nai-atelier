# NAI Atelier

一个本地运行的 **LLM Tags × NovelAI** 轻量级 WebUI。输入一段自然语言画面描述，后端先调用 LLM 生成英文 Danbooru 风格标签（或结构化场景 JSON），再与基础正向提示词、画师串、角色提示词和生成参数一起提交给 NovelAI，最后把返回的图片保存到本地 `outputs/`。

界面使用深色磨砂玻璃风格，布局与交互参考 SillyTavern：左侧配置栏，右侧画廊工作区，底部输入与 Generate 按钮。

> 当前版本：**2.0.0**（2026-11-27）。本版重做绘图内核：**V5 走官方流式协议**（`/ai/generate-image-stream` + multipart + MessagePack 帧，边收边解析，中间帧可显示进度）、**角色提示词与归一化坐标**（一图最多 10 个角色，双人以上不再串装）、**结构化提示词**（LLM 直接返回 `scene + characters[] + negative` 的 JSON，失败自动回退单行 tags）、**提示词预设**（4 个内置预设照搬 LittleWhiteBox 场景 Agent 的**LLM 提示词分层**——开场 / 材料与输出去向 / Tag 指南 / 场景规则 / 输出契约，每段是独立提示词块，可单独改、单独对比，支持保存 / 导入 / 导出）、V5 的 `ucPresetId` / `qualityPresetId` / 透明背景 / Variety Boost 开关、**错误分类与 429/5xx 自动重试**、**请求诊断面板**，以及手机端的角色卡与预设区适配。`npm run verify` 扩到 **261 项**，并新增 `npm run test:nai`（41 项纯函数单测）与 `npm run test:msgpack`。上一版 1.9.1 重做手机端底部 Tab；1.9.0 新增设备间同步。

## 功能

- **统一 OpenAI 兼容接口**：DeepSeek、Gemini（OpenAI 兼容端点）、OpenAI 以及各类中转站都用同一套 `/chat/completions` 协议，只需填 Base URL、API Key 与模型名。
- **拉取模型**：在侧栏点「拉取模型」即可从当前 Base URL 读取模型列表（`GET /models`），结果会以可点击列表显示在模型输入框下方；列表随配置保存，刷新后仍保留。
- **LLM / NovelAI 配置预设**：两套配置都能保存为**自定义命名**的预设，用下拉框一键切换；支持重命名覆盖与删除。LLM 预设含连接信息、参数、提示词结构与模型列表；NovelAI 预设含模型、采样、尺寸、Seed 与提示词；NovelAI 预设支持 JSON 导入 / 导出（不含 Key）。
- **创作记录**：默认按原始输入分组。每条记录保存用户原始描述、多个可编辑的 LLM Tag 版本（含 LLM 标题）以及每个版本下的多张图片；支持 Tag 重 roll、同层并排对比、从任意版本继续生图、把原始输入一键填回输入框。旧作品会自动迁移为独立记录。
- **提示词大编辑器**：基础正向 / 画师串 / 负面 / 提示词块 / 灯箱最终 Tag 都有铅笔按钮，可在独立大编辑器中修改并写回。
- **可组合提示词结构**：可添加多段 System / Assistant / User 提示词，分别指定放在「用户输入之前」或「之后」，并调整顺序。
- **提示词预设（内置 + 自定义）**：内置 4 套，结构照搬 LittleWhiteBox 场景 Agent 发给 **LLM** 的提示词——开场（怎么选瞬间、怎么定镜头与画幅）、材料说明与输出去向、Tag 指南（V5 / V4.5）、场景规则、输出契约，五段各自是独立提示词块，可以只改「场景规则」而不动 Tag 指南。预设为：基础 Tags（对照基线）、LWB 分镜（V5·JSON）、LWB 分镜（V4.5·JSON）、LWB 单行（V5·纯 tags）。选中即应用到提示词结构，也可把当前提示词另存为自定义预设、删除、**导出 JSON** 或**导入 JSON**（同名自动加 `(2)` 后缀）。多段 system 块在发送前会合并成一条 system 消息，兼容只接受单条 system 的端点。换预设不会动其他未保存的字段，方便对比不同提示词的实际出图效果。
- **结构化提示词（可选）**：打开「结构化输出」后，LLM 直接返回 `{ title, scene, characters[], negative }` 的 JSON，服务端负责校验、去重与回退；解析失败或字段为空时自动退回「一行英文 tags」的老路径，不会因为模型不听话就生成失败。
- **角色提示词与坐标**：最多 10 个角色，每个角色有自己的正向 / 负面提示词与 X / Y 站位（归一化 0–1，留空由服务端按人数自动排布）。角色词与 `char_captions` 由同一份数据编译，保证两处同源同序；V3 / Furry 这类不支持角色通道的模型会自动把角色词内联进正向并给出提示。
- **可调生成参数**：温度、Top P、最大 Token、思考强度（`reasoning_effort`）与 LLM 请求超时（秒）。
- **完整 NovelAI 参数**：模型版本（含 V5 Full Medium 蒸馏模型）、Sampler、Noise Schedule、Steps、Guidance、CFG Rescale、宽高、Seed；V5 额外支持 `ucPresetId`（负面预设强度）、`qualityPresetId`（质量词）、透明背景；V4.5 支持 Variety Boost。
- **V5 流式协议**：V5 模型改走 `/ai/generate-image-stream`，请求体为 multipart（字段 `request`）+ `stream: "msgpack"`，响应是「4 字节大端长度 + MessagePack」的帧序列。服务端边收边解，`intermediate` 帧用来推进度，`final` 帧取 PNG；旧模型继续走 `/ai/generate-image` + ZIP，两条路径由能力表自动选择。
- **错误分类与重试**：上游状态码归一成 `NAI_AUTH` / `NAI_QUOTA` / `NAI_BUSY` / `NAI_UNAVAILABLE` / `NAI_TIMEOUT` 等 code；429 最多自动重试 2 次、5xx 重试 1 次，队列里能看到「第 n 次重试」；失败原因不再是一句笼统的「生成失败」。
- **请求诊断面板**：侧栏「最近请求」折叠面板显示最近 30 次调用的模型、传输方式、帧数、字节数、重试次数、耗时、警告与错误码，排查「为什么这张图不对/为什么失败」时不用翻终端日志。
- **提示词拼接**：`画师串 → 场景 Tags → 角色内联（仅旧模型）→ 基础正向`，自动去重并去除空标签；负面提示词同时作为 `negative_prompt` 与 `v4_negative_prompt` 发送。
- **实时阶段反馈**：通过 POST SSE 流接收后端真实阶段事件，而不是前端假动画：
  `正在请求 LLM → 正在调用 NovelAI → 正在解压 ZIP → 正在保存`。
- **ZIP 内存解压**：不将临时 ZIP 写入磁盘，使用 `adm-zip` 在内存中找到第一张 PNG/JPEG/WebP 并保存。
- **本地持久化**：API Keys、模型、参数与提示词保存在 `data/config.json`；画廊索引保存在 `data/history.json`；画册列表保存在 `data/albums.json`；回收站索引保存在 `data/trash.json`（图片在隐藏目录 `outputs/.trash/`）；提示词收藏保存在 `data/prompts.json`；图片位于 `outputs/`（画册图片位于 `outputs/albums/<画册ID>/`）。
- **设备间同步**：画廊头部「同步」按钮里打开同步开关、设一个口令，另一台设备填「对方 IP:端口 + 同一口令」即可开始。两边都能离线生图，同步时双向合并作品 / 画册 / 创作记录 / 回收站 / 提示词，删除也会跟着传播；重复同步不会重复搬运文件。只走局域网，不经过云端，也不碰 API Key。详见 [docs/DEVICE-SYNC.md](docs/DEVICE-SYNC.md)。
- **画廊与详情**：图片预览、最终 Tag 展示/复制、下载原图、参数详情、历史持久化。
- **PNG 元数据内嵌**：每次生成 / 重画保存图片时，自动把 A1111 风格的 `parameters`（prompt、Negative prompt、Steps、Sampler、Schedule type、CFG scale、Seed、Size、Model 等）与完整元数据 JSON（`NAI-Atelier` 键）写入 PNG 文本块；Latin-1 不安全的内容改用 `iTXt`，JPEG / WebP 只写配套 JSON。
- **配套 JSON（sidecar）**：图片同目录自动生成 `<原文件名>.json`，内容与内嵌 JSON 一致；移动画册时随图片移动并刷新，删除 / 移入回收站时移除，恢复时重新生成。画廊头部「元数据」可一键给全部作品补写并下载 ZIP，灯箱「下载元数据」下载单张 JSON。
- **画册分类**：画廊顶部新增画册栏，可新建 / 重命名 / 删除画册，按画册筛选；每张作品可随时移动到画册或移回「未分类」。新建画册会在 `outputs/albums/` 下建立真实文件夹，归档时图片文件会随之移动。
- **画册封面**：可在灯箱里把画册内任意作品「设为封面」，画册标签随即显示该缩略图；没有显式设置时自动回退为该画册最新作品。作品移出画册、移入回收站或删除时，封面会自动清空。
- **拖拽排序**：直接拖动卡片即可调整作品顺序，顺序写入 `data/history.json`；把卡片拖到画册标签上即可跨画册移动（多选时整批移动）。
- **批量操作与清空**：卡片左上角可多选，选择条支持「全选当前 / 取消选择 / 批量移动 / 批量删除」；「清空画廊」会把当前筛选下的作品一次性移入回收站。
- **删除单张作品**：画廊卡片与灯箱都提供删除按钮，确认后把作品移入回收站（图片移到隐藏目录 `outputs/.trash/`），可随时恢复；需要永久删除时使用回收站里的「彻底删除」或在接口上带 `?permanent=1`。
- **回收站**：画廊头部「回收站」对话框可查看、恢复或彻底删除已移除的作品。恢复时优先回到原画册（原画册已删除则回到未分类），文件名冲突时自动生成新的合法文件名；最多保留 300 条，超出会自动清理最旧的记录。
- **可编辑重画**：灯箱里的最终 Tag 与负面提示词可直接修改，并可在 V5 / V4.5 / V4 / V3 等模型之间切换后重画；新图自动打开，配合 ← → 方向键或左右按钮快速翻页对比不同提示词 / 模型 / 种子的效果。
- **灯箱快捷操作**：查看大图时可「应用修改并重画」——跳过 LLM，用编辑后的 Tag、负面词、模型与采样参数重新渲染；也可以「复用参数」——把模型、采样、尺寸、Seed 与负面词一键填回左侧配置。
- **提示词收藏库**：可把常用正向 / 负面提示词存成命名收藏（最多 100 条，重名会被拒绝），在画廊头部「提示词库」中增删改，并一键插入基础正向、负面或灯箱；灯箱里也能「收藏 Tag」。
- **Tag 权重编辑**：灯箱内可把最终 Tag 拆成芯片，用 − / + 以 0.05 步进调整权重（0.1–2.0），自动写成 `(tag:1.2)`；权重 1.0 时还原为普通 Tag，可一键重置。加权后的提示词会随「应用修改并重画」发给 NovelAI。
- **生成队列与取消**：所有生成 / 重画都进入单并发队列，可以连续提交多个任务；队列面板显示进度、排队位置与取消按钮，还支持「取消全部排队」。取消的任务不会写入历史。
- **请求超时可视化**：侧栏可设置 NovelAI 请求超时（30–900 秒，默认 300 秒）；生成中进度条上方显示「已用 x.xs / 上限 Ns」，接近上限 80% 时变为黄色警示。
- **响应式布局**：桌面为左右布局，移动端配置栏变为抽屉。

## 技术栈

- Node.js（>= 18.17）+ Express
- 原生 HTML / CSS / JavaScript，无前端框架、无构建步骤
- axios、cors、adm-zip
- 原生 `fs` 持久化（临时文件 + rename 的原子写入）

## 快速开始

```powershell
cd D:\NAI-Atelier
npm install
npm start
```

打开终端输出的地址（默认 <http://127.0.0.1:3000>）。

Windows 下也可以直接双击项目根目录中的 `start-nai-atelier.bat`：它会检查服务是否已启动，按需打开服务窗口，并自动打开浏览器。使用过程中保持服务窗口运行；关闭该窗口即停止本地服务。

首次启动会自动创建：

```text
data/config.json     # API Key、模型、参数与提示词（含同步设置，不参与同步）
data/history.json    # 画廊索引
data/albums.json     # 画册列表（含封面 coverId）
data/trash.json      # 回收站索引
data/prompts.json    # 提示词收藏
data/sync-state.json # 同步状态（设备 ID、排序时间、删除墓碑）
data/backups/        # 每次同步前自动备份的索引（保留最近 5 份）
outputs/             # 生成的 PNG
outputs/albums/      # 画册文件夹（按画册 ID）
outputs/.trash/      # 回收站图片（隐藏目录，不对 /outputs 暴露）
outputs/.incoming/   # 同步过程中的临时目录，同步结束自动清空
```

## 两台设备同步

电脑和手机都装同一份代码、各自跑 `node server.js`，数据不需要经过任何云盘：

1. 两台设备连同一个 Wi-Fi。手机如果要访问电脑，电脑要放行同步端口（默认 `3801`，首次启动时 Windows 防火墙会弹提示，选「允许专用网络」）。
2. 在电脑上打开画廊头部「同步」→ 勾选「允许其他设备同步」→ 点「保存设置」，对话框会显示「在另一台设备填：`192.168.x.x:3801`」和同步口令；点口令旁的复制按钮。
3. 手机上打开「同步」→ 同样打开开关并保存（端口和口令要和电脑一致）→ 在「另一台设备」里填电脑的地址 → 点「开始同步」。
4. 之后每次同步都点「开始同步」即可：第 2 次以后只传新增或修改过的图片，没变化时几秒结束。

规则说明：

- **不会丢数据**：两边各自的作品会合并；同一条作品按修改时间取新的，时间相同再按内容哈希裁决，所以两边算出来的结果一致。
- **删除会传播**：「彻底删除」「清空回收站」「删除画册」都会留下墓碑，同步时对方也会删；移入回收站只是移动位置，可以随时恢复。
- **排序以最近拖动的一端为准**：手机上调完顺序同步给电脑，反之亦然。
- **API Key 不同步**：`data/config.json` 里的 Key、模型和提示词结构各端独立，同步只覆盖作品与创作数据。
- **有备份**：每次同步前会把 5 个索引 JSON 备份到 `data/backups/<时间戳>/`，万一结果不对可以手动回滚。

## 代码仓库

代码托管在**公开** GitHub 仓库：<https://github.com/y1090026806-eng/nai-atelier>（可直接访问，无需登录）。

- `main` 分支对应项目当前代码；标签 `v1.9.1` 对应本版本。两边代码保持同步的方式是各自 `git pull`，手机端改完代码就 `git push`，不再手工传 zip。
- `.gitignore` 已忽略 `data/config.json`（含 API Key）、`data/*.json`、`outputs/`（作品与回收站）、`node_modules/`、`*.log`，这些内容不会进入仓库。
- 本机已安装 GitHub CLI 并登录账号 `y1090026806-eng`；换机器后先 `gh auth login`，再用 `git push` 即可继续同步。

## 文档

| 文件 | 内容 |
| --- | --- |
| [docs/HANDOFF.md](docs/HANDOFF.md) | 交接主文档：运行状态、数据结构、同步实现（§13）、排错、验证记录 |
| [docs/DEVICE-SYNC.md](docs/DEVICE-SYNC.md) | 电脑 ↔ 手机同步：一次性设置、合并规则、故障排查 |
| [docs/ANDROID-PORT-HANDOFF.md](docs/ANDROID-PORT-HANDOFF.md) | 安卓（Termux / PRoot）部署与移植改动清单 |
| [docs/TESTER-GUIDE.md](docs/TESTER-GUIDE.md) | 打包给测试者时的说明模板 |

## 自检

```powershell
npm run verify
```

会在临时目录里启动一份 `server.js`，配合本地假 LLM / 假 NovelAI 上游（含慢速模式，用于验证运行中取消；V5 走 MessagePack 流式假上游），检查配置归一化、标签生成、提示词结构、提示词预设的保存 / 应用 / 导入 / 导出 / 内置保护、能力表、模型拉取、LLM/NovelAI 预设、提示词拼接顺序与加权 Tag 去重、负面提示词、画册文件夹与归档、画册封面、作品排序、批量移动 / 删除、回收站恢复与清理、提示词收藏、单张删除、编辑提示词 / 模型重画、Tag 权重、生成队列（并发为 1、取消排队中与运行中任务、取消全部）、NovelAI 超时、创作记录（Tag 重 roll / 记录生图 / 标题与 Tags 编辑 / 重复输入归组）、诊断记录、错误处理以及重启恢复。当前 **261/261 全部通过**。不会读取真实 `data/config.json`、不访问外网、不消耗任何额度，结束后自动清理临时文件。

另有两组不启动服务的单测：

```powershell
npm run test:nai      # 41 项：能力表、提示词编译、V5 / 旧模型请求体、结构化解析、预设导入导出
npm run test:msgpack  # 48 项：MessagePack 解码器与 V5 帧解析（含逐字节喂入、截断、超限）
```

同步功能单独自检（同样不需要真实 Key）：

```powershell
npm run test:sync
```

先用 10 条纯函数用例验证合并规则（时间戳、墓碑、排序基序、对称性），再起两个独立实例（各自 `DATA_DIR` / `OUTPUTS_DIR` / 端口）跑 32 项端到端：首次全量同步、重复同步零搬运、新增作品与排序回传、回收站双向、彻底删除传播到文件、错口令 401、对方离线 502、重启后设置保留。

## 配置说明

### LLM

所有 LLM 都通过 **OpenAI 兼容协议** 接入：请求 `POST {Base URL}/chat/completions`，模型列表为 `GET {Base URL}/models`。

| 字段 | 示例 / 说明 |
| --- | --- |
| Base URL | `https://api.deepseek.com/v1`，通常以 `/v1` 结尾；也可直接填完整的 `.../chat/completions` 地址 |
| API Key | 对应平台的 Key，以 `Authorization: Bearer` 发送 |
| 模型 | `deepseek-chat`；可点「拉取模型」列出接口返回的模型并点击选择，也可手动输入 |
| 温度 | `0` – `2`，默认 `0.4` |
| Top P | `0` – `1`，默认 `1` |
| 最大 Token | `16` – `32768`，默认 `1024`（作为 `max_tokens` 发送） |
| 思考强度 | 默认不发送；可选 `low` / `medium` / `high`，对应 `reasoning_effort` |
| 超时（秒） | `10` – `600`，默认 `120`，仅作用于 LLM 请求 |

#### 提示词结构

侧栏的「提示词结构」替代了旧版单个 System Prompt：可以添加任意多段提示词（最多 24 段），每段包含：

- **角色**：`System` / `Assistant` / `User`；
- **插入位置**：`用户输入之前` 或 `用户输入之后`；
- **内容**：可自由编辑；
- **顺序**：用 ↑ / ↓ 调整同组内的先后。

最终发送顺序为：所有「之前」段（按列表顺序）→ 你输入的画面描述 → 所有「之后」段（按列表顺序）。空内容或删除全部段落时，只发送用户输入。

#### 提示词预设与结构化输出

「提示词预设」下拉框列出内置与自定义预设，切换后立即把预设里的提示词块写回 `promptBlocks` 并保存：

- **内置预设**（不可删除，可「另存为」一份再改）：基础 Tags（对照基线）、LWB 分镜（V5·JSON，5 块）、LWB 分镜（V4.5·JSON，5 块）、LWB 单行（V5·纯 tags，4 块）；
- **保存 / 更新**：把当前提示词块存成命名预设，选中自定义预设时按钮变为更新；
- **导出**：下载 `nai-atelier-prompt-presets-<时间戳>.json`，可整份或单个导出；
- **导入**：选择 JSON 文件后合并，同名预设自动加 `(2)` 后缀并分配新 id，不会覆盖已有内容；
- 手动编辑任意提示词块会让下拉框回到「当前提示词（自定义）」，避免误以为还在用预设。

打开「结构化输出」后，服务端会在提示词里追加 JSON 契约说明，并把 LLM 的返回按 `{ title, scene, characters[], negative }` 解析：模型返回带 ```json 围栏、前后有解释文字、字段缺失都能容错；如果最终拿不到任何场景或角色内容，会自动回退成单行 tags 的旧路径，并把原因写进诊断面板。

#### LLM 预设

顶部「当前配置」下拉框用于管理预设：

- **保存预设**：点击后弹出命名对话框，默认填「主机名 · 模型名」，可改成任意名称；预设会保存 Base URL、Key、模型、采样参数、提示词结构与已拉取模型列表；
- 选中已有预设后，按钮会变为「更新预设」并进入「重命名 / 更新」模式：改名即重命名，不改名则覆盖更新；保存后立即写入 `data/config.json`；
- 重名会被拒绝，需要换一个名称；
- 切换预设会立即把整套配置填回表单（并标记为未保存，点「保存配置」后持久化）；
- **删除**：删除当前选中的预设。

> 1.5.0 起，`public/` 下的页面资源强制 `Cache-Control: no-store`，`index.html` 也带 `?v=` 版本号；这样升级后刷新页面就会加载新的 `app.js` / `style.css`，不会再出现「界面还是旧版、预设按钮无效」的缓存问题。如果你从旧版升级，首次请按一次 `Ctrl + F5` 强制刷新。

> 旧版本只有一个 `systemPrompt` 字符串，启动时会自动迁移为一段 `System / 用户输入之前` 的提示词块，内容保持不变。

常见 Base URL：

- DeepSeek：`https://api.deepseek.com/v1`，模型 `deepseek-chat` / `deepseek-reasoner`
- Gemini（OpenAI 兼容端点）：`https://generativelanguage.googleapis.com/v1beta/openai`，模型 `gemini-2.5-flash` / `gemini-2.5-pro`
- OpenAI：`https://api.openai.com/v1`，模型 `gpt-4o-mini` 等
- 中转站：填服务商给出的 OpenAI 兼容地址与模型名即可

> 旧版本的「Google Gemini 原生协议」已移除。若 `data/config.json` 里仍是旧的 Gemini 配置，启动时会自动迁移到 `https://generativelanguage.googleapis.com/v1beta/openai`，Key 与模型保持不变。
>
> 「思考强度」只有支持 `reasoning_effort` 的接口才会生效；部分推理模型不接受 `temperature` / `top_p`，遇到 400 参数错误时请改用支持这些参数的模型或中转站。

### NovelAI

- **API Key**：NovelAI 的 **Persistent API Token**（通常以 `pst-` 开头），在 NovelAI Account Settings 中生成。它不是账户密码。
- **模型**：内置 V5 Full / V5 Curated / **V5 Full Medium（蒸馏，14 步）** / V4.5 / V4 / V3 / Furry V3。请选择账户可用的版本；V5 Medium 的 Steps 与采样器由服务端锁定，界面上会置灰。
- **V5 专用参数**：`ucPresetId`（负面预设强度：重度 / 轻度 / 人物特化 / 兽人特化 / 不使用）与 `qualityPresetId`（质量词：标准 / 轻度 / 不使用），只有 V5 模型显示；「透明背景」与 V4.5 的「Variety Boost」也会随模型切换显示或隐藏。
- **角色提示词**：点「+ 添加角色」填写名字与角色正向提示词，可选负面提示词与 X / Y 站位；不填坐标时按人数自动均分站位（1 人居中，2 人 0.33 / 0.67，3 人 0.28 / 0.5 / 0.72）。角色数超过模型上限（V5 为 10、V4 系列为 6）时会截断并在提示里说明。
- **尺寸**：宽高会按 64 对齐。常用 `832 × 1216` / `1216 × 832` / `1024 × 1024`。
- **Seed**：填 `-1` 时每次自动生成随机种子；实际使用的 seed 会写入画廊记录。
- **请求超时**：`30` – `900` 秒，默认 `300`，只作用于每次 NovelAI 生图请求；超时后任务失败，错误消息会带上配置的秒数。该值不随 NovelAI 预设保存。
- **Quality / Anlas**：实际请求会消耗订阅额度或 Anlas，具体以 NovelAI 规则为准。

#### NovelAI 预设

NovelAI 区顶部同样有「当前配置」下拉框与「保存预设 / 删除」：

- 保存模型、Sampler、Noise Schedule、Steps、Guidance、CFG Rescale、宽高、Seed、Quality Tags，以及基础正向、画师串和负面提示词；
- 名称同样通过对话框自定义，选中已有预设保存时可重命名或覆盖；
- **不包含 API Key 与 Base URL**：切换预设不会改变请求发往哪个账户或端点；
- **不包含请求超时**：NovelAI 单次请求超时属于账户级请求配置，只在主配置里生效；
- 切换预设会立即填回表单并标记未保存。

### 提示词

- **基础正向提示词**：所有生成共用的构图/光影/质量类补充。
- **画师串**：如 `artist:wlop, artist:ask_(askzy)`。
- **负面提示词**：同时作为 `negative_prompt` 与 V4/V5 的 `v4_negative_prompt.caption.base_caption` 发送；V3 只发送 `negative_prompt`。
- 发往 NovelAI 的最终正向提示词按以下顺序拼接并去重：

```text
画师串 + LLM 生成的 Tags + 基础正向提示词
```

去重时会忽略 NovelAI 权重语法：`(1girl:1.2)` 与 `1girl` 视为同一个 tag，保留先出现者的写法。

## 使用流程

1. 在左侧填入 LLM 与 NovelAI 凭据，点击「保存配置」（每次生成前也会自动同步当前表单）。
2. 在底部输入任意自然语言描述。
3. 点击「生成」，或用 `Ctrl + Enter` / `Cmd + Enter` 快捷键。
4. 按钮下方会显示实时阶段和进度条。完成后，新图片追加到画廊顶部，并展示本次实际使用的最终 Tag。

画廊中的图片可点击放大查看参数、复制最终 Tag、下载原图，或删除作品（移入回收站，可恢复）。刷新页面后仍会从 `outputs/` 恢复。

**画册**：画廊顶部「ALBUMS」一栏默认有「全部」与「未分类」，点「+ 新建画册」创建画册；当前画册可重命名或删除（删除画册时其中的作品会移回「未分类」，不会丢失图片）。每张作品卡片底部与灯箱里都有「画册」下拉框，可选择归档目标；当处于某个画册筛选下时，新生成的作品也会直接保存进该画册的文件夹。画册标签会显示封面缩略图；卡片可以拖拽排序，拖到画册标签上即可跨画册移动；卡片左上角可多选后批量移动 / 删除。

**对比重画**：灯箱中的最终 Tag 与负面提示词可以直接编辑，也能切换重画模型、选择新种子或沿用原种子。点「应用修改并重画」会用当前编辑内容直接请求 NovelAI（不经过 LLM），完成后自动打开新图；用 ← → 方向键或图片两侧按钮即可在作品间快速翻页，对比不同提示词 / 模型 / 种子的结果。「复用参数」只把参数填回左侧，不改变提示词。

**画册封面**：打开作品灯箱，在「所属画册」行右侧点「设为封面」（只能把画册内的作品设为该画册封面）；画册标签会立即换成这张缩略图。没有显式设置封面的画册会自动显示该画册最新一张作品。作品移出画册、移入回收站或删除时，封面会自动清空。

**拖拽排序**：直接拖动画廊卡片到另一张卡片的左 / 右半边，即可把作品插到它前面 / 后面。前端只把当前筛选下可见的作品发给 `POST /api/history/order`，服务端按新顺序填回原位置，其他画册或未分类的作品位置不受影响，刷新后顺序仍然保留。

**跨画册移动（拖到画册标签）**：把卡片（多选时则整批）拖到顶部画册标签上松手，作品会移动到该画册；拖到「未分类」则移回未分类。

**多选与批量操作**：点卡片左上角的选择按钮进入多选，画廊底部会出现选择条：可「全选当前」视图、取消选择，选好目标画册后点「移动」，或点「批量删除」把所选作品移入回收站。

**清空画廊**：点画廊头部「清空画廊」，会把当前筛选（全部 / 未分类 / 某本画册）下的作品全部移入回收站；确认框会写明数量。图片不会真正删除，可到回收站恢复。

**回收站**：画廊头部「回收站」按钮显示当前条数。对话框里每张作品可「恢复」或「彻底删除」，右上角「清空回收站」会永久删除全部。恢复时优先回到原画册，原画册已删除则回到未分类；目标文件名冲突时会自动生成新的合法文件名。

**导出元数据**：每次生成 / 重画保存图片时都会自动写入元数据，无需额外操作。要补写旧作品：点画廊头部「元数据」——会先给全部历史作品补写 / 刷新 PNG 内嵌与 `.json`，然后自动下载 `nai-atelier-metadata-<时间戳>.zip`（内含每张作品的 `<文件名>.json` 与 `manifest.json`）。只想要单张：打开灯箱点「下载元数据」，或直接请求 `GET /api/history/<id>/metadata?download=1`。PNG 里的 `parameters` 是 A1111 / 常见 WebUI 约定，多数工具与脚本可直接读取；`NAI-Atelier` 文本块与 sidecar `.json` 中是完整记录。

**提示词收藏库**：画廊头部「提示词库」打开对话框，填写名称与正向 / 负面提示词后「保存收藏」；点收藏名称可载入编辑，再点「更新收藏」；每条右侧可「正向 / 负面 / 灯箱 / 复制 / 删除」。灯箱里点「收藏 Tag」会把当前作品的最终 Tag 与负面词预填进收藏表单。

**Tag 权重编辑**：灯箱「FINAL PROMPT」下方展开「Tag 权重编辑」，最终 Tag 会拆成芯片。点 − / + 以 0.05 步进调整（范围 0.1–2.0），也可直接输入数字；权重 1.0 会还原为普通 Tag，`(tag:1.2)` 形式会随「应用修改并重画」提交给 NovelAI；点「重置权重」可全部恢复为 1.0。

**生成队列与取消**：直接点「生成」即可连续提交多个描述，生成中按钮会变为「加入队列」（ADD TO QUEUE）。任务按单并发顺序执行，队列面板显示每个任务的状态 / 排队位置 / 进度，可单独取消，也可「取消全部排队」。运行中的任务点「取消」会中止上游请求，最终状态为 `canceled` 且不写入历史。

**超时显示与设置**：生成时进度条上方会显示「已用 x.xs / 上限 Ns」，LLM 阶段用 LLM 超时、NAI 阶段用 NovelAI 超时；达到上限 80% 时数字变黄。侧栏 NovelAI 区可改「请求超时」（30–900 秒，默认 300），该值不随 NovelAI 预设保存。

## API

### `GET /api/config`

返回：

```json
{
  "config": {
    "llm": { "...": "..." },
    "novelai": { "...": "..." }
  }
}
```

> 这是一个完全本地、单用户应用，配置接口会把 API Key 原样返回给本机页面。请勿把端口暴露到公网。

### `POST /api/config`

接受完整或部分配置，深合并后保存：

```json
{
  "llm": {
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
    "presets": [
      { "name": "api.deepseek.com · deepseek-chat", "baseUrl": "…", "model": "…", "promptBlocks": [] }
    ]
  },
  "novelai": {
    "steps": 28,
    "timeoutSeconds": 300,
    "presets": [
      {
        "name": "V5 竖图",
        "model": "nai-diffusion-5-full",
        "sampler": "k_euler_ancestral",
        "steps": 28,
        "width": 832,
        "height": 1216,
        "seed": -1,
        "basePositive": "…",
        "artistPrompt": "…",
        "negativePrompt": "…"
      }
    ]
  }
}
```

`promptBlocks` 的角色只接受 `system` / `assistant` / `user`，位置只接受 `before` / `after`，最多 24 段；两套 `presets` 各最多 30 个；`availableModels` 最多 300 个并自动去重。`novelai.timeoutSeconds` 会钳制到 `30` – `900`（默认 300）。NovelAI 预设会忽略 `apiKey` / `baseUrl` / `timeoutSeconds`（仍以主配置为准）。

返回保存后的 `config` 和 `savedAt`。

### `POST /api/llm/models`

用当前 Base URL 与 Key 拉取模型列表：

```json
{ "baseUrl": "https://api.deepseek.com/v1", "apiKey": "sk-..." }
```

返回：

```json
{ "models": ["deepseek-chat", "deepseek-reasoner"], "fetchedAt": "..." }
```

服务端请求 `GET {Base URL}/models`，兼容 `{data:[...]}`、`{models:[...]}` 与字符串数组三种返回；`models/` 前缀会被去掉。缺少 Key 返回 `LLM_API_KEY_MISSING`，URL 非法返回 `INVALID_URL`，上游错误返回 `LLM_MODELS_ERROR`。

### `POST /api/generate`

普通 JSON 模式：

```http
POST /api/generate
Content-Type: application/json
Accept: application/json

{ "text": "雨夜的电车月台，穿水手服的少女回头", "albumId": "可选：目标画册 ID" }
```

`albumId` 省略或传 `null` 时保存到 `outputs/` 根目录（未分类）；传入有效画册 ID 时保存到 `outputs/albums/<画册ID>/`。

返回：

```json
{
  "result": {
    "id": "uuid",
    "filename": "nai-20261126-010707-500cad.png",
    "relativePath": "nai-20261126-010707-500cad.png",
    "url": "/outputs/nai-20261126-010707-500cad.png",
    "albumId": null,
    "parentId": "",
    "prompt": "最终拼接后的 Tag",
    "llmTags": "LLM 原始生成的 Tag",
    "model": "nai-diffusion-4-5-full",
    "sampler": "k_euler_ancestral",
    "steps": 28,
    "scale": 5,
    "width": 832,
    "height": 1216,
    "seed": 123456,
    "createdAt": "2026-11-26T01:07:07.000Z"
  }
}
```

`relativePath` 是相对 `outputs/` 的路径；画册图片形如 `albums/<画册ID>/nai-....png`，`url` 为对应的 `/outputs/...` 地址。

流式阶段模式（前端默认使用）：

```http
POST /api/generate
Accept: text/event-stream
Content-Type: application/json

{ "text": "..." }
```

响应为 SSE：

```text
event: stage
data: {"stage":"llm","message":"正在请求 LLM 生成 Danbooru 标签…","progress":15}

event: stage
data: {"stage":"nai","message":"正在调用 NovelAI 生图…","progress":45}

event: stage
data: {"stage":"unzip","message":"正在从 NovelAI ZIP 中解压图片…","progress":82}

event: stage
data: {"stage":"save","message":"正在保存图片到本地 outputs/…","progress":94}

event: done
data: {"result":{...}}
```

错误会以 `event: error` 返回。两种模式共用同一套生成流程。

> 1.6.0 起，生成请求内部会作为任务进入**单并发队列**（见下文「生成队列 API」），多个请求会依次执行；如果提交时队列正忙，SSE 会先收到一条 `stage: "queued"` 事件，空闲时阶段仍是 `llm → nai → unzip → save`。SSE 客户端中途断开连接时，对应任务会被取消，避免继续消耗额度。

### `POST /api/history/:id/rerender`

跳过 LLM，用这条历史记录里保存的最终 Tag、负面提示词和采样参数重新请求 NovelAI。支持在重画前覆盖提示词、负面词、模型与采样参数，方便对比不同提示词 / 模型效果：

```http
POST /api/history/<id>/rerender
Content-Type: application/json
Accept: application/json   # 也可以使用 text/event-stream

{
  "seedMode": "new",
  "prompt": "可选：编辑后的最终 Tag",
  "negativePrompt": "可选：编辑后的负面词",
  "model": "可选：nai-diffusion-5-full",
  "steps": 28,
  "scale": 5,
  "width": 832,
  "height": 1216,
  "albumId": "可选：新图保存到的画册 ID"
}
```

- `seedMode: "new"`（默认）：换一个随机 Seed，生成变体；`same` 复用记录中的 Seed，尽量复现原图。
- `prompt` 省略时沿用原记录；显式传入空字符串或纯空白会返回 `EMPTY_PROMPT`。
- `negativePrompt` / `model` / `sampler` / `noiseSchedule` / `steps` / `scale` / `cfgRescale` / `width` / `height` / `qualityToggle` 均可覆盖；未提供的字段沿用原记录。
- `albumId` 省略时沿用原记录所在画册；传 `null` 表示保存到未分类。
- 响应体与 `/api/generate` 相同（`{ result }` 或 SSE 的 `stage` / `done` / `error`），新图片同样追加到画廊顶部，并带上 `parentId` 指向原作品。
- 与 `/api/generate` 一样，重画任务也进入单并发队列；SSE 排队时会先收到 `stage: "queued"`，客户端断开时任务会被取消，取消后不会写入历史。
- 错误码：`HISTORY_NOT_FOUND`、`HISTORY_FILE_MISSING`、`HISTORY_PROMPT_MISSING`、`NAI_API_KEY_MISSING`、`EMPTY_PROMPT`、`ALBUM_NOT_FOUND`。

### `POST /api/history/:id/album`

把某张作品移动到画册或移回未分类，服务端会同步移动真实图片文件、配套 `.json` sidecar，并刷新历史与元数据（`relativePath` / `albumId` / `url`）：

```json
{ "albumId": "画册 ID，或 null 表示未分类" }
```

返回 `{ "item": { ...更新后的记录 } }`。示例错误码：`HISTORY_NOT_FOUND`、`ALBUM_NOT_FOUND`、`HISTORY_FILE_MISSING`。

### `DELETE /api/history/:id`

默认把作品移入回收站：图片文件移动到隐藏目录 `outputs/.trash/` 并在 `data/trash.json` 中记录，同时从 `data/history.json` 移除索引；可随时从回收站恢复。

```http
DELETE /api/history/<id>              # 移入回收站
DELETE /api/history/<id>?permanent=1  # 彻底删除，无法恢复
```

成功返回 `{ "deleted": "<id>", "filename": "...", "trashed": true }`；不存在返回 `HISTORY_NOT_FOUND`。带 `?permanent=1` 时直接删除图片文件与索引，`trashed` 为 `false`。

两种删除都会移除图片旁的 `.json` sidecar；移入回收站时 PNG 内的内嵌元数据仍随图片保留，恢复时会重新生成 sidecar 并刷新内嵌内容。

### `POST /api/history/order`

调整画廊顺序：

```json
{ "ids": ["<id1>", "<id2>", "<id3>"] }
```

客户端只需发送当前可见的子集（全部 / 某本画册 / 未分类）。服务端把这些 id 按新顺序填回它们在 `history.json` 中的原位置，未列出的记录位置不变；一次最多 200 个 id。成功返回 `{ "items": [ ...完整历史数组... ] }`。错误码：`ORDER_IDS_REQUIRED`（列表为空）、`ORDER_IDS_INVALID`（没有任何有效 id）。

### `POST /api/history/batch-album`

批量把作品移动到画册：

```json
{ "ids": ["<id1>", "<id2>"], "albumId": "<画册ID 或 null>" }
```

`albumId` 为 `null` / 省略表示移回未分类。逐张移动真实图片文件并更新历史，返回 `{ "items": [...更新后的记录...], "moved": 2, "failed": [{ "id": "...", "message": "..." }], "albums": [...] }`。错误码：`IDS_REQUIRED`、`ALBUM_NOT_FOUND`；一次最多 200 个 id。

### `POST /api/history/batch-delete`

批量把作品移入回收站：

```json
{ "ids": ["<id1>", "<id2>"] }
```

返回 `{ "trashed": ["<id1>", ...], "failed": [{ "id": "...", "message": "..." }], "albums": [...] }`。`IDS_REQUIRED` 表示没有有效 id；一次最多 200 个。

### 画册 API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/albums` | 返回 `{ albums: [{ id, name, createdAt, coverId, coverUrl, explicitCoverId, count }] }`；`coverId` / `coverUrl` 未显式设置封面时为该画册最新作品（兜底），`explicitCoverId` 只在显式设置封面时非空；空画册的 `coverId` / `coverUrl` 为空字符串 |
| `POST` | `/api/albums` | 新建画册，body `{ "name": "风景" }`，同时在 `outputs/albums/` 下建立文件夹；重名返回 `ALBUM_EXISTS` |
| `POST` | `/api/albums/:id` | 重命名画册，body `{ "name": "新名称" }`；只改显示名，不移动图片 |
| `POST` | `/api/albums/:id/cover` | 设置 / 清除画册封面，body `{ "historyId": "<作品ID>" }`；传 `null`、`""` 或省略表示清除。只能设该画册内的作品；返回 `{ album, albums }` |
| `DELETE` | `/api/albums/:id` | 删除画册；其中的作品会移回未分类，画册文件夹被移除 |

画册名称会去掉首尾空白、压缩连续空格，最长 40 个字符；同名（不区分大小写）会被拒绝；最多 60 个画册。

封面错误码：`ALBUM_NOT_FOUND`、`HISTORY_NOT_FOUND`、`COVER_NOT_IN_ALBUM`（作品不属于该画册）、`INVALID_COVER`（类型不合法）。作品被移到其他画册、移入回收站或删除时，服务端会自动清空指向它的封面设置。

### `GET /api/history`

返回 `{ "items": [...] }`，最新作品在前，最多保留 200 条索引。每条记录包含 `relativePath`、`albumId` 与 `parentId`（重画变体时指向原作品）。1.6.0 起顺序可通过 `POST /api/history/order` 调整并持久化。

### 元数据导出 API（1.7.0）

#### `GET /api/history/:id/metadata`

返回某张作品的完整元数据：

```json
{
  "metadata": {
    "schema": "nai-atelier.metadata/1",
    "app": "NAI Atelier",
    "appVersion": "1.8.0",
    "exportedAt": "2026-11-26T08:00:00.000Z",
    "id": "uuid",
    "filename": "nai-20261126-010707-500cad.png",
    "relativePath": "nai-20261126-010707-500cad.png",
    "url": "/outputs/nai-20261126-010707-500cad.png",
    "albumId": null,
    "parentId": "",
    "prompt": "最终拼接后的 Tag",
    "llmTags": "LLM 原始生成的 Tag",
    "negativePrompt": "…",
    "model": "nai-diffusion-4-5-full",
    "sampler": "k_euler_ancestral",
    "noiseSchedule": "karras",
    "steps": 28,
    "scale": 5,
    "cfgRescale": 0,
    "width": 832,
    "height": 1216,
    "seed": 123456,
    "qualityToggle": true,
    "llmProvider": "openai",
    "llmModel": "deepseek-chat",
    "createdAt": "2026-11-26T01:07:07.000Z",
    "elapsedMs": 12345
  }
}
```

- 带 `?download=1` 时按附件返回（`Content-Type: application/json`、`Content-Disposition: attachment; filename="<文件名>.json"`）。
- 元数据由历史记录即时生成，不依赖 sidecar 是否存在。未知 id 返回 404 `HISTORY_NOT_FOUND`。

#### `POST /api/metadata/sync`

给历史作品补写 / 刷新元数据（PNG 内嵌 + sidecar）；body 可选：

```json
{ "ids": ["<id1>", "<id2>"] }
```

- `ids` 省略或为空数组时同步全部历史作品。
- 返回 `{ "synced": 2, "failed": [{ "id": "...", "filename": "...", "message": "..." }], "total": 2 }`；`total` 为当前历史作品总数。原图文件缺失的作品会进入 `failed`，不影响其他作品。
- 幂等：重复同步会替换旧的 `parameters` / `NAI-Atelier` 文本块，不会累积重复 chunk。

#### `GET /api/metadata/archive`

返回 ZIP（`Content-Type: application/zip`，`Content-Disposition: attachment; filename="nai-atelier-metadata-<时间戳>.zip"`）：每张历史作品一个 `<文件名>.json`（内容与 sidecar 一致），外加 `manifest.json`（`schema` / `app` / `appVersion` / `exportedAt` / `count`）。响应头 `X-Metadata-Count` 为打包的作品数量。打包内容由历史记录即时生成，无需先调用 sync。

> sidecar 生命周期：移动到画册时 `.json` 跟随图片并刷新内容；删除（移入回收站或永久删除）时移除 `.json`；从回收站恢复时重新生成；删除画册使作品移回根目录时 `.json` 一并回到根目录。PNG 内嵌元数据随图片文件本身移动，因此回收站里的 PNG 也保留参数。

### 回收站 API（1.6.0）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/trash` | 返回 `{ items: [{ id, filename, url, deletedAt, createdAt, albumId, prompt, width, height, model }] }`；`url` 形如 `/trash-files/<文件名>` |
| `POST` | `/api/trash/:id/restore` | 恢复一张作品并重新生成元数据 sidecar，返回 `{ item, items }`；原画册已删除时回到未分类，文件名冲突时自动生成新的合法文件名。错误码 `TRASH_NOT_FOUND`、`TRASH_FILE_MISSING`、`TRASH_INVALID` |
| `DELETE` | `/api/trash/:id` | 彻底删除一条回收站记录（连同图片文件），返回 `{ deleted, items }`；错误码 `TRASH_NOT_FOUND` |
| `DELETE` | `/api/trash` | 清空回收站，永久删除所有图片，返回 `{ deleted: <数量>, items: [] }` |

回收站上限 300 条，超出时自动清理最旧的记录（连同图片文件）。回收站图片只通过 `/trash-files/<file>` 访问；`/outputs` 仍然禁止访问点开头的文件，因此 `outputs/.trash/` 不会作为普通作品暴露。

### 提示词收藏 API（1.6.0）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/prompts` | 返回 `{ prompts: [{ id, name, positive, negative, createdAt }] }` |
| `POST` | `/api/prompts` | 新建或更新收藏：body `{ id?, name, positive, negative }`；带 `id` 为更新，否则新建。返回 `{ prompt, prompts }` |
| `DELETE` | `/api/prompts/:id` | 删除一条收藏，返回 `{ deleted, prompts }`；错误码 `PROMPT_NOT_FOUND` |

名称必填、最长 60 字；正向与负面至少填写一项；名称不区分大小写去重，重名返回 `PROMPT_EXISTS`；最多 100 条，超出返回 `PROMPT_LIMIT`；空名返回 `PROMPT_NAME_REQUIRED`，正向与负面都为空返回 `PROMPT_EMPTY`。

### 生成队列 API（1.6.0）

所有生成与重画都进入同一个**单并发队列**：同一时间只有一个任务在调用上游，其余任务排队等待。

#### `POST /api/jobs`

```json
{ "kind": "generate", "text": "雨夜的电车月台", "albumId": "可选：目标画册 ID" }
```

或重画：

```json
{
  "kind": "rerender",
  "historyId": "<作品ID>",
  "seedMode": "new",
  "prompt": "可选：编辑后的 Tag",
  "negativePrompt": "可选",
  "model": "可选",
  "albumId": "可选"
}
```

成功返回 **202**：`{ "job": { ...任务... }, "queueLength": 0 }`。`kind` 省略时按 `generate` 处理；`text` 为空返回 400 `EMPTY_INPUT`，过长返回 `INPUT_TOO_LONG`，画册不存在返回 404 `ALBUM_NOT_FOUND`。重画参数的错误会在任务开始执行时体现在任务的 `error` 字段里。

任务对象字段：`id`、`kind`（`generate` / `rerender`）、`label`、`status`（`queued` / `running` / `done` / `error` / `canceled`）、`stage`、`message`、`progress`、`position`、`queueLength`、`createdAt` / `startedAt` / `finishedAt`、`elapsedMs`、`result`、`error`。

#### `GET /api/jobs`

返回最近 50 条任务（新的在前）：

```json
{
  "jobs": [ ... ],
  "running": { ...当前运行的任务，或 null... },
  "queueLength": 0,
  "limits": { "llmTimeoutSeconds": 120, "naiTimeoutSeconds": 300 }
}
```

#### `POST /api/jobs/:id/cancel`

取消排队中或运行中的任务：排队中立即取消；运行中会中止上游 axios 请求，最终状态为 `canceled`，**不写入历史**。返回 `{ job, jobs, running, queueLength, limits }`；不存在返回 404 `JOB_NOT_FOUND`。

#### `POST /api/jobs/cancel-all`

取消所有**排队中**的任务（正在运行的任务不受影响），返回结构同上。

#### `DELETE /api/jobs/:id`

从任务列表移除一条**已结束**的任务记录，返回 `{ deleted, jobs, running, queueLength, limits }`；任务仍在排队 / 运行中时返回 409 `JOB_ACTIVE`，不存在返回 404 `JOB_NOT_FOUND`。

### 提示词预设 API（2.0.0）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/prompt-presets` | 返回 `{ presets, activeId, structuredOutput, maxPresets }`；`presets` 里内置预设带 `builtin: true` 与 `builtin-` 前缀 id，排在自定义预设之前 |
| `POST` | `/api/prompt-presets/save` | body `{ preset: { id?, name, blocks[], structuredOutput?, structuredSchema? } }`；带已有自定义 `id` 为更新，否则新建。返回 `{ preset, presets, activeId, ... }` |
| `POST` | `/api/prompt-presets/delete` | body `{ id }`；内置预设返回 400 `PRESET_BUILTIN`，不存在返回 404 `PRESET_NOT_FOUND`；删除当前应用中的预设会同时清空 `activeId` |
| `POST` | `/api/prompt-presets/apply` | body `{ id }`；把预设的 `blocks` 写入 `llm.promptBlocks`、`structuredOutput` 写入同名字段，并记录 `activePromptPresetId`。返回 `{ ...状态, config }` |
| `GET` | `/api/prompt-presets/export` | 直接返回附件 JSON：`{ app: "nai-atelier", kind: "nai-atelier/prompt-presets", version: 1, presets: [...] }`；可带 `?id=` 只导出一个 |
| `POST` | `/api/prompt-presets/import` | body `{ text }`（文件内容字符串）；支持导出格式、`{ presets: [...] }`、单个预设、裸数组四种形态。同名自动加 `(2)` 后缀并分配新 id，返回 `{ added, skipped, names, ...状态 }` |

预设上限 40 个、每份预设最多 24 个提示词块；名称必填且不超过 60 字，至少一个非空块。内置预设不可删除，但可以「另存为」自定义预设后再改。

### 模型能力 API（2.0.0）

`GET /api/nai/capabilities` 返回：

```json
{
  "models": [
    { "id": "nai-diffusion-5-full", "label": "V5 Full", "family": "v5", "transport": "msgpack-stream",
      "maxCharacters": 10, "centerMode": "normalized", "supportsCharacterPrompts": true,
      "supportsV5Presets": true, "supportsTransparentBackground": true, "supportsVibe": false,
      "supportsVarietyBoost": false, "lockedSteps": null, "lockedSampler": null }
  ],
  "ucPresets": { "heavy": { "id": "heavy", "label": "重度（默认）", "legacyValue": 0 } },
  "qualityPresets": { "standard": { "id": "standard", "label": "标准", "tags": "very aesthetic, masterpiece, no text" } }
}
```

前端据此决定显示哪些控件、哪些参数要锁定，避免界面出现模型不支持却可点的开关。

### 请求诊断 API（2.0.0）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/nai/diagnostics` | 返回 `{ items, limit }`，最多保留 30 条，新的在前；每条含 `ok`、`model`、`transport`、`endpoint`、`bytes`、`frames`、`attempts`、`characters`、`warnings`、`seed`、`elapsedMs`、`errorCode` / `errorMessage` |
| `DELETE` | `/api/nai/diagnostics` | 清空诊断记录（同时写空 `data/diagnostics.json`） |

诊断记录只保存请求的元信息（模型、传输、耗时、错误码、压缩后的提示词警告），不保存 API Key。

### `GET /api/health`

返回运行状态，便于检查服务是否启动（2.0.0 的 `version` 为 `2.0.0`）。

## 目录结构

```text
D:\NAI-Atelier\
├─ package.json
├─ server.js              # Express 路由、LLM 适配器、生成流程编排、持久化、PNG 元数据 / sidecar
├─ lib/
│  ├─ msgpack.js          # 最小 MessagePack 解码器（V5 流式响应用，零依赖）
│  ├─ nai/
│  │  ├─ capabilities.js  # 模型能力表：端点 / 传输 / 角色上限 / 锁定参数 / uc 与 quality 预设
│  │  ├─ payload.js       # V5 与旧模型的请求体构造（含 characterPrompts / char_captions）
│  │  ├─ compile.js       # 提示词编译：画师串 → 场景 → 角色（仅旧模型）→ 基础正向，负数与坐标
│  │  ├─ transport.js     # multipart 请求、msgpack 流式解析、超时、429 / 5xx 重试
│  │  ├─ v5-stream.js     # 4 字节长度前缀 + MessagePack 的帧解析（跨 chunk、截断、超限）
│  │  └─ errors.js        # NaiError 与状态码分类、重试决策
│  └─ prompts/
│     ├─ tags.js          # tag 去重 / 加权解析的唯一口径
│     ├─ parse.js         # 结构化输出解析（剥围栏、括号配对、字段归一）
│     ├─ presets.js       # 提示词预设的归一化、导入合并、导出格式
│     └─ builtin-presets.js # 4 套内置 LLM 提示词预设，按 LWB 场景 Agent 的五段结构拆分
├─ scripts/
│  ├─ verify.js           # npm run verify 自检（临时目录 + 假 LLM / 假 V5 流式上游）
│  ├─ test-nai.js         # npm run test:nai 纯函数单测
│  └─ test-msgpack.js     # npm run test:msgpack 解码器与帧解析单测
├─ public/
│  ├─ index.html          # 页面结构（提示词预设、V5 参数、角色卡、诊断面板）
│  ├─ style.css           # 深色磨砂玻璃样式、批量条 / 队列 / 回收站 / 提示词库 / 权重编辑器 / 角色卡与响应式布局
│  └─ app.js              # 表单、SSE、画廊、拖拽排序、批量操作、队列轮询、预设管理、角色编辑、诊断面板、灯箱
├─ data/                  # 运行时自动生成
│  ├─ config.json
│  ├─ history.json
│  ├─ records.json         # 创作记录：原始输入、Tag 版本与标题
│  ├─ albums.json         # 画册列表（含封面 coverId）
│  ├─ trash.json          # 回收站索引
│  ├─ prompts.json        # 提示词收藏
│  └─ diagnostics.json    # 最近 30 次 NovelAI 请求的诊断记录
├─ outputs/               # 生成图片（未分类）
│  ├─ albums/<画册ID>/    # 画册图片（每本画册一个真实文件夹，含同名 .json）
│  ├─ .trash/             # 回收站图片（隐藏目录）
│  └─ <图片同名>.json     # 每张图片的元数据 sidecar（与 PNG 内嵌 JSON 相同）
└─ README.md
```

## NovelAI 请求要点

- 旧模型（V4.5 / V4 / V3 / Furry）：`POST https://image.novelai.net/ai/generate-image`，Header `Authorization: Bearer <NAI_TOKEN>`，请求体含 `input`、`model`、`action: "generate"` 与 `parameters`；响应是 **ZIP**，在内存中用 `AdmZip` 取第一张图片，不落盘。
- V5 模型：`POST https://image.novelai.net/ai/generate-image-stream`，body 为 **multipart/form-data**（单字段 `request`，filename `blob`，内容类型 JSON），`parameters` 里带 `stream: "msgpack"`、`params_version: 4`、`ucPresetId`、`qualityPresetId`、`use_coords`、`straight_alpha` 与 `characterPrompts`；响应是 `4 字节大端长度 + MessagePack` 的帧序列，只取 `event_type: "final"` 且 `samp_ix === 0` 的帧里的 PNG。
- 结构化提示词：V4.5 / V4 / V5 会发送 `v4_prompt.caption.base_caption` 与 `v4_negative_prompt.caption.base_caption`；有角色时额外发送 `characterPrompts[]` 与 `char_captions[]`（两处同源同序，坐标写在 `centers`）。V3 只发送扁平的正 / 负面提示词。
- `params_version`：V5 为 `4`，V4 / V3 为 `3`。
- V4.5 开启 Variety Boost 时按分辨率计算 `skip_cfg_above_sigma = sqrt(w*h/1011712)*58`，避免高分辨率下 CFG 过早衰减。
- 上游错误会归一成 `NaiError`：`NAI_AUTH`（401/403）、`NAI_QUOTA`（402）、`NAI_BUSY`（429，自动重试）、`NAI_UNAVAILABLE` / `NAI_UPSTREAM_ERROR`（5xx）、`NAI_TIMEOUT`、`NAI_BAD_REQUEST`（400/422）。HTTP 层只向浏览器暴露 400（参数问题）/ 499（已取消）/ 502（上游问题），避免把上游状态码误当成本地权限问题。

> 模型名称和接口字段会随 NovelAI 更新而变化。V5 的流式格式是按公开实现逆向整理的，若官方改版导致解析失败，`lib/nai/v5-stream.js` 会报 `V5_STREAM_*` 错误并保留原始诊断信息；也可在能力表 `lib/nai/capabilities.js` 里把该模型临时改回旧的 `image` 传输。

## 可选环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | 服务端口 |
| `HOST` | `127.0.0.1` | 监听地址，保持默认以仅本机访问 |
| `DATA_DIR` | `./data` | 配置与历史目录 |
| `OUTPUTS_DIR` | `./outputs` | 图片输出目录 |

Windows PowerShell 自定义端口示例：

```powershell
$env:PORT=4000; npm start
```

## 安全与注意事项

- 应用默认只监听 `127.0.0.1`，并仅对 localhost 来源开放 CORS。
- API Keys 以明文形式保存在本地 `data/config.json`，该文件已被 `.gitignore` 忽略。请勿分享该文件。
- `data/history.json`、`data/records.json`、`data/albums.json`、`data/trash.json`、`data/prompts.json` 与 `outputs/` 都只属于本机；不要手动删除 `outputs/`（包括 `outputs/.trash/` 里的回收站图片），否则作品与回收站会失去对应文件。
- **元数据隐私**：每次生成 / 重画都会把 prompt、seed、参数等写进 PNG 文本块，并在 `outputs/` 中生成 sidecar `.json`。分享 PNG 或整个 `outputs/` 目录等于分享这些生成参数；API Key 等凭据不在元数据字段内。`outputs/` 已被 `.gitignore` 忽略。
- `/outputs` 禁止访问点开头的文件/目录，回收站图片只通过 `/trash-files/<file>` 挂载访问，不会出现在普通画廊里。
- 不要在没有额外认证的情况下把本服务暴露到局域网或公网。
- 生成行为可能消耗 NovelAI 订阅额度 / Anlas。提交前请确认参数；取消生成会中止上游请求，但已经发出的请求可能仍会计费。
- 应用会把用户输入与配置中的提示词发送给所选 LLM 和 NovelAI，这是应用的预期行为。

## 版本历史

| 版本 | 主要变化 |
| --- | --- |
| 2.0.0 | 绘图内核重做：V5 流式协议（multipart + MessagePack，中间帧进度）、角色提示词与归一化坐标、结构化提示词 JSON（失败回退 tags）、提示词预设（4 套内置 + 导入导出）、`ucPresetId` / `qualityPresetId` / 透明背景 / Variety Boost、错误分类与 429/5xx 自动重试、请求诊断面板、V5 Full Medium；`lib/` 拆分能力表 / 编译 / 请求体 / 传输 / 流解析；自检 259 项 + `test:nai` 41 项 + `test:msgpack` 48 项 |
| 1.9.1 | 手机端底部 Tab 重构：画廊 / 生成 / 队列 / 设置四个全屏页面、通栏双列卡片、画册与操作底部弹层、生成页最近作品条、记录详情底部抽屉、多选模式、安全区适配；桌面端不变 |
| 1.9.0 | 设备间同步：局域网口令认证的双向合并（作品 / 画册 / 创作记录 / 回收站 / 提示词），删除墓碑、排序时间戳、SHA-256 文件校验、同步前自动备份索引；画廊「同步」面板；`npm run test:sync`（10 单测 + 32 双实例端到端） |
| 1.8.0 | 创作记录（原始输入 → 多个可编辑 Tag 版本 → 多张图片）、Tag 重 roll 与同层对比、记录标题编辑、原始输入回填；NAI 预设 JSON 导入 / 导出；提示词铅笔大编辑器；历史原始输入展示；自检扩到 244 项 |
| 1.7.0 | PNG 元数据（A1111 `parameters` + `NAI-Atelier` JSON 文本块）与配套 `.json` sidecar；画廊「元数据」一键补写并下载 ZIP、灯箱下载单张 JSON；新增元数据 API；自检扩到 235 项 |
| 1.6.0 | 画册封面、拖拽排序、批量操作 / 清空画廊 / 回收站、提示词收藏库、Tag 权重编辑、生成队列与取消、可配置 NovelAI 超时；自检扩到 183 项 |
| 1.5.0 | 画册（真实文件夹 + 归档 / 筛选 / 重命名 / 删除）、单张删除、灯箱编辑提示词 / 模型后重画与翻页对比、静态资源缓存修复 |
| 1.4.0 | 自定义命名预设、正面提示词顺序 Artist → LLM → Base、负面提示词明确发送 |
| 1.3.0 | 可见的模型列表、LLM 配置预设、多段 System / Assistant / User 提示词结构 |
| 1.2.0 | LLM 统一为 OpenAI 兼容协议、`npm run verify` 常驻自检 |
| 1.1.0 | 灯箱「应用修改并重画」与「复用参数」 |

## License

本项目供个人本地使用。NovelAI、DeepSeek、Google Gemini 及相关模型、服务归其各自权利方所有。
