const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { test } = require('node:test')
const ts = require('typescript')

function loadApi(download) {
  const code = ts.transpileModule(readFileSync(resolve(__dirname, '../src/renderer/api.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  const loaded = { exports: {} }
  new Function('window', 'exports', code)({ aigei: { download } }, loaded.exports)
  return loaded.exports.api
}

function oldBridge(paused = false) {
  const calls = []
  return {
    calls,
    getQueueState: async () => ({ paused }),
    pause: async () => { calls.push('pause') },
    // State may change while the confirmation dialog is open: always read again.
    list: async () => {
      calls.push('list')
      return [{ id: 'waiting', status: 'pending' }, { id: 'running', status: 'downloading' },
        { id: 'failed', status: 'failed' }, { id: 'done', status: 'completed' }]
    },
    remove: async id => { calls.push('remove:' + id) },
    resume: async () => { calls.push('resume') }
  }
}

test('hot-updated UI clears using an older preload without the new method', async () => {
  const bridge = oldBridge()
  const api = loadApi(bridge)
  assert.equal(await api.download.clearInactive(), 3)
  assert.deepEqual(bridge.calls, ['pause', 'list', 'remove:waiting', 'remove:failed', 'remove:done', 'resume'])
})

test('compatibility clear preserves an existing queue pause', async () => {
  const bridge = oldBridge(true)
  assert.equal(await loadApi(bridge).download.clearInactive(), 3)
  assert.deepEqual(bridge.calls, ['list', 'remove:waiting', 'remove:failed', 'remove:done'])
})

test('new preload uses the native bulk clear', async () => {
  assert.equal(await loadApi({ clearInactive: async () => 7 }).download.clearInactive(), 7)
})

test('new preload with an old main process falls back when its handler is missing', async () => {
  const bridge = oldBridge()
  bridge.clearInactive = async () => { throw new Error("No handler registered for 'download:clearInactive'") }
  assert.equal(await loadApi(bridge).download.clearInactive(), 3)
})

test('native deletion errors are reported without retrying through the fallback', async () => {
  const bridge = oldBridge()
  bridge.clearInactive = async () => { throw new Error('database is locked') }
  await assert.rejects(loadApi(bridge).download.clearInactive(), /database is locked/)
  assert.deepEqual(bridge.calls, [])
})
