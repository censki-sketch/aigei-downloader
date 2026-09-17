import { existsSync } from 'fs'
import { basename, extname, resolve } from 'path'
import extractZip from 'extract-zip'
import * as yauzl from 'yauzl'
import type { ArchiveEntry, ArchiveInspection } from '../shared/types.js'

export async function inspectArchive(filePath: string): Promise<ArchiveInspection> {
  const targetPath = resolve(filePath)
  if (!existsSync(targetPath)) {
    throw new Error('压缩包不存在')
  }
  if (extname(targetPath).toLowerCase() !== '.zip') {
    throw new Error('当前只支持 ZIP 压缩包')
  }

  const entries = await readZipEntries(targetPath)
  return buildInspection(targetPath, entries)
}

export async function extractArchive(filePath: string, outputDir: string): Promise<ArchiveInspection> {
  const targetPath = resolve(filePath)
  const targetDir = resolve(outputDir)
  await extractZip(targetPath, { dir: targetDir })
  return inspectArchive(targetPath)
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
