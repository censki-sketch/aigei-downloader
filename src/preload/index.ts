import { contextBridge, ipcRenderer } from 'electron'

const api = {
  // ===== 登录 =====
  login: {
    check: () => ipcRenderer.invoke('login:check'),
    open: () => ipcRenderer.invoke('login:open'),
    logout: () => ipcRenderer.invoke('login:logout'),
    saveCookies: () => ipcRenderer.invoke('login:saveCookies'),
    checkSession: () => ipcRenderer.invoke('login:checkSession'),
    onSuccess: (callback: () => void) => {
      const handler = () => callback()
      ipcRenderer.on('login:success', handler)
      return () => ipcRenderer.removeListener('login:success', handler)
    }
  },

  // ===== 资源抓取 =====
  scrape: {
    list: (url: string) => ipcRenderer.invoke('scrape:list', url),
    item: (url: string) => ipcRenderer.invoke('scrape:item', url)
  },

  // ===== 下载 =====
  download: {
    add: (url: string, title: string, type?: string) => ipcRenderer.invoke('download:add', url, title, type),
    addBatch: (items: { url: string; title: string; type?: string }[]) =>
      ipcRenderer.invoke('download:addBatch', items),
    list: (status?: string) => ipcRenderer.invoke('download:list', status),
    retry: (id: number) => ipcRenderer.invoke('download:retry', id),
    remove: (id: number) => ipcRenderer.invoke('download:remove', id),
    pause: () => ipcRenderer.invoke('download:pause'),
    resume: () => ipcRenderer.invoke('download:resume'),
    setConcurrent: (n: number) => ipcRenderer.invoke('download:setConcurrent', n),
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
    getSaveDir: () => ipcRenderer.invoke('settings:getSaveDir')
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
