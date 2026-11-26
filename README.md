# NAI Atelier

一个本地运行的 **LLM Tags × NovelAI** 轻量级 WebUI。输入一段自然语言画面描述，后端先调用 LLM 生成英文 Danbooru 风格标签，再与基础正向提示词、画师串、负面提示词和生成参数一起提交给 NovelAI，最后把 ZIP 响应在内存中解压成 PNG 并保存到本地 `outputs/`。

界面使用深色磨砂玻璃风格，布局与交互参考 SillyTavern：左侧配置栏，右侧画廊工作区，底部输入与 Generate 按钮。

> 当前版本：**1.9.0**（2026-11-27）。本版新增**设备间同步**：电脑和手机各自离线工作，连同一个 Wi-Fi 时点一下「同步」就把两边的作品、画册、创作记录、回收站和提示词收藏双向合并，不用再手工拷贝文件。同步走局域网端口 + 口令，图片按 SHA-256 校验，删除操作靠墓碑记录传播，不会再「删了又被对方同步回来」。配置（含 API Key）不参与同步，各端独立。`npm run verify` 仍是 **244 项全部通过**，另加 `npm run test:sync`（10 项合并单测 + 32 项双实例端到端）。上一版 1.8.0 新增创作记录：以用户原始输入为一条记录，记录下保存多个可编辑的 LLM Tag 版本，每个版本可生成并叠放多张图片；支持 Tag 重 roll、同层并排对比、记录标题编辑、原始输入回填，以及 NAI 预设 JSON 导入 / 导出、提示词铅笔大编辑器。

## 功能

- **统一 OpenAI 兼容接口**：DeepSeek、Gemini（OpenAI 兼容端点）、OpenAI 以及各类中转站都用同一套 `/chat/completions` 协议，只需填 Base URL、API Key 与模型名。
- **拉取模型**：在侧栏点「拉取模型」即可从当前 Base URL 读取模型列表（`GET /models`），结果会以可点击列表显示在模型输入框下方；列表随配置保存，刷新后仍保留。
- **LLM / NovelAI 配置预设**：两套配置都能保存为**自定义命名**的预设，用下拉框一键切换；支持重命名覆盖与删除。LLM 预设含连接信息、参数、提示词结构与模型列表；NovelAI 预设含模型、采样、尺寸、Seed 与提示词；NovelAI 预设支持 JSON 导入 / 导出（不含 Key）。
- **创作记录**：默认按原始输入分组。每条记录保存用户原始描述、多个可编辑的 LLM Tag 版本（含 LLM 标题）以及每个版本下的多张图片；支持 Tag 重 roll、同层并排对比、从任意版本继续生图、把原始输入一键填回输入框。旧作品会自动迁移为独立记录。
- **提示词大编辑器**：基础正向 / 画师串 / 负面 / 提示词块 / 灯箱最终 Tag 都有铅笔按钮，可在独立大编辑器中修改并写回。
- **可组合提示词结构**：可添加多段 System / Assistant / User 提示词，分别指定放在「用户输入之前」或「之后」，并调整顺序。
- **可调生成参数**：温度、Top P、最大 Token、思考强度（`reasoning_effort`）与 LLM 请求超时（秒）。
- **完整 NovelAI 参数**：模型版本、Sampler、Noise Schedule、Steps、Guidance、CFG Rescale、宽高、Seed、Quality Tags。
- **提示词拼接**：`画师串 → LLM Tags → 基础正向`，自动去重并去除空标签；负面提示词同时作为 `negative_prompt` 与 `v4_negative_prompt` 发送。
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

代码托管在**私有** GitHub 仓库：<https://github.com/y1090026806-eng/nai-atelier>（需登录且有权限才能访问）。

- `main` 分支对应项目当前代码；标签 `v1.9.0` 对应本版本。两边代码保持同步的方式是各自 `git pull`，手机端改完代码就 `git push`，不再手工传 zip。
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

会在临时目录里启动一份 `server.js`，配合本地假 LLM / 假 NovelAI 上游（含慢速模式，用于验证运行中取消），检查配置归一化、标签生成、提示词结构、模型拉取、LLM/NovelAI 预设、提示词拼接顺序与加权 Tag 去重、负面提示词、画册文件夹与归档、画册封面、作品排序、批量移动 / 删除、回收站恢复与清理、提示词收藏、单张删除、编辑提示词 / 模型重画、Tag 权重、生成队列（并发为 1、取消排队中与运行中任务、取消全部）、NovelAI 超时、创作记录（Tag 重 roll / 记录生图 / 标题与 Tags 编辑 / 重复输入归组）、错误处理以及重启恢复。当前 **244/244 全部通过**。不会读取真实 `data/config.json`、不访问外网、不消耗任何额度，结束后自动清理临时文件。

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
- **模型**：内置 V5 / V4.5 / V4 / V3 / Furry V3。请选择账户可用的版本。
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

### `GET /api/health`

返回运行状态，便于检查服务是否启动（1.8.0 的 `version` 为 `1.8.0`）。

## 目录结构

```text
D:\NAI-Atelier\
├─ package.json
├─ server.js              # Express、LLM 适配器、NovelAI 调用、ZIP 解压、PNG 元数据 / sidecar、持久化
├─ scripts/
│  └─ verify.js           # npm run verify 自检脚本（临时目录 + 假上游）
├─ public/
│  ├─ index.html          # 页面结构（含「元数据」按钮与灯箱「下载元数据」）
│  ├─ style.css           # 深色磨砂玻璃样式、批量条 / 队列 / 回收站 / 提示词库 / 权重编辑器与响应式布局
│  └─ app.js              # 表单、SSE、画廊、拖拽排序、批量操作、队列轮询、回收站、提示词库、元数据导出、灯箱
├─ data/                  # 运行时自动生成
│  ├─ config.json
│  ├─ history.json
│  ├─ records.json         # 创作记录：原始输入、Tag 版本与标题
│  ├─ albums.json         # 画册列表（含封面 coverId）
│  ├─ trash.json          # 回收站索引
│  └─ prompts.json        # 提示词收藏
├─ outputs/               # 生成图片（未分类）
│  ├─ albums/<画册ID>/    # 画册图片（每本画册一个真实文件夹，含同名 .json）
│  ├─ .trash/             # 回收站图片（隐藏目录）
│  └─ <图片同名>.json     # 每张图片的元数据 sidecar（与 PNG 内嵌 JSON 相同）
└─ README.md
```

## NovelAI 请求要点

- 端点：`POST https://image.novelai.net/ai/generate-image`
- Header：`Authorization: Bearer <NAI_TOKEN>`
- 请求体包含 `input`、`model`、`action: "generate"` 和 `parameters`。
- V4 / V4.5 / V5 会发送结构化提示词：
  - `v4_prompt.caption.base_caption`
  - `v4_negative_prompt.caption.base_caption`
- V5 使用 `params_version: 4`，V4/V3 使用 `params_version: 3`。
- NovelAI 返回 **ZIP**，代码在内存中用 `AdmZip` 读取图片条目，不保存 ZIP 文件；检测图片真实签名后以唯一文件名保存到 `outputs/`（若指定画册则保存到 `outputs/albums/<画册ID>/`）。

> 模型名称和接口字段会随 NovelAI 更新而变化。若某个新模型报参数错误，可先切换到已支持版本，或在此基础上调整 `server.js` 中的 `buildNaiPayload()`。

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
