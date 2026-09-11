import { session } from 'electron'
import { clearCookies } from './db.js'
import { log } from './debug-log.js'

const AIGEI_HOST = 'www.aigei.com'
const AIGEI_URL = 'https://www.aigei.com'

/**
 * 获取爱给网 Cookie 字符串（从 Electron session，webview 登录后自动有）
 */
export async function getCookieString(): Promise<string> {
  const cookies = await session.defaultSession.cookies.get({ url: AIGEI_URL })
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ')
}

/**
 * 获取爱给网 Cookie 对象数组
 */
export async function getCookies(): Promise<{ name: string; value: string }[]> {
  return await session.defaultSession.cookies.get({ url: AIGEI_URL })
}

/**
 * 检查登录状态：用 Node.js fetch 访问个人中心，看是否跳转到登录页
 * 不用 Playwright，直接用 session cookie 发请求
 */
export async function checkLoginStatus(): Promise<{
  isLoggedIn: boolean
  username?: string
  vipLevel?: string
  coins?: number
}> {
  try {
    const cookieString = await getCookieString()
    if (!cookieString) return { isLoggedIn: false }

    // 检查是否有 SESSION cookie
    const cookies = await getCookies()
    const hasSession = cookies.some((c) => c.name === 'SESSION' && c.value.length > 0)
    if (!hasSession) return { isLoggedIn: false }

    // 用 session cookie 访问个人中心
    const resp = await fetch('https://www.aigei.com/home/', {
      headers: {
        Cookie: cookieString,
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
      },
      redirect: 'manual' // 不自动跟随重定向，手动检查
    })

    // 如果被重定向到登录页（状态码 302），说明未登录
    if (resp.status === 302 || resp.status === 301) {
      const location = resp.headers.get('location') || ''
      if (location.includes('/login')) return { isLoggedIn: false }
    }

    // 200 说明已登录，解析用户信息
    if (resp.status === 200) {
      const html = await resp.text()
      // 从 HTML 提取用户名、会员等级、铜币
      const username = extractFromHtml(html, /昵称[^>]*>([^<]+)/) || extractFromHtml(html, /user-name[^>]*>([^<]+)/) || '已登录'
      const vipLevel = extractFromHtml(html, /VIP[^>]*>([^<]+)/) || extractFromHtml(html, /会员[^>]*>([^<]+)/) || undefined
      const coinsMatch = html.match(/铜币[^<]*?(\d+)/)
      const coins = coinsMatch ? Number(coinsMatch[1]) : undefined

      return { isLoggedIn: true, username, vipLevel, coins }
    }

    return { isLoggedIn: false }
  } catch {
    return { isLoggedIn: false }
  }
}

function extractFromHtml(html: string, regex: RegExp): string | undefined {
  const m = html.match(regex)
  return m?.[1]?.trim()
}

/**
 * 退出登录：彻底清除 Electron session 所有 cookie
 */
export async function logoutClearAll(): Promise<void> {
  try {
    await session.defaultSession.clearStorageData({
      storages: ['cookies']
    })
  } catch { /* ignore */ }
  clearCookies()
}

// 保留兼容接口（空实现，不再用 Playwright）
export async function closeBrowser(): Promise<void> {}
export async function saveSessionCookies(): Promise<boolean> {
  const cookies = await getCookies()
  return cookies.length > 0
}
export async function checkSessionLogin(): Promise<boolean> {
  const cookies = await getCookies()
  return cookies.some((c) => c.name === 'SESSION' && c.value.length > 0)
}
export async function openLoginWindow(): Promise<boolean> {
  return false
}
export async function syncCookiesFromSession(): Promise<void> {}
