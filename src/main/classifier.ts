import { join } from 'path'
import type { DownloadItemInput } from '../shared/types.js'

const CATEGORY_NAMES = new Set(['音效', '配乐', '视频', '3D', '平面', '图片', '游戏', '教程', '软件'])

export function resolveCategoryPath(input: Pick<DownloadItemInput, 'category' | 'categoryPath' | 'tags' | 'fileType' | 'type'>): string[] {
  const provided = cleanSegments(input.categoryPath)
  if (provided.length > 0) return provided

  if (input.category && CATEGORY_NAMES.has(input.category)) {
    return [input.category]
  }

  const type = String(input.fileType || input.type || '').toLowerCase()
  const typeCategory: Record<string, string> = {
    sound: '音效',
    music: '配乐',
    video: '视频',
    '3d': '3D',
    design: '平面',
    image: '图片',
    game: '游戏',
    course: '教程',
    software: '软件'
  }
  if (typeCategory[type]) return [typeCategory[type]]

  const tag = cleanSegments(input.tags).find((value) => value.length <= 20)
  return tag ? ['未分类', tag] : ['未分类']
}

export function getArchivePath(saveRoot: string, title: string, input: DownloadItemInput): string {
  return join(saveRoot, 'archives', ...resolveCategoryPath(input), `${sanitizeFileName(title || '未命名资源')}.zip`)
}

export function getLibraryPath(saveRoot: string, title: string, input: DownloadItemInput): string {
  return join(saveRoot, 'library', ...resolveCategoryPath(input), sanitizeFileName(title || '未命名资源'))
}

export function getLibraryRoot(saveRoot: string): string {
  return join(saveRoot, 'library')
}

export function sanitizeFileName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .substring(0, 100)
    .replace(/[. ]+$/, '') || '未命名资源'
}

function cleanSegments(values?: string[] | string): string[] {
  const source = Array.isArray(values) ? values : values ? [values] : []
  return source
    .map((value) => value.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, ' ').trim())
    .filter((value) => value && value !== '.' && value !== '..')
    .slice(0, 5)
}
