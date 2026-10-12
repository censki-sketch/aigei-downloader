# 爱给下载器 (AigeiDownloader)

基于 Electron + Vue 3 的爱给网批量下载桌面工具。

## 功能特性

- 🔐 **半自动登录**：内嵌浏览器手动登录，登录态自动持久化，验证码由用户手动完成
- 📋 **资源列表抓取**：输入爱给网分类页 URL，自动抓取资源列表可视化展示
- ✅ **批量勾选下载**：勾选多个资源一键加入下载队列
- 📥 **下载队列管理**：并发控制、断点续传、失败重试、进度可视化
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
│   │   ├── browser.ts         # Playwright 持久化浏览器 + 登录
│   │   ├── scraper.ts         # 资源列表抓取
│   │   ├── downloader.ts      # 下载引擎（爱给网加密 + 文件下载）
│   │   ├── aigei-encrypt.ts   # 爱给网加密函数（dfu/cqbj/cupie）
│   │   └── queue.ts           # 下载队列管理
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
5. 在资源列表中勾选要下载的资源 → 点击"下载选中"
6. 进入"下载队列"页查看下载进度
7. 在"设置"页配置下载目录、并发数等参数

## ⚠️ 重要说明

### 加密逻辑

爱给网的下载接口使用双层加密（`dfu`/`cqbj`/`cupie` 函数）。当前 `src/main/aigei-encrypt.ts` 中的实现是**简化占位版**。

要让下载真正工作，有两种方式：

**方式一（推荐）：在页面上下文中调用原生加密函数**

`downloader.ts` 已经实现了优先在 Playwright 页面的 `window` 上下文中调用爱给网自带的 `dfu`/`cqbj`/`cupie` 函数。这种方式最可靠，因为用的是网站自己的加密逻辑。

**方式二：扣取加密 JS 到本地**

如果方式一不生效，需要从爱给网扣取加密 JS：
1. 浏览器打开 `https://www.aigei.com/sound/` 任意资源页
2. F12 搜索 `dfu` 定位加密函数
3. 完整扣取 `dfu`、`cqbj`、`cupie` 及其依赖（含 jQuery 部分）
4. 替换 `aigei-encrypt.ts` 中的简化实现

详细扣取教程：
- https://www.52pojie.cn/thread-2047580-1-1.html
- https://www.cnblogs.com/352387312-dada/p/19058088

### 合规提醒

- 本工具仅供**个人学习备份**使用，请勿用于商业用途
- 批量下载可能违反爱给网用户协议，请控制频率（建议并发 2-3，间隔 5 秒）
- 下载的资源请勿二次分发，否则可能侵权
- 使用本工具产生的任何后果由使用者自行承担
