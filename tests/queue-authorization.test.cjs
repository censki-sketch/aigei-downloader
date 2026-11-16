const assert = require('node:assert/strict')
const { test } = require('node:test')
const loadMain = require('./load-main.cjs')

function harness(initial = [], result = { success: true, authorizationState: 'authorized', coinsSpent: 25 }) {
  const tasks = new Map(initial.map(task => [task.id, structuredClone(task)]))
  const history = []
  const checkpoints = []
  let calls = 0
  let inspections = 0
  const { downloadQueue: queue } = loadMain('queue', {
    electron: { BrowserWindow: { getAllWindows: () => [] } },
    './db.js': {
      saveTask(task) { tasks.set(task.id, structuredClone(task)); checkpoints.push(structuredClone(task)) },
      getTask: id => tasks.has(id) ? structuredClone(tasks.get(id)) : undefined,
      getAllTasks: () => [...tasks.values()].map(task => structuredClone(task)),
      deleteTask: id => tasks.delete(id),
      getAllSettings: () => ({ downloadDir: 'test-root' }),
      addHistory: entry => history.push(entry)
    },
    './downloader.js': {
      getDefaultSaveDir: () => 'test-root',
      async downloadItem(input, path, progress, authorization) {
        calls++
        authorization({ authorizationState: 'pending' })
        if (result.authorizationState === 'authorized') authorization({ authorizationState: 'authorized', coinsSpent: 25 })
        return result
      }
    },
    './classifier.js': { resolveCategoryPath: () => [], getArchivePath: () => 'test-root/file.zip' },
    './archive.js': { inspectArchive() { inspections++; return { fileCount: 1 } } },
    './scraper.js': { isAigeiAccessBlockedError: error => /风控/.test(error.message) }
  })
  queue.setRequestDelay(0)
  return { queue, tasks, history, checkpoints, get calls() { return calls }, get inspections() { return inspections } }
}

const input = { itemId: '83347402', title: 'Spaceship', url: 'https://www.aigei.com/item/test.html', operationMode: 'unlock' }
async function finished(app, id) {
  for (let i = 0; i < 50; i++) {
    if (['completed', 'failed'].includes(app.tasks.get(id)?.status)) return app.tasks.get(id)
    await new Promise(resolve => setImmediate(resolve))
  }
  throw new Error('Task did not settle')
}

test('unlock persists its mode, charge checkpoints, and history without archive work', async () => {
  const app = harness()
  const task = await finished(app, app.queue.add(input))
  assert.equal(task.status, 'completed')
  assert.equal(task.operationMode, 'unlock')
  assert.equal(task.savePath, '')
  assert.equal(task.totalBytes, 0)
  assert.equal(task.coinsSpent, 25)
  assert.equal(app.inspections, 0)
  assert.equal(app.history[0].operationMode, 'unlock')
  assert.equal(app.history[0].filePath, '')
  assert.ok(app.checkpoints.some(x => x.authorizationState === 'pending'))
})

for (const authorizationState of ['unknown', 'authorized']) {
  test(authorizationState + ' failures cannot retry even if marked retryable or labeled anti-bot', async () => {
    const app = harness([], { success: false, authorizationState, retryable: true, error: '风控' })
    const id = app.queue.add(input)
    const task = await finished(app, id)
    assert.equal(task.status, 'failed')
    assert.equal(app.calls, 1)
    assert.throws(() => app.queue.retry(id), /检查消费记录/)
    assert.equal(app.queue.getState().pendingCount, 0)
  })
}

for (const authorizationState of ['pending', 'waiting', 'authorized']) {
  test('restart blocks a previous in-flight ' + authorizationState + ' task', () => {
    const app = harness([{ id: 'old', status: 'downloading', authorizationState, operationMode: 'unlock' }])
    app.queue.rehydrateFromDb()
    assert.equal(app.tasks.get('old').status, 'failed')
    assert.equal(app.queue.getState().pendingCount, 0)
    assert.equal(app.calls, 0)
    assert.throws(() => app.queue.retry('old'), /检查消费记录/)
  })
}

test('a rejected authorization can be retried and keeps its original mode', async () => {
  const app = harness([{ ...input, id: 'old', status: 'failed', authorizationState: 'rejected' }])
  app.queue.retry('old')
  const task = await finished(app, 'old')
  assert.equal(task.operationMode, 'unlock')
  assert.equal(app.history[0].filePath, '')
})

test('clear removes pending, failed, and completed records from disk and memory while preserving running work', () => {
  const app = harness([
    { id: 'failed', status: 'failed' },
    { id: 'completed', status: 'completed' },
    { id: 'running', status: 'downloading' }
  ])
  app.queue.pause()
  app.queue.add(input)
  app.queue.add(input)
  assert.equal(app.queue.getState().pendingCount, 2)
  assert.equal(app.queue.clearInactive(), 4)
  assert.equal(app.queue.getState().pendingCount, 0)
  assert.deepEqual([...app.tasks.keys()], ['running'])
  app.queue.resume()
  assert.equal(app.calls, 0)
  assert.equal(app.queue.clearInactive(), 0)
})

test('clear removes an obsolete task-failure pause when the queue is empty', () => {
  const app = harness([{ id: 'failed', status: 'failed' }])
  app.queue.pause('任务失败', true, 'task-failure')
  assert.equal(app.queue.clearInactive(), 1)
  assert.equal(app.queue.getState().paused, false)
  assert.equal(app.queue.getState().pauseReason, undefined)
})

test('clear preserves safety pauses and history', async () => {
  const app = harness()
  await finished(app, app.queue.add(input))
  app.queue.pause('请完成验证', true, 'anti-bot')
  assert.equal(app.queue.clearInactive(), 1)
  assert.equal(app.queue.getState().paused, true)
  assert.equal(app.queue.getState().pauseKind, 'anti-bot')
  assert.equal(app.history.length, 1)
})
