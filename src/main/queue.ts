import { BrowserWindow } from 'electron'
import { join } from 'path'
import { randomUUID } from 'crypto'
import {
  saveTask,
  getTask,
  getAllTasks,
  deleteTask,
  getAllSettings,
  addHistory
} from './db.js'
import { downloadItem, getDefaultSaveDir } from './downloader.js'
import type { DownloadTask } from '../shared/types.js'

interface QueueEntry {
  id: string
  itemUrl: string
  title: string
  fileType?: string
}

class DownloadQueue {
  private queue: QueueEntry[] = []
  private active: Map<string, Promise<void>> = new Map()
  private maxConcurrent = 2
  private paused = false
  private retryLimit = 3
  private requestDelay = 5000

  setMaxConcurrent(n: number): void {
    this.maxConcurrent = Math.max(1, Math.min(5, n))
  }

  setRetryLimit(n: number): void {
    this.retryLimit = n
  }

  setRequestDelay(ms: number): void {
    this.requestDelay = ms
  }

  pause(): void {
    this.paused = true
  }

  resume(): void {
    this.paused = false
    this.tick()
  }

  add(itemUrl: string, title: string, fileType?: string): string {
    const id = randomUUID()
    const saveDir = this.getSaveDir()
    const task: DownloadTask = {
      id,
      itemId: itemUrl,
      title,
      url: itemUrl,
      fileType: fileType || 'audio_mp3',
      thumbnail: '',
      savePath: join(saveDir, `${this.sanitize(title)}.zip`),
      status: 'pending',
      progress: 0,
      downloadedBytes: 0,
      totalBytes: 0,
      speed: 0,
      retryCount: 0,
      createdAt: Date.now()
    }
    saveTask(task)
    this.queue.push({ id, itemUrl, title, fileType })
    this.tick()
    return id
  }

  addBatch(items: { url: string; title: string; type?: string }[]): string[] {
    const ids: string[] = []
    for (const item of items) {
      ids.push(this.add(item.url, item.title, item.type))
    }
    return ids
  }

  retry(id: number): void {
    const tasks = getAllTasks()
    const task = tasks[id] || tasks.find((t) => t.id === String(id))
    if (task && task.status === 'failed') {
      task.status = 'pending'
      task.retryCount = 0
      task.error = undefined
      saveTask(task)
      this.queue.push({ id: task.id, itemUrl: task.url, title: task.title, fileType: task.fileType })
      this.tick()
    }
  }

  remove(id: number): void {
    const tasks = getAllTasks()
    const task = tasks[id]
    if (task) {
      deleteTask(task.id)
      this.queue = this.queue.filter((q) => q.id !== task.id)
    }
  }

  private getSaveDir(): string {
    const settings = getAllSettings()
    return settings.downloadDir || getDefaultSaveDir()
  }

  private sanitize(name: string): string {
    return name.replace(/[<>:"/\\|?*]/g, '_').substring(0, 100)
  }

  private async tick(): Promise<void> {
    if (this.paused) return
    while (this.active.size < this.maxConcurrent && this.queue.length > 0) {
      const entry = this.queue.shift()!
      const promise = this.processEntry(entry)
      this.active.set(entry.id, promise)
      promise.finally(() => {
        this.active.delete(entry.id)
        this.tick()
      })
    }
  }

  private async processEntry(entry: QueueEntry): Promise<void> {
    const task = getTask(entry.id)
    if (!task) return

    task.status = 'downloading'
    task.startedAt = Date.now()
    saveTask(task)
    this.notifyStatusChange(task)

    try {
      const saveDir = this.getSaveDir()
      const result = await downloadItem(entry.itemUrl, entry.title, saveDir, (downloaded, total, speed) => {
        task.downloadedBytes = downloaded
        task.totalBytes = total
        task.speed = speed
        task.progress = total > 0 ? (downloaded / total) * 100 : 0
        saveTask(task)
        this.notifyProgress(task)
      })

      if (result.success) {
        task.status = 'completed'
        task.progress = 100
        task.finishedAt = Date.now()
        saveTask(task)
        addHistory({
          itemId: entry.id,
          title: entry.title,
          filePath: result.filePath!,
          fileSize: result.fileSize,
          fileType: task.fileType
        })
        this.notifyStatusChange(task)
      } else {
        throw new Error(result.error || '下载失败')
      }
    } catch (err: any) {
      task.error = err.message
      task.retryCount++
      if (task.retryCount < this.retryLimit) {
        task.status = 'pending'
        saveTask(task)
        this.notifyStatusChange(task)
        await new Promise((r) => setTimeout(r, this.requestDelay))
        this.queue.push(entry)
        this.tick()
      } else {
        task.status = 'failed'
        task.finishedAt = Date.now()
        saveTask(task)
        this.notifyStatusChange(task)
      }
    }

    if (this.requestDelay > 0) {
      await new Promise((r) => setTimeout(r, this.requestDelay))
    }
  }

  private notifyProgress(task: DownloadTask): void {
    const win = BrowserWindow.getAllWindows()[0]
    if (win && !win.isDestroyed()) {
      win.webContents.send('download:progress', {
        id: task.id,
        progress: task.progress,
        downloadedBytes: task.downloadedBytes,
        totalBytes: task.totalBytes,
        speed: task.speed
      })
    }
  }

  private notifyStatusChange(task: DownloadTask): void {
    const win = BrowserWindow.getAllWindows()[0]
    if (win && !win.isDestroyed()) {
      win.webContents.send('download:statusChange', {
        id: task.id,
        status: task.status,
        error: task.error
      })
    }
  }
}

export const downloadQueue = new DownloadQueue()
