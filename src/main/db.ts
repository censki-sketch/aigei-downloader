import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import type { DownloadTask, AppSettings } from '../shared/types.js'
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

  console.log('[DB] 初始化完成:', dbPath)
}

export function getDb(): Database.Database {
  if (!db) throw new Error('数据库未初始化')
  return db
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
    INSERT INTO tasks (id, itemId, title, url, fileType, thumbnail, savePath, status, progress, downloadedBytes, totalBytes, speed, error, retryCount, createdAt, startedAt, finishedAt)
    VALUES (@id, @itemId, @title, @url, @fileType, @thumbnail, @savePath, @status, @progress, @downloadedBytes, @totalBytes, @speed, @error, @retryCount, @createdAt, @startedAt, @finishedAt)
    ON CONFLICT(id) DO UPDATE SET
      status=excluded.status, progress=excluded.progress, downloadedBytes=excluded.downloadedBytes,
      totalBytes=excluded.totalBytes, speed=excluded.speed, error=excluded.error,
      retryCount=excluded.retryCount, startedAt=excluded.startedAt, finishedAt=excluded.finishedAt
  `).run({
    id: task.id, itemId: task.itemId, title: task.title, url: task.url,
    fileType: task.fileType, thumbnail: task.thumbnail, savePath: task.savePath,
    status: task.status, progress: task.progress, downloadedBytes: task.downloadedBytes,
    totalBytes: task.totalBytes, speed: task.speed, error: task.error,
    retryCount: task.retryCount, createdAt: task.createdAt,
    startedAt: task.startedAt || null, finishedAt: task.finishedAt || null
  })
}

export function getTask(id: string): DownloadTask | undefined {
  return getDb().prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as DownloadTask | undefined
}

export function getAllTasks(): DownloadTask[] {
  return getDb().prepare(`SELECT * FROM tasks ORDER BY createdAt DESC`).all() as DownloadTask[]
}

export function getTasksByStatus(status: string): DownloadTask[] {
  return getDb().prepare(`SELECT * FROM tasks WHERE status = ? ORDER BY createdAt DESC`).all(status) as DownloadTask[]
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
export function addHistory(entry: { itemId: string; title: string; filePath: string; fileSize?: number; fileType?: string }): void {
  getDb().prepare(`INSERT INTO history (itemId, title, filePath, fileSize, fileType) VALUES (?, ?, ?, ?, ?)`).run(
    entry.itemId, entry.title, entry.filePath, entry.fileSize || null, entry.fileType || null
  )
}

export function getAllHistory(): any[] {
  return getDb().prepare(`SELECT * FROM history ORDER BY id DESC`).all()
}

export function clearHistory(): void {
  getDb().prepare(`DELETE FROM history`).run()
}
