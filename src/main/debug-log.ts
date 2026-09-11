import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

let logFile = ''
let debugMode: boolean | null = null // null = 未检查过

function getLogFile(): string {
  if (!logFile) {
    logFile = path.join(app.getPath('desktop'), 'aigei-debug.log')
  }
  return logFile
}

function isDebugEnabled(): boolean {
  if (debugMode !== null) return debugMode
  try {
    const { getSetting } = require('./db.js')
    debugMode = getSetting('debugMode') === 'true'
  } catch {
    debugMode = false
  }
  return debugMode
}

export function log(tag: string, message: string): void {
  if (!isDebugEnabled()) return
  try {
    const line = `[${new Date().toLocaleTimeString()}] [${tag}] ${message}\n`
    fs.appendFileSync(getLogFile(), line)
    console.log(`[${tag}] ${message}`)
  } catch { /* ignore */ }
}

export function getDebugMode(): boolean {
  return isDebugEnabled()
}

export function setDebugMode(enabled: boolean): void {
  debugMode = enabled
  try {
    const { setSetting } = require('./db.js')
    setSetting('debugMode', enabled ? 'true' : 'false')
  } catch { /* ignore */ }
  if (enabled) {
    fs.writeFileSync(getLogFile(), `=== 爱给下载器调试日志 ${new Date().toLocaleString()} ===\n`)
    log('DEBUG', '调试模式已开启')
  }
}

export function getLogFilePath(): string {
  return getLogFile()
}
