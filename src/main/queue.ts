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
import { getArchivePath, resolveCategoryPath } from './classifier.js'
import { inspectArchive } from './archive.js'
import { isAigeiAccessBlockedError } from './scraper.js'
import type {
  DownloadItemInput,
  DownloadQueueState,
  DownloadTask,
  QueuePauseKind
} from '../shared/types.js'

interface QueueEntry {
  id: string
  input: DownloadItemInput
}

const ONE_HOUR_MS = 60 * 60 * 1000
const MIN_DELAY_JITTER = 0.75
const MAX_DELAY_JITTER = 1.25
const ANTI_BOT_BACKOFF_STEPS_MS = [60_000, 180_000, 600_000, 1_800_000]

class DownloadQueue {
  private queue: QueueEntry[] = []
  private active: Map<string, Promise<void>> = new Map()
  private maxConcurrent = 2
  private paused = false
  private automaticallyPaused = false
  private pauseReason: string | undefined
  private pauseKind: QueuePauseKind | undefined
  private retryLimit = 3
  private requestDelay = 5000
  private retryDelay = 5000
  private hourlyLimit = 60
  private startTimestamps: number[] = []
  private nextStartAt = 0
  private tickTimer: ReturnType<typeof setTimeout> | null = null
  private antiBotStrikes = 0

  setMaxConcurrent(n: number): void {
    // 爱给网硬性钳位到 2：高并发在共享 Cookie 下极易触发风控
    this.maxConcurrent = Math.max(1, Math.min(2, n))
  }

  setRetryLimit(n: number): void {
    this.retryLimit = Math.max(0, n)
  }

  setRequestDelay(ms: number): void {
    this.requestDelay = Math.max(0, ms)
  }

  setRetryDelay(ms: number): void {
    this.retryDelay = Math.max(0, ms)
  }

  setHourlyLimit(n: number): void {
    this.hourlyLimit = Math.max(0, Math.floor(n))
    // 上限刚调大，若之前因 hourly-limit 暂停，试着恢复一次
    if (this.pauseKind === 'hourly-limit' && this.hourlyRemaining() > 0) {
      this.resume()
    } else {
      this.notifyQueueState()
    }
  }

  getState(): DownloadQueueState {
    this.trimHourlyWindow()
    const used = this.startTimestamps.length
    const reachedCap = this.hourlyLimit > 0 && used >= this.hourlyLimit
    return {
      paused: this.paused,
      automaticallyPaused: this.automaticallyPaused,
      pauseReason: this.pauseReason,
      pauseKind: this.pauseKind,
      pendingCount: this.queue.length,
      activeCount: this.active.size,
      nextStartAt: this.paused ? undefined : this.nextStartAt || undefined,
      hourlyUsed: used,
      hourlyLimit: this.hourlyLimit,
      hourlyResetAt: reachedCap ? this.startTimestamps[0] + ONE_HOUR_MS : undefined
    }
  }

  pause(reason = '下载队列已手动暂停', automaticallyPaused = false, kind: QueuePauseKind = 'manual'): void {
    this.paused = true
    this.automaticallyPaused = automaticallyPaused
    this.pauseReason = reason
    this.pauseKind = kind
    this.clearTickTimer()
    this.notifyQueueState()
  }

  resume(): void {
    this.paused = false
    this.automaticallyPaused = false
    this.pauseReason = undefined
    this.pauseKind = undefined
    this.antiBotStrikes = 0
    this.notifyQueueState()
    void this.tick()
  }

  /**
   * 启动时把数据库里残留的任务（pending、以及上次崩溃时还是 downloading）重新塞回内存队列。
   */
  rehydrateFromDb(): void {
    const tasks = getAllTasks()
    for (const task of tasks) {
      if (task.status !== 'completed' && ['pending', 'waiting'].includes(task.authorizationState || '')) {
        task.authorizationState = 'unknown'
      }
      if ((task.status === 'downloading' || task.status === 'pending') &&
          (task.authorizationState === 'unknown' || task.authorizationState === 'authorized')) {
        task.status = 'failed'
        task.speed = 0
        task.error = task.authorizationState === 'authorized'
          ? '上次任务已授权但未完成，已阻止再次扣币，请在网站检查记录'
          : '上次任务中断，扣币结果未知，请先在网站检查消费记录'
        saveTask(task)
        continue
      }
      if (task.status === 'downloading') {
        task.status = 'pending'
        task.speed = 0
        saveTask(task)
      }
      if (task.status === 'pending') {
        if (!this.queue.some((entry) => entry.id === task.id)) {
          this.queue.push({ id: task.id, input: taskToInput(task) })
        }
      }
    }
    this.notifyQueueState()
    if (!this.paused) void this.tick()
  }

  add(inputOrUrl: DownloadItemInput | string, title?: string, fileType?: string): string {
    const input: DownloadItemInput =
      typeof inputOrUrl === 'string'
        ? { url: inputOrUrl, title: title || inputOrUrl, fileType, type: fileType }
        : inputOrUrl
    const id = randomUUID()
    const saveDir = this.getSaveDir()
    const categoryPath = resolveCategoryPath(input)
    const normalizedInput = { ...input, operationMode: input.operationMode === 'unlock' ? 'unlock' as const : 'download' as const, categoryPath }
    const archivePath = getArchivePath(saveDir, normalizedInput.title, normalizedInput)
    const task: DownloadTask = {
      id,
      operationMode: normalizedInput.operationMode,
      authorizationState: 'not-started',
      itemId: normalizedInput.itemId || normalizedInput.url,
      title: normalizedInput.title,
      url: normalizedInput.url,
      fileType: normalizedInput.fileType || normalizedInput.type || 'audio_mp3',
      thumbnail: normalizedInput.thumbnail || '',
      savePath: normalizedInput.operationMode === 'unlock' ? '' : archivePath,
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
      archiveEntryCount: 0,
      archiveSummary: {}
    }
    saveTask(task)
    this.queue.push({ id, input: normalizedInput })
    // 新增任务时只有"上一任务失败"这种软性原因才自动恢复；
    // 风控或每小时上限导致的暂停，不被添加动作静默撤销，避免反复戳风控。
    if (this.automaticallyPaused && this.pauseKind === 'task-failure') {
      this.resume()
      return id
    }
    this.notifyQueueState()
    if (!this.paused) void this.tick()
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
      if (['pending', 'waiting', 'unknown', 'authorized'].includes(task.authorizationState || '')) {
        throw new Error('该任务可能已经扣币，已阻止重复提交；请先在网站检查消费记录')
      }
      task.status = 'pending'
      task.authorizationState = 'not-started'
      task.retryCount = 0
      task.error = undefined
      saveTask(task)
      this.queue.push({ id: task.id, input: taskToInput(task) })
      if (this.automaticallyPaused && this.pauseKind === 'task-failure') {
        this.resume()
        return
      }
      this.notifyQueueState()
      if (!this.paused) void this.tick()
    }
  }

  remove(id: string | number): void {
    const tasks = getAllTasks()
    const index = typeof id === 'number' ? id : Number(id)
    const task = getTask(String(id)) || (Number.isInteger(index) ? tasks[index] : undefined)
    if (task) {
      deleteTask(task.id)
      this.queue = this.queue.filter((q) => q.id !== task.id)
      this.notifyQueueState()
    }
  }

  clearInactive(): number {
    const removable = getAllTasks().filter((task) =>
      task.status !== 'downloading' && !this.active.has(task.id)
    )
    // 同时移除内存队列和数据库记录，防止清除后仍启动等待任务。
    for (const task of removable) {
      deleteTask(task.id)
      this.queue = this.queue.filter((entry) => entry.id !== task.id)
    }
    if (this.queue.length === 0 && this.active.size === 0 && this.pauseKind === 'task-failure') {
      this.resume()
    } else {
      this.notifyQueueState()
    }
    return removable.length
  }

  private getSaveDir(): string {
    const settings = getAllSettings()
    return settings.downloadDir || getDefaultSaveDir()
  }

  private hourlyRemaining(): number {
    if (this.hourlyLimit <= 0) return Number.POSITIVE_INFINITY
    this.trimHourlyWindow()
    return Math.max(0, this.hourlyLimit - this.startTimestamps.length)
  }

  private trimHourlyWindow(): void {
    const cutoff = Date.now() - ONE_HOUR_MS
    while (this.startTimestamps.length > 0 && this.startTimestamps[0] <= cutoff) {
      this.startTimestamps.shift()
    }
  }

  private jitteredDelay(base: number): number {
    if (base <= 0) return 0
    const factor = MIN_DELAY_JITTER + Math.random() * (MAX_DELAY_JITTER - MIN_DELAY_JITTER)
    return Math.max(0, Math.round(base * factor))
  }

  private scheduleNextTick(delayMs: number): void {
    this.clearTickTimer()
    if (delayMs <= 0) {
      void this.tick()
      return
    }
    this.tickTimer = setTimeout(() => {
      this.tickTimer = null
      void this.tick()
    }, delayMs)
  }

  private clearTickTimer(): void {
    if (this.tickTimer) {
      clearTimeout(this.tickTimer)
      this.tickTimer = null
    }
  }

  private async tick(): Promise<void> {
    if (this.paused) return

    while (this.active.size < this.maxConcurrent && this.queue.length > 0) {
      // 每小时预算
      if (this.hourlyLimit > 0) {
        this.trimHourlyWindow()
        if (this.startTimestamps.length >= this.hourlyLimit) {
          const resumeAt = this.startTimestamps[0] + ONE_HOUR_MS
          const waitMs = Math.max(1000, resumeAt - Date.now())
          this.pause(
            `已达每小时下载上限 ${this.hourlyLimit} 个，${formatWait(waitMs)}后自动恢复`,
            true,
            'hourly-limit'
          )
          this.scheduleAutoResume(waitMs)
          return
        }
      }

      // 两次请求之间的抖动间隔
      const now = Date.now()
      if (this.nextStartAt > now) {
        this.scheduleNextTick(this.nextStartAt - now)
        this.notifyQueueState()
        return
      }

      const entry = this.queue.shift()!
      // 标记：本次 start 占用预算、刷新下一次允许开始的时间
      this.startTimestamps.push(now)
      this.nextStartAt = now + this.jitteredDelay(this.requestDelay)

      const promise = this.processEntry(entry)
      this.active.set(entry.id, promise)
      this.notifyQueueState()
      void promise.finally(() => {
        this.active.delete(entry.id)
        this.notifyQueueState()
        void this.tick()
      })
    }
  }

  private scheduleAutoResume(delayMs: number): void {
    this.clearTickTimer()
    this.tickTimer = setTimeout(() => {
      this.tickTimer = null
      // 只处理我们自己触发的 hourly-limit 暂停；其它类型的暂停保持原状
      if (this.pauseKind === 'hourly-limit') {
        this.resume()
      }
    }, Math.min(delayMs, ONE_HOUR_MS))
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
      const result = await downloadItem(entry.input, archivePath, (downloaded, total, speed) => {
        task.downloadedBytes = downloaded
        task.totalBytes = total
        task.speed = speed
        task.progress = total > 0 ? (downloaded / total) * 100 : 0
        saveTask(task)
        this.notifyProgress(task)
      }, (authorization) => {
        Object.assign(task, authorization)
        saveTask(task)
        this.notifyStatusChange(task)
      })

      if (result.authorizationState) Object.assign(task, {
        authorizationState: result.authorizationState,
        coinsSpent: result.coinsSpent ?? task.coinsSpent,
        coinBalance: result.coinBalance ?? task.coinBalance
      })

      if (result.success) {
        const finishedAt = Date.now()
        const downloadedBytes = result.fileSize || task.downloadedBytes
        task.status = 'completed'
        task.savePath = task.operationMode === 'unlock' ? '' : result.filePath || archivePath
        task.format = result.format || task.format
        task.progress = 100
        task.finishedAt = finishedAt
        task.downloadedBytes = downloadedBytes
        task.totalBytes = task.totalBytes || downloadedBytes
        task.speed = this.getAverageSpeed(downloadedBytes, task.startedAt, finishedAt)
        this.antiBotStrikes = 0
        try {
          if (task.operationMode === 'unlock' || !result.filePath) throw new Error('无文件')
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
          operationMode: task.operationMode,
          authorizationState: task.authorizationState,
          coinsSpent: task.coinsSpent,
          coinBalance: task.coinBalance,
          itemId: task.itemId,
          title: task.title,
          filePath: task.savePath,
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
          extractedPath: task.extractedAt ? task.extractedPath : undefined,
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
      if (['pending', 'waiting'].includes(task.authorizationState || '')) task.authorizationState = 'unknown'
      task.error = err.message
      task.retryCount++
      const paymentUncertain = ['unknown', 'authorized'].includes(task.authorizationState || '')
      const retryable = !paymentUncertain && err?.retryable !== false
      const antiBot = isAigeiAccessBlockedError(err)

      if (antiBot && !paymentUncertain) {
        // 命中风控：直接暂停整条队列，用指数退避计算多久后"软恢复"。
        // 任务本身丢回队首等恢复后重跑（不消耗重试次数）。
        task.status = 'pending'
        task.retryCount = Math.max(0, task.retryCount - 1)
        saveTask(task)
        this.notifyStatusChange(task)
        this.queue.unshift(entry)
        const backoff = ANTI_BOT_BACKOFF_STEPS_MS[
          Math.min(this.antiBotStrikes, ANTI_BOT_BACKOFF_STEPS_MS.length - 1)
        ]
        this.antiBotStrikes++
        this.pause(
          `检测到爱给网风控/验证码（${err.message}），将在 ${formatWait(backoff)}后再尝试，请前往"网页登录验证"检查`,
          true,
          'anti-bot'
        )
        this.nextStartAt = Date.now() + backoff
        this.scheduleAutoResume(backoff)
      } else if (retryable && task.retryCount < this.retryLimit) {
        // 普通可重试错误：使用 retryDelay（和 requestDelay 分开），并在多次失败时轻度退避
        const retryBase = this.retryDelay * Math.pow(1.5, task.retryCount - 1)
        const waitMs = this.jitteredDelay(retryBase)
        task.status = 'pending'
        saveTask(task)
        this.notifyStatusChange(task)
        this.queue.push(entry)
        this.notifyQueueState()
        // 不睡在 await 上；通过推迟 nextStartAt 让下一次 tick 自动等待
        this.nextStartAt = Math.max(this.nextStartAt, Date.now() + waitMs)
      } else {
        task.status = 'failed'
        task.finishedAt = Date.now()
        saveTask(task)
        this.notifyStatusChange(task)
        if (!retryable) {
          this.pause(`任务"${task.title}"失败：${task.error}`, true, 'task-failure')
        }
      }
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
        operationMode: task.operationMode,
        authorizationState: task.authorizationState,
        coinsSpent: task.coinsSpent,
        coinBalance: task.coinBalance,
        savePath: task.savePath,
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

  private notifyQueueState(): void {
    const win = BrowserWindow.getAllWindows()[0]
    if (win && !win.isDestroyed()) {
      win.webContents.send('download:queueState', this.getState())
    }
  }
}

function formatWait(ms: number): string {
  const totalSec = Math.max(1, Math.round(ms / 1000))
  if (totalSec < 60) return `${totalSec} 秒`
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  if (min < 60) return sec > 0 ? `${min} 分 ${sec} 秒` : `${min} 分`
  const hour = Math.floor(min / 60)
  return `${hour} 小时 ${min % 60} 分`
}

function taskToInput(task: DownloadTask): DownloadItemInput {
  return {
    operationMode: task.operationMode,
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
