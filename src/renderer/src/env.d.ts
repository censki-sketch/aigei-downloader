// 渲染进程全局 window.api 类型声明
export interface Api {
  login: {
    check: () => Promise<boolean>
    open: () => Promise<boolean>
    logout: () => Promise<boolean>
  }
  scrape: {
    list: (url: string) => Promise<ResourceItem[]>
    item: (url: string) => Promise<any>
  }
  download: {
    add: (url: string, title: string, type?: string) => Promise<number>
    addBatch: (items: { url: string; title: string; type?: string }[]) => Promise<number[]>
    list: (status?: string) => Promise<DownloadRecord[]>
    retry: (id: number) => Promise<boolean>
    remove: (id: number) => Promise<boolean>
    pause: () => Promise<boolean>
    resume: () => Promise<boolean>
    setConcurrent: (n: number) => Promise<boolean>
    onProgress: (cb: (data: any) => void) => () => void
  }
  settings: {
    get: (key: string) => Promise<string | null>
    set: (key: string, value: string) => Promise<boolean>
    getSaveDir: () => Promise<string>
  }
}

export interface ResourceItem {
  itemId: string
  title: string
  type: string
  thumb?: string
  isVip?: boolean
  url: string
  duration?: string
  fileSize?: string
}

export interface DownloadRecord {
  id: number
  item_id: string
  title?: string
  type?: string
  url?: string
  save_path?: string
  file_size?: number
  downloaded_size?: number
  status?: string
  error_msg?: string
  created_at?: string
  updated_at?: string
}

declare global {
  interface Window {
    api: Api
  }
}

export {}
