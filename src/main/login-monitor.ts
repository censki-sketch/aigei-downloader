import { app, BrowserWindow, session } from 'electron'
import { saveCookie, clearCookies } from './db.js'
import { log } from './debug-log.js'

const AIGEI_HOST = 'www.aigei.com'
const AIGEI_URL = 'https://www.aigei.com'
let isMonitoring = false
let loginNotified = false

export function startLoginMonitor(): void {
  if (isMonitoring) return
  isMonitoring = true
  log('MONITOR', '启动登录监听（只监听登录回调URL）')

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
      const setCookies = []
      for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() === 'set-cookie') {
          if (Array.isArray(value)) setCookies.push(...value)
          else setCookies.push(String(value))
        }
      }

      const hasSession = setCookies.some((c: string) => c.includes('SESSION=') && !c.includes('SESSION=;'))
      log('NETWORK', `${details.statusCode} ${details.url} | SESSION=${hasSession} | ${setCookies.length > 0 ? JSON.stringify(setCookies.slice(0, 2)) : 'none'}`)

      if (hasSession && !loginNotified) {
        loginNotified = true
        log('MONITOR', `>>> 检测到登录成功！URL: ${details.url}`)
        const cookies = await session.defaultSession.cookies.get({ url: AIGEI_URL })
        clearCookies()
        for (const c of cookies) saveCookie(AIGEI_HOST, c.name, c.value, c.expirationDate)
        BrowserWindow.getAllWindows().forEach((win) => {
          if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
            win.webContents.send('login:success')
          }
        })
      }
    }
  )
}

export function resetLoginMonitor(): void {
  loginNotified = false
  log('MONITOR', '重置登录状态')
}
