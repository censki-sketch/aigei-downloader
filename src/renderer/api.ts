// 渲染进程 API 封装 - 通过 preload 暴露的 window.aigei 调用主进程

declare global {
  interface Window {
    aigei: {
      login: {
        check: () => Promise<any>
        open: () => Promise<boolean>
        logout: () => Promise<boolean>
        saveCookies: () => Promise<boolean>
        checkSession: () => Promise<boolean>
        onSuccess: (callback: () => void) => () => void
      }
      scrape: {
        list: (url: string) => Promise<any[]>
        item: (url: string) => Promise<any>
      }
      download: {
        add: (url: string, title: string, type?: string) => Promise<string>
        addBatch: (items: { url: string; title: string; type?: string }[]) => Promise<string[]>
        list: (status?: string) => Promise<any[]>
        retry: (id: number) => Promise<boolean>
        remove: (id: number) => Promise<boolean>
        pause: () => Promise<boolean>
        resume: () => Promise<boolean>
        setConcurrent: (n: number) => Promise<boolean>
        onProgress: (cb: (data: any) => void) => () => void
        onStatusChange: (cb: (data: any) => void) => () => void
      }
      settings: {
        get: (key: string) => Promise<string | undefined>
        set: (key: string, value: string) => Promise<boolean>
        getSaveDir: () => Promise<string>
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
