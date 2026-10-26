import { BrowserWindow, session, type DownloadItem as ElectronDownloadItem } from 'electron'
import { existsSync, mkdirSync, openSync, closeSync, readSync, statSync, unlinkSync } from 'fs'
import { basename, dirname, extname, join } from 'path'
import type { DownloadItemInput } from '../shared/types.js'

export interface WebDownloadResult {
  success: boolean
  filePath?: string
  fileSize?: number
  format?: string
  error?: string
  retryable?: boolean
}

interface PreparedDownload {
  ok: boolean
  error?: string
  format?: string
  cost?: string
  size?: string
}

const PAGE_LOAD_TIMEOUT = 30_000
const DOWNLOAD_START_TIMEOUT = 30_000

/**
 * 在隐藏的 Electron 页面中调用爱给网自己的下载逻辑。
 * 页面与“网页登录验证”共用 defaultSession，因此 Cookie、验证码和登录状态完全一致。
 */
export async function downloadThroughWebPage(
  input: DownloadItemInput,
  targetPath: string,
  onProgress?: (downloaded: number, total: number, speed: number) => void
): Promise<WebDownloadResult> {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  })

  try {
    await loadPage(win, input.detailUrl || input.url)
    const currentUrl = win.webContents.getURL()
    if (isSecurityUrl(currentUrl)) {
      return fail('爱给网要求安全验证或当前 IP 访问频率受限，请在“网页登录验证”中处理后重试')
    }
    if (isLoginUrl(currentUrl)) {
      return fail('爱给网登录状态已失效，请重新登录后重试')
    }

    const prepared = await prepareDownload(win, input)
    if (!prepared.ok) return fail(prepared.error || '网页下载选项加载失败')

    return await triggerAndSaveDownload(win, targetPath, prepared, onProgress)
  } catch (error: any) {
    const message = error?.message || '网页下载失败'
    return {
      success: false,
      error: message,
      // 网页下载可能已经产生铜币消费，不能在后台自动重复触发。
      retryable: false
    }
  } finally {
    if (!win.isDestroyed()) win.destroy()
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
  const targetItemId = String(input.itemId || '').replace(/\D/g, '')
  const preferredFormat = normalizeFormat(input.format)
  const script = `
    (async function () {
      var targetItemId = ${JSON.stringify(targetItemId)};
      var preferredFormat = ${JSON.stringify(preferredFormat)};
      var sleep = function (ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); };
      for (var attempt = 0; attempt < 30 && typeof window.itemFileDown !== 'function'; attempt++) {
        await sleep(250);
      }
      if (typeof window.itemFileDown !== 'function') {
        return { ok: false, error: '爱给网页下载脚本没有加载完成' };
      }
      var buttons = Array.from(document.querySelectorAll('.js-down-btn-with-drop-down'));
      var button = buttons.find(function (el) {
        return targetItemId && String(el.getAttribute('itemid') || '') === targetItemId;
      }) || buttons[0];
      if (!button) return { ok: false, error: '没有在资源详情页找到下载按钮，网页结构可能已经变化' };

      var itemId = String(button.getAttribute('itemid') || '');
      var itemDownloadType = String(button.getAttribute('item-down-type') || '');
      if (!itemId || !itemDownloadType) return { ok: false, error: '资源下载参数不完整' };

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
        return { ok: false, error: '爱给网要求安全验证或当前 IP 访问频率受限，请在“网页登录验证”中处理后重试' };
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
      return { ok: true, format: selected.format, cost: selected.cost, size: selected.size };
    })()
  `
  return await win.webContents.executeJavaScript(script, true) as PreparedDownload
}

async function triggerAndSaveDownload(
  win: BrowserWindow,
  targetPath: string,
  prepared: PreparedDownload,
  onProgress?: (downloaded: number, total: number, speed: number) => void
): Promise<WebDownloadResult> {
  mkdirSync(dirname(targetPath), { recursive: true })
  let resolvedPath = targetPath

  return await new Promise<WebDownloadResult>((resolve, reject) => {
    let settled = false
    const ses = session.defaultSession
    const startTimer = setTimeout(async () => {
      if (settled) return
      settled = true
      cleanup()
      const pageMessage = await readVisiblePageMessage(win).catch(() => '')
      reject(new Error(pageMessage || '网页没有开始下载，可能需要人工确认铜币、授权或安全验证'))
    }, DOWNLOAD_START_TIMEOUT)

    const cleanup = () => {
      clearTimeout(startTimer)
      ses.removeListener('will-download', onWillDownload)
    }

    const onWillDownload = (_event: Electron.Event, item: ElectronDownloadItem, sourceWebContents: Electron.WebContents) => {
      if (sourceWebContents.id !== win.webContents.id || settled) return
      clearTimeout(startTimer)
      try {
        const suggestedExtension = extname(item.getFilename()) || extensionFromFormat(prepared.format)
        resolvedPath = replaceExtension(targetPath, suggestedExtension)
        if (existsSync(resolvedPath)) unlinkSync(resolvedPath)
        item.setSavePath(resolvedPath)
      } catch (error) {
        settled = true
        cleanup()
        item.cancel()
        reject(error)
        return
      }

      let lastAt = Date.now()
      let lastBytes = 0
      item.on('updated', () => {
        const now = Date.now()
        const downloaded = item.getReceivedBytes()
        const total = item.getTotalBytes()
        const elapsed = now - lastAt
        const speed = elapsed > 0 ? ((downloaded - lastBytes) / elapsed) * 1000 : 0
        lastAt = now
        lastBytes = downloaded
        onProgress?.(downloaded, total, speed)
      })
      item.once('done', (_doneEvent, state) => {
        if (settled) return
        settled = true
        cleanup()
        if (state !== 'completed') {
          reject(new Error(`浏览器下载未完成：${state}`))
          return
        }
        if (!existsSync(resolvedPath)) {
          reject(new Error('浏览器报告下载完成，但没有找到保存的文件'))
          return
        }
        if (looksLikeHtmlFile(resolvedPath)) {
          unlinkSync(resolvedPath)
          reject(new Error('爱给网返回了网页而不是资源文件，请在“网页登录验证”中完成验证后重试'))
          return
        }
        const fileSize = statSync(resolvedPath).size
        onProgress?.(fileSize, fileSize, 0)
        resolve({ success: true, filePath: resolvedPath, fileSize, format: prepared.format })
      })
    }

    ses.on('will-download', onWillDownload)
    void win.webContents.executeJavaScript(`
      (function () {
        var target = document.querySelector('[data-aigei-downloader-target="true"]');
        if (!target || typeof window.itemFileDown !== 'function') {
          throw new Error('网页下载入口已经失效');
        }
        window.itemFileDown(target);
        return true;
      })()
    `, true).catch((error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    })
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
