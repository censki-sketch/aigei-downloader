// 共享类型定义 - 主进程与渲染进程通用的接口

export interface ResourceItem {
  itemId: string
  title: string
  thumbnail: string
  url: string
  isVip: boolean
  fileType: string // audio_mp3, video, 3d, image...
  size?: string
  detailUrl?: string
  sourceUrl?: string
  previewUrl?: string
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
  selected?: boolean
}

export interface ResourcePageResult {
  items: ResourceItem[]
  currentUrl: string
  currentPage: number
  totalPages?: number
  previousUrl?: string
  nextUrl?: string
  pages: Array<{ page: number; url: string }>
}

export interface DownloadItemInput {
  itemId?: string
  url: string
  title: string
  type?: string
  fileType?: string
  thumbnail?: string
  detailUrl?: string
  sourceUrl?: string
  previewUrl?: string
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
}

export interface DownloadTask {
  id: string
  itemId: string
  title: string
  url: string
  fileType: string
  thumbnail: string
  savePath: string
  status: DownloadStatus
  progress: number // 0-100
  downloadedBytes: number
  totalBytes: number
  speed: number // bytes/s
  error?: string
  retryCount: number
  createdAt: number
  startedAt?: number
  finishedAt?: number
  detailUrl?: string
  sourceUrl?: string
  previewUrl?: string
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
}

export interface ArchiveEntry {
  path: string
  name: string
  extension: string
  size: number
  compressedSize: number
  isDirectory: boolean
  modifiedAt?: number
}

export interface ArchiveInspection {
  filePath: string
  fileCount: number
  directoryCount: number
  totalSize: number
  formats: Record<string, number>
  entries: ArchiveEntry[]
}

export interface HistoryEntry {
  id: number
  itemId?: string
  title?: string
  url?: string
  detailUrl?: string
  filePath?: string
  fileSize?: number
  fileType?: string
  thumbnail?: string
  category?: string
  categoryPath?: string[]
  tags?: string[]
  licenseType?: string
  format?: string
  duration?: string
  downloadCount?: string
  uploadTime?: string
  author?: string
  description?: string
  metadata?: Record<string, unknown>
  archiveEntryCount?: number
  archiveSummary?: Record<string, unknown>
  extractedPath?: string
  extractedAt?: number
  createdAt?: string | number
}

export type DownloadStatus =
  | 'pending'
  | 'downloading'
  | 'completed'
  | 'failed'
  | 'paused'
  | 'queued'

export interface LoginStatus {
  isLoggedIn: boolean
  userId?: string
  username?: string
  vipLevel?: string
  coins?: number
}

export interface AppSettings {
  downloadDir: string
  maxConcurrent: number
  retryCount: number
  retryDelay: number
  requestDelay: number // 每个任务间隔毫秒
  headless: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
  downloadDir: '',
  maxConcurrent: 2,
  retryCount: 3,
  retryDelay: 5000,
  requestDelay: 5000,
  headless: false
}

// IPC 通道定义
export const IPC_CHANNELS = {
  // 浏览器相关
  BROWSER_OPEN: 'browser:open',
  BROWSER_CLOSE: 'browser:close',
  BROWSER_NAVIGATE: 'browser:navigate',
  BROWSER_GET_LOGIN_STATUS: 'browser:getLoginStatus',
  BROWSER_LOGIN: 'browser:login',
  BROWSER_LOGOUT: 'browser:logout',

  // 资源相关
  RESOURCE_GET_LIST: 'resource:getList',
  RESOURCE_GET_PAGE_LIST: 'resource:getPageList',
  RESOURCE_SEARCH: 'resource:search',

  // 下载相关
  DOWNLOAD_ADD: 'download:add',
  DOWNLOAD_START: 'download:start',
  DOWNLOAD_PAUSE: 'download:pause',
  DOWNLOAD_RESUME: 'download:resume',
  DOWNLOAD_CANCEL: 'download:cancel',
  DOWNLOAD_REMOVE: 'download:remove',
  DOWNLOAD_CLEAR_COMPLETED: 'download:clearCompleted',
  DOWNLOAD_GET_LIST: 'download:getList',
  DOWNLOAD_PROGRESS: 'download:progress', // 主进程推送进度
  DOWNLOAD_STATUS_CHANGE: 'download:statusChange',

  // 设置
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',

  // 历史
  HISTORY_GET: 'history:get',
  HISTORY_CLEAR: 'history:clear',

  // 验证码
  CAPTCHA_REQUIRED: 'captcha:required', // 主进程通知前端需要验证码
  CAPTCHA_SOLVED: 'captcha:solved' // 前端通知验证码已解决
} as const
