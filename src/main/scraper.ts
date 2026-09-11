import { getCookieString } from './browser.js'
import type { ResourceItem } from '../shared/types.js'

/**
 * 抓取列表页资源（用 Node.js fetch + session cookie，不用 Playwright）
 */
export async function scrapeListPage(listUrl: string): Promise<ResourceItem[]> {
  const cookieString = await getCookieString()
  const resp = await fetch(listUrl, {
    headers: {
      Cookie: cookieString,
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    }
  })
  const html = await resp.text()
  return parseResourceList(html, listUrl)
}

/**
 * 从 HTML 解析资源列表
 */
function parseResourceList(html: string, baseUrl: string): ResourceItem[] {
  const results: ResourceItem[] = []
  const seen = new Set<string>()

  // 匹配爱给资源链接：/sound/xxx.html, /video/xxx.html 等
  const linkRegex = /href="(https?:\/\/[^"]*\/(sound|video|3d|image|psd|game|software)\/[^"]+\.html)"/g
  let match

  while ((match = linkRegex.exec(html)) !== null) {
    const url = match[1]
    if (seen.has(url)) continue
    seen.add(url)

    const fileType = match[2]
    const itemId = url.match(/\/([^/.]+)\.html/)?.[1] || url

    // 从 HTML 中提取该链接附近的标题和缩略图
    const linkIndex = html.indexOf(match[0])
    const context = html.substring(Math.max(0, linkIndex - 500), linkIndex + 200)

    const titleMatch = context.match(/title="([^"]+)"/) || context.match(/<img[^>]*alt="([^"]+)"/)
    const thumbMatch = context.match(/<img[^>]*src="([^"]+)"/)
    const vipMatch = context.match(/vip|VIP/i)

    results.push({
      itemId,
      title: titleMatch?.[1] || '',
      thumbnail: thumbMatch?.[1] || '',
      url,
      isVip: !!vipMatch,
      fileType,
      size: undefined
    })
  }

  return results
}

/**
 * 抓取资源详情页，提取下载加密参数
 */
export async function scrapeItemPage(itemUrl: string): Promise<{
  itemId: string
  fileType: string
  token: string
  extime: string
  fuid: string
  cccllpptttgt: string
  pIii111lllE: string
  vvvvvvviisssss: string
  title: string
}> {
  const cookieString = await getCookieString()
  const resp = await fetch(itemUrl, {
    headers: {
      Cookie: cookieString,
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    }
  })
  const html = await resp.text()

  const extract = (name: string): string => {
    const regex = new RegExp(`${name}\\s*[=:]\\s*['"]([^'"]+)['"]`)
    return html.match(regex)?.[1] || ''
  }

  const match = itemUrl.match(/\/(sound|video|3d|image|psd|game|software)\/([^/.]+)\.html/)
  const fileType = match?.[1] || 'audio_mp3'
  const itemId = match?.[2] || itemUrl

  return {
    itemId,
    fileType,
    token: extract('token'),
    extime: extract('extime') || extract('expireTime'),
    fuid: extract('fuid') || extract('fileUuid'),
    cccllpptttgt: extract('cccllpptttgt'),
    pIii111lllE: extract('pIii111lllE'),
    vvvvvvviisssss: extract('vvvvvvviisssss'),
    title: html.match(/<title>([^<]*)<\/title>/)?.[1] || ''
  }
}
