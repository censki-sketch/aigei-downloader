// 渲染进程 API 封装 - 通过 preload 暴露的 window.aigei 调用主进程
import type { ResourcePageResult } from '../shared/types'

declare global {
  interface Window {
    aigei: {
      login: {
        check: () => Promise<any>
        open: () => Promise<boolean>
        logout: () => Promise<boolean>
        saveCookies: () => Promise<boolean>
        checkSession: () => Promise<boolean>
        onSuccess: (callback: (status?: any) => void) => () => void
      }
      scrape: {
        list: (url: string) => Promise<any[]>
        page: (url: string) => Promise<ResourcePageResult>
        item: (url: string) => Promise<any>
      }
      download: {
        add: (inputOrUrl: any | string, title?: string, type?: string) => Promise<string>
        addBatch: (items: any[]) => Promise<string[]>
        list: (status?: string) => Promise<any[]>
        retry: (id: string) => Promise<boolean>
        remove: (id: string) => Promise<boolean>
        pause: () => Promise<boolean>
        resume: () => Promise<boolean>
        setConcurrent: (n: number) => Promise<boolean>
        clearCompleted: () => Promise<boolean>
        onProgress: (cb: (data: any) => void) => () => void
        onStatusChange: (cb: (data: any) => void) => () => void
      }
      settings: {
        get: (key: string) => Promise<string | undefined>
        set: (key: string, value: string) => Promise<boolean>
        getSaveDir: () => Promise<string>
        selectDownloadDir: () => Promise<string | null>
      }
      history: {
        list: () => Promise<any[]>
        inspectArchive: (id: number | string) => Promise<any>
        extractArchive: (id: number | string) => Promise<any>
        clear: () => Promise<boolean>
      }
      system: {
        showItemInFolder: (targetPath: string) => Promise<boolean>
        openPath: (targetPath: string) => Promise<boolean>
      }
      debug: {
        getMode: () => Promise<boolean>
        setMode: (enabled: boolean) => Promise<boolean>
        getLogPath: () => Promise<string>
      }
    }
  }
}

export const api = window.aigei
