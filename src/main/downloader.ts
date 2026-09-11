import { createWriteStream, existsSync, mkdirSync, statSync, renameSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { getCookieString } from './browser.js'
import { scrapeItemPage } from './scraper.js'
import { dfu, cqbj, cupie, decryptResponse } from './aigei-encrypt.js'

export interface DownloadResult {
  success: boolean
  filePath?: string
  error?: string
  fileSize?: number
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
  saveDir: string,
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
    const safeTitle = sanitizeFileName(title || itemId)
    const savePath = join(saveDir, `${safeTitle}.zip`)
    const tempPath = `${savePath}.tmp`
    mkdirSync(saveDir, { recursive: true })

    let resumeFrom = 0
    if (existsSync(tempPath)) resumeFrom = statSync(tempPath).size

    const dlHeaders: Record<string, string> = {
      Referer: 'https://www.aigei.com/',
      'User-Agent': ua,
      Cookie: cookieString
    }
    if (resumeFrom > 0) dlHeaders['Range'] = `bytes=${resumeFrom}-`

    const dlResp = await fetch(downloadUrl, { headers: dlHeaders })
    if (!dlResp.ok && dlResp.status !== 206 && dlResp.status !== 200) {
      throw new Error(`下载失败: HTTP ${dlResp.status}`)
    }

    const totalBytes = Number(dlResp.headers.get('content-length') || 0) + resumeFrom
    const fileStream = createWriteStream(tempPath, { flags: resumeFrom > 0 ? 'a' : 'w' })
    let downloadedBytes = resumeFrom
    let lastTime = Date.now()
    let lastBytes = downloadedBytes
    const reader = dlResp.body?.getReader()
    if (!reader) throw new Error('无法读取下载流')

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
    return { success: false, error: err.message }
  }
}

function sanitizeFileName(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '_').replace(/_+/g, '_').substring(0, 100)
}
