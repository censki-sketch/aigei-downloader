import { join } from 'path'
import { app } from 'electron'
import { downloadThroughWebPage } from './web-downloader.js'
import type { AuthorizationResult, DownloadItemInput } from '../shared/types.js'

export interface DownloadResult extends AuthorizationResult {
  success: boolean
  filePath?: string
  error?: string
  fileSize?: number
  format?: string
  retryable?: boolean
}

export function getDefaultSaveDir(): string {
  return join(app.getPath('downloads'), 'AigeiDownloader')
}

/** 使用与软件登录页相同的 Electron 会话执行网站原生下载流程。 */
export async function downloadItem(
  input: DownloadItemInput,
  targetPath: string,
  onProgress?: (downloaded: number, total: number, speed: number) => void,
  onAuthorization?: (result: AuthorizationResult) => void
): Promise<DownloadResult> {
  return await downloadThroughWebPage(input, targetPath, onProgress, onAuthorization)
}
