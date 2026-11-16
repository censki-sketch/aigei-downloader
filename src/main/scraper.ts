import { getCookieString } from './browser.js'
import { log } from './debug-log.js'
import { parse, type HTMLElement } from 'node-html-parser'
import type { ResourceItem, ResourcePageResult } from '../shared/types.js'
import { AIGEI_ACCEPT_LANGUAGE, AIGEI_ORIGIN, AIGEI_UA } from '../shared/aigei-constants.js'

const AIGEI_URL = AIGEI_ORIGIN
const DETAIL_CACHE_TTL = 30 * 60 * 1000
const DETAIL_REQUEST_DELAY_MIN = 2000
const DETAIL_REQUEST_DELAY_MAX = 4000

const detailCache = new Map<string, { value: ItemPageData; expiresAt: number }>()
const pendingDetails = new Map<string, Promise<ItemPageData>>()
let detailRequestChain: Promise<void> = Promise.resolve()
let lastDetailRequestAt = 0

export interface ItemPageData extends ResourceItem {
  token: string
  extime: string
  fuid: string
  cccllpptttgt: string
  pIii111lllE: string
  vvvvvvviisssss: string
}

export async function scrapeListPage(listUrl: string): Promise<ResourceItem[]> {
  return (await scrapeResourcePage(listUrl)).items
}

export async function scrapeResourcePage(listUrl: string): Promise<ResourcePageResult> {
  const targetUrl = normalizeUrl(listUrl, AIGEI_URL) || listUrl
  const html = await fetchAigeiHtml(targetUrl)
  assertNotSecurityCheckPage(html)
  return parseResourcePage(html, targetUrl)
}

/** Parse only the current resource list; navigation and recommendations are not resources. */
export function parseResourcePage(html: string, currentUrl: string): ResourcePageResult {
  const root = parse(html)
  const container = root.querySelector('#searchContainer') || root.querySelector('#resContainer')
  const items = container ? parseResourceList(container, currentUrl) : []
  return { items, currentUrl, ...parsePagination(root, currentUrl) }
}

function parsePagination(root: HTMLElement, currentUrl: string): Omit<ResourcePageResult, 'items' | 'currentUrl'> {
  const currentPage = Number(root.querySelector('.pageInfo_currentPage')?.text.trim()) || extractPageNumber(currentUrl) || 1
  const totalPages = Number(root.querySelector('.pageInfo_totalPage')?.text.trim()) || undefined
  const pages = new Map<number, string>([[currentPage, currentUrl]])
  let previousUrl: string | undefined
  let nextUrl: string | undefined

  const container = root.querySelector('#resContainer')
  for (const button of container?.querySelectorAll('.f-pager a, .js-page-tag-btn, .pagination a, .pager a') || []) {
    if (button.classList.contains('disabled')) continue
    const label = `${button.text} ${button.getAttribute('title') || ''} ${button.getAttribute('class') || ''}`
    const href = normalizeUrl(button.getAttribute('href') || '', currentUrl)
    const page = Number(button.getAttribute('js-param-pagenum') ||
      button.getAttribute('js-page-tag-onclick')?.match(/clickChangePageNum\(['"](\d+)['"]/)?.[1]) ||
      (href ? extractPageNumber(href) : undefined)
    if (!page || page < 1) continue
    const url = href || buildPageUrl(currentUrl, page)
    pages.set(page, url)
    if (/上一页|prev/i.test(label)) previousUrl = url
    if (/下一页|next/i.test(label)) nextUrl = url
  }
  if (totalPages) {
    previousUrl = currentPage > 1 ? buildPageUrl(currentUrl, currentPage - 1) : undefined
    nextUrl = currentPage < totalPages ? buildPageUrl(currentUrl, currentPage + 1) : undefined
  }

  return {
    currentPage,
    totalPages,
    previousUrl,
    nextUrl,
    pages: [...pages].sort(([a], [b]) => a - b).map(([page, url]) => ({ page, url }))
  }
}

function buildPageUrl(currentUrl: string, page: number): string {
  let url: URL
  try {
    url = new URL(currentUrl, AIGEI_URL)
  } catch {
    url = new URL(AIGEI_URL)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    url = new URL(AIGEI_URL)
  }
  if (page <= 1) url.searchParams.delete('page')
  else url.searchParams.set('page', String(page))
  return url.toString()
}

function extractPageNumber(url: string): number | undefined {
  try {
    const parsed = new URL(url, AIGEI_URL)
    for (const key of ['page', 'p', 'pageNo', 'pageNum']) {
      const value = Number(parsed.searchParams.get(key))
      if (Number.isInteger(value) && value > 0) return value
    }
    // 只认真正的"页码段"：/page-4/、/page_4/、/page/4/、以及明确的 _p4 / -p4 结尾
    const pathMatch = parsed.pathname.match(
      /(?:^|\/)(?:page|p|pg)[-_/]?(\d+)(?:[/-]|\.html)?(?:$|\/)/i
    )
    if (pathMatch) {
      const value = Number(pathMatch[1])
      if (Number.isInteger(value) && value > 0) return value
    }
  } catch {
    // ignore malformed URL
  }
  return undefined
}

function parseResourceList(container: HTMLElement, baseUrl: string): ResourceItem[] {
  const results: ResourceItem[] = []
  const seen = new Set<string>()
  const cards = container.querySelectorAll('[id^="unitBox_item-"]')

  for (const card of cards) {
    const itemId = card.getAttribute('itemid') || card.id.replace('unitBox_item-', '')
    if (!itemId || seen.has(itemId)) continue
    const code = card.getAttribute('js-item-code')
    const link = card.querySelector('.item-view-url a')
    // Some archive cards have no anchor. Their item code is still a valid detail URL.
    const url = normalizeUrl(link?.getAttribute('href') || (code ? `/item/${encodeURIComponent(code)}.html` : ''), baseUrl)
    if (!url) continue
    seen.add(itemId)

    const context = card.outerHTML
    const name = card.querySelector('.resc-info-bottom-info-name')
    const title = cleanResourceTitle(name?.getAttribute('title') ||
      card.querySelector('.trans-title')?.text || link?.getAttribute('title') || link?.text || itemId)
    const fileType = inferFileType(url, baseUrl)
    const description = extractDescription(context)
    const tags = uniqueTexts([
      ...extractTagTexts(context),
      ...extractTagsFromDescription(description),
      ...extractTagsFromTitle(title)
    ])
    const categoryPath = inferCategoryPath(url, baseUrl, '', tags, title)
    // The "vip" wrapper class exists even on free cards. Only an explicit marker is evidence.
    const isVip = !!card.querySelector('[js-unit-isvip="true"]')
    const licenseType = isVip ? 'VIP' : extractLicenseType(card.querySelector('.js-item-box-license-mark-wrap')?.text || '')
    const size = card.querySelector('.item-info-bottom-file-size')

    results.push({
      itemId,
      title,
      thumbnail: extractImageUrl(card.querySelector('.mpic')?.outerHTML || context, baseUrl),
      url,
      detailUrl: url,
      sourceUrl: baseUrl,
      isVip,
      fileType,
      size: cleanText(size?.text) || extractSize(size?.getAttribute('title') || ''),
      previewUrl: extractMediaUrl(context, baseUrl),
      description,
      category: categoryPath[0],
      categoryPath,
      tags,
      licenseType,
      format: cleanText(card.querySelector('.format_desc')?.text)?.toUpperCase() || extractFormat('', title),
      duration: extractDuration(card.text),
      downloadCount: cleanText(card.querySelector('.item-info-bottom-down')?.text),
      uploadTime: extractUploadTime(card.text),
      metadata: { source: 'list' }
    })
  }

  log('SCRAPE', `parseResourceList: cards=${cards.length} kept=${results.length}`)
  return results
}

export async function scrapeItemPage(itemUrl: string): Promise<ItemPageData> {
  const targetUrl = normalizeUrl(itemUrl, AIGEI_URL) || itemUrl
  const cached = detailCache.get(targetUrl)
  if (cached && cached.expiresAt > Date.now()) return cached.value
  if (cached) detailCache.delete(targetUrl)

  const pending = pendingDetails.get(targetUrl)
  if (pending) return pending

  const request = queueDetailRequest(() => scrapeItemPageUncached(targetUrl))
  pendingDetails.set(targetUrl, request)
  try {
    const value = await request
    detailCache.set(targetUrl, { value, expiresAt: Date.now() + DETAIL_CACHE_TTL })
    return value
  } finally {
    pendingDetails.delete(targetUrl)
  }
}

async function scrapeItemPageUncached(targetUrl: string): Promise<ItemPageData> {
  const html = await fetchAigeiHtml(targetUrl)
  assertNotSecurityCheckPage(html)
  const extract = (name: string): string => {
    const regex = new RegExp(`${escapeRegExp(name)}\\s*[=:]\\s*['"]([^'"]+)['"]`)
    return html.match(regex)?.[1] || ''
  }

  const detailRoot = parse(html)
  const itemId = detailRoot.querySelector('.item-page-prev-container[itemid]')?.getAttribute('itemid') ||
    detailRoot.querySelector('input[id^=itemInfoToken_][itemid]')?.getAttribute('itemid') || extractItemId(targetUrl)
  const jsonLd = extractJsonLd(html)
  const metaTitle = cleanResourceTitle(
    stringValue(jsonLd?.name) ||
      extractMeta(html, 'og:title') ||
      html.match(/<title>([^<]*)<\/title>/i)?.[1] ||
      itemId
  )
  const description = firstText(
    stringValue(jsonLd?.description),
    extractMeta(html, 'description'),
    extractMeta(html, 'og:description')
  )
  const keywords = extractMeta(html, 'keywords')
  const thumbnail = normalizeUrl(
    stringValue(jsonLd?.thumbnailUrl) ||
      stringValue(jsonLd?.image) ||
      extractMeta(html, 'og:image') ||
      extractMeta(html, 'twitter:image') ||
      extractImageUrl(html, targetUrl),
    targetUrl
  )
  const tags = uniqueTexts([
    ...extractTagsFromDescription(description),
    ...splitTags(keywords),
    ...extractTagTexts(html),
    ...extractTagsFromTitle(metaTitle)
  ])
  const categoryPath = inferCategoryPath(targetUrl, targetUrl, html, tags, metaTitle)
  const inferredFileType = inferFileType(targetUrl, targetUrl, html)
  const fileType = inferredFileType === 'item' ? inferFileTypeFromCategory(categoryPath[0]) : inferredFileType

  return {
    itemId,
    title: metaTitle,
    thumbnail: thumbnail || '',
    url: targetUrl,
    detailUrl: targetUrl,
    isVip: /vip|会员/i.test(html),
    fileType,
    size: extractSize(description || html),
    previewUrl: extractMediaUrl(html, targetUrl),
    description,
    category: categoryPath[0],
    categoryPath,
    tags,
    licenseType: extractLicenseType(description || html),
    format: extractFormat(description || html, metaTitle),
    duration: extractDuration(description || html) || formatIsoDuration(stringValue(jsonLd?.duration)),
    downloadCount: extractDownloadCount(description || html),
    uploadTime: stringValue(jsonLd?.uploadDate) || stringValue(jsonLd?.datePublished) || extractUploadTime(html),
    author: extractAuthor(html),
    metadata: {
      source: 'detail',
      keywords,
      pageTitle: html.match(/<title>([^<]*)<\/title>/i)?.[1] || '',
      schemaType: stringValue(jsonLd?.['@type'])
    },
    token: extract('token'),
    extime: extract('extime') || extract('expireTime'),
    fuid: extract('fuid') || extract('fileUuid'),
    cccllpptttgt: extract('cccllpptttgt'),
    pIii111lllE: extract('pIii111lllE'),
    vvvvvvviisssss: extract('vvvvvvviisssss')
  }
}

function queueDetailRequest<T>(request: () => Promise<T>): Promise<T> {
  const result = detailRequestChain.then(async () => {
    const elapsed = Date.now() - lastDetailRequestAt
    const delay = randomBetween(DETAIL_REQUEST_DELAY_MIN, DETAIL_REQUEST_DELAY_MAX)
    if (elapsed < delay) await wait(delay - elapsed)
    lastDetailRequestAt = Date.now()
    return request()
  })
  detailRequestChain = result.then(() => undefined, () => undefined)
  return result
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchAigeiHtml(url: string): Promise<string> {
  let parsed: URL
  try {
    parsed = new URL(url, AIGEI_URL)
  } catch {
    throw new Error(`抓取请求失败 (无法解析 URL: ${url})`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`抓取请求失败 (非法协议 ${parsed.protocol}，期望 https)`)
  }
  const safeUrl = parsed.toString()
  const cookieString = await getCookieString()
  const headers: Record<string, string> = {
    'User-Agent': AIGEI_UA,
    'Accept-Language': AIGEI_ACCEPT_LANGUAGE,
    Accept:
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    Referer: AIGEI_ORIGIN + '/'
  }
  if (cookieString) headers.Cookie = cookieString
  let resp: Response
  try {
    resp = await fetch(safeUrl, { headers })
  } catch (err: any) {
    const cause = err?.cause
    const detail = cause?.code || cause?.message || cause?.name || err?.message || String(err)
    throw new Error(`抓取请求失败 (${detail}) URL=${safeUrl}`)
  }
  const html = await resp.text()
  if (isIpLimitedPage(resp.url, html)) {
    throw new Error('爱给网已限制当前 IP 的访问频率，抓取和下载已停止，请等待限制解除后再继续')
  }
  if (resp.status === 403 || resp.status === 429 || isSecurityCheckPage(html, resp.url)) {
    throw new Error('爱给网要求完成安全验证，请先到“网页登录验证”页完成验证后再抓取')
  }
  if (!resp.ok) {
    throw new Error(`抓取失败: HTTP ${resp.status}`)
  }
  return html
}

function assertNotSecurityCheckPage(html: string): void {
  if (isIpLimitedPage('', html)) {
    throw new Error('爱给网已限制当前 IP 的访问频率，抓取和下载已停止，请等待限制解除后再继续')
  }
  if (isSecurityCheckPage(html)) {
    throw new Error('爱给网要求完成安全验证，请先到“网页登录验证”页完成验证后再抓取')
  }
}

export function isAigeiAccessBlockedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '')
  return /安全验证|验证码|访问验证|限制当前 IP|限制.*频率|IP.*限制/.test(message)
}

export function isAigeiBlockedContent(url: string, content: string): boolean {
  return isIpLimitedPage(url, content) || isSecurityCheckPage(content, url)
}

function isSecurityCheckPage(html: string, url = ''): boolean {
  const text = stripHtml(html)
  return /verify|captcha|security|validate|safe|check|challenge/i.test(url) ||
    /通过验证以确保正常访问|自动.*完成验证|请点击下方按钮完成验证|请完成安全验证|请输入上图文字|验证码/.test(text)
}

function isIpLimitedPage(url: string, html: string): boolean {
  const text = stripHtml(html)
  return /\/banIp\/route/i.test(url) ||
    /休息会.*将在\s*\d+\s*秒后回来|访问过于频繁|IP地址.*(?:限制|频繁)|限制访问频率/.test(text)
}

function normalizeUrl(url: string, baseUrl: string): string {
  if (!url) return ''
  const trimmed = decodeHtml(url).trim()
  if (!trimmed || /^(?:javascript|data|mailto|tel|about|blob|file):/i.test(trimmed)) return ''
  try {
    const normalized = new URL(trimmed, baseUrl)
    if (normalized.protocol !== 'http:' && normalized.protocol !== 'https:') return ''
    normalized.hash = ''
    return normalized.toString()
  } catch {
    return ''
  }
}

function extractItemId(url: string): string {
  return (
    url.match(/\/(?:item|sound|music|video|3d|design|image|psd|game|course|software|ue|unity3d|game2d|game-code|cc-game|paint)\/([^/?#.]+)(?:\.html)?/i)?.[1] ||
    url
  )
}

function inferFileType(url: string, baseUrl: string, html = ''): string {
  const fromUrl = url.match(/\/(sound|music|video|3d|design|image|psd|game|course|software|ue|unity3d|game2d|game-code|cc-game|paint)\//i)?.[1]
  if (fromUrl) return normalizeFileType(fromUrl)

  const fromBaseUrl = baseUrl.match(/\/(sound|music|video|3d|design|image|psd|game|course|software|ue|unity3d|game2d|game-code|cc-game|paint)\//i)?.[1]
  if (fromBaseUrl) return normalizeFileType(fromBaseUrl)

  const fromScript =
    extractScriptValue(html, 'fileType') ||
    extractScriptValue(html, 'resType') ||
    extractScriptValue(html, 'type')
  return fromScript ? normalizeFileType(fromScript) : 'item'
}

function normalizeFileType(value: string): string {
  const lower = value.toLowerCase()
  if (lower === 'psd') return 'design'
  return lower
}

function inferFileTypeFromCategory(category?: string): string {
  const map: Record<string, string> = {
    音效: 'sound',
    配乐: 'music',
    视频: 'video',
    '3D': '3d',
    平面: 'design',
    图片: 'image',
    游戏: 'game',
    教程: 'course',
    软件: 'software'
  }
  return category ? map[category] || 'item' : 'item'
}

function inferCategoryPath(url: string, baseUrl: string, html = '', tags: string[] = [], title = ''): string[] {
  const source = `${url}\n${baseUrl}\n${title}\n${html.slice(0, 2000)}`
  const category = inferCategory(source)
  const selected = uniqueTexts([
    category,
    ...extractSelectedCategoryNames(html),
    ...tags.filter((tag) => tag.length <= 12).slice(0, 2)
  ])
  return selected.length > 0 ? selected : ['未分类']
}

function inferCategory(source: string): string {
  const tests: Array<[RegExp, string]> = [
    [/\/sound\/|音效库|音效素材/i, '音效'],
    [/\/music\/|配乐库|配乐素材|BGM/i, '配乐'],
    [/\/video\/|视频素材/i, '视频'],
    [/\/3d\/|3D|模型/i, '3D'],
    [/\/design\/|\/psd\/|平面|设计素材/i, '平面'],
    [/\/image\/|图片素材/i, '图片'],
    [/\/(?:game|ue|unity3d|game2d|game-code|cc-game|paint)\/|游戏素材/i, '游戏'],
    [/\/course\/|教程/i, '教程'],
    [/\/software\/|软件/i, '软件']
  ]
  return tests.find(([regex]) => regex.test(source))?.[1] || '未分类'
}

function extractSelectedCategoryNames(html: string): string[] {
  const selected: string[] = []
  const activeRegex = /<[^>]+class\s*=\s*["'][^"']*(?:active|selected|on)[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/gi
  let match
  while ((match = activeRegex.exec(html)) !== null && selected.length < 4) {
    const text = stripHtml(match[1])
    if (text && text.length <= 16 && !/热门|文件|专辑|全部/.test(text)) selected.push(text)
  }
  return selected
}

function extractImageUrl(html: string, baseUrl: string): string {
  const attrs = ['data-original', 'data-src', 'lazy-src', 'src', 'href']
  const candidates: string[] = []
  for (const attr of attrs) {
    candidates.push(...extractAttributes(html, attr))
  }
  candidates.push(...extractCssUrls(html))
  const image = candidates
    .map((candidate) => normalizeUrl(candidate, baseUrl))
    .find((candidate) => candidate && isUsefulImage(candidate))
  return image || ''
}

function extractMediaUrl(html: string, baseUrl: string): string {
  const namedCandidates: string[] = []
  const namedRegex = /(?:data-)?(?:audio|play|preview|music|sound)(?:-?(?:url|src|path))?\s*[=:]\s*["']([^"']+)["']/gi
  let namedMatch
  while ((namedMatch = namedRegex.exec(html)) !== null) namedCandidates.push(namedMatch[1])
  const candidates = [
    ...namedCandidates,
    ...extractAttributes(html, 'src'),
    ...extractAttributes(html, 'data-src'),
    ...extractAttributes(html, 'href'),
    ...extractCssUrls(html),
    ...(html.match(/https?:\/\/[^"'\s<>]+/gi) || [])
  ]
  const media = candidates
    .map((candidate) => normalizeUrl(candidate, baseUrl))
    .find((candidate) =>
      /\.(?:mp3|wav|ogg|m4a|aac)(?:[?#].*)?$/i.test(candidate) ||
      /(?:audio|sound|music|preview|play).*(?:url|stream|file)|(?:url|stream|file).*(?:audio|sound|music)/i.test(candidate)
    )
  return media || ''
}

function isUsefulImage(url: string): boolean {
  if (/logo|avatar|search-no-res|appdown|favicon|sprite|icon/i.test(url)) return false
  return /\.(?:jpg|jpeg|png|webp|gif)(?:[?#].*)?$/i.test(url) || /\/src\/img\//i.test(url)
}

function extractDescription(html: string): string | undefined {
  return (
    extractAttribute(html, 'data-desc') ||
    extractAttribute(html, 'description') ||
    extractAttribute(html, 'content') ||
    stripHtml(html.match(/<(?:p|div|span)[^>]*class\s*=\s*["'][^"']*(?:desc|intro|summary)[^"']*["'][^>]*>([\s\S]*?)<\/(?:p|div|span)>/i)?.[1])
  )
}

function extractTagTexts(html: string): string[] {
  const tags: string[] = []
  const tagRegex = /<(?:a|span|em)[^>]*(?:class|data-[^=]+)\s*=\s*["'][^"']*(?:tag|label|keyword|cate|category)[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|span|em)>/gi
  let match
  while ((match = tagRegex.exec(html)) !== null) {
    tags.push(stripHtml(match[1]))
  }
  return uniqueTexts(tags)
}

function extractTagsFromDescription(description?: string): string[] {
  if (!description) return []
  const tags: string[] = []
  const more = description.match(/更多([^，。]+)/)
  if (more) tags.push(...splitTags(more[1]))
  const afterNeedle = description.match(/(?:标签|关键词)[:：]\s*([^，。]+)/)
  if (afterNeedle) tags.push(...splitTags(afterNeedle[1]))
  return uniqueTexts(tags)
}

function extractTagsFromTitle(title?: string): string[] {
  if (!title) return []
  const insideParentheses = title.match(/[（(]([^）)]+)[）)]/)?.[1]
  return uniqueTexts(splitTags(insideParentheses))
}

function splitTags(value?: string): string[] {
  if (!value) return []
  return value
    .split(/[,，、/|;；\s]+/)
    .map((item) => cleanText(item))
    .filter((item): item is string => !!item && item.length > 1 && item.length < 24 && !/爱给|免费|下载/.test(item))
}

function extractLicenseType(html: string): string | undefined {
  if (/版权/.test(html)) return '版权'
  if (/vip|VIP|会员/.test(html)) return 'VIP'
  if (/免费|免费下载/.test(html)) return '免费'
  return undefined
}

function extractFormat(html: string, title = ''): string | undefined {
  const value =
    extractFromText(html, /格式\s*[:：]?\s*([a-z0-9]+)/i) ||
    extractFromText(title, /_([a-z0-9]{2,5})(?:\s*-|$)/i) ||
    extractFromText(`${html} ${title}`, /\b(mp3|wav|ogg|m4a|aac|zip|rar|png|jpg|jpeg|psd|ai|mp4|mov|fbx|obj)\b/i)
  return value?.toUpperCase()
}

function extractDuration(html: string): string | undefined {
  return extractFromText(html, /时长\s*[:：]?\s*([0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?)/)
}

function extractSize(html: string): string | undefined {
  return extractFromText(html, /(?:体积|大小|容量)\s*[:：]?\s*([0-9.]+\s*(?:B|K|KB|M|MB|G|GB|k|m|g)?)/i)
}

function extractDownloadCount(html: string): string | undefined {
  return extractFromText(html, /已下载\s*([0-9,.万wW]+)\s*次?/i) || extractFromText(html, /下载\s*([0-9,.万wW]+)\s*次/i)
}

function extractUploadTime(html: string): string | undefined {
  return extractFromText(html, /(?:上传|发布)时间?\s*[:：]?\s*([0-9]{4}[-/年][0-9]{1,2}[-/月][0-9]{1,2})/)
}

function extractAuthor(html: string): string | undefined {
  return (
    extractTextByClass(html, 'author') ||
    extractTextByClass(html, 'username') ||
    extractFromText(html, /(?:作者|上传者|供稿人)\s*[:：]?\s*([^\s，。<]+)/)
  )
}

function extractMeta(html: string, key: string): string | undefined {
  const metaRegex = new RegExp(
    `<meta\\s+[^>]*(?:name|property)\\s*=\\s*["']${escapeRegExp(key)}["'][^>]*content\\s*=\\s*["']([^"']*)["'][^>]*>`,
    'i'
  )
  const reversedRegex = new RegExp(
    `<meta\\s+[^>]*content\\s*=\\s*["']([^"']*)["'][^>]*(?:name|property)\\s*=\\s*["']${escapeRegExp(key)}["'][^>]*>`,
    'i'
  )
  return cleanText(html.match(metaRegex)?.[1] || html.match(reversedRegex)?.[1])
}

function extractJsonLd(html: string): Record<string, unknown> | undefined {
  const match = html.match(/<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i)
  if (!match) return undefined
  try {
    const parsed = JSON.parse(decodeHtml(match[1].trim()))
    return Array.isArray(parsed) ? parsed[0] : parsed
  } catch {
    return undefined
  }
}

function extractTextByClass(html: string, className: string): string | undefined {
  const regex = new RegExp(
    `<[^>]+class\\s*=\\s*["'][^"']*${escapeRegExp(className)}[^"']*["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`,
    'i'
  )
  return stripHtml(html.match(regex)?.[1])
}

function extractScriptValue(html: string, name: string): string {
  const match = html.match(new RegExp(`(?:var\\s+)?${escapeRegExp(name)}\\s*=\\s*['"]([^'"]+)['"]`, 'i'))
  return match?.[1]?.trim() || ''
}

function extractAttributes(html: string, attr: string): string[] {
  const values: string[] = []
  const regex = new RegExp(`${escapeRegExp(attr)}\\s*=\\s*["']([^"']+)["']`, 'gi')
  let match
  while ((match = regex.exec(html)) !== null) values.push(decodeHtml(match[1]))
  return values
}

function extractAttribute(html: string, attr: string): string {
  return cleanText(extractAttributes(html, attr)[0]) || ''
}

function extractCssUrls(html: string): string[] {
  const values: string[] = []
  const regex = /url\((['"]?)(.*?)\1\)/gi
  let match
  while ((match = regex.exec(html)) !== null) values.push(decodeHtml(match[2]))
  return values
}

function extractFromText(value: string | undefined, regex: RegExp): string | undefined {
  return cleanText(value?.match(regex)?.[1])
}

function stripHtml(html?: string): string {
  return cleanText((html || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')) || ''
}

function cleanResourceTitle(value?: string): string {
  return (
    cleanText(value)
      ?.replace(/\s*[-_]\s*(?:SQ)?无损\s*[-_]\s*[a-z0-9]+/i, '')
      .replace(/\s*[-_]\s*(?:音效库|配乐库|视频素材|平面素材|3D模型|游戏素材|教程)\s*[-_]\s*爱给网\s*$/i, '')
      .replace(/\s*-\s*爱给网\s*$/i, '')
      .trim() || ''
  )
}

function cleanText(value?: string): string | undefined {
  if (!value) return undefined
  const cleaned = decodeHtml(decodeJsEscapes(value))
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned || undefined
}

function firstText(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const cleaned = cleanText(value)
    if (cleaned) return cleaned
  }
  return undefined
}

function uniqueTexts(values: Array<string | undefined>): string[] {
  const seen = new Set<string>()
  const output: string[] = []
  for (const value of values) {
    const cleaned = cleanText(value)
    if (!cleaned || seen.has(cleaned)) continue
    seen.add(cleaned)
    output.push(cleaned)
  }
  return output
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0]
  if (value && typeof value === 'object' && 'url' in value && typeof (value as { url?: unknown }).url === 'string') {
    return (value as { url: string }).url
  }
  return undefined
}

function formatIsoDuration(value?: string): string | undefined {
  const match = value?.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i)
  if (!match) return undefined
  const hours = Number(match[1] || 0)
  const minutes = Number(match[2] || 0)
  const seconds = Number(match[3] || 0)
  const total = hours * 3600 + minutes * 60 + seconds
  if (!total) return undefined
  const hh = Math.floor(total / 3600)
  const mm = Math.floor((total % 3600) / 60)
  const ss = total % 60
  return hh > 0
    ? `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
    : `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
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
