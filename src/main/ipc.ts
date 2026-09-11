import { IpcMain } from 'electron'
import { getMainWindow } from './window.js'
import { checkLoginStatus, logoutClearAll, checkSessionLogin, saveSessionCookies } from './browser.js'
import { resetLoginMonitor } from './login-monitor.js'
import { scrapeListPage, scrapeItemPage } from './scraper.js'
import { downloadQueue } from './queue.js'
import {
  getAllTasks,
  getTasksByStatus,
  deleteTask,
  clearCompletedTasks,
  getSetting,
  setSetting,
  getAllSettings,
  getAllHistory,
  clearHistory
} from './db.js'
import { getDefaultSaveDir } from './downloader.js'

export function registerIpcHandlers(ipcMain: IpcMain): void {
  // ===== 登录 =====
  ipcMain.handle('login:check', async () => {
    return await checkLoginStatus()
  })

  ipcMain.handle('login:open', async () => {
    const win = getMainWindow()
    if (!win) return false
    return await openLoginWindow(win)
  })

  ipcMain.handle('login:logout', async () => {
    await logoutClearAll()
    resetLoginMonitor()
    return true
  })

  // webview 登录成功后，保存 Electron session 的 Cookie 到数据库并同步到 Playwright
  ipcMain.handle('login:saveCookies', async () => {
    return await saveSessionCookies()
  })

  // 检查 Electron session 是否有登录 Cookie（能看到 httpOnly 的 SESSION）
  ipcMain.handle('login:checkSession', async () => {
    return await checkSessionLogin()
  })

  // ===== 资源抓取 =====
  ipcMain.handle('scrape:list', async (_e, listUrl: string) => {
    return await scrapeListPage(listUrl)
  })

  ipcMain.handle('scrape:item', async (_e, itemUrl: string) => {
    return await scrapeItemPage(itemUrl)
  })

  // ===== 下载 =====
  ipcMain.handle('download:add', async (_e, itemUrl: string, title: string, type?: string) => {
    return downloadQueue.add(itemUrl, title, type)
  })

  ipcMain.handle('download:addBatch', async (_e, items: { url: string; title: string; type?: string }[]) => {
    return downloadQueue.addBatch(items)
  })

  ipcMain.handle('download:list', async (_e, status?: string) => {
    return status ? getTasksByStatus(status) : getAllTasks()
  })

  ipcMain.handle('download:retry', async (_e, id: string) => {
    downloadQueue.retry(id as any)
    return true
  })

  ipcMain.handle('download:remove', async (_e, id: string) => {
    downloadQueue.remove(id as any)
    return true
  })

  ipcMain.handle('download:pause', async () => {
    downloadQueue.pause()
    return true
  })

  ipcMain.handle('download:resume', async () => {
    downloadQueue.resume()
    return true
  })

  ipcMain.handle('download:setConcurrent', async (_e, n: number) => {
    downloadQueue.setMaxConcurrent(n)
    return true
  })

  ipcMain.handle('download:clearCompleted', async () => {
    clearCompletedTasks()
    return true
  })

  // ===== 设置 =====
  ipcMain.handle('settings:get', async (_e, key: string) => {
    return getSetting(key)
  })

  ipcMain.handle('settings:set', async (_e, key: string, value: string) => {
    setSetting(key, value)
    return true
  })

  ipcMain.handle('settings:getAll', async () => {
    return getAllSettings()
  })

  ipcMain.handle('settings:getSaveDir', async () => {
    return getDefaultSaveDir()
  })

  // ===== 调试模式 =====
  ipcMain.handle('debug:getMode', async () => {
    const { getDebugMode } = await import('./debug-log.js')
    return getDebugMode()
  })

  ipcMain.handle('debug:setMode', async (_e, enabled: boolean) => {
    const { setDebugMode } = await import('./debug-log.js')
    setDebugMode(enabled)
    return true
  })

  ipcMain.handle('debug:getLogPath', async () => {
    const { getLogFilePath } = await import('./debug-log.js')
    return getLogFilePath()
  })

  // ===== 历史 =====
  ipcMain.handle('history:list', async () => {
    return getAllHistory()
  })

  ipcMain.handle('history:clear', async () => {
    clearHistory()
    return true
  })
}
