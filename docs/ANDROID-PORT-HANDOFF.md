# NAI Atelier — Android 移植开发交接文档

> 交接时间：2026-11-26（Asia/Shanghai）
> 文档状态：**设计 / 交接文档**。PC 端代码已到 **v1.9.0**（含设备间同步）。手机端已能跑 v1.8.0，升级方式是 `git pull` 到 `main`（不要再手工拷包）。
> 源项目：`D:\NAI-Atelier`（v1.9.0，公开仓库 <https://github.com/y1090026806-eng/nai-atelier>，标签 `v1.9.0`）
> 目标设备：Android 8.0+（arm64），通过 **DSH Go 本机引擎**或 **Termux** 在手机上运行（见 §3.4 / §5.8）
> 关联文档：`NAI-Atelier-HANDOFF.md`（功能 / PC 运维 / 接口）、`README.md`（API 细节）
> 仓库内同步副本：`D:\NAI-Atelier\docs\ANDROID-PORT-HANDOFF.md`（以仓库副本为准）

---

## 0. 一页结论（TL;DR）

**可以移植，而且改动量不大。** 这是一个「单进程 Node + 静态前端 + 4 个纯 JS 依赖」的本地 Web 应用：没有构建步骤、没有原生模块，后端没有 `child_process` / 平台判断，且已支持 `PORT` / `HOST` / `DATA_DIR` / `OUTPUTS_DIR` 环境变量；前端已有 900px / 600px 响应式和移动抽屉。

**手机端形态**

```
DSH Go（Flutter App，前台常驻）
  └─ 本机引擎：PRoot Ubuntu + 内置 Node
       └─ ~/nai-atelier/server.js   监听 127.0.0.1:3800
            ├─ data/    配置、历史、画册、回收站、提示词库（App 私有 ext4）
            └─ outputs/ 作品 PNG + .json sidecar
手机 Chrome 打开 http://127.0.0.1:3800
```

> 手机上有 Termux 的话，推荐把服务放在 Termux 里跑（无 PRoot 开销、文件好拷、可开机自启），步骤见 §5.8。Termux 与 DSH Go 是两个独立沙箱，**项目只能选一个宿主**，不要一半在 Termux、一半在 DSH Go。

**不能直接照搬的东西**

| Windows 现状 | Android 替代 |
| --- | --- |
| `start-nai-atelier.bat`、桌面 `.lnk`、`.ico` 快捷方式 | `scripts/mobile-start.sh` / `mobile-stop.sh`（本文件附录 A/B） |
| `D:\NAI-Atelier` | `~/nai-atelier`（App 私有目录，**不要**放 `/sdcard`） |
| 双击图标打开浏览器 | 手机 Chrome 书签 /「添加到主屏幕」 |
| 鼠标拖拽排序 | 触屏无 HTML5 DnD → 增加「排序模式 + ↑/↓ 按钮」（P0） |

**必须做的 P0 改动（4 项）**

1. 手机端启停脚本 + 自检脚本（`scripts/mobile-*.sh`）。
2. 触屏可用的画廊排序（现有 `applyGalleryOrder()` 可复用，只差入口）。
3. 安全区 / 软键盘视口适配（`viewport-fit=cover`、`interactive-widget=resizes-content`、`env(safe-area-inset-bottom)`）。
4. 数据迁移与备份流程（`data/` + `outputs/`，含真实 API Key，禁止走公开通道）。

**三个必须先实测、不能拍脑袋的点**

| # | 问题 | 为什么关键 | 怎么测 |
| --- | --- | --- | --- |
| ① | DSH Go 里有没有 `npm`？ | 决定依赖是 `npm ci` 还是从 PC 拷 `node_modules` | 终端执行 `command -v npm && npm -v` |
| ② | 手机 Chrome 能不能访问 App 内的 `127.0.0.1:3800`？ | 决定客户端形态；不行就要换方案 | 服务起来后 Chrome 打开，或 `curl` 先测内部 |
| ③ | 手机终端能不能读 `/sdcard`？ | 只影响「从手机下载目录拷文件」这条迁移路线 | `ls -ld /sdcard /storage/emulated/0` |

①③ 在 §5.2 M0 就能测；②要等 M3 服务起来后才能测。**先拿到 ①③ 再写代码**。即使 ①③ 都不行，也有替代路线（§5.3 / §5.4），②才是真正的分叉点。

**第一件事**：在手机端（DSH Go 本机引擎或 Termux 终端）跑 §5.2 的 M0 环境探测，把 ① npm ③ `/sdcard` 结果带回来；如果决定用 Termux，直接在 Termux 终端执行即可。

---

## 1. 目标与非目标

### 目标

- 在**手机本地**（不依赖 PC 常开）运行完整 NAI Atelier：生成、重画、画册、排序（手机用按钮）、批量、回收站、提示词库、Tag 权重、任务队列、PNG 元数据 / sidecar / ZIP 导出。
- 用户已有数据（`data/` + `outputs/`）可迁移，迁移后可回退到 PC。
- 手机浏览器体验可用：390×844 竖屏、无横向溢出、软键盘不挡输入、图片可保存进相册。
- PC 端行为不回退：`npm start` 仍监听 3000，Windows 快捷方式照常，`npm run verify` 仍 235/235。

### 非目标（明确不做，避免范围膨胀）

- 公网 / 多用户 / 登录鉴权部署。默认只监听 `127.0.0.1`。
- 把服务暴露到局域网给 PC 用（会泄露 `GET /api/config` 里的明文 Key，见 §7）。要做必须另加 token 鉴权，属于 P2。
- 7×24 后台常驻、开机自启、被系统杀死后自动拉起。DSH Go 的引擎生命周期决定做不到，只能尽力保活（§5.7）。
- iOS / 鸿蒙；替换 NovelAI 或 LLM 上游；Electron 打包。

### 硬约束（延续原项目）

- **不要读取、打印、复制或提交 `data/config.json` 的真实 Key。**
- **不要删除 `outputs/`（含 `albums/`、`.trash/`）、`data/*.json`。**
- 不要用真实 LLM / NovelAI Key 做自动化测试（会消耗额度）。自检一律用 `npm run verify` 的假上游。
- 用户说中文，文档与汇报用中文；偏好直接实现而不是只给建议。

---

## 2. 现状盘点

### 2.1 代码形态（已核对 v1.7.0 源码）

| 文件 | 体量 | 移植影响 |
| --- | --- | --- |
| `server.js` | 3487 行，单文件后端 | 用 `__dirname` 定位，支持 `PORT` / `HOST` / `DATA_DIR` / `OUTPUTS_DIR`；**无 `child_process`、无 `process.platform`、无 Windows 路径** |
| `public/app.js` | 136 KB | 无框架、无构建；画廊排序用 HTML5 拖拽（触屏不可用），见 §4.2 |
| `public/index.html` | 39 KB | `viewport` 只有 `width=device-width`，无安全区适配 |
| `public/style.css` | 81 KB | 已有 `@media (max-width: 1180/900/680px)` 与 `@media (hover: none)`；无 `env(safe-area-inset-*)` |
| `scripts/verify.js` | 115 KB，235 项 | `os.tmpdir()` + `spawn(process.execPath)` + 随机端口 + 假上游，**Linux / Android 可跑**，不碰真实数据 |
| `package.json` | 4 个依赖 | `express` / `axios` / `cors` / `adm-zip`，**全部纯 JS，无原生模块**，arm64 直接可用 |
| `start-nai-atelier.bat` / `.ico` / `.lnk` | Windows 专用 | 手机端不复用 |

关键结论：`node_modules` 从 Windows 拷到 Android **可直接用**（`.bin` 里的 `.cmd` 垫片无意义，但不影响 `require`），所以「没有 npm」不是死路。

### 2.2 已经具备的移动端基础

- 900px 以下侧栏变抽屉，600px 以下另有布局；桌面 / 390×844 都做过无横向溢出审计。
- 画廊图片 `loading="lazy"` / `decoding="async"`；封面缩略图同样懒加载。
- 生成走 `/api/jobs` + 800ms 轮询（不是长连接），**浏览器切后台被节流不会取消任务**；只有遗留 SSE 接口会「断开即取消」，手机端不依赖它。
- `#prompt-input` 在移动端已设 16px（避免聚焦自动放大）。
- `127.0.0.1` 与 `localhost` 属于浏览器安全上下文，`navigator.clipboard` 可用。
- 复制、下载、`<a download>` 都是同源普通请求，Android Chrome 能落到 `Download/`，相册可扫描到。

### 2.3 手机端缺口（按优先级）

| 优先级 | 缺口 | 影响 |
| --- | --- | --- |
| **P0** | 画廊排序只能 HTML5 拖拽 | 手机上完全无法调整作品顺序；跨画册拖拽同样失效（但卡片上的画册下拉仍可用） |
| **P0** | 无安全区 / 软键盘适配 | 底部输入区被手势条遮挡；键盘弹出后页面高度处理不理想 |
| **P0** | 只有 Windows 启停脚本 | 手机上无法幂等启动、看日志、查端口 |
| **P0** | 无手机端环境自检 | 出问题时无法快速区分「依赖没装 / 端口被占 / 数据没迁 / 服务没起」 |
| **P1** | 无迁移 / 备份流程 | `data` + `outputs` 无法安全地从 PC 搬到手机，也没有升级前备份手段 |
| **P1** | 跨目录 `fs.rename` 无 `EXDEV` 回退 | 仅在把 `OUTPUTS_DIR` 指到另一个文件系统（如共享存储 / SD 卡）时出问题 |
| **P2** | 无 PWA manifest / 图标 | 「添加到主屏幕」只是浏览器快捷方式，不是独立窗口 |
| **P2** | 灯箱无左右滑动翻页、无双指缩放 | 手机上翻页只能点箭头，看细节不便 |
| **P2** | 无「分享到其他 App」 | 作品只能先下载再分享 |
| **P2** | 无 LAN 鉴权 | 想让 PC 用手机上的服务时必须先改鉴权，默认不做 |

---

## 3. 目标架构

### 3.1 组件与端口

| 项 | 值 | 说明 |
| --- | --- | --- |
| 运行位置 | DSH Go 「本机引擎」 | App 内置 Ubuntu（PRoot）+ Node，免 Root、免 Termux |
| 项目目录 | `~/nai-atelier` | 通常是 `/root/nai-atelier`（以 `echo $HOME` 为准）；**App 私有 ext4**，不放 `/sdcard` |
| 数据目录 | `~/nai-atelier/data`（默认） | 配置 / 历史 / 画册 / 回收站 / 提示词库 |
| 作品目录 | `~/nai-atelier/outputs`（默认） | PNG + `.json` sidecar + `albums/` + `.trash/` |
| 监听 | `127.0.0.1:3800` | 默认端口 3800，避开 3000 与 DSH 引擎；`NAI_PORT` 可改 |
| 客户端 | 手机 Chrome / Edge | `http://127.0.0.1:3800`，可「添加到主屏幕」 |
| 进程 | `nohup node server.js &` | 从 DSH Go 终端页签启动；日志 `logs/server.*.log` |
| 反向代理 | 无 | 不做 LAN 暴露 |

### 3.2 为什么是这几个选择

**为什么用 DSH Go 本机引擎，而不是远程主机模式？**
远程模式只是「手机当遥控器」，服务还在 PC 上，不满足「移植到手机」。本机模式才有自己的 Node 运行时和文件系统。

**为什么端口用 3800 而不是 3000？**
3000 是最容易被其他服务占用的端口，DSH Go 引擎也可能用；手机上换端口成本几乎为零，脚本里 `NAI_PORT=3800` 即可，PC 端保持 3000 不变。

**为什么客户端用手机 Chrome，而不是 DSH Go 的「网页模式」？**
DSH Go 的网页模式只承载 DSH 自己的 Web UI（`dsh web`），不能打开任意端口。除非后续确认 App 内的 WebView 支持任意 URL，否则用系统浏览器。

**为什么数据一定放 App 私有目录？**
`data/config.json` 是明文 API Key。App 私有目录其他 App 读不到；`/sdcard` 上任何有存储权限的 App 都能读。性能上 ext4 也比 FUSE 共享存储稳。

**手机 Chrome 能访问 App 内的 127.0.0.1 吗？**
正常情况下能：Android 各 App 共享同一个 loopback，PRoot 进程只是 App 的子进程，没有独立网络命名空间。**但仍需实测**（M3 ②），因为个别定制系统 / 安全软件可能拦截 App 间 loopback。

### 3.3 运行生命周期

```
手机开机
  → 打开 DSH Go（设置里「打开 App 时自动启动本机引擎」默认开）
  → 引擎启动：PRoot Ubuntu + Node（约 1 GB 存储）
  → 终端页签前台运行 PORT=3800 node server.js（脚本落盘后用 mobile-start.sh）
  → Chrome 打开 http://127.0.0.1:3800
  → 生成 / 管理作品
  → 手机息屏、切走：靠「后台运行」设置 + 前台通知尽量保活（不保证）
  → 重新打开 App / Chrome：数据都在；服务可能已被系统结束，按提示重启
```

### 3.4 备选（推荐）运行时：Termux

手机上已经装了 Termux 的话，**把服务放在 Termux 里跑比放在 DSH Go 本机引擎里更合适**：

| 维度 | Termux | DSH Go 本机引擎 |
| --- | --- | --- |
| 运行方式 | 原生 Linux 用户态，无 PRoot 开销 | PRoot 兼容启动，路径映射/兼容层 |
| Node / npm | `pkg install nodejs`（自带 npm），版本自己可控 | 内置，随 App 更新 |
| 文件访问 | `termux-setup-storage` 后直接读写 `~/storage/downloads` | 取决于 App 与系统版本 |
| 常驻能力 | `termux-wake-lock` + Termux:Boot 可开机自启 | 跟随 App 引擎生命周期，停止引擎即结束 |
| 数据位置 | Termux 私有 home（`/data/data/com.termux/files/home`） | App 私有 PRoot（`/root`） |
| 卸载影响 | 卸载 Termux 会清空 home | 卸载/重置 App 会清空 `/root` |
| 适合 | 长期跑 Web 服务、自己敲命令、传文件 | 想在手机上直接用 DSH 智能体 |

**结论**：只是要跑 NAI Atelier，用 Termux；想顺便在手机上用 DSH 智能体改代码，再用 DSH Go。两者是不同 App 的沙箱，**项目只能选一个地方放**：DSH Go 的 agent 读不到 Termux 的 home，反之亦然。

Termux 从 **F-Droid** 或 **GitHub Releases** 安装，不要用 Play 商店版（已停止维护）。完整步骤见 §5.8。

---

## 4. 代码改动清单

### 4.0 变更矩阵

| 文件 | 改动 | 优先级 | 风险 | 验收 |
| --- | --- | --- | --- | --- |
| `scripts/mobile-start.sh` | 新增：幂等启动、健康检查、端口探测、日志 | P0 | 低 | 重复执行不重复起进程 |
| `scripts/mobile-stop.sh` | 新增：按 PID + 工作目录停止 | P0 | 低 | 不会误杀其他 `node server.js` |
| `scripts/mobile-doctor.sh` | 新增：环境 / 依赖 / 数据 / 接口自检 | P0 | 低 | 全绿；缺项能说清原因 |
| `scripts/mobile-backup.sh` | 新增：`data` + `outputs` 打包 + sha256 | P1 | 低 | 包可解压、大小合理 |
| `public/app.js` | 排序模式 + ↑/↓，复用 `applyGalleryOrder()` | P0 | 中 | 手机可排序、刷新后保持、桌面拖拽不变 |
| `public/index.html` | viewport 增加 `viewport-fit=cover`、`interactive-widget=resizes-content` | P0 | 低 | 键盘弹出布局正确 |
| `public/style.css` | 安全区、`overscroll-behavior`、`tap-highlight`、16px 输入 | P0 | 低 | 输入区不被手势条遮挡 |
| `server.js` | `movePath()`：`rename` 失败 `EXDEV` 时 `copyFile + rm` | P1 | 低 | verify 全过；移动 / 回收站 / 恢复均正常 |
| `server.js` | 可选 `POST /api/backup/import`（浏览器上传 ZIP） | P2 | 中 | 仅本机；先解压到临时目录再合并 |
| `public/manifest.webmanifest` + 图标 | PWA 安装体验 | P2 | 低 | 可添加到主屏幕 |
| `package.json` | 增加 `mobile:start` / `mobile:stop` / `mobile:doctor` | P0 | 低 | `npm run mobile:start` 可用 |

**明确不改**：CORS 仍只允许 localhost；`express.json({ limit: '2mb' })`；`public/` 的 `no-store`；`/api` 契约；端口默认值（PC 3000）。

---

### 4.1 后端 `server.js`

现状已经能跑，只有两类可选改动。**先别动它**，等 M0/M3 验证通过再按需改。

#### (a) P1：跨文件系统移动回退

现在有 5 处 `fs.rename`：原子写 JSON（同目录，没有跨设备问题）、孤儿作品回收、作品移画册、回收站移入、回收站恢复。如果 `OUTPUTS_DIR` 和 `DATA_DIR` 在同一个 ext4 上（推荐做法），`EXDEV` 不会发生；只有用户把作品目录指到 `/sdcard` 或 SD 卡时才可能。

新增一个 helper 并替换这 5 处（`atomicWriteJson` 保持原样，因为它同目录 rename 更安全）：

```js
async function movePath(source, target) {
  try {
    await fs.rename(source, target);
  } catch (error) {
    if (error.code !== 'EXDEV') throw error;
    // 跨文件系统（例如 App 私有存储 → 共享存储）：复制后删除
    await fs.copyFile(source, target);
    await fs.rm(source, { force: true });
  }
}
```

验收：`npm run verify` 235 项仍全过；手动验证「移动画册 / 移入回收站 / 恢复 / 删除画册回根目录」。

#### (b) P2：浏览器内备份导入（可选，解决「没有 `/sdcard` 怎么迁数据」）

如果 M0 ③ 结果是「`/sdcard` 不可读」，同时又不想每次都用 PC 中转，可以加：

- `GET /api/backup/export`：把 `data/` + `outputs/` 打成一个流式 ZIP 下载（浏览器落到 `Download/`，PC 可拉回）。
- `POST /api/backup/import`：接收 `application/zip` 原始流写到临时文件 → 解压到临时目录 → 校验 `data/history.json` 可解析 → 停写 → 原子替换 → 重启内存状态。

注意点（写代码时必须遵守）：

- 只接受 `127.0.0.1` 来源（`req.socket.remoteAddress` 判断），否则等于给局域网开了一个「任意写盘」入口。
- 限制体积（建议 2 GB）与条目数；解压前防 `../` 路径穿越。
- 解压到临时目录，**成功后才替换**；失败不能动现有数据。
- `adm-zip` 会把整个 ZIP 读进内存；大包建议 `unzip` 命令行（Ubuntu 自带）或先写盘再用 `yauzl`，不要硬扛。

这条是 P2，**M3 能跑起来就不做**。

> **2026-11-27 更新**：v1.9.0 已经实现了应用内「设备间同步」（`docs/DEVICE-SYNC.md`），手机和 PC 在同一个 Wi-Fi 下即可双向合并作品与索引，所以这一节的备份导入导出**优先级进一步降低**，只在「两台设备从不在同一网络」时才考虑。同步协议已经处理了路径、sidecar、回收站、删除墓碑，不必再单独做一套 ZIP 迁移。

---

### 4.2 前端：触屏排序（P0）

现状：卡片 `dragstart` / `dragover` / `drop` + 画册标签 drop（`app.js` 约 1760–1930 行）。HTML5 DnD 在 Android Chrome 上不触发，所以手机无法排序、无法拖拽换画册。

**方案：排序模式 + ↑/↓ 按钮**（改动最小、可访问性最好、桌面拖拽完全保留）

1. 画廊工具区加一个切换按钮 `#sort-mode`（文案「排序」/「完成排序」），只在 `matchMedia('(hover: none)')` 或宽度 ≤ 900px 时显示；也可全端显示。
2. `state.sortMode = false`；开启后 `renderGallery()` 给每张卡片渲染一个两键行：

```js
function moveVisibleItem(item, delta) {
  const visibleIds = visibleHistory().map((entry) => entry.id);
  const index = visibleIds.indexOf(item.id);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= visibleIds.length) return;

  const ordered = [...visibleIds];
  ordered.splice(index, 1);
  ordered.splice(target, 0, item.id);
  applyGalleryOrder(ordered); // 复用现有：先本地重排，再 POST /api/history/order
}
```

3. 边界与交互：
   - 只重排**当前筛选下可见**的作品；后端 `POST /api/history/order` 本来就只把 id 填回原槽位，所以「全部 / 某画册 / 未分类」互不干扰。
   - 第一张的 ↑、最后一张的 ↓ 置灰。
   - 排序模式与多选模式互不干扰；按钮 `aria-label="前移 / 后移"`。
   - 排序模式下可隐藏卡片常规操作，减少误触。
   - 桌面端不显示这个按钮也行，但保留无妨。

**跨画册移动**：手机用卡片底部 / 灯箱里的「所属画册」下拉，以及多选后的「批量移动」，已有能力，不需要新代码。

**验收**：手机 Chrome 上把第 3 张前移 → 刷新页面顺序保持；切到某画册再排序 → 只影响该画册；PC 上拖拽仍正常。

---

### 4.3 前端：安全区 / 软键盘（P0）

`index.html`：

```html
<meta
  name="viewport"
  content="width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content"
>
```

`style.css`（放在移动端媒体查询里）：

```css
:root {
  --safe-bottom: env(safe-area-inset-bottom, 0px);
}

@media (max-width: 680px) {
  html,
  body {
    overscroll-behavior-y: contain; /* 防止下拉刷新打断拖拽 / 输入 */
  }

  body {
    -webkit-tap-highlight-color: transparent;
  }

  .composer {
    padding-bottom: calc(12px + var(--safe-bottom));
  }

  /* 避免聚焦时自动放大；桌面端保持紧凑字号 */
  input,
  textarea,
  select {
    font-size: 16px;
  }

  /* 触屏触控目标不小于 44px */
  .icon-button,
  .card-action,
  .album-chip {
    min-height: 44px;
  }
}
```

说明：

- `interactive-widget=resizes-content` 让键盘弹出时缩小内容区，而不是盖住输入框；不支持的旧浏览器会忽略该值，不报错。
- `--safe-bottom` 只影响底部输入区；顶部状态栏由 Chrome 自己处理，除非以后做 PWA standalone。
- 现有的 `#prompt-input { font-size: 16px }` 已经避免 iOS 缩放；Android 不缩放，但统一 16px 更稳。

---

### 4.4 启动 / 自检 / 备份脚本（P0）

四个脚本放在 `scripts/`，用 `bash`，不依赖 npm。完整可落盘版本见**附录 A–D**。要点：

- `mobile-start.sh`：先查健康（幂等），再查 Node 版本、依赖、端口，然后 `nohup node server.js &`，轮询 `/api/health` 最多 20 秒，失败打印 `server.err.log` 尾部。
- `mobile-stop.sh`：优先 PID 文件；兜底用 `pgrep -f "node server.js"` + `/proc/<pid>/cwd` 是否等于项目根，**避免误杀其他项目**。
- `mobile-doctor.sh`：环境、依赖、磁盘、可写、服务、数据一致性（历史条数 vs 图片数）、接口 200、sidecar 抽样。
- `mobile-backup.sh`：`tar -czf backups/nai-atelier-<时间>.tar.gz data outputs` + sha256，并提醒「包含 Key，别公开」。

`package.json`：

```json
"scripts": {
  "start": "node server.js",
  "dev": "node --watch server.js",
  "verify": "node scripts/verify.js",
  "mobile:start": "bash scripts/mobile-start.sh",
  "mobile:stop": "bash scripts/mobile-stop.sh",
  "mobile:doctor": "bash scripts/mobile-doctor.sh",
  "mobile:backup": "bash scripts/mobile-backup.sh"
}
```

> 注意：脚本必须用 LF 换行（`.gitattributes` 已统一 LF；`.bat` 保持 CRLF）。在 PC 上用编辑器改完别存成 CRLF，否则手机报 `bad interpreter: /usr/bin/env bash^M`。

---

### 4.5 版本与文档

- 移动端改动合并后建议把版本提到 **1.8.0**：`package.json`、`package-lock.json` 根版本、`server.js` 的 `APP_VERSION`、`index.html` 的 `?v=1.8.0`、右上角 `v1.8`。
- 同步更新 `NAI-Atelier-HANDOFF.md`：§2 增加「Android 运行态」一行；§3 增加 `docs/` 与 `scripts/mobile-*`；§12 把「Android 移植」标记为已实现。
- `README.md` 增加一节「Android / DSH Go」指向本文件。

---

## 5. 手机部署步骤（DSH Go）

> 以下命令都在 **DSH Go 的终端**（`全部功能 › 终端`，见 [终端说明](https://github.com/ccch1mneyyy/dsh-go/blob/main/docs/guide/zh/16-terminal.md)）或 **Termux** 里执行。终端命令以主机用户身份运行，App 不会逐条确认；停止 / 重置本机引擎会结束其中的进程。
> DSH Go 是社区第三方客户端（Android 8+，arm64 APK，AGPL-3.0），与本项目无关；安装与模型配置见 [仓库](https://github.com/ccch1mneyyy/dsh-go) 和 [使用指南](https://github.com/ccch1mneyyy/dsh-go/blob/main/docs/guide/README.md)。
> **注意**：本章的 `scripts/mobile-*.sh` 属于 §4.4 的待落盘改动，当前仓库里还没有。落盘前用原生命令代替：启动 `PORT=3800 node server.js`，自检 `node scripts/verify.js`，备份 `tar -czf ... data outputs`。

### 5.1 准备

1. 安装 DSH Go（Release 页 arm64 包），首次启动选「本机」，按引导安装运行环境（约 1 GB）。
2. 按 §5.7 打开「后台运行」相关设置（电池优化、通知、最近任务锁定）。
3. 在 DSH Go 里把 `~/nai-atelier` 添加为工作区（`全部功能 › 工作区 › 添加工作区`，见 [工作区说明](https://github.com/ccch1mneyyy/dsh-go/blob/main/docs/guide/zh/17-workspaces.md)）。这样后续对话的文件读写都落在这个目录。

> 如果决定用 Termux（§5.8），可以跳过第 1 步的本机运行环境安装，直接在 Termux 终端里操作。Termux 与 DSH Go 是两个独立沙箱，**项目只放一处**。

### 5.2 M0：环境探测（先做，不改任何文件）

```sh
set -x
uname -m
node -v
command -v npm && npm -v || echo NO_NPM
command -v pnpm && pnpm -v || echo NO_PNPM
echo "HOME=$HOME"; pwd
df -h "$HOME" | tail -1
ls -ld /sdcard /storage/emulated/0 2>&1
command -v curl wget tar ss pgrep 2>&1
```

判定：

| 结果 | 结论 |
| --- | --- |
| `node -v` ≥ 18.17 | 运行时合格（DSH Go 内置或 Termux `pkg install nodejs`；以实际输出为准） |
| 有 `npm` | 走 `npm ci --omit=dev` |
| 没有 `npm` | 从 PC 打包 `node_modules` 传过来（纯 JS，可直接用） |
| `/sdcard` 可读 | 迁移可走「浏览器下载 → 拷进 home」 |
| `/sdcard` 不可读 | 迁移走「PC 临时 HTTP + 手机 `curl`」（§5.4，推荐路线，不需要 `/sdcard`） |
| `curl` 存在 | 后面所有校验都可用它 |

回贴结果给 PC 端再进入 M1。**不要在这一步执行 `npm install`、不要建文件、不要访问外网**。②（Chrome 能否访问 `127.0.0.1`）此时还没有服务，等 M3 启动后再测。

### 5.3 M1：把代码放到手机

#### 路线 A（推荐）：GitHub 仓库（公开）

公开仓库无需登录，直接 HTTPS 克隆即可：

```sh
git clone https://github.com/y1090026806-eng/nai-atelier.git ~/nai-atelier
cd ~/nai-atelier
```

如果手机上有 `gh`，也可以 `gh repo clone y1090026806-eng/nai-atelier ~/nai-atelier`。

#### 路线 B（无法访问 GitHub 时）：PC 临时 HTTP

PC（PowerShell）：

```powershell
cd D:\NAI-Atelier
tar.exe -czf "$env:TEMP\nai-atelier-src.tar.gz" --exclude=node_modules --exclude=data --exclude=outputs --exclude=.git .
cd $env:TEMP
# 任选一种静态服务
python -m http.server 8080 --bind 0.0.0.0
# 没有 Python 时用项目自带 express：
# node -e "const e=require('D:/NAI-Atelier/node_modules/express')();e.use(e.static(process.env.TEMP));e.listen(8080,'0.0.0.0',()=>console.log('http://0.0.0.0:8080'))"
```

手机终端（把 `<PC_IP>` 换成 PC 的局域网 IP，`ipconfig` 查）：

```sh
mkdir -p ~/nai-atelier
curl -fL -o ~/nai-src.tar.gz "http://<PC_IP>:8080/nai-atelier-src.tar.gz"
tar -xzf ~/nai-src.tar.gz -C ~/nai-atelier
ls ~/nai-atelier
```

#### 依赖

```sh
cd ~/nai-atelier
npm ci --omit=dev        # 有 npm 且能访问 npm 源
# 或者：从 PC 打包 node_modules 传过来，直接解压到项目根
```

若 `npm ci` 因网络失败：在 PC 上 `cd D:\NAI-Atelier; tar -czf node_modules.tgz node_modules`，用同样方式传到手机解压。**不要**在手机上执行 `npm install --production` 之外的构建，也不要装原生模块。

### 5.4 M2：迁移数据

> 数据包含明文 API Key。只在家里可信 Wi-Fi 下传输，传完立刻停掉临时 HTTP 服务，**不要**放公开仓库、公开网盘或聊天工具。

**PC 侧**（先停服务；如果是从桌面快捷方式起的，关掉服务窗口）：

```powershell
cd D:\NAI-Atelier
tar.exe -czf "$env:TEMP\nai-atelier-data.tar.gz" data outputs
Get-Item "$env:TEMP\nai-atelier-data.tar.gz" | Select-Object Length
# 然后按 5.3 路线 B 的方式在 $env:TEMP 起 8080 静态服务
```

**手机侧**：

```sh
curl -fL -o ~/nai-data.tar.gz "http://<PC_IP>:8080/nai-atelier-data.tar.gz"
tar -xzf ~/nai-data.tar.gz -C ~/nai-atelier
chmod -R u+rwX ~/nai-atelier/data ~/nai-atelier/outputs
```

**只迁 `data/`、作品不迁**：历史里引用的图片会 404，画廊缩略图破图。不推荐，除非确认只需要画册 / 预设结构。

**都不迁**：手机端从空库开始，PC 保留旧作品；以后要合并需要自己写脚本，不建议。

**迁移后校验**：

```sh
cd ~/nai-atelier
node -e "const j=require('./data/history.json'); console.log('history', (j.items||[]).length)"
find outputs -maxdepth 1 -type f -iname '*.png' | wc -l
find outputs -maxdepth 1 -type f -name '*.json' | wc -l
du -sh data outputs
```

预期：`history` 条数 = 根目录 PNG 数 + `outputs/albums/*/*.png` 数 + 回收站数；sidecar 数约等于作品数（1.7.0 之前的老图可能没有，属正常）。

### 5.5 M3：启动并访问

```sh
cd ~/nai-atelier
PORT=3800 node server.js              # 前台运行；Ctrl+C 停止
# 脚本落盘后（附录 A）可改用：
# bash scripts/mobile-start.sh
```

看到 `Local http://127.0.0.1:3800`（用脚本启动时是 `已启动：http://127.0.0.1:3800`）后：

1. 在手机上打开 Chrome，访问 `http://127.0.0.1:3800`。
2. 成功则「添加到主屏幕」，以后一点直达。
3. 页面上方应显示 `v1.7`，画册、历史、灯箱都能打开。

**如果 Chrome 打不开**，按顺序排查：

```sh
curl -s http://127.0.0.1:3800/api/health      # 服务内部是否通
ss -ltn | grep 3800                            # 是否在监听
ps -ef | grep "node server.js" | grep -v grep
# 前台运行直接看终端输出；脚本方式看 logs/server.err.log
```

| 现象 | 处理 |
| --- | --- |
| `curl` 不通，端口没监听 | 看终端输出；脚本方式看 `logs/server.err.log`，多半是依赖缺失或 `EADDRINUSE` |
| `curl` 通、Chrome 不通 | 极少见。临时试 `HOST=0.0.0.0 PORT=3800 node server.js`，然后用 `http://<手机Wi-Fi IP>:3800` 访问；**仅用于定位问题，用完改回 127.0.0.1** |
| 端口被占 | `PORT=3801 node server.js` |
| 页面 404 / 白屏 | 确认 `public/` 完整；`curl -I http://127.0.0.1:3800/` 看是否 200 |

**启动方式的选择**：

- **推荐**：在 DSH Go 终端页签里前台跑 `PORT=3800 node server.js`（脚本落盘后用 `bash scripts/mobile-start.sh`），启动后**不要关这个页签**（关页签会结束里面的进程）。之后离开终端页面不影响，服务继续跑。
- 让 DSH Go 的 AI 在对话工具里执行启动命令只适合「验证能不能起」；工具调用结束或会话结束时，子进程可能被回收。长期运行请以**终端页签**为准，AI 负责诊断和验证。
- 不推荐 `setsid` / 守护进程化：DSH Go 停止或重置引擎时，终端里的进程一样会结束，徒增排查难度。

### 5.6 M4：自检与验收

```sh
cd ~/nai-atelier
node scripts/verify.js            # 235 项，假上游，临时目录
# 脚本落盘后可用：bash scripts/mobile-doctor.sh
```

`npm run verify` 在手机上会慢一些（约 1–2 分钟），它使用 `os.tmpdir()` 和随机端口，**不会**读写 `data/`、`outputs/`，也不会消耗额度。若内存紧张导致失败，先只做接口检查（§6.1），verify 留到 PC 上跑。

前端验收（手机 Chrome，390×844 或实际分辨率）：

- [ ] 首页无横向滚动；侧栏抽屉可开合；Esc / 遮罩可关。
- [ ] 画廊卡片、画册筛选、封面缩略图正常。
- [ ] 灯箱打开 / 关闭、← → 翻页、复制 Tag、下载原图、下载元数据。
- [ ] 排序模式 ↑/↓ 可用，刷新后顺序保持。
- [ ] 多选 → 批量移动 / 批量删除；回收站恢复 / 清空。
- [ ] 提示词库增删改、插入正向 / 灯箱。
- [ ] Tag 权重 − / + / 重置后「应用修改并重画」请求体正确（用假上游或看 Network）。
- [ ] 队列面板：连续提交排队、取消、已用时间 / 上限显示。
- [ ] 元数据导出：先 sync 再下载 ZIP（大库注意内存）。
- [ ] 软键盘弹出时底部输入不被遮挡；粘贴 / 复制可用。
- [ ] 图片「下载」落到 `Download/`，相册能看到。

### 5.7 日常使用与保活

- DSH Go：`设置 › 本机引擎` 打开「打开 App 时自动启动」；`设置 › 后台运行` 按引导关闭电池优化、保留「引擎运行中」通知、最近任务里锁定 App（见 [FAQ](https://github.com/ccch1mneyyy/dsh-go/blob/main/docs/guide/zh/11-faq.md)）。
- 手机 Chrome 与 DSH Go 是两个 App：生成时尽量让 DSH Go 留在后台并保持通知，不要手动「清理全部」。
- 手机重启 / 重新打开 App：DSH Go 可能自动恢复本机引擎，但**不会自动重放**之前的命令；需要回终端再跑一次 `PORT=3800 node server.js`（脚本落盘后用 `mobile-start.sh`）。
- 长任务（默认 300 秒，可到 900）期间**不要锁屏太久**；系统冻结会让请求停在半路。宁可把 NovelAI 超时调低到 120–180 秒，失败重试。
- 更新 DSH Go / 引擎 / Termux 前，先备份：`tar -czf ~/storage/downloads/nai-backup-$(date +%Y%m%d).tar.gz -C ~/nai-atelier data outputs`（脚本落盘后可用 `npm run mobile:backup`），并把备份传到 PC。
- 卸载 DSH Go / 重置运行环境会删除 `/root` 下的项目和数据，**不可撤销**。
- **网络与代理**：手机上的 Node 进程不会继承 PC 的代理 / 梯子。如果 NovelAI、LLM 在手机上直连失败：先 `curl -I https://image.novelai.net`（NovelAI 默认 Base URL；LLM 默认 `https://api.deepseek.com/v1`）看是 DNS 还是超时；PRoot 里 DNS 异常时检查 `/etc/resolv.conf`。本项目没有显式配置代理，但 axios 依赖 `proxy-from-env`，会读取 `HTTPS_PROXY` / `HTTP_PROXY`（`NO_PROXY` 可排除直连域名）：启动时注入即可，例如 `HTTPS_PROXY=http://127.0.0.1:<端口> PORT=3800 node server.js`；也可以在 `server.js` 的 axios 实例上显式加 `proxy` 配置，然后重启服务。

### 5.8 用 Termux 部署（可选，推荐常驻）

Termux 是原生 Linux 用户态，没有 PRoot 的路径映射和兼容层，比 DSH Go 本机引擎更适合长期跑服务；§4.4 的 `scripts/mobile-*.sh` 落盘后可直接用，落盘前用前台 `node server.js`。前提：Termux 来自 **F-Droid 或 GitHub Releases**（Play 商店版已停止维护）。

#### 安装与依赖

```sh
pkg update -y && pkg upgrade -y
pkg install -y nodejs git curl tar coreutils findutils gawk procps iproute2
node -v && npm -v
termux-setup-storage
ls ~/storage/downloads
```

- `nodejs` 自带 npm；若 `npm -v` 报 not found，再 `pkg install npm`。
- `procps` / `iproute2` 提供 `pgrep` / `ss`，让 `mobile-*.sh`（落盘后）的进程和端口检查生效；不装也能跑，只是少两项检查。
- `termux-setup-storage` 按提示授权后，`~/storage/downloads` 就是系统下载目录；Android 13+ 个别系统可能只允许媒体目录。

#### 代码与数据

```sh
# 代码：任选一种
pkg install gh && gh auth login
git clone https://github.com/y1090026806-eng/nai-atelier.git ~/nai-atelier
# 或把源码包放进 Download 后：
# cp ~/storage/downloads/nai-atelier-1.7.0-tester-src.zip ~/ && cd ~ && unzip ...

# 数据（PC 已起临时 HTTP；不需要 /sdcard）
curl -fL -o ~/nai-data.tar.gz "http://<PC_IP>:8080/nai-atelier-data.tar.gz"
mkdir -p ~/nai-atelier && tar -xzf ~/nai-data.tar.gz -C ~/nai-atelier

# 依赖（Termux 有 npm，优先现装；国内镜像）
cd ~/nai-atelier
npm config set registry https://registry.npmmirror.com   # 可选
npm ci --omit=dev
```

没有 `unzip` 时 `pkg install unzip`；也可以直接用离线包（含 `node_modules`），解压到 `~/nai-atelier` 后跳过 `npm ci`。

#### 启动

```sh
cd ~/nai-atelier
PORT=3800 node server.js              # 前台运行；Ctrl+C 停止
# 脚本按附录 A 创建后：
# bash scripts/mobile-start.sh
```

> Termux 里统一用 `bash scripts/...` 调用脚本，不要直接 `./scripts/...`：脚本 shebang 是 `#!/usr/bin/env bash`，而 Termux 没有 `/usr/bin/env`。

然后 Chrome 打开 `http://127.0.0.1:3800`。

#### 保活与开机自启

```sh
termux-wake-lock
```

- 系统设置 → 应用 → Termux → 电池 → **不受限制**；最近任务里锁定 Termux。
- 开机自启：安装 **Termux:Boot**（F-Droid）并打开一次，然后：

```sh
mkdir -p ~/.termux/boot
cat > ~/.termux/boot/nai-atelier.sh <<'EOF'
#!/data/data/com.termux/files/usr/bin/sh
termux-wake-lock
mkdir -p "$HOME/nai-atelier/logs"
cd "$HOME/nai-atelier"
export PORT=3800
exec node server.js >> logs/boot.log 2>&1
EOF
chmod +x ~/.termux/boot/nai-atelier.sh
```

- 一键启动：安装 **Termux:Widget**，新建 `~/.shortcuts/nai-atelier`，内容为：

```sh
cd "$HOME/nai-atelier" && PORT=3800 node server.js
```

  桌面小部件点一下即可启动（前台运行，关终端即停）。

#### 备份

```sh
cd ~/nai-atelier
tar -czf ~/storage/downloads/nai-backup-$(date +%Y%m%d-%H%M).tar.gz data outputs
```

再把 `~/storage/downloads` 里的包拷回 PC。备份含 `data/config.json` 的明文 Key；放共享存储时同机其他 App 可能读到，传到 PC 后删除手机上的备份，或直接 `scp` 到 PC。

#### Termux 常见问题

| 现象 | 处理 |
| --- | --- |
| `pkg` / `npm` 很慢 | `termux-change-repo` 换镜像；`npm config set registry https://registry.npmmirror.com` |
| 息屏后服务没了 | `termux-wake-lock` + 电池不受限制 + 最近任务锁定；Android 12+ 的 phantom process killer 也可能杀子进程，必要时用 ADB 关闭（高级） |
| `termux-setup-storage` 没反应 | 到系统设置给 Termux 存储权限；Android 13+ 可能只能访问媒体目录 |
| 装过 Play 商店版 | 换 F-Droid/GitHub 版；换版本要卸载，先把 home 用 `tar` 备份到 `~/storage/downloads` |
| 端口 3800 被占 | `PORT=3801 node server.js` |
| `node -v` 低于 18.17 | `pkg upgrade`；仍不够就 `pkg install nodejs-lts`（若有） |
| `npm run verify` 中途被杀 | 手机内存 / phantom 限制；先跑接口检查，verify 留 PC 跑 |

---

## 6. 验收清单（手机端）

### 6.1 后端

```sh
curl -s http://127.0.0.1:3800/api/health
curl -s http://127.0.0.1:3800/api/history | head -c 300
curl -s http://127.0.0.1:3800/api/albums
curl -s http://127.0.0.1:3800/api/trash
curl -s http://127.0.0.1:3800/api/prompts
curl -s -I http://127.0.0.1:3800/api/metadata/archive
```

通过标准：

- `health` 返回 `{"ok":true,"version":"1.7.0","storageReady":true}`（升级后版本号随之变化）。
- 历史条数、画册数、回收站条数与迁移前一致。
- `metadata/archive` 返回 `application/zip` 且带 `X-Metadata-Count`。
- 抽查任意图片 URL 200（`curl -I http://127.0.0.1:3800/outputs/<文件名>`）。

### 6.2 数据完整性

- 根目录 PNG 数 + 画册内 PNG 数 = `history.json` 中文件仍在的记录数（照片可能被移动，以 `relativePath` 为准）。
- 新生成一张图（**用假上游或明确同意后再用真 Key**）：PNG 落盘、sidecar 生成、历史置顶、画廊 +1。
- 删除一张 → 进回收站（`outputs/.trash/` + `trash.json`），恢复后 sidecar 重新生成。

### 6.3 回归（PC 端）

- `npm run verify` 仍 **235/235**。
- `npm start` 仍监听 3000，桌面快捷方式仍能打开。
- 手机端新增文件不影响 Windows 启动（`.bat` 未改）。

---

## 7. 风险与回退

| 风险 | 触发条件 | 影响 | 处理 |
| --- | --- | --- | --- |
| 系统冻结 / 杀死 DSH Go | 息屏、省电策略、内存不足 | 服务停、长任务中断 | 后台白名单 + 前台通知；缩短超时；失败重试 |
| 应用重置 / 卸载 / 清除数据 | 用户操作、签名冲突重装 | `/root` 全删，作品与 Key 丢失 | **升级前备份到 PC**；不要为签名冲突直接卸载在用版本 |
| DSH Go 引擎更新 | 换 Node / 重建环境 | 依赖可能需重装，工作区保留 | 更新后跑 `mobile-doctor.sh`（落盘后）或 §6.1 接口检查 |
| 端口冲突 | 3000/3800 被占 | 启动失败 `EADDRINUSE` | `PORT=3801 node server.js` |
| 存储不足 | 作品多、回收站满、备份堆积 | 生成失败、元数据写失败 | `df -h`；清回收站（上限 300）；备份移到 PC |
| `/sdcard` 不可读 | 定制系统 / 权限 | 浏览器下载的文件拷不进 home | 用 PC 临时 HTTP + `curl`（§5.3 B） |
| 把服务绑到 `0.0.0.0` | 为给 PC 访问而改 HOST | **`GET /api/config` 明文 Key 暴露给同网任何人** | 默认禁止；要 LAN 必须先加 token 鉴权（P2） |
| 手机浏览器后台 | 切走 / 锁屏 | 轮询被节流，任务仍继续；SSE 断开即取消 | 生成时不要关标签；手机端只用 jobs 轮询 |
| FUSE / SD 卡上的 `rename` | `OUTPUTS_DIR` 指到共享存储 | 移动 / 回收站报 `EXDEV` | §4.1(a) 的 `movePath()`；或干脆别放共享存储 |
| 备份泄露 Key | 把 `tar.gz` 发群 / 上传公开盘 | Key 与全部作品泄露 | 备份只走可信通道；传完删临时文件 |
| CRLF 脚本 | PC 编辑器保存 | `bad interpreter: bash^M` | 保持 LF；必要时 `sed -i 's/\r$//' scripts/*.sh` |
| Termux 被系统杀 / 息屏断 | 省电策略、phantom process killer | 服务停、长任务失败 | `termux-wake-lock` + 电池不受限制 + 最近任务锁定；必要时用 ADB 放宽 phantom 限制 |
| Termux 卸载 / 换版本 | 从 Play 版换 F-Droid 版、卸载重装 | home 全清，项目与 Key 丢失 | 换版本前 `tar -czf ~/storage/downloads/home-backup.tar.gz -C /data/data/com.termux/files home` |
| Play 商店版 Termux | 装的是旧版 | 存储/组件异常、无法正常装 Node | 用 F-Droid / GitHub Releases 版；换版本前先备份 |

**回退方案**：

1. 代码回退：`git checkout v1.7.0`（手机端只拉代码，`data/` 不动）。
2. 手机端不可用时：把 `data/` + `outputs/` 从手机 `curl` 回 PC（PC 起 HTTP 服务，手机推；或反过来用浏览器下载），在 PC 继续用。
3. 手机端恢复：解压备份到 `~/nai-atelier`，`mobile-start.sh`，doctor 全绿即可。

---

## 8. 给手机端 DSH Go 的开工提示

### 8.1 最小开场（只做 M0，不改文件）

把下面整段发给手机上的 DSH Go（本机模式）：

```text
你是我的安卓部署助手，我们要把 NAI Atelier（一个本地 Node Web 应用）跑在这台手机上。
这一轮只做环境探测，不要修改任何文件，不要执行 npm install，不要发起任何真实 API 请求。

请在终端执行并把关键输出贴给我：
uname -m; node -v; command -v npm && npm -v || echo NO_NPM; echo HOME=$HOME; pwd; df -h "$HOME" | tail -1; ls -ld /sdcard /storage/emulated/0 2>&1; command -v curl tar ss pgrep

然后逐条回答：
1) 有没有 npm，版本是多少？
2) node 版本是否 >= 18.17？
3) /sdcard 和 /storage/emulated/0 是否可读？
4) 剩余空间多少？
不要自行安装任何东西，等我确认。
```

### 8.2 完整执行提示（读完本文件后再用）

```text
继续 NAI Atelier 安卓部署。请先读仓库里的 docs/ANDROID-PORT-HANDOFF.md（必要时先按 §5.3 把代码拉下来），
然后严格按文档的 M0 → M1 → M2 → M3 → M4 顺序推进。

硬性约束：
- 不要读取、打印、回显 data/config.json 的内容；需要配置结构时读 server.js 的 DEFAULT_CONFIG。
- 不要删除 outputs/（含 albums/、.trash/）、data/*.json。
- 不要用真实 NovelAI Key 生成图片；自检一律用 npm run verify（假上游、临时目录）。
- 每完成一个阶段先汇报（命令 + 关键输出 + 结论），等我确认再进入下一阶段。
- 遇到 /sdcard 不可读、Chrome 连不上 127.0.0.1、npm 不存在这几种情况，先停下来报告，按文档的备选路线处理，不要自行改架构。
- 如果服务放在 Termux，先读 §5.8；不要在 DSH Go 本机引擎和 Termux 各装一份环境。
- 所有新文件用 LF 换行；脚本放 scripts/，文档放 docs/。

本轮先做 M0，把结果贴给我。
```

### 8.3 让手机端 agent 知道的「不要做」

- 不要 `apt install` 一堆东西试图修环境；先确认缺什么。
- 不要为了「能访问」把 `HOST` 改成 `0.0.0.0` 并长期保留。
- 不要 `git add -f data/`、`outputs/`，也不要把备份包提交。
- 不要在手机上跑 `npm install` 装原生模块（本项目不需要）。
- 不要用 `rm -rf outputs` 清空间；用回收站 / 清空画廊接口。

---

## 9. 分支、提交与协作

1. 在 PC 上新建分支：`git switch -c android`（从 `v1.7.0` / `main` 起）。
2. 按 §4 落地 P0：脚本 → 排序 → 安全区 → 文档；每步在 PC 跑 `npm run verify`。
3. 手机端验证通过后合并 `main`，打 `v1.8.0` 标签。
4. 手机端只 `git pull`；如果要在手机上提交，先 `gh auth login`，提交前 `git status` 确认没有 `data/`、`outputs/`、`logs/`、`backups/` 被暂存。
5. `.gitignore` 已忽略 `data/*.json`、`outputs/`、`node_modules/`、`*.log`；再加 `logs/`、`backups/`。

提交信息建议：

```text
Android：手机端启停 / 自检脚本，触屏排序，安全区适配
Android：新增 docs/ANDROID-PORT-HANDOFF.md
```

---

## 10. 待办清单（勾选）

- [ ] M0：手机跑探测，回贴 ① npm ② /sdcard ③ 端口可访问性
- [ ] 决策：依赖安装路线（npm vs 拷贝 node_modules）
- [ ] 落盘 `scripts/mobile-start.sh` / `mobile-stop.sh` / `mobile-doctor.sh` / `mobile-backup.sh`
- [ ] `package.json` 增加 mobile 脚本
- [ ] 前端排序模式（P0）
- [ ] viewport + 安全区 CSS（P0）
- [ ] 数据迁移（整包）并校验条数
- [ ] 手机端 doctor 全绿 + `npm run verify` 235/235
- [ ] 手机端 UI 验收清单（§5.6）
- [ ] 合并 `android` → `main`，版本 1.8.0
- [ ] 更新 `NAI-Atelier-HANDOFF.md` / `README.md`
- [ ] （可选）P1 `movePath()`、P2 PWA / 备份导入 / 灯箱手势

---

## 附录 A：`scripts/mobile-start.sh`

```bash
#!/usr/bin/env bash
# NAI Atelier 手机端启动脚本（Android + DSH Go 本机引擎 / Termux / 任意 Linux）
# 用法：
#   bash scripts/mobile-start.sh                 # 127.0.0.1:3800
#   NAI_PORT=3801 bash scripts/mobile-start.sh   # 换端口
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${NAI_PORT:-3800}"
HOST="${NAI_HOST:-127.0.0.1}"
LOG_DIR="$APP_DIR/logs"
PID_FILE="$LOG_DIR/nai-atelier.pid"
BASE_URL="http://${HOST}:${PORT}"

mkdir -p "$LOG_DIR"
cd "$APP_DIR"

health_ok() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsS --max-time 2 "$BASE_URL/api/health" >/dev/null 2>&1
  else
    node -e 'fetch(process.argv[1]).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))' \
      "$BASE_URL/api/health" >/dev/null 2>&1
  fi
}

if health_ok; then
  echo "NAI Atelier 已在运行：$BASE_URL"
  exit 0
fi

command -v node >/dev/null 2>&1 || {
  echo "未找到 node。请先确认 DSH Go 本机引擎已安装运行环境。" >&2
  exit 1
}

node -e 'const v=process.versions.node.split(".").map(Number);process.exit(v[0]>18||(v[0]===18&&v[1]>=17)?0:1)' || {
  echo "Node 版本过低：$(node -v)，需要 >= 18.17。" >&2
  exit 1
}

[ -d "$APP_DIR/node_modules/express" ] || {
  echo "缺少依赖：先在 $APP_DIR 执行 npm ci --omit=dev，或从 PC 拷贝 node_modules。" >&2
  exit 1
}

if command -v ss >/dev/null 2>&1; then
  if ss -ltn 2>/dev/null | awk 'NR>1 {print $4}' | grep -qE "[:.]${PORT}$"; then
    echo "端口 ${PORT} 已被其他程序占用；用 NAI_PORT=3801 换一个端口再启动。" >&2
    exit 1
  fi
fi

PORT="$PORT" HOST="$HOST" nohup node server.js \
  >>"$LOG_DIR/server.out.log" 2>>"$LOG_DIR/server.err.log" &
echo $! >"$PID_FILE"

for _ in $(seq 1 40); do
  if health_ok; then
    echo "已启动：$BASE_URL（PID $(cat "$PID_FILE")）"
    exit 0
  fi
  sleep 0.5
done

echo "启动超时。最近错误日志：" >&2
tail -n 30 "$LOG_DIR/server.err.log" 2>/dev/null >&2 || true
exit 1
```

## 附录 B：`scripts/mobile-stop.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_FILE="$APP_DIR/logs/nai-atelier.pid"
stopped=0

if [ -f "$PID_FILE" ]; then
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    stopped=1
  fi
fi

# 兜底：只杀工作目录等于本项目的 node server.js，避免误伤其他项目
if command -v pgrep >/dev/null 2>&1; then
  for pid in $(pgrep -f "node server.js" 2>/dev/null || true); do
    cwd="$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)"
    [ "$cwd" = "$APP_DIR" ] || continue
    kill "$pid" 2>/dev/null || true
    stopped=1
  done
fi

sleep 1
rm -f "$PID_FILE"

if [ "$stopped" = 1 ]; then
  echo "已停止 NAI Atelier。"
else
  echo "没有发现运行中的 NAI Atelier 进程。"
fi
```

## 附录 C：`scripts/mobile-doctor.sh`

```bash
#!/usr/bin/env bash
# 手机端自检：环境 / 依赖 / 磁盘 / 服务 / 数据一致性
set -uo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${NAI_PORT:-3800}"
BASE_URL="http://127.0.0.1:${PORT}"
pass=0; fail=0; warn=0

ok()   { printf '  [ok]   %s\n' "$1"; pass=$((pass+1)); }
bad()  { printf '  [fail] %s\n' "$1"; fail=$((fail+1)); }
caution() { printf '  [warn] %s\n' "$1"; warn=$((warn+1)); }

http_get() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsS --max-time 3 "$1" 2>/dev/null
  else
    node -e 'fetch(process.argv[1]).then(async r=>{process.stdout.write(await r.text())}).catch(()=>process.exit(1))' "$1"
  fi
}

echo "== 环境 =="
echo "  arch: $(uname -m)  kernel: $(uname -r 2>/dev/null || echo '?')  home: $HOME"
if command -v node >/dev/null 2>&1; then
  node_ok=$(node -e 'const v=process.versions.node.split(".").map(Number);process.exit(v[0]>18||(v[0]===18&&v[1]>=17)?0:1)' && echo yes || echo no)
  [ "$node_ok" = yes ] && ok "node $(node -v)" || bad "node $(node -v) 低于 18.17"
else
  bad "找不到 node"
fi
command -v npm >/dev/null 2>&1 && ok "npm $(npm -v 2>/dev/null)" || caution "没有 npm（可从 PC 拷贝 node_modules）"

echo "== 项目 =="
[ -f "$APP_DIR/server.js" ] && ok "server.js 存在" || bad "server.js 缺失"
[ -d "$APP_DIR/public" ] && ok "public/ 存在" || bad "public/ 缺失"
[ -d "$APP_DIR/node_modules/express" ] && ok "依赖已安装" || bad "node_modules/express 缺失"
[ -d "$APP_DIR/data" ] && ok "data/ 存在" || caution "data/ 不存在（首次启动会自动创建）"
[ -d "$APP_DIR/outputs" ] && ok "outputs/ 存在" || caution "outputs/ 不存在（首次启动会自动创建）"

if [ -d "$APP_DIR/data" ]; then
  if touch "$APP_DIR/data/.doctor-write" 2>/dev/null; then
    rm -f "$APP_DIR/data/.doctor-write"
    ok "data/ 可写"
  else
    bad "data/ 不可写"
  fi
fi

free_kb=$(df -Pk "$APP_DIR" 2>/dev/null | awk 'NR==2 {print $4}')
if [ -n "${free_kb:-}" ]; then
  free_mb=$((free_kb / 1024))
  [ "$free_mb" -ge 512 ] && ok "剩余空间 ${free_mb} MB" || caution "剩余空间仅 ${free_mb} MB"
fi

echo "== 服务 =="
health="$(http_get "$BASE_URL/api/health" || true)"
if [ -n "$health" ]; then
  ok "健康检查：$health"
  for path in /api/history /api/albums /api/trash /api/prompts; do
    if http_get "$BASE_URL$path" >/dev/null; then ok "$path 200"; else bad "$path 不可用"; fi
  done
else
  bad "服务未响应 $BASE_URL/api/health（先运行 mobile-start.sh）"
fi

echo "== 数据 =="
if [ -f "$APP_DIR/data/history.json" ]; then
  counts=$(node -e '
    const fs=require("fs"),path=require("path");
    const root=process.argv[1];
    const hist=JSON.parse(fs.readFileSync(path.join(root,"data/history.json"),"utf8"));
    const items=Array.isArray(hist.items)?hist.items:[];
    let missing=0;
    for(const it of items){
      if(!it||!it.relativePath) continue;
      if(!fs.existsSync(path.join(root,"outputs",it.relativePath))) missing++;
    }
    console.log(items.length+" "+missing);
  ' "$APP_DIR" 2>/dev/null || echo "ERR")
  if [ "$counts" != "ERR" ]; then
    total=${counts%% *}; missing=${counts##* }
    ok "历史 $total 条，缺失图片 $missing 条"
    [ "$missing" -gt 0 ] && caution "有 $missing 条记录找不到图片（迁移不完整？）"
  else
    bad "无法解析 history.json"
  fi
else
  caution "没有 history.json（空库）"
fi

echo
echo "通过 $pass 项，警告 $warn 项，失败 $fail 项。"
[ "$fail" -eq 0 ] || exit 1
```

## 附录 D：`scripts/mobile-backup.sh`

```bash
#!/usr/bin/env bash
# 备份 data/ 与 outputs/（含真实 API Key，妥善保管）
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${1:-$APP_DIR/backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"
ARCHIVE="$DEST/nai-atelier-$STAMP.tar.gz"

mkdir -p "$DEST"
tar -czf "$ARCHIVE" -C "$APP_DIR" data outputs

if command -v sha256sum >/dev/null 2>&1; then
  (cd "$DEST" && sha256sum "$(basename "$ARCHIVE")" > "$(basename "$ARCHIVE").sha256")
fi

ls -lh "$ARCHIVE"
echo "备份完成：$ARCHIVE"
echo "恢复：先 mobile-stop.sh，再 tar -xzf \"$ARCHIVE\" -C \"$APP_DIR\"，最后 mobile-start.sh。"
echo "注意：压缩包内含 data/config.json（真实 API Key），不要上传到公开仓库或分享链接。"
```

## 附录 E：排序模式改动点（伪代码）

```js
// state 增加
state.sortMode = false;

// 画廊工具区按钮（index.html）
// <button type="button" id="sort-mode" class="ghost-btn">排序</button>

// toggle
ui.sortMode?.addEventListener('click', () => {
  state.sortMode = !state.sortMode;
  ui.sortMode.textContent = state.sortMode ? '完成排序' : '排序';
  ui.sortMode.classList.toggle('is-active', state.sortMode);
  renderGallery();
});

// 小工具
function makeSortButton(label, aria, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.setAttribute('aria-label', aria);
  button.addEventListener('click', onClick);
  return button;
}

// renderGallery() 内，每张卡片（sortMode 时）：
if (state.sortMode) {
  const row = document.createElement('div');
  row.className = 'card-sort-row';

  const up = makeSortButton('↑', '前移', () => moveVisibleItem(item, -1));
  const down = makeSortButton('↓', '后移', () => moveVisibleItem(item, 1));
  const index = visibleHistory().findIndex((entry) => entry.id === item.id);
  up.disabled = index <= 0;
  down.disabled = index < 0 || index >= visibleHistory().length - 1;

  row.append(up, down);
  card.append(row);
}
```

对应 CSS：

```css
.card-sort-row {
  display: flex;
  gap: 8px;
  padding: 0 12px 12px;
}
.card-sort-row button {
  flex: 1;
  min-height: 44px;
  border-radius: 10px;
}
```

## 附录 F：参考链接

- DSH Go 仓库：<https://github.com/ccch1mneyyy/dsh-go>
- DSH Go 使用指南：<https://github.com/ccch1mneyyy/dsh-go/blob/main/docs/guide/README.md>
- 本机引擎与远程主机：<https://github.com/ccch1mneyyy/dsh-go/blob/main/docs/guide/zh/03-engine-hosts.md>
- 终端：<https://github.com/ccch1mneyyy/dsh-go/blob/main/docs/guide/zh/16-terminal.md>
- 工作区：<https://github.com/ccch1mneyyy/dsh-go/blob/main/docs/guide/zh/17-workspaces.md>
- 常见问题（后台被关 / 引擎启动失败）：<https://github.com/ccch1mneyyy/dsh-go/blob/main/docs/guide/zh/11-faq.md>
- Termux 官网：<https://termux.dev/>
- Termux Wiki：<https://wiki.termux.com/wiki/Main_Page>
- Termux（F-Droid）：<https://f-droid.org/packages/com.termux/>
- Termux:Boot：<https://f-droid.org/packages/com.termux.boot/>
- 项目仓库（公开）：<https://github.com/y1090026806-eng/nai-atelier>

> DSH Go 是社区第三方客户端，与 DeepSeek 公司无隶属关系；其安装包、运行环境和数据目录以 App 实际版本为准。本文中标注「待实测」的结论，必须由 §5.2 的真实输出确认后再写进代码或文档。

---

**交接人备注**：截至本文档写入，PC 端 `D:\NAI-Atelier` 未做任何修改；本文件是手机端的行动清单。下一步只有一件事：跑 §5.2 的 M0，把 ① npm ② `/sdcard` ③ 端口可访问性三个结果带回来，再决定 M1/M2 的具体路线。
