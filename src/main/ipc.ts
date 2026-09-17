import { dialog, IpcMain, shell } from 'electron'
import { getMainWindow } from './window.js'
import { checkLoginStatus, logoutClearAll, checkSessionLogin, saveSessionCookies, openLoginWindow } from './browser.js'
import { resetLoginMonitor } from './login-monitor.js'
import { scrapeListPage, scrapeItemPage, scrapeResourcePage } from './scraper.js'
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
  getHistory,
  updateHistoryExtraction,
  clearHistory
} from './db.js'
import { getDefaultSaveDir } from './downloader.js'
import { inspectArchive, extractArchive } from './archive.js'
import { getLibraryPath } from './classifier.js'
import type { ArchiveInspection, DownloadItemInput, HistoryEntry } from '../shared/types.js'

export function registerIpcHandlers(ipcMain: IpcMain): void {
  // ===== 登录 =====
  ipcMain.handle('login:check', async () => {
    return await checkLoginStatus()
  })

  ipcMain.handle('login:open', async () => {
    const win = getMainWindow()
    if (!win) return false
    return await openLoginWindow()
  })

  ipcMain.handle('login:logout', async () => {
    await logoutClearAll()
    resetLoginMonitor()
    return true
  })

  // webview 登录通过真实校验后，保存 Electron session 的 Cookie 到数据库
  ipcMain.handle('login:saveCookies', async () => {
    return await saveSessionCookies()
  })

  // 检查 Electron session 是否对应真实已登录用户
  ipcMain.handle('login:checkSession', async () => {
    return await checkSessionLogin()
  })

  // ===== 资源抓取 =====
  ipcMain.handle('scrape:list', async (_e, listUrl: string) => {
    return await scrapeListPage(listUrl)
  })

  ipcMain.handle('scrape:page', async (_e, listUrl: string) => {
    return await scrapeResourcePage(listUrl)
  })

  ipcMain.handle('scrape:item', async (_e, itemUrl: string) => {
    return await scrapeItemPage(itemUrl)
  })

  // ===== 下载 =====
  ipcMain.handle('download:add', async (_e, inputOrUrl: DownloadItemInput | string, title?: string, type?: string) => {
    return downloadQueue.add(inputOrUrl, title, type)
  })

  ipcMain.handle('download:addBatch', async (_e, items: DownloadItemInput[]) => {
    return downloadQueue.addBatch(items)
  })

  ipcMain.handle('download:list', async (_e, status?: string) => {
    return status ? getTasksByStatus(status) : getAllTasks()
  })

  ipcMain.handle('download:retry', async (_e, id: string) => {
    downloadQueue.retry(id)
    return true
  })

  ipcMain.handle('download:remove', async (_e, id: string) => {
    downloadQueue.remove(id)
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

  ipcMain.handle('settings:selectDownloadDir', async () => {
    const win = getMainWindow()
    const options = {
      title: '选择下载保存目录',
      properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'>
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : result.filePaths[0]
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

  ipcMain.handle('history:inspectArchive', async (_e, id: number | string) => {
    const entry = getHistoryEntry(id)
    if (!entry.filePath) throw new Error('历史记录没有保存路径')
    return await inspectArchive(entry.filePath)
  })

  ipcMain.handle('history:extractArchive', async (_e, id: number | string) => {
    const entry = getHistoryEntry(id)
    if (!entry.filePath) throw new Error('历史记录没有保存路径')
    const extractedPath = entry.extractedPath || getExtractionPath(entry)
    const inspection = await extractArchive(entry.filePath, extractedPath)
    const extractedAt = Date.now()
    const archiveSummary = toArchiveSummary(inspection)
    updateHistoryExtraction(entry.id, extractedPath, extractedAt, inspection.fileCount, archiveSummary)
    return { extractedPath, extractedAt, inspection, archiveSummary }
  })

  // ===== 系统操作 =====
  ipcMain.handle('system:showItemInFolder', async (_e, targetPath: string) => {
    if (!targetPath) return false
    shell.showItemInFolder(targetPath)
    return true
  })

  ipcMain.handle('system:openPath', async (_e, targetPath: string) => {
    if (!targetPath) return false
    const error = await shell.openPath(targetPath)
    if (error) throw new Error(error)
    return true
  })
}

function getHistoryEntry(id: number | string): HistoryEntry {
  const numericId = typeof id === 'number' ? id : Number(id)
  if (!Number.isInteger(numericId) || numericId <= 0) {
    throw new Error('历史记录 ID 无效')
  }
  const entry = getHistory(numericId)
  if (!entry) throw new Error('历史记录不存在')
  return entry
}

function getExtractionPath(entry: HistoryEntry): string {
  const settings = getAllSettings()
  const saveRoot = settings.downloadDir || getDefaultSaveDir()
  return getLibraryPath(saveRoot, entry.title || '未命名资源', {
    itemId: entry.itemId,
    url: entry.url || entry.detailUrl || entry.filePath || '',
    title: entry.title || '未命名资源',
    fileType: entry.fileType,
    type: entry.fileType,
    category: entry.category,
    categoryPath: entry.categoryPath,
    tags: entry.tags
  })
}

function toArchiveSummary(inspection: ArchiveInspection): Record<string, unknown> {
  return {
    fileCount: inspection.fileCount,
    directoryCount: inspection.directoryCount,
    totalSize: inspection.totalSize,
    formats: inspection.formats
  }
}
