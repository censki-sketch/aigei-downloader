import { BrowserWindow } from 'electron'
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
import { getArchivePath, getLibraryPath, resolveCategoryPath } from './classifier.js'
import { inspectArchive } from './archive.js'
import type { DownloadItemInput, DownloadTask } from '../shared/types.js'

interface QueueEntry {
  id: string
  input: DownloadItemInput
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
    void this.tick()
  }

  add(inputOrUrl: DownloadItemInput | string, title?: string, fileType?: string): string {
    const input: DownloadItemInput =
      typeof inputOrUrl === 'string'
        ? { url: inputOrUrl, title: title || inputOrUrl, fileType, type: fileType }
        : inputOrUrl
    const id = randomUUID()
    const saveDir = this.getSaveDir()
    const categoryPath = resolveCategoryPath(input)
    const normalizedInput = { ...input, categoryPath }
    const archivePath = getArchivePath(saveDir, normalizedInput.title, normalizedInput)
    const task: DownloadTask = {
      id,
      itemId: normalizedInput.itemId || normalizedInput.url,
      title: normalizedInput.title,
      url: normalizedInput.url,
      fileType: normalizedInput.fileType || normalizedInput.type || 'audio_mp3',
      thumbnail: normalizedInput.thumbnail || '',
      savePath: archivePath,
      status: 'pending',
      progress: 0,
      downloadedBytes: 0,
      totalBytes: 0,
      speed: 0,
      retryCount: 0,
      createdAt: Date.now(),
      detailUrl: normalizedInput.detailUrl || normalizedInput.url,
      sourceUrl: normalizedInput.sourceUrl || normalizedInput.url,
      previewUrl: normalizedInput.previewUrl,
      description: normalizedInput.description,
      category: normalizedInput.category || categoryPath[0],
      categoryPath,
      tags: normalizedInput.tags || [],
      licenseType: normalizedInput.licenseType,
      format: normalizedInput.format,
      duration: normalizedInput.duration,
      downloadCount: normalizedInput.downloadCount,
      uploadTime: normalizedInput.uploadTime,
      author: normalizedInput.author,
      metadata: normalizedInput.metadata,
      extractedPath: getLibraryPath(saveDir, normalizedInput.title, normalizedInput),
      archiveEntryCount: 0,
      archiveSummary: {}
    }
    saveTask(task)
    this.queue.push({ id, input: normalizedInput })
    void this.tick()
    return id
  }

  addBatch(items: DownloadItemInput[]): string[] {
    const ids: string[] = []
    for (const item of items) {
      ids.push(this.add(item))
    }
    return ids
  }

  retry(id: string | number): void {
    const tasks = getAllTasks()
    const index = typeof id === 'number' ? id : Number(id)
    const task = getTask(String(id)) || (Number.isInteger(index) ? tasks[index] : undefined)
    if (task && task.status === 'failed') {
      task.status = 'pending'
      task.retryCount = 0
      task.error = undefined
      saveTask(task)
      this.queue.push({ id: task.id, input: taskToInput(task) })
      void this.tick()
    }
  }

  remove(id: string | number): void {
    const tasks = getAllTasks()
    const index = typeof id === 'number' ? id : Number(id)
    const task = getTask(String(id)) || (Number.isInteger(index) ? tasks[index] : undefined)
    if (task) {
      deleteTask(task.id)
      this.queue = this.queue.filter((q) => q.id !== task.id)
    }
  }

  private getSaveDir(): string {
    const settings = getAllSettings()
    return settings.downloadDir || getDefaultSaveDir()
  }

  private async tick(): Promise<void> {
    if (this.paused) return
    while (this.active.size < this.maxConcurrent && this.queue.length > 0) {
      const entry = this.queue.shift()!
      const promise = this.processEntry(entry)
      this.active.set(entry.id, promise)
      void promise.finally(() => {
        this.active.delete(entry.id)
        void this.tick()
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
      const archivePath = task.savePath || getArchivePath(saveDir, entry.input.title, entry.input)
      const result = await downloadItem(entry.input.url, entry.input.title, archivePath, (downloaded, total, speed) => {
        task.downloadedBytes = downloaded
        task.totalBytes = total
        task.speed = speed
        task.progress = total > 0 ? (downloaded / total) * 100 : 0
        saveTask(task)
        this.notifyProgress(task)
      })

      if (result.success) {
        const finishedAt = Date.now()
        const downloadedBytes = result.fileSize || task.downloadedBytes
        task.status = 'completed'
        task.progress = 100
        task.finishedAt = finishedAt
        task.downloadedBytes = downloadedBytes
        task.totalBytes = task.totalBytes || downloadedBytes
        task.speed = this.getAverageSpeed(downloadedBytes, task.startedAt, finishedAt)
        task.extractedPath =
          task.extractedPath || getLibraryPath(saveDir, task.title, {
            url: task.url,
            title: task.title,
            fileType: task.fileType,
            category: task.category,
            categoryPath: task.categoryPath,
            tags: task.tags
          })

        try {
          const archive = await inspectArchive(result.filePath!)
          task.archiveEntryCount = archive.fileCount
          task.archiveSummary = {
            fileCount: archive.fileCount,
            directoryCount: archive.directoryCount,
            totalSize: archive.totalSize,
            formats: archive.formats
          }
        } catch {
          task.archiveEntryCount = 0
          task.archiveSummary = {}
        }

        saveTask(task)
        addHistory({
          itemId: task.itemId,
          title: task.title,
          filePath: result.filePath!,
          fileSize: result.fileSize,
          fileType: task.fileType,
          url: task.url,
          detailUrl: task.detailUrl,
          thumbnail: task.thumbnail,
          description: task.description,
          category: task.category,
          categoryPath: task.categoryPath,
          tags: task.tags,
          licenseType: task.licenseType,
          format: task.format,
          duration: task.duration,
          downloadCount: task.downloadCount,
          uploadTime: task.uploadTime,
          author: task.author,
          metadata: task.metadata,
          extractedPath: task.extractedPath,
          archiveEntryCount: task.archiveEntryCount,
          archiveSummary: task.archiveSummary
        })
        this.notifyStatusChange(task)
      } else {
        const error = new Error(result.error || '下载失败') as Error & { retryable?: boolean }
        error.retryable = result.retryable
        throw error
      }
    } catch (err: any) {
      task.error = err.message
      task.retryCount++
      const retryable = err?.retryable !== false
      if (retryable && task.retryCount < this.retryLimit) {
        task.status = 'pending'
        saveTask(task)
        this.notifyStatusChange(task)
        await new Promise((resolve) => setTimeout(resolve, this.requestDelay))
        this.queue.push(entry)
        void this.tick()
      } else {
        task.status = 'failed'
        task.finishedAt = Date.now()
        saveTask(task)
        this.notifyStatusChange(task)
        if (!retryable) this.paused = true
      }
    }

    if (this.requestDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.requestDelay))
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

  private getAverageSpeed(bytes: number, startedAt?: number, finishedAt?: number): number {
    if (!bytes || !startedAt || !finishedAt || finishedAt <= startedAt) return 0
    return Math.round(bytes / ((finishedAt - startedAt) / 1000))
  }

  private notifyStatusChange(task: DownloadTask): void {
    const win = BrowserWindow.getAllWindows()[0]
    if (win && !win.isDestroyed()) {
      win.webContents.send('download:statusChange', {
        id: task.id,
        status: task.status,
        error: task.error,
        progress: task.progress,
        downloadedBytes: task.downloadedBytes,
        totalBytes: task.totalBytes,
        speed: task.speed,
        startedAt: task.startedAt,
        finishedAt: task.finishedAt,
        thumbnail: task.thumbnail,
        detailUrl: task.detailUrl,
        category: task.category,
        categoryPath: task.categoryPath,
        tags: task.tags,
        format: task.format,
        duration: task.duration,
        extractedPath: task.extractedPath,
        archiveEntryCount: task.archiveEntryCount,
        archiveSummary: task.archiveSummary
      })
    }
  }
}

function taskToInput(task: DownloadTask): DownloadItemInput {
  return {
    itemId: task.itemId,
    url: task.url,
    title: task.title,
    fileType: task.fileType,
    type: task.fileType,
    thumbnail: task.thumbnail,
    detailUrl: task.detailUrl,
    sourceUrl: task.sourceUrl,
    previewUrl: task.previewUrl,
    description: task.description,
    category: task.category,
    categoryPath: task.categoryPath,
    tags: task.tags,
    licenseType: task.licenseType,
    format: task.format,
    duration: task.duration,
    downloadCount: task.downloadCount,
    uploadTime: task.uploadTime,
    author: task.author,
    metadata: task.metadata
  }
}

export const downloadQueue = new DownloadQueue()
