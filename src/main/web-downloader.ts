import { BrowserWindow, session, type DownloadItem as ElectronDownloadItem } from 'electron'
import { existsSync, mkdirSync, openSync, closeSync, readSync, statSync, unlinkSync } from 'fs'
import { basename, dirname, extname, join } from 'path'
import { AIGEI_UA } from '../shared/aigei-constants.js'
import type { AuthorizationResult, DownloadItemInput } from '../shared/types.js'
import { installAuthorizationHook } from './site-authorization.js'

export interface WebDownloadResult extends AuthorizationResult {
  success: boolean
  filePath?: string
  fileSize?: number
  format?: string
  error?: string
  retryable?: boolean
}

interface PreparedDownload {
  ok: boolean
  itemId?: string
  entryPoint?: 'direct' | 'options'
  error?: string
  format?: string
  cost?: string
  size?: string
}

const PAGE_LOAD_TIMEOUT = 30_000
const DOWNLOAD_START_TIMEOUT = 30_000
// 受 queue.ts 中 setMaxConcurrent 的硬性钳位，池大小 2 足够
const WORKER_POOL_SIZE = 2
const BLOCKED_RESOURCE_TYPES = new Set(['media', 'object', 'ping', 'cspReport'])
const BLOCKED_HOST_PATTERNS = [
  /(^|\.)cnzz\.com$/i,
  /(^|\.)google-analytics\.com$/i,
  /(^|\.)googletagmanager\.com$/i,
  /(^|\.)doubleclick\.net$/i,
  /(^|\.)baidustatic\.com$/i,
  /(^|\.)hm\.baidu\.com$/i,
  /(^|\.)umeng\.(co|com)$/i
]

interface Worker {
  win: BrowserWindow
  busy: boolean
}

const pool: Worker[] = []
const waiters: Array<(worker: Worker) => void> = []
const workerWebContentsIds = new Set<number>()
let assetFilterInstalled = false

function installAssetFilter(): void {
  if (assetFilterInstalled) return
  assetFilterInstalled = true
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const wcId = (details as any).webContentsId
    if (typeof wcId === 'number' && workerWebContentsIds.has(wcId)) {
      if (BLOCKED_RESOURCE_TYPES.has(details.resourceType)) {
        return callback({ cancel: true })
      }
      try {
        const host = new URL(details.url).hostname
        if (BLOCKED_HOST_PATTERNS.some((pattern) => pattern.test(host))) {
          return callback({ cancel: true })
        }
      } catch {
        /* ignore malformed URL */
      }
    }
    callback({})
  })
}

function createWorker(): Worker {
  installAssetFilter()
  const win = new BrowserWindow({
    show: false,
    width: 1100,
    height: 800,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      // 原生确认/验证码窗口需要图片和字体。
      images: true,
      backgroundThrottling: false
    }
  })
  win.webContents.setUserAgent(AIGEI_UA)
  workerWebContentsIds.add(win.webContents.id)
  win.once('closed', () => {
    workerWebContentsIds.delete(win.webContents.id)
    const index = pool.findIndex((item) => item.win === win)
    if (index >= 0) pool.splice(index, 1)
  })
  const worker: Worker = { win, busy: false }
  pool.push(worker)
  return worker
}

async function acquireWorker(): Promise<Worker> {
  const idle = pool.find((w) => !w.busy && !w.win.isDestroyed())
  if (idle) {
    idle.busy = true
    return idle
  }
  if (pool.length < WORKER_POOL_SIZE) {
    const worker = createWorker()
    worker.busy = true
    return worker
  }
  return new Promise<Worker>((resolve) => {
    waiters.push(resolve)
  })
}

async function releaseWorker(worker: Worker): Promise<void> {
  if (worker.win.isDestroyed()) {
    // 销毁的 worker 已通过 closed 事件移出池；只需唤醒一个等待者
    const waiter = waiters.shift()
    if (waiter) void acquireWorker().then(waiter)
    return
  }
  // 把窗口导航到 about:blank，丢掉上一次的 DOM / JS 上下文
  try {
    worker.win.hide()
    await worker.win.loadURL('about:blank')
  } catch {
    destroyWorker(worker)
    return
  }
  worker.busy = false
  const waiter = waiters.shift()
  if (waiter) {
    worker.busy = true
    waiter(worker)
  }
}

function destroyWorker(worker: Worker): void {
  if (!worker.win.isDestroyed()) {
    worker.win.destroy()
  }
  // 唤醒一个等待者，让它去走 acquireWorker（可能触发新建）
  const waiter = waiters.shift()
  if (waiter) void acquireWorker().then(waiter)
}

/**
 * 在隐藏的 Electron 页面中调用爱给网自己的下载逻辑。
 * 页面与"网页登录验证"共用 defaultSession，因此 Cookie、验证码和登录状态完全一致。
 * 通过池化复用窗口、屏蔽图片/字体/追踪请求降低对站点的压力。
 */
export async function downloadThroughWebPage(
  input: DownloadItemInput,
  targetPath: string,
  onProgress?: (downloaded: number, total: number, speed: number) => void,
  onAuthorization?: (result: AuthorizationResult) => void
): Promise<WebDownloadResult> {
  const worker = await acquireWorker()
  const { win } = worker

  try {
    await loadPage(win, input.detailUrl || input.url)
    const currentUrl = win.webContents.getURL()
    if (isSecurityUrl(currentUrl)) {
      return fail('爱给网要求安全验证或当前 IP 访问频率受限，请在"网页登录验证"中处理后重试')
    }
    if (isLoginUrl(currentUrl)) {
      return fail('爱给网登录状态已失效，请重新登录后重试')
    }

    const prepared = await prepareDownload(win, input)
    if (!prepared.ok) return fail(prepared.error || '网页下载选项加载失败')

    return await triggerAndSaveDownload(win, targetPath, prepared, input.operationMode === 'unlock', onProgress, onAuthorization)
  } catch (error: any) {
    // webContents 异常时销毁 worker，让下一次 acquire 建一个新的
    destroyWorker(worker)
    return {
      success: false,
      error: error?.message || '网页下载失败',
      // 网页下载可能已经产生铜币消费，不能在后台自动重复触发。
      retryable: false
    }
  } finally {
    if (!worker.win.isDestroyed()) {
      await releaseWorker(worker)
    }
  }
}

async function loadPage(win: BrowserWindow, url: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('加载爱给资源详情页超时'))
    }, PAGE_LOAD_TIMEOUT)
    const cleanup = () => {
      clearTimeout(timer)
      win.webContents.removeListener('did-finish-load', onLoaded)
      win.webContents.removeListener('did-fail-load', onFailed)
    }
    const onLoaded = () => {
      cleanup()
      resolve()
    }
    const onFailed = (_event: unknown, code: number, description: string, validatedUrl: string, isMainFrame: boolean) => {
      if (!isMainFrame) return
      cleanup()
      reject(new Error(`资源详情页加载失败：${description || code} (${validatedUrl})`))
    }
    win.webContents.once('did-finish-load', onLoaded)
    win.webContents.on('did-fail-load', onFailed)
    void win.loadURL(url).catch((error) => {
      cleanup()
      reject(error)
    })
  })
}

async function prepareDownload(win: BrowserWindow, input: DownloadItemInput): Promise<PreparedDownload> {
  const targetItemId = /^\d+$/.test(String(input.itemId || '')) ? String(input.itemId) : ''
  const preferredFormat = normalizeFormat(input.format)
  const script = `
    (async function () {
      var targetItemId = ${JSON.stringify(targetItemId)};
      var preferredFormat = ${JSON.stringify(preferredFormat)};
      var sleep = function (ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); };
      var button;
      for (var attempt = 0; attempt < 30; attempt++) {
        if (!targetItemId) {
          var detail = document.querySelector('.item-page-prev-container[itemid], .options-btns-right-down-Btn [itemid]');
          targetItemId = detail ? String(detail.getAttribute('itemid') || '') : '';
        }
        button = targetItemId ? document.getElementById('itemDownBtn_' + targetItemId) : null;
        if (!button && targetItemId) {
          button = Array.from(document.querySelectorAll('[itemid][item-down-type]')).find(function (el) {
            return String(el.getAttribute('itemid') || '') === targetItemId;
          });
        }
        if (button && typeof window.itemFileDown === 'function') break;
        await sleep(250);
      }
      if (typeof window.itemFileDown !== 'function') {
        return { ok: false, error: '爱给网页下载脚本没有加载完成' };
      }
      if (!button) return { ok: false, error: '没有在资源详情页找到当前资源的下载按钮，请在“网页登录验证”中检查该详情页' };

      var itemId = String(button.getAttribute('itemid') || '');
      var itemDownloadType = String(button.getAttribute('item-down-type') || '');
      if (!itemId || !itemDownloadType) return { ok: false, error: '资源下载参数不完整' };

      // Detail pages can provide a single download with its token already embedded.
      // Keep that exact button so its native click handler can perform the download.
      if (!button.classList.contains('js-down-btn-with-drop-down') &&
          /itemFileDown/.test(button.getAttribute('onclick') || '')) {
        var format = String(button.textContent || '').match(/\\b(zip|rar|7z|mp3|wav|ogg|flac|aac|m4a|mp4|mov|fbx|obj)\\b/i);
        button.setAttribute('data-aigei-downloader-target', 'true');
        return { ok: true, itemId: itemId, entryPoint: 'direct', format: format ? format[1].toLowerCase() : undefined };
      }

      var response = await fetch('/gei-res/ajaxComp/unit/mftDropDownContent', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: new URLSearchParams({ itemId: itemId, itemDownloadType: itemDownloadType, tipRenderSelector: '' })
      });
      var html = await response.text();
      if (/banIp\\/route|访问过于频繁|安全验证|验证码拦截/.test(response.url + ' ' + html)) {
        return { ok: false, error: '爱给网要求安全验证或当前 IP 访问频率受限，请在"网页登录验证"中处理后重试' };
      }
      if (/用户登录|user\\/login\\/page/.test(response.url + ' ' + html)) {
        return { ok: false, error: '爱给网登录状态已失效，请重新登录后重试' };
      }

      var holder = document.createElement('div');
      holder.setAttribute('data-aigei-downloader-options', 'true');
      holder.style.display = 'none';
      holder.innerHTML = html;
      document.body.appendChild(holder);
      var options = Array.from(holder.querySelectorAll('a.item-down-btn')).map(function (el, index) {
        return {
          index: index,
          format: String(el.querySelector('.td-format')?.textContent || '').trim().toLowerCase(),
          cost: String(el.querySelector('.td-fund')?.textContent || '').trim(),
          size: String(el.querySelector('.td-size')?.textContent || '').trim(),
          type: String(el.getAttribute('item-down-type') || '')
        };
      });
      if (!options.length) return { ok: false, error: '爱给网页没有返回可用的下载格式' };

      var preferred = options.find(function (option) { return preferredFormat && option.format === preferredFormat; });
      var selected = preferred || options.find(function (option) { return /^(zip|rar|7z)$/.test(option.format); })
        || options.find(function (option) { return option.format === 'mp3'; }) || options[0];
      var selectedEl = holder.querySelectorAll('a.item-down-btn')[selected.index];
      selectedEl.setAttribute('data-aigei-downloader-target', 'true');
      return { ok: true, itemId: itemId, entryPoint: 'options', format: selected.format, cost: selected.cost, size: selected.size };
    })()
  `
  return await win.webContents.executeJavaScript(script, true) as PreparedDownload
}

async function triggerAndSaveDownload(
  win: BrowserWindow,
  targetPath: string,
  prepared: PreparedDownload,
  unlockOnly: boolean,
  onProgress?: (downloaded: number, total: number, speed: number) => void,
  onAuthorization?: (result: AuthorizationResult) => void
): Promise<WebDownloadResult> {
  const installed = await win.webContents.executeJavaScript(
    '(' + installAuthorizationHook.toString() + ')(' + JSON.stringify(prepared.itemId) + ')', true)
  if (!installed) return fail('网站授权脚本尚未就绪，请刷新详情页后重试')
  // Durable checkpoint precedes any native request that might consume coins.
  onAuthorization?.({ authorizationState: 'pending' })
  let authorization: AuthorizationResult = { authorizationState: 'pending' }
  let resolvedPath = targetPath

  return await new Promise<WebDownloadResult>((resolve) => {
    let settled = false
    let released = false
    let polling = false
    let waitingForUser = false
    let dialogSeen = false
    const ses = session.defaultSession
    const finish = (result: WebDownloadResult) => {
      if (settled) return
      settled = true
      cleanup()
      if (!result.success && ['pending', 'waiting'].includes(authorization.authorizationState || '')) {
        authorization = { authorizationState: 'unknown' }
      }
      resolve({ ...result, ...authorization, retryable: false })
    }
    const onTimeout = () => {
      void readVisiblePageMessage(win).catch(() => '').then((message) => finish({
        success: false,
        error: message || '授权或文件传输未开始；扣币结果不明确时请先检查网站消费记录'
      }))
    }
    let startTimer = setTimeout(onTimeout, DOWNLOAD_START_TIMEOUT)
    const onClosed = () => finish({ success: false, error: '已关闭爱给确认窗口；请核对网站消费记录后再操作' })
    const cleanup = () => {
      clearTimeout(startTimer)
      clearInterval(pollTimer)
      ses.removeListener('will-download', onWillDownload)
      win.removeListener('closed', onClosed)
    }
    const onWillDownload = (_event: Electron.Event, item: ElectronDownloadItem, source: Electron.WebContents) => {
      if (source.id !== win.webContents.id || settled) return
      if (unlockOnly || authorization.authorizationState !== 'authorized') {
        item.cancel()
        finish({ success: false, error: '网站提前发起文件传输，已停止当前任务，请检查消费记录' })
        return
      }
      clearTimeout(startTimer)
      try {
        mkdirSync(dirname(targetPath), { recursive: true })
        const extension = extname(item.getFilename()) || extensionFromFormat(prepared.format)
        resolvedPath = replaceExtension(targetPath, extension)
        if (existsSync(resolvedPath)) unlinkSync(resolvedPath)
        item.setSavePath(resolvedPath)
      } catch (error: any) {
        item.cancel()
        finish({ success: false, error: error.message })
        return
      }
      let lastAt = Date.now()
      let lastBytes = 0
      item.on('updated', () => {
        const now = Date.now()
        const downloaded = item.getReceivedBytes()
        const total = item.getTotalBytes()
        const speed = now > lastAt ? ((downloaded - lastBytes) / (now - lastAt)) * 1000 : 0
        lastAt = now
        lastBytes = downloaded
        onProgress?.(downloaded, total, speed)
      })
      item.once('done', (_event, state) => {
        if (settled) return
        try {
          if (state !== 'completed') throw new Error('浏览器下载未完成：' + state)
          if (!existsSync(resolvedPath)) throw new Error('浏览器报告下载完成，但没有找到保存的文件')
          if (looksLikeHtmlFile(resolvedPath)) {
            unlinkSync(resolvedPath)
            throw new Error('网站返回了网页，请先在网页登录验证中完成验证')
          }
          const fileSize = statSync(resolvedPath).size
          onProgress?.(fileSize, fileSize, 0)
          finish({ success: true, filePath: resolvedPath, fileSize, format: prepared.format })
        } catch (error: any) {
          finish({ success: false, error: error.message })
        }
      })
    }
    const pollTimer = setInterval(() => {
      if (settled || polling || released) return
      polling = true
      void win.webContents.executeJavaScript(`(function () {
        var state = window.__aigeiAuthorization.state;
        var dialogVisible = Array.from(document.querySelectorAll('.modal.in, .modal.show, .layui-layer, .vcode-dialog, .geetest_panel.geetest_show, .geetest_holder.geetest_wind, #aliyunCaptcha-window-popup'))
          .some(function (el) { return el.getClientRects().length > 0; });
        return Object.assign({}, state, { dialogVisible: dialogVisible });
      })()`, true).then(async (state) => {
        if (settled) return
        if (state?.authorizationState === 'waiting' || (state?.dialogVisible && state?.authorizationState === 'pending')) {
          if (!waitingForUser) {
            waitingForUser = true
            clearTimeout(startTimer)
            authorization = { authorizationState: 'waiting' }
            onAuthorization?.(authorization)
            win.setTitle('爱给网 · 请手动完成验证码，完成后任务将继续')
            win.show()
            win.focus()
          }
          dialogSeen = dialogSeen || state.dialogVisible
          if (state.authorizationState !== 'authorized') {
            if (dialogSeen && !state.dialogVisible && state.authorizationState === 'waiting') {
              authorization = { authorizationState: 'rejected' }
              finish({ success: false, error: '爱给弹窗已关闭，未获得下载授权' })
            }
            return
          }
        }
        if (waitingForUser && state?.authorizationState === 'pending' && !state.dialogVisible) {
          waitingForUser = false
          dialogSeen = false
          authorization = { authorizationState: 'pending' }
          onAuthorization?.(authorization)
          startTimer = setTimeout(onTimeout, DOWNLOAD_START_TIMEOUT)
        }
        if (state?.authorizationState === 'authorized') {
          authorization = {
            authorizationState: 'authorized', coinsSpent: state.coinsSpent, coinBalance: state.coinBalance
          }
          onAuthorization?.(authorization)
          if (unlockOnly) {
            finish({ success: true, fileSize: 0, format: prepared.format })
          } else {
            released = true
            const started = await win.webContents.executeJavaScript('window.__aigeiAuthorization.release()', true)
            if (!started) finish({ success: false, error: '已授权，但网站没有启动文件传输' })
          }
        } else if (state?.authorizationState === 'rejected') {
          authorization = { authorizationState: 'rejected' }
          finish({ success: false, error: state.error || '网站未授权' })
        }
      }).catch((error) => finish({ success: false, error: error.message })).finally(() => { polling = false })
    }, 150)
    ses.on('will-download', onWillDownload)
    win.once('closed', onClosed)
    void win.webContents.executeJavaScript(`
      (function () {
        var target = document.querySelector('[data-aigei-downloader-target="true"]');
        if (!target || typeof window.itemFileDown !== 'function') throw new Error('网页下载入口已经失效');
        if (${JSON.stringify(prepared.entryPoint)} === 'direct') target.click();
        else window.itemFileDown(target);
      })()
    `, true).catch((error) => finish({ success: false, error: error.message }))
  })
}

async function readVisiblePageMessage(win: BrowserWindow): Promise<string> {
  if (win.isDestroyed()) return ''
  const result = await win.webContents.executeJavaScript(`
    (function () {
      var selectors = ['.bootstrap-dialog-message', '.modal.in .modal-body', '.layui-layer-content', '.vcode-dialog'];
      for (var i = 0; i < selectors.length; i++) {
        var el = document.querySelector(selectors[i]);
        if (el && el.textContent && el.getClientRects().length) return el.textContent.trim();
      }
      return '';
    })()
  `, true)
  return result ? `网页提示：${String(result).replace(/\s+/g, ' ').slice(0, 240)}` : ''
}

function replaceExtension(targetPath: string, extension: string): string {
  const cleanExtension = extension && extension.startsWith('.') ? extension : extension ? `.${extension}` : ''
  const currentExtension = extname(targetPath)
  const baseName = currentExtension ? basename(targetPath, currentExtension) : basename(targetPath)
  return join(dirname(targetPath), `${baseName}${cleanExtension || currentExtension || '.bin'}`)
}

function extensionFromFormat(format?: string): string {
  const normalized = normalizeFormat(format)
  return normalized ? `.${normalized}` : ''
}

function normalizeFormat(format?: string): string {
  return String(format || '').trim().toLowerCase().replace(/^\./, '').match(/[a-z0-9]+/)?.[0] || ''
}

function looksLikeHtmlFile(filePath: string): boolean {
  const buffer = Buffer.alloc(256)
  const fd = openSync(filePath, 'r')
  try {
    const bytesRead = readSync(fd, buffer, 0, buffer.length, 0)
    const prefix = buffer.subarray(0, bytesRead).toString('utf8')
    return /^\s*(?:<!doctype\s+html|<html\b)/i.test(prefix)
  } finally {
    closeSync(fd)
  }
}

function isSecurityUrl(url: string): boolean {
  return /verify|captcha|security|challenge|banIp\/route/i.test(url)
}

function isLoginUrl(url: string): boolean {
  return /\/user\/login\/page|\/login(?:[/?#]|$)/i.test(url)
}

function fail(error: string): WebDownloadResult {
  return { success: false, error, retryable: false }
}
