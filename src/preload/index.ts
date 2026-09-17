import { contextBridge, ipcRenderer } from 'electron'
import type { DownloadItemInput, ResourcePageResult } from '../shared/types.js'

const api = {
  // ===== 登录 =====
  login: {
    check: () => ipcRenderer.invoke('login:check'),
    open: () => ipcRenderer.invoke('login:open'),
    logout: () => ipcRenderer.invoke('login:logout'),
    saveCookies: () => ipcRenderer.invoke('login:saveCookies'),
    checkSession: () => ipcRenderer.invoke('login:checkSession'),
    onSuccess: (callback: (status?: any) => void) => {
      const handler = (_e: any, status?: any) => callback(status)
      ipcRenderer.on('login:success', handler)
      return () => ipcRenderer.removeListener('login:success', handler)
    }
  },

  // ===== 资源抓取 =====
  scrape: {
    list: (url: string) => ipcRenderer.invoke('scrape:list', url),
    page: (url: string): Promise<ResourcePageResult> => ipcRenderer.invoke('scrape:page', url),
    item: (url: string) => ipcRenderer.invoke('scrape:item', url)
  },

  // ===== 下载 =====
  download: {
    add: (inputOrUrl: DownloadItemInput | string, title?: string, type?: string) =>
      ipcRenderer.invoke('download:add', inputOrUrl, title, type),
    addBatch: (items: DownloadItemInput[]) =>
      ipcRenderer.invoke('download:addBatch', items),
    list: (status?: string) => ipcRenderer.invoke('download:list', status),
    retry: (id: string) => ipcRenderer.invoke('download:retry', id),
    remove: (id: string) => ipcRenderer.invoke('download:remove', id),
    pause: () => ipcRenderer.invoke('download:pause'),
    resume: () => ipcRenderer.invoke('download:resume'),
    setConcurrent: (n: number) => ipcRenderer.invoke('download:setConcurrent', n),
    clearCompleted: () => ipcRenderer.invoke('download:clearCompleted'),
    onProgress: (callback: (data: any) => void) => {
      const handler = (_e: any, data: any) => callback(data)
      ipcRenderer.on('download:progress', handler)
      return () => ipcRenderer.removeListener('download:progress', handler)
    },
    onStatusChange: (callback: (data: any) => void) => {
      const handler = (_e: any, data: any) => callback(data)
      ipcRenderer.on('download:statusChange', handler)
      return () => ipcRenderer.removeListener('download:statusChange', handler)
    }
  },

  // ===== 设置 =====
  settings: {
    get: (key: string) => ipcRenderer.invoke('settings:get', key),
    set: (key: string, value: string) => ipcRenderer.invoke('settings:set', key, value),
    getSaveDir: () => ipcRenderer.invoke('settings:getSaveDir'),
    selectDownloadDir: () => ipcRenderer.invoke('settings:selectDownloadDir')
  },

  // ===== 历史 =====
  history: {
    list: () => ipcRenderer.invoke('history:list'),
    inspectArchive: (id: number | string) => ipcRenderer.invoke('history:inspectArchive', id),
    extractArchive: (id: number | string) => ipcRenderer.invoke('history:extractArchive', id),
    clear: () => ipcRenderer.invoke('history:clear')
  },

  // ===== 系统操作 =====
  system: {
    showItemInFolder: (targetPath: string) => ipcRenderer.invoke('system:showItemInFolder', targetPath),
    openPath: (targetPath: string) => ipcRenderer.invoke('system:openPath', targetPath)
  },

  // ===== 调试模式 =====
  debug: {
    getMode: () => ipcRenderer.invoke('debug:getMode'),
    setMode: (enabled: boolean) => ipcRenderer.invoke('debug:setMode', enabled),
    getLogPath: () => ipcRenderer.invoke('debug:getLogPath')
  }
}

contextBridge.exposeInMainWorld('aigei', api)

export type AigeiApi = typeof api
