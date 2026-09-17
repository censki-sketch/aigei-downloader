import { BrowserWindow, session } from 'electron'
import { checkLoginStatus, saveSessionCookies } from './browser.js'
import { log } from './debug-log.js'

let isMonitoring = false
let loginNotified = false
let loginCheckInFlight = false

export function startLoginMonitor(): void {
  if (isMonitoring) return
  isMonitoring = true
  log('MONITOR', '启动登录监听（监听登录相关请求，成功前会二次校验）')

  // 只监听登录回调相关的 URL，不监听首页（首页也设匿名SESSION）
  session.defaultSession.webRequest.onCompleted(
    {
      urls: [
        'https://*.aigei.com/*callback*',
        'https://*.aigei.com/*connect*',
        'https://*.aigei.com/*oauth*',
        'https://*.aigei.com/*auth*',
        'https://*.aigei.com/*qq*',
        'https://*.aigei.com/*sms*',
        'https://*.aigei.com/*phone*',
        'https://*.aigei.com/*verify*',
        'https://*.aigei.com/*code*',
        'https://*.aigei.com/*login*do*',
        'https://*.aigei.com/*login*check*',
        'https://*.aigei.com/*login*success*',
        'https://graph.qq.com/*',
        'https://*.ptlogin2.qq.com/*'
      ]
    },
    async (details) => {
      const headers = details.responseHeaders || {}
      const setCookies: string[] = []
      for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() === 'set-cookie') {
          if (Array.isArray(value)) setCookies.push(...value)
          else setCookies.push(String(value))
        }
      }

      const hasSession = setCookies.some((c: string) => c.includes('SESSION=') && !c.includes('SESSION=;'))
      log('NETWORK', `${details.statusCode} ${details.url} | SESSION=${hasSession} | ${setCookies.length > 0 ? JSON.stringify(setCookies.slice(0, 2)) : 'none'}`)

      void verifyLoginAndNotify(details.url).catch((err: any) => {
        log('MONITOR', `登录校验异常：${err?.message || String(err)}`)
      })
    }
  )
}

export function resetLoginMonitor(): void {
  loginNotified = false
  loginCheckInFlight = false
  log('MONITOR', '重置登录状态')
}

async function verifyLoginAndNotify(sourceUrl: string): Promise<void> {
  if (loginNotified || loginCheckInFlight) return
  loginCheckInFlight = true

  try {
    const status = await waitForConfirmedLogin()
    if (!status.isLoggedIn || loginNotified) {
      log('MONITOR', `登录相关请求未通过真实登录校验：${sourceUrl}`)
      return
    }

    const saved = await saveSessionCookies()
    if (!saved) {
      log('MONITOR', `登录已校验通过，但 Cookie 保存失败，等待下一次登录事件：${sourceUrl}`)
      return
    }

    loginNotified = true
    log('MONITOR', `>>> 检测到真实登录成功！URL: ${sourceUrl}`)
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
        win.webContents.send('login:success', status)
      }
    })
  } finally {
    loginCheckInFlight = false
  }
}

async function waitForConfirmedLogin(): Promise<{
  isLoggedIn: boolean
  userId?: string
  username?: string
  vipLevel?: string
  coins?: number
}> {
  let latest = { isLoggedIn: false } as {
    isLoggedIn: boolean
    userId?: string
    username?: string
    vipLevel?: string
    coins?: number
  }
  for (let i = 0; i < 6; i++) {
    latest = await checkLoginStatus()
    if (latest.isLoggedIn) return latest
    await delay(500)
  }
  return latest
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
