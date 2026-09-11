// 兼容旧版 Node.js（v16 没有 crypto.getRandomValues）
import { webcrypto } from 'crypto'
if (!(globalThis as any).crypto) {
  (globalThis as any).crypto = webcrypto
}

import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { createMainWindow, getMainWindow } from './window.js'
import { registerIpcHandlers } from './ipc.js'
import { initDatabase, closeDatabase, getAllSettings } from './db.js'
import { downloadQueue } from './queue.js'
import { startLoginMonitor } from './login-monitor.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// 单实例锁
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
  process.exit(0)
}

app.on('second-instance', () => {
  const win = getMainWindow()
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

app.whenReady().then(async () => {
  // 初始化数据库
  initDatabase()

  // 从数据库加载设置到下载队列
  const settings = getAllSettings()
  downloadQueue.setMaxConcurrent(settings.maxConcurrent)
  downloadQueue.setRetryLimit(settings.retryCount)
  downloadQueue.setRequestDelay(settings.requestDelay)

  // 注册 IPC 处理器
  registerIpcHandlers(ipcMain)

  // 启动登录状态监听（监听所有 webContents 的导航，自动检测登录成功）
  startLoginMonitor()

  // 创建主窗口
  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', async () => {
  closeDatabase()
})
