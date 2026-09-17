import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import type { DownloadTask, AppSettings, HistoryEntry } from '../shared/types.js'
import { DEFAULT_SETTINGS } from '../shared/types.js'

let db: Database.Database | null = null

export function initDatabase(): void {
  const dbPath = join(app.getPath('userData'), 'aigei-downloader.db')
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')

  // 下载任务表
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      itemId TEXT NOT NULL,
      title TEXT,
      url TEXT,
      fileType TEXT,
      thumbnail TEXT,
      savePath TEXT,
      status TEXT DEFAULT 'pending',
      progress REAL DEFAULT 0,
      downloadedBytes INTEGER DEFAULT 0,
      totalBytes INTEGER DEFAULT 0,
      speed INTEGER DEFAULT 0,
      error TEXT,
      retryCount INTEGER DEFAULT 0,
      createdAt INTEGER,
      startedAt INTEGER,
      finishedAt INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
  `)
  ensureColumns('tasks', {
    detailUrl: 'TEXT',
    sourceUrl: 'TEXT',
    previewUrl: 'TEXT',
    description: 'TEXT',
    category: 'TEXT',
    categoryPath: 'TEXT',
    tags: 'TEXT',
    licenseType: 'TEXT',
    format: 'TEXT',
    duration: 'TEXT',
    downloadCount: 'TEXT',
    uploadTime: 'TEXT',
    author: 'TEXT',
    metadata: 'TEXT',
    extractedPath: 'TEXT',
    extractedAt: 'INTEGER',
    archiveEntryCount: 'INTEGER DEFAULT 0',
    archiveSummary: 'TEXT'
  })

  // Cookie 表（备份登录态）
  db.exec(`
    CREATE TABLE IF NOT EXISTS cookies (
      host TEXT,
      name TEXT,
      value TEXT,
      expires REAL,
      PRIMARY KEY (host, name)
    );
  `)

  // 配置表
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `)

  // 下载历史表
  db.exec(`
    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      itemId TEXT,
      title TEXT,
      filePath TEXT,
      fileSize INTEGER,
      fileType TEXT,
      createdAt TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_history_created ON history(createdAt);
  `)
  ensureColumns('history', {
    url: 'TEXT',
    detailUrl: 'TEXT',
    thumbnail: 'TEXT',
    description: 'TEXT',
    category: 'TEXT',
    categoryPath: 'TEXT',
    tags: 'TEXT',
    licenseType: 'TEXT',
    format: 'TEXT',
    duration: 'TEXT',
    downloadCount: 'TEXT',
    uploadTime: 'TEXT',
    author: 'TEXT',
    metadata: 'TEXT',
    extractedPath: 'TEXT',
    extractedAt: 'INTEGER',
    archiveEntryCount: 'INTEGER DEFAULT 0',
    archiveSummary: 'TEXT'
  })

  console.log('[DB] 初始化完成:', dbPath)
}

export function getDb(): Database.Database {
  if (!db) throw new Error('数据库未初始化')
  return db
}

function ensureColumns(table: 'tasks' | 'history', columns: Record<string, string>): void {
  const existing = new Set(
    (getDb().prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((column) => column.name)
  )
  for (const [name, definition] of Object.entries(columns)) {
    if (!existing.has(name)) {
      getDb().exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`)
    }
  }
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function serializeJson(value: unknown): string | null {
  if (value === undefined || value === null) return null
  try {
    return JSON.stringify(value)
  } catch {
    return null
  }
}

function hydrateTask(row: Record<string, any>): DownloadTask {
  return {
    ...row,
    categoryPath: parseJson<string[]>(row.categoryPath, []),
    tags: parseJson<string[]>(row.tags, []),
    metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
    archiveSummary: parseJson<Record<string, unknown>>(row.archiveSummary, {})
  } as DownloadTask
}

function hydrateHistory(row: Record<string, any>): HistoryEntry {
  return {
    ...row,
    categoryPath: parseJson<string[]>(row.categoryPath, []),
    tags: parseJson<string[]>(row.tags, []),
    metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
    archiveSummary: parseJson<Record<string, unknown>>(row.archiveSummary, {})
  } as HistoryEntry
}

export function closeDatabase(): void {
  if (db) {
    db.close()
    db = null
  }
}

// ===== 任务 CRUD =====
export function saveTask(task: DownloadTask): void {
  getDb().prepare(`
    INSERT INTO tasks (
      id, itemId, title, url, fileType, thumbnail, savePath, status, progress, downloadedBytes,
      totalBytes, speed, error, retryCount, createdAt, startedAt, finishedAt, detailUrl, sourceUrl,
      previewUrl, description, category, categoryPath, tags, licenseType, format, duration,
      downloadCount, uploadTime, author, metadata, extractedPath, extractedAt, archiveEntryCount, archiveSummary
    )
    VALUES (
      @id, @itemId, @title, @url, @fileType, @thumbnail, @savePath, @status, @progress, @downloadedBytes,
      @totalBytes, @speed, @error, @retryCount, @createdAt, @startedAt, @finishedAt, @detailUrl, @sourceUrl,
      @previewUrl, @description, @category, @categoryPath, @tags, @licenseType, @format, @duration,
      @downloadCount, @uploadTime, @author, @metadata, @extractedPath, @extractedAt, @archiveEntryCount, @archiveSummary
    )
    ON CONFLICT(id) DO UPDATE SET
      status=excluded.status, progress=excluded.progress, downloadedBytes=excluded.downloadedBytes,
      totalBytes=excluded.totalBytes, speed=excluded.speed, error=excluded.error,
      retryCount=excluded.retryCount, startedAt=excluded.startedAt, finishedAt=excluded.finishedAt,
      detailUrl=excluded.detailUrl, sourceUrl=excluded.sourceUrl, previewUrl=excluded.previewUrl,
      description=excluded.description, category=excluded.category, categoryPath=excluded.categoryPath,
      tags=excluded.tags, licenseType=excluded.licenseType, format=excluded.format, duration=excluded.duration,
      downloadCount=excluded.downloadCount, uploadTime=excluded.uploadTime, author=excluded.author,
      metadata=excluded.metadata, extractedPath=excluded.extractedPath, extractedAt=excluded.extractedAt,
      archiveEntryCount=excluded.archiveEntryCount, archiveSummary=excluded.archiveSummary
  `).run({
    id: task.id, itemId: task.itemId, title: task.title, url: task.url,
    fileType: task.fileType, thumbnail: task.thumbnail, savePath: task.savePath,
    status: task.status, progress: task.progress, downloadedBytes: task.downloadedBytes,
    totalBytes: task.totalBytes, speed: task.speed, error: task.error,
    retryCount: task.retryCount, createdAt: task.createdAt,
    startedAt: task.startedAt || null, finishedAt: task.finishedAt || null,
    detailUrl: task.detailUrl || task.url, sourceUrl: task.sourceUrl || task.url,
    previewUrl: task.previewUrl || null, description: task.description || null,
    category: task.category || null, categoryPath: serializeJson(task.categoryPath),
    tags: serializeJson(task.tags), licenseType: task.licenseType || null, format: task.format || null,
    duration: task.duration || null, downloadCount: task.downloadCount || null,
    uploadTime: task.uploadTime || null, author: task.author || null, metadata: serializeJson(task.metadata),
    extractedPath: task.extractedPath || null, extractedAt: task.extractedAt || null,
    archiveEntryCount: task.archiveEntryCount || 0, archiveSummary: serializeJson(task.archiveSummary)
  })
}

export function getTask(id: string): DownloadTask | undefined {
  const row = getDb().prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as Record<string, any> | undefined
  return row ? hydrateTask(row) : undefined
}

export function getAllTasks(): DownloadTask[] {
  return (getDb().prepare(`SELECT * FROM tasks ORDER BY createdAt DESC`).all() as Record<string, any>[]).map(hydrateTask)
}

export function getTasksByStatus(status: string): DownloadTask[] {
  return (getDb().prepare(`SELECT * FROM tasks WHERE status = ? ORDER BY createdAt DESC`).all(status) as Record<string, any>[]).map(hydrateTask)
}

export function deleteTask(id: string): void {
  getDb().prepare(`DELETE FROM tasks WHERE id = ?`).run(id)
}

export function clearCompletedTasks(): void {
  getDb().prepare(`DELETE FROM tasks WHERE status = 'completed'`).run()
}

// ===== Cookie =====
export function saveCookie(host: string, name: string, value: string, expires?: number): void {
  getDb().prepare(`
    INSERT INTO cookies (host, name, value, expires) VALUES (?, ?, ?, ?)
    ON CONFLICT(host, name) DO UPDATE SET value=excluded.value, expires=excluded.expires
  `).run(host, name, value, expires || null)
}

export function getCookies(host: string): { name: string; value: string }[] {
  return getDb().prepare(`SELECT name, value FROM cookies WHERE host = ?`).all(host) as { name: string; value: string }[]
}

export function clearCookies(): void {
  getDb().prepare(`DELETE FROM cookies`).run()
}

// ===== 设置 =====
export function getSetting(key: string): string | null {
  const row = getDb().prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function setSetting(key: string, value: string): void {
  getDb().prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value)
}

export function getAllSettings(): AppSettings {
  const rows = getDb().prepare(`SELECT key, value FROM settings`).all() as { key: string; value: string }[]
  const map: Record<string, string> = {}
  for (const r of rows) map[r.key] = r.value
  return {
    downloadDir: map.downloadDir || DEFAULT_SETTINGS.downloadDir,
    maxConcurrent: Number(map.maxConcurrent) || DEFAULT_SETTINGS.maxConcurrent,
    retryCount: Number(map.retryCount) || DEFAULT_SETTINGS.retryCount,
    retryDelay: Number(map.retryDelay) || DEFAULT_SETTINGS.retryDelay,
    requestDelay: Number(map.requestDelay) || DEFAULT_SETTINGS.requestDelay,
    headless: map.headless === 'true'
  }
}

// ===== 历史 =====
export function addHistory(entry: {
  itemId: string
  title: string
  filePath: string
  fileSize?: number
  fileType?: string
  url?: string
  detailUrl?: string
  thumbnail?: string
  description?: string
  category?: string
  categoryPath?: string[]
  tags?: string[]
  licenseType?: string
  format?: string
  duration?: string
  downloadCount?: string
  uploadTime?: string
  author?: string
  metadata?: Record<string, unknown>
  extractedPath?: string
  extractedAt?: number
  archiveEntryCount?: number
  archiveSummary?: Record<string, unknown>
}): void {
  getDb().prepare(`
    INSERT INTO history (
      itemId, title, filePath, fileSize, fileType, url, detailUrl, thumbnail, description, category,
      categoryPath, tags, licenseType, format, duration, downloadCount, uploadTime, author, metadata,
      extractedPath, extractedAt, archiveEntryCount, archiveSummary
    )
    VALUES (
      @itemId, @title, @filePath, @fileSize, @fileType, @url, @detailUrl, @thumbnail, @description, @category,
      @categoryPath, @tags, @licenseType, @format, @duration, @downloadCount, @uploadTime, @author, @metadata,
      @extractedPath, @extractedAt, @archiveEntryCount, @archiveSummary
    )
  `).run({
    itemId: entry.itemId, title: entry.title, filePath: entry.filePath,
    fileSize: entry.fileSize || null, fileType: entry.fileType || null,
    url: entry.url || entry.detailUrl || null, detailUrl: entry.detailUrl || entry.url || null,
    thumbnail: entry.thumbnail || null, description: entry.description || null,
    category: entry.category || null, categoryPath: serializeJson(entry.categoryPath),
    tags: serializeJson(entry.tags), licenseType: entry.licenseType || null,
    format: entry.format || null, duration: entry.duration || null,
    downloadCount: entry.downloadCount || null, uploadTime: entry.uploadTime || null,
    author: entry.author || null, metadata: serializeJson(entry.metadata),
    extractedPath: entry.extractedPath || null, extractedAt: entry.extractedAt || null,
    archiveEntryCount: entry.archiveEntryCount || 0, archiveSummary: serializeJson(entry.archiveSummary)
  })
}

export function updateHistoryExtraction(
  id: number,
  extractedPath: string,
  extractedAt: number,
  archiveEntryCount: number,
  archiveSummary: Record<string, unknown>
): void {
  getDb().prepare(`
    UPDATE history
    SET extractedPath = ?, extractedAt = ?, archiveEntryCount = ?, archiveSummary = ?
    WHERE id = ?
  `).run(extractedPath, extractedAt, archiveEntryCount, serializeJson(archiveSummary), id)
}

export function getAllHistory(): HistoryEntry[] {
  return (getDb().prepare(`SELECT * FROM history ORDER BY id DESC`).all() as Record<string, any>[]).map(hydrateHistory)
}

export function getHistory(id: number): HistoryEntry | undefined {
  const row = getDb().prepare(`SELECT * FROM history WHERE id = ?`).get(id) as Record<string, any> | undefined
  return row ? hydrateHistory(row) : undefined
}

export function clearHistory(): void {
  getDb().prepare(`DELETE FROM history`).run()
}
