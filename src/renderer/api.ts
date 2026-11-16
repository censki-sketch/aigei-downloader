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
        getQueueState: () => Promise<any>
        retry: (id: string) => Promise<boolean>
        remove: (id: string) => Promise<boolean>
        pause: () => Promise<boolean>
        resume: () => Promise<boolean>
        setConcurrent: (n: number) => Promise<boolean>
        clearCompleted: () => Promise<boolean>
        clearInactive: () => Promise<number>
        onProgress: (cb: (data: any) => void) => () => void
        onStatusChange: (cb: (data: any) => void) => () => void
        onQueueState: (cb: (data: any) => void) => () => void
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

const bridge = window.aigei

export const api = {
  ...bridge,
  download: {
    ...bridge.download,
    async clearInactive(): Promise<number> {
      if (typeof bridge.download.clearInactive === 'function') {
        try {
          return await bridge.download.clearInactive()
        } catch (error: any) {
          // 开发热更新可能只更新了 preload，主进程尚未注册新通道。
          if (!/No handler registered for ['"]download:clearInactive['"]/.test(String(error?.message || error))) {
            throw error
          }
        }
      }

      // 渲染进程热更新不会替换已加载的 contextBridge；兼容旧窗口已有的接口。
      // 先暂停调度，再重新读取任务，避免等待任务在逐条清除时开始执行。
      const state = await bridge.download.getQueueState()
      if (!state.paused) await bridge.download.pause()
      try {
        const tasks = await bridge.download.list()
        const removable = tasks.filter((task: any) => task.status !== 'downloading')
        for (const task of removable) await bridge.download.remove(task.id)
        return removable.length
      } finally {
        if (!state.paused) await bridge.download.resume()
      }
    }
  }
}
