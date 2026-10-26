import { closeSync, existsSync, openSync, readSync, statSync } from 'fs'
import { basename, extname, resolve } from 'path'
import extractZip from 'extract-zip'
import * as yauzl from 'yauzl'
import type { ArchiveEntry, ArchiveInspection } from '../shared/types.js'

export async function inspectArchive(filePath: string): Promise<ArchiveInspection> {
  const targetPath = resolve(filePath)
  if (extname(targetPath).toLowerCase() !== '.zip') {
    throw new Error('当前只支持 ZIP 压缩包')
  }
  return validateZipArchive(targetPath)
}

export async function validateZipArchive(filePath: string): Promise<ArchiveInspection> {
  const targetPath = resolve(filePath)
  assertZipSignature(targetPath)

  try {
    const entries = await readZipEntries(targetPath)
    return buildInspection(targetPath, entries)
  } catch (error: any) {
    const message = String(error?.message || error || '')
    if (/central directory|invalid.*zip|not.*zip|unexpected end|invalid signature|end of file/i.test(message)) {
      throw new Error('ZIP 文件不完整或已损坏，请删除后重新下载')
    }
    throw new Error(`读取 ZIP 压缩包失败：${message || '未知错误'}`)
  }
}

export async function extractArchive(filePath: string, outputDir: string): Promise<ArchiveInspection> {
  const targetPath = resolve(filePath)
  const targetDir = resolve(outputDir)
  const inspection = await inspectArchive(targetPath)
  try {
    await extractZip(targetPath, { dir: targetDir })
  } catch (error: any) {
    throw new Error(`解压 ZIP 文件失败：${error?.message || '未知错误'}`)
  }
  return inspection
}

function assertZipSignature(filePath: string): void {
  if (!existsSync(filePath)) {
    throw new Error('压缩包不存在')
  }

  const fileSize = statSync(filePath).size
  if (fileSize < 4) {
    throw new Error('ZIP 文件为空或下载不完整，请删除后重新下载')
  }

  const prefix = Buffer.alloc(Math.min(512, fileSize))
  const fd = openSync(filePath, 'r')
  try {
    readSync(fd, prefix, 0, prefix.length, 0)
  } finally {
    closeSync(fd)
  }

  const isZip = prefix[0] === 0x50 && prefix[1] === 0x4b &&
    ((prefix[2] === 0x03 && prefix[3] === 0x04) ||
      (prefix[2] === 0x05 && prefix[3] === 0x06) ||
      (prefix[2] === 0x07 && prefix[3] === 0x08))
  if (isZip) return

  const textPrefix = prefix.toString('utf8').trimStart().toLowerCase()
  if (textPrefix.startsWith('<!doctype html') || textPrefix.startsWith('<html')) {
    throw new Error('该文件实际是爱给网页，不是 ZIP 压缩包；登录或验证可能已失效，请删除后重新下载')
  }
  throw new Error('文件内容不是有效的 ZIP 压缩包，请删除后重新下载')
}

function readZipEntries(filePath: string): Promise<ArchiveEntry[]> {
  return new Promise((resolvePromise, reject) => {
    yauzl.open(filePath, { lazyEntries: true, autoClose: true }, (openError, zipFile) => {
      if (openError) {
        reject(openError)
        return
      }
      if (!zipFile) {
        reject(new Error('无法打开压缩包'))
        return
      }

      const entries: ArchiveEntry[] = []
      zipFile.readEntry()

      zipFile.on('entry', (entry) => {
        const normalizedPath = entry.fileName.replace(/\\/g, '/')
        const isDirectory = normalizedPath.endsWith('/')
        entries.push({
          path: normalizedPath,
          name: basename(normalizedPath) || normalizedPath,
          extension: isDirectory ? '' : extname(normalizedPath).replace(/^\./, '').toLowerCase(),
          size: entry.uncompressedSize || 0,
          compressedSize: entry.compressedSize || 0,
          isDirectory,
          modifiedAt: entry.getLastModDate().getTime()
        })
        zipFile.readEntry()
      })

      zipFile.on('end', () => resolvePromise(entries))
      zipFile.on('error', reject)
    })
  })
}

function buildInspection(filePath: string, entries: ArchiveEntry[]): ArchiveInspection {
  const formats: Record<string, number> = {}
  let totalSize = 0
  let fileCount = 0
  let directoryCount = 0

  for (const entry of entries) {
    if (entry.isDirectory) {
      directoryCount += 1
      continue
    }
    fileCount += 1
    totalSize += entry.size || 0
    const extension = entry.extension || 'unknown'
    formats[extension] = (formats[extension] || 0) + 1
  }

  return {
    filePath,
    fileCount,
    directoryCount,
    totalSize,
    formats,
    entries
  }
}
