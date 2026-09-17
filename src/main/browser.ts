import { session } from 'electron'
import { clearCookies, saveCookie } from './db.js'
import { log } from './debug-log.js'
import type { LoginStatus } from '../shared/types.js'

const AIGEI_HOST = 'www.aigei.com'
const AIGEI_URL = 'https://www.aigei.com'
const AIGEI_HOME_URL = 'https://www.aigei.com/home/'

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
export async function getCookies(): Promise<{ name: string; value: string; expirationDate?: number }[]> {
  return await session.defaultSession.cookies.get({ url: AIGEI_URL })
}

/**
 * 检查登录状态：用 Node.js fetch 访问个人中心，看是否跳转到登录页
 * 不用 Playwright，直接用 session cookie 发请求
 */
export async function checkLoginStatus(): Promise<LoginStatus> {
  try {
    const cookieString = await getCookieString()
    if (!cookieString) return { isLoggedIn: false }

    // 用 session cookie 访问个人中心
    const resp = await fetch(AIGEI_HOME_URL, {
      headers: {
        Cookie: cookieString,
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
      },
      redirect: 'manual' // 不自动跟随重定向，手动检查
    })

    // 如果被重定向到登录页，说明未登录。爱给网未登录时也会下发匿名 SESSION，不能把 SESSION 当登录证据。
    if (isRedirect(resp.status)) {
      const location = resp.headers.get('location') || ''
      if (isLoginUrl(location)) {
        log('LOGIN', `未登录：/home/ 重定向到 ${location}`)
        return { isLoggedIn: false }
      }
    }

    if (resp.status === 200) {
      const html = await resp.text()
      const identity = parseLoginIdentity(html)
      if (!identity.isLoggedIn) {
        log('LOGIN', '未登录：未检测到可靠用户身份标记')
        return { isLoggedIn: false }
      }

      return { isLoggedIn: true, ...parseLoginProfile(html, identity) }
    }

    return { isLoggedIn: false }
  } catch {
    return { isLoggedIn: false }
  }
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
}

function isLoginUrl(url: string): boolean {
  return /\/user\/login\/page/i.test(url) || /\/login/i.test(url)
}

function parseLoginIdentity(html: string): { isLoggedIn: boolean; userId?: string; username?: string } {
  const isLogin = extractBooleanAssignment(html, 'isLogin')
  const userId = firstText(
    extractStringAssignment(html, 'loginUserId'),
    extractTextById(html, 'myGeiId'),
    extractStringAssignment(html, 'myGeiId')
  )
  const username = firstText(
    extractStringAssignment(html, 'loginUserName'),
    extractTextById(html, 'loginUserInfoName'),
    extractTextById(html, 'myNickName'),
    extractStringAssignment(html, 'loginUserInfoName'),
    extractStringAssignment(html, 'myNickName')
  )

  if (isLogin === false) return { isLoggedIn: false }
  if (isLogin === true) {
    return {
      isLoggedIn: true,
      userId,
      username: username || userId || undefined
    }
  }
  if (userId || username) {
    return { isLoggedIn: true, userId, username: username || userId }
  }
  if (isLoginPage(html)) return { isLoggedIn: false }

  return { isLoggedIn: false }
}

function parseLoginProfile(
  html: string,
  identity: { userId?: string; username?: string }
): Omit<LoginStatus, 'isLoggedIn'> {
  const userId = firstText(
    identity.userId,
    extractTextById(html, 'myGeiId'),
    extractStringAssignment(html, 'myGeiId'),
    extractStringAssignment(html, 'loginUserId')
  )
  const username = firstText(
    extractTextById(html, 'loginUserInfoName'),
    extractTextById(html, 'myNickName'),
    extractStringAssignment(html, 'loginUserName'),
    extractStringAssignment(html, 'loginUserInfoName'),
    extractStringAssignment(html, 'myNickName'),
    identity.username,
    userId,
    '已登录'
  )
  const vipName = firstText(
    extractTextById(html, 'myVipName'),
    extractStringAssignment(html, 'myVipName'),
    extractStringAssignment(html, 'userVipName'),
    extractFromHtml(html, /会员等级[^<]*<\/[^>]+>\s*<[^>]+>([^<]+)/i),
    extractFromHtml(html, /VIP[^<]*<\/[^>]+>\s*<[^>]+>([^<]+)/i)
  )
  const isVip = extractBooleanAssignment(html, 'userIsVip')
  const vipLevel = vipName || (isVip ? 'VIP' : undefined)
  const coins = extractCoins(html)

  return { userId, username, vipLevel, coins }
}

function extractStringAssignment(html: string, name: string): string | undefined {
  const regex = new RegExp(`(?:var\\s+)?${escapeRegExp(name)}\\s*=\\s*(['"])(.*?)\\1`, 'is')
  const value = html.match(regex)?.[2]
  return cleanText(value)
}

function extractBooleanAssignment(html: string, name: string): boolean | undefined {
  const regex = new RegExp(`(?:var\\s+)?${escapeRegExp(name)}\\s*=\\s*([^;\\n]+)`, 'i')
  const expression = html.match(regex)?.[1]?.trim()
  if (!expression) return undefined

  const equalsTrue = expression.match(/['"]?(true|false)['"]?\s*==\s*['"]?true['"]?/i)
  if (equalsTrue) return equalsTrue[1].toLowerCase() === 'true'

  const literal = expression.match(/^['"]?(true|false)['"]?$/i)
  if (literal) return literal[1].toLowerCase() === 'true'

  return undefined
}

function isLoginPage(html: string): boolean {
  return (
    /currentPageUrl\s*=\s*['"]\/user\/login\/page/i.test(html) ||
    /<title>[^<]*用户登录/i.test(html) ||
    /id=["']loginBtn["']/i.test(html)
  )
}

function extractFromHtml(html: string, regex: RegExp): string | undefined {
  const m = html.match(regex)
  return cleanText(m?.[1])
}

function extractTextById(html: string, id: string): string | undefined {
  const regex = new RegExp(
    `<([a-z0-9:-]+)(?=[^>]*\\bid\\s*=\\s*["']${escapeRegExp(id)}["'])[^>]*>([\\s\\S]*?)<\\/\\1>`,
    'i'
  )
  return (
    cleanText(html.match(regex)?.[2]) ||
    extractAttributeById(html, id, 'value') ||
    extractAttributeById(html, id, 'title')
  )
}

function extractAttributeById(html: string, id: string, attr: string): string | undefined {
  const regex = new RegExp(
    `<[a-z0-9:-]+(?=[^>]*\\bid\\s*=\\s*["']${escapeRegExp(id)}["'])[^>]*\\b${escapeRegExp(attr)}\\s*=\\s*["']([^"']*)["'][^>]*>`,
    'i'
  )
  return cleanText(html.match(regex)?.[1])
}

function extractCoins(html: string): number | undefined {
  const candidates = [
    extractTextById(html, 'myCoin'),
    extractStringAssignment(html, 'userTotalFundDown'),
    extractFromHtml(html, /我的铜币\s*[:：]?\s*([0-9,]+(?:\.\d+)?)/i),
    extractFromHtml(html, /铜币\s*[:：]?\s*([0-9,]+(?:\.\d+)?)/i)
  ]

  for (const candidate of candidates) {
    const value = parseNumber(candidate)
    if (value !== undefined) return value
  }
  return undefined
}

function parseNumber(value?: string): number | undefined {
  const match = value?.replace(/,/g, '').match(/\d+(?:\.\d+)?/)
  if (!match) return undefined
  const num = Number(match[0])
  return Number.isFinite(num) ? num : undefined
}

function firstText(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const cleaned = cleanText(value)
    if (cleaned) return cleaned
  }
  return undefined
}

function cleanText(value?: string): string | undefined {
  if (!value) return undefined
  const cleaned = decodeHtml(decodeJsEscapes(value))
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned || undefined
}

function decodeJsEscapes(value: string): string {
  return value
    .replace(/\\u([\da-fA-F]{4})/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\x([\da-fA-F]{2})/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)))
}

function decodeHtml(value: string): string {
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' '
  }

  return value
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([\da-fA-F]+);/g, (_m, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => named[name.toLowerCase()] || m)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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
  const status = await checkLoginStatus()
  if (!status.isLoggedIn) return false

  const cookies = await getCookies()
  clearCookies()
  for (const c of cookies) saveCookie(AIGEI_HOST, c.name, c.value, c.expirationDate)
  return true
}
export async function checkSessionLogin(): Promise<boolean> {
  const status = await checkLoginStatus()
  return status.isLoggedIn
}
export async function openLoginWindow(): Promise<boolean> {
  return false
}
export async function syncCookiesFromSession(): Promise<void> {}
