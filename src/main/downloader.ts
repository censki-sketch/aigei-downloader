import { closeSync, createWriteStream, existsSync, mkdirSync, openSync, readSync, statSync, renameSync, unlinkSync } from 'fs'
import { dirname, join } from 'path'
import { app } from 'electron'
import { getCookieString } from './browser.js'
import { isAigeiBlockedContent, scrapeItemPage } from './scraper.js'
import { dfu, cqbj, cupie, decryptResponse } from './aigei-encrypt.js'

export interface DownloadResult {
  success: boolean
  filePath?: string
  error?: string
  fileSize?: number
  retryable?: boolean
}

export function getDefaultSaveDir(): string {
  return join(app.getPath('downloads'), 'AigeiDownloader')
}

/**
 * 下载单个资源（纯 Node.js fetch，不用 Playwright）
 */
export async function downloadItem(
  itemUrl: string,
  title: string,
  archivePath: string,
  onProgress?: (downloaded: number, total: number, speed: number) => void
): Promise<DownloadResult> {
  const cookieString = await getCookieString()
  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

  try {
    // 1. 抓取资源页，提取加密参数
    const pageData = await scrapeItemPage(itemUrl)
    const { itemId, fileType, token, extime, fuid, cccllpptttgt, pIii111lllE, vvvvvvviisssss } = pageData

    // 2. 用本地加密函数生成请求参数
    const encrypted = dfu(fileType, itemId, extime, token, vvvvvvviisssss)
    encrypted.rescUrl = itemId
    encrypted.isc = false
    encrypted.ilg = false
    encrypted.confirm = false
    encrypted.downUuid = fuid
    const requestBody = cqbj(encrypted)
    const etag = cupie(`${encrypted.ud}-${pIii111lllE}`)

    // 3. POST 下载接口
    const apiUrl = `https://www.aigei.com/f/d/${fileType}`
    const resp = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        Cookie: cookieString,
        'User-Agent': ua,
        Referer: itemUrl,
        cccllpptttgt,
        'x-requested-etag': etag
      },
      body: requestBody
    })
    const respText = await resp.text()

    // 4. 解密响应，获取真实下载链接
    let downloadUrl = decryptResponse(respText)
    if (!downloadUrl || !downloadUrl.startsWith('http')) {
      // 尝试从 JSON 提取
      try {
        const json = JSON.parse(respText)
        downloadUrl = json.url || json.message || json.data?.url || ''
      } catch {
        const m = respText.match(/https?:\/\/[^\s"'<>]+/)
        downloadUrl = m?.[0] || ''
      }
    }

    if (!downloadUrl || !downloadUrl.startsWith('http')) {
      throw new Error('无法获取下载链接，可能需要重新登录或加密逻辑已更新')
    }

    // 5. 下载文件（带进度 + 断点续传）
    const savePath = archivePath
    const tempPath = `${savePath}.tmp`
    mkdirSync(dirname(savePath), { recursive: true })

    let resumeFrom = 0
    if (existsSync(tempPath)) {
      if (isZipFile(tempPath)) resumeFrom = statSync(tempPath).size
      else unlinkSync(tempPath)
    }

    const dlHeaders: Record<string, string> = {
      Referer: 'https://www.aigei.com/',
      'User-Agent': ua,
      Cookie: cookieString
    }
    if (resumeFrom > 0) dlHeaders['Range'] = `bytes=${resumeFrom}-`

    let dlResp = await fetch(downloadUrl, { headers: dlHeaders })
    if (!dlResp.ok && dlResp.status !== 206 && dlResp.status !== 200) {
      throw new Error(`下载失败: HTTP ${dlResp.status}`)
    }
    if (resumeFrom > 0 && dlResp.status === 200) {
      resumeFrom = 0
      dlResp = await fetch(downloadUrl, {
        headers: {
          Referer: 'https://www.aigei.com/',
          'User-Agent': ua,
          Cookie: cookieString
        }
      })
    }

    const contentType = dlResp.headers.get('content-type') || ''
    if (/text\/html|application\/json|text\/plain/i.test(contentType)) {
      const body = await dlResp.text()
      if (isAigeiBlockedContent(dlResp.url, body)) {
        throw new Error('爱给网要求验证或已限制访问频率，下载队列已暂停')
      }
      throw new Error('下载接口返回了网页而不是 ZIP 文件，请重新登录后再试')
    }

    const totalBytes = Number(dlResp.headers.get('content-length') || 0) + resumeFrom
    const reader = dlResp.body?.getReader()
    if (!reader) throw new Error('无法读取下载流')

    const initialChunks = resumeFrom > 0 ? [] : await readZipPrefix(reader)
    if (resumeFrom === 0 && !isZipHeader(Buffer.concat(initialChunks.map((chunk) => Buffer.from(chunk))))) {
      await reader.cancel()
      throw new Error('下载内容不是有效的 ZIP 文件，可能是登录失效、验证页或访问频率受限')
    }

    const fileStream = createWriteStream(tempPath, { flags: resumeFrom > 0 ? 'a' : 'w' })
    let downloadedBytes = resumeFrom
    let lastTime = Date.now()
    let lastBytes = downloadedBytes
    for (const chunk of initialChunks) {
      fileStream.write(Buffer.from(chunk))
      downloadedBytes += chunk.length
    }
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      fileStream.write(Buffer.from(value))
      downloadedBytes += value.length
      const now = Date.now()
      if (now - lastTime >= 500) {
        onProgress?.(downloadedBytes, totalBytes, ((downloadedBytes - lastBytes) / (now - lastTime)) * 1000)
        lastTime = now
        lastBytes = downloadedBytes
      }
    }
    fileStream.end()
    await new Promise<void>((resolve, reject) => {
      fileStream.on('finish', resolve)
      fileStream.on('error', reject)
    })
    renameSync(tempPath, savePath)
    onProgress?.(downloadedBytes, totalBytes, 0)

    return { success: true, filePath: savePath, fileSize: downloadedBytes }
  } catch (err: any) {
    const message = err?.message || '下载失败'
    return {
      success: false,
      error: message,
      retryable: !/验证|登录失效|重新登录|限制.*频率|IP|不是有效的 ZIP|网页而不是 ZIP/.test(message)
    }
  }
}

function isZipHeader(value: Uint8Array): boolean {
  if (value.length < 4) return false
  return value[0] === 0x50 && value[1] === 0x4b &&
    ((value[2] === 0x03 && value[3] === 0x04) ||
      (value[2] === 0x05 && value[3] === 0x06) ||
      (value[2] === 0x07 && value[3] === 0x08))
}

async function readZipPrefix(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<Uint8Array[]> {
  const chunks: Uint8Array[] = []
  let length = 0
  while (length < 4) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    length += value.length
  }
  return chunks
}

function isZipFile(filePath: string): boolean {
  const header = Buffer.alloc(4)
  const fd = openSync(filePath, 'r')
  try {
    return readSync(fd, header, 0, header.length, 0) === header.length && isZipHeader(header)
  } finally {
    closeSync(fd)
  }
}
