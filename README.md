# 爱给下载器 (AigeiDownloader)

基于 Electron + Vue 3 的爱给网批量下载桌面工具。

## 功能特性

- 🔐 **半自动登录**：内嵌浏览器手动登录，登录态自动持久化，验证码由用户手动完成
- 📋 **资源列表抓取**：输入爱给网分类页 URL，自动抓取资源列表可视化展示
- ✅ **批量勾选下载**：勾选多个资源一键加入下载队列
- 🪙 **两种任务模式**：自动确认铜币后下载，或仅扣币获取网站授权、不下载文件；验证码由用户在爱给原生窗口手动完成
- 📥 **下载队列管理**：并发控制、断点续传、失败重试、进度可视化
- 🧹 **一键清除队列**：清除全部分类中的非进行中任务，保留正在执行的任务、本地文件和历史记录
- 📚 **下载历史**：记录所有已下载文件
- ⚙️ **可配置设置**：下载目录、并发数、重试次数、任务间隔

## 技术栈

| 组件 | 技术 |
|------|------|
| 桌面外壳 | Electron 32 |
| 前端界面 | Vue 3 + Element Plus + Pinia + Vue Router |
| 构建工具 | electron-vite + Vite |
| 本地存储 | better-sqlite3 |
| 打包 | electron-builder（NSIS 安装版 + ZIP 免安装版） |

## 项目结构

```
aigei-downloader/
├── src/
│   ├── main/                  # Electron 主进程
│   │   ├── index.ts           # 入口
│   │   ├── window.ts          # 主窗口
│   │   ├── ipc.ts             # IPC 通信
│   │   ├── db.ts              # SQLite 数据库
│   │   ├── settings.ts        # 设置管理
│   │   ├── browser.ts         # 登录态与 Cookie 读取
│   │   ├── scraper.ts         # 资源列表抓取
│   │   ├── downloader.ts      # 下载入口（委托给 web-downloader）
│   │   ├── web-downloader.ts  # 网页下载流程（复用窗口池、屏蔽静态资源）
│   │   └── queue.ts           # 下载队列（抖动节流、每小时上限、风控退避）
│   ├── preload/
│   │   └── index.ts           # preload 桥接
│   ├── shared/
│   │   └── types.ts           # 共享类型定义
│   └── renderer/              # Vue 3 前端
│       ├── index.html
│       ├── main.ts
│       ├── App.vue
│       ├── api.ts
│       ├── router/
│       └── views/
│           ├── LoginView.vue
│           ├── BrowserView.vue
│           ├── DownloadsView.vue
│           ├── HistoryView.vue
│           └── SettingsView.vue
├── package.json
├── electron.vite.config.ts
└── tsconfig.json
```

## 开发与运行

### Windows 一键启动

首次使用源码时，直接双击项目根目录的 `一键启动.bat`。脚本会自动切换到项目目录，缺少依赖时先执行安装，然后启动开发版。

### 1. 安装依赖

```bash
cd aigei-downloader
npm install
```

### 2. 开发模式运行

```bash
npm run dev
```

### 3. 构建生产版本

```bash
npm run build
```

### 4. 生成 Windows 发行版

```bash
npm run release:win
```

也可以直接双击 `一键打包.bat`。打包结果位于 `dist-build/`：

- `AigeiDownloader-Setup-版本-x64.exe`：安装版。
- `AigeiDownloader-版本-win-x64.zip`：免安装版，解压后运行 `AigeiDownloader.exe`。

只生成安装版：

```bash
npm run build:exe
```

只生成免安装 ZIP：

```bash
npm run build:portable
```

## GitHub 自动发布

项目包含 `.github/workflows/release.yml`：

1. 在 `package.json` 中更新版本号，例如 `1.0.1`。
2. 提交并推送代码。
3. 创建并推送同版本标签：

```bash
git tag v1.0.1
git push origin v1.0.1
```

GitHub Actions 会自动构建安装版和免安装 ZIP，并发布到仓库的 Releases 页面。也可以在 Actions 页面手动运行工作流；手动运行只生成可下载的构建产物，不创建 Release。

## 使用流程

1. 双击 `AigeiDownloader.exe` 启动程序
2. 点击右上角"登录爱给网" → 在弹出的窗口中手动登录（含验证码手动操作）
3. 登录成功后，登录态自动保存，下次无需重新登录
4. 进入"资源浏览"页 → 输入或选择爱给网分类页 URL → 点击"抓取资源"
5. 在资源列表上方选择“扣币并下载”或“仅扣币授权（不下载）”，再单条添加或勾选批量添加
6. 进入"下载队列"页查看下载进度
7. 在"设置"页配置下载目录、并发数等参数

## ⚠️ 重要说明

### 下载流程

下载完全走爱给网自身的网页链路：在隐藏的 Electron 窗口中打开资源详情页，让站点自己的 `itemFileDown` 入口触发下载。得益于这种方式，无需扣取或维护任何加密 JS。

两种模式都会自动确认网站的铜币下载提示，包括带有 VIP 推广文字的铜币确认框。只有验证码、安全验证会显示当前任务所在的爱给原生窗口，等待用户手动完成。验证期间暂停启动超时；完成后同一个任务继续执行，不会重新点击资源下载按钮。VIP 权限限制、余额不足、现金购买不会自动确认。仅扣币模式在网站返回授权成功后结束，不发起资源文件传输，不创建本地文件。这里记录的是当次下载授权，是否长期有效以网站规则为准，免费资源不会强制扣币。

任务和历史会区分模式，并记录网站返回的铜币消耗。若扣币请求超时、应用中断，或授权后文件下载失败，任务会保留授权状态并阻止直接重试，避免再次消费；先到网站核对消费记录。验证码、VIP 和现金购买提示需要在网站处理。

授权流程的本地模拟测试（无需网站账号，不消耗真实铜币）：

```powershell
postman simulation run postman/simulations/aigei-authorization.sim.yaml --port 4010 --no-history
# 在另一个 PowerShell 窗口中运行
$env:AIGEI_SIMULATION_URL = 'http://localhost:4010/aigei'
npm test
```

模拟覆盖响应与队列处理，不验证网站签名、实际扣币或授权有效期。

为了降低对站点的压力并减少风控触发概率，下载窗口会：

- 禁用媒体等不需要的资源，保留原生表单和验证码所需的图片与字体
- 屏蔽 CNZZ / Google Analytics / 百度统计等追踪域
- 复用窗口池（最多 2 个），减少重复渲染进程

### 频率与风控

- 内置"每小时下载上限"（默认 60 个/小时，可在设置中改），达到后自动暂停并倒计时恢复。
- 任务间隔自带 ±25% 抖动，避免整点节奏被识别为脚本。
- 命中安全验证 / IP 限流会自动暂停整条队列并按 1/3/10/30 分钟指数退避重试。
- 下载并发硬性钳位为最多 2，设置界面也只允许 1–2。

### 合规提醒

- 本工具仅供**个人学习备份**使用，请勿用于商业用途
- 批量下载可能违反爱给网用户协议，请控制频率（建议并发 1，间隔 ≥5 秒）
- 下载的资源请勿二次分发，否则可能侵权
- 使用本工具产生的任何后果由使用者自行承担
