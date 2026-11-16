const assert = require('node:assert/strict')
const { test } = require('node:test')
const { DatabaseSync } = require('node:sqlite')
const loadMain = require('./load-main.cjs')

test('migrates legacy tables and round-trips authorization records and resolved file paths', t => {
  // Use Node's SQLite engine for the real SQL. The app's native better-sqlite3
  // binary targets Electron's ABI and cannot be loaded by the Node test runner.
  const sqlite = new DatabaseSync(':memory:')
  t.after(() => sqlite.close())
  sqlite.exec(`
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY, itemId TEXT NOT NULL, title TEXT, url TEXT, fileType TEXT,
      thumbnail TEXT, savePath TEXT, status TEXT DEFAULT 'pending', progress REAL DEFAULT 0,
      downloadedBytes INTEGER DEFAULT 0, totalBytes INTEGER DEFAULT 0, speed INTEGER DEFAULT 0,
      error TEXT, retryCount INTEGER DEFAULT 0, createdAt INTEGER, startedAt INTEGER, finishedAt INTEGER
    );
    INSERT INTO tasks (id, itemId, status) VALUES ('legacy', '1', 'completed');
    CREATE TABLE history (id INTEGER PRIMARY KEY AUTOINCREMENT, itemId TEXT, title TEXT,
      filePath TEXT, fileSize INTEGER, fileType TEXT, createdAt TEXT DEFAULT (datetime('now','localtime')));
  `)
  const db = loadMain('db', {
    electron: { app: { getPath: () => 'test-only' } },
    '../shared/types.js': { DEFAULT_SETTINGS: {} },
    'better-sqlite3': class {
      pragma() {}
      exec(sql) { return sqlite.exec(sql) }
      prepare(sql) {
        const statement = sqlite.prepare(sql)
        const clean = arg => arg && typeof arg === 'object'
          ? Object.fromEntries(Object.entries(arg).map(([k, v]) => [k, v === undefined ? null : v])) : arg
        return Object.fromEntries(['run', 'all', 'get'].map(method => [method, (...args) => statement[method](...args.map(clean))]))
      }
    }
  })
  db.initDatabase()
  assert.equal(db.getTask('legacy').operationMode, 'download')
  const task = {
    id: 'new', itemId: '83347402', title: 'Spaceship', url: 'https://www.aigei.com/item/test.html',
    fileType: 'threeD_model', thumbnail: '', savePath: '', status: 'completed',
    progress: 100, downloadedBytes: 0, totalBytes: 0, speed: 0, retryCount: 0, createdAt: 1,
    operationMode: 'unlock', authorizationState: 'authorized', coinsSpent: 25, coinBalance: 75
  }
  db.saveTask(task)
  assert.equal(db.getTask('new').operationMode, 'unlock')
  assert.equal(db.getTask('new').coinsSpent, 25)
  db.addHistory({ ...task, filePath: '', fileSize: 0 })
  const history = db.getAllHistory()[0]
  assert.equal(history.filePath, '')
  assert.equal(history.operationMode, 'unlock')
  assert.equal(history.coinBalance, 75)
  db.saveTask({ ...task, savePath: 'test/file.rar', operationMode: 'download', coinsSpent: 0 })
  assert.equal(db.getTask('new').savePath, 'test/file.rar')
  assert.equal(db.getTask('new').coinsSpent, 0)
})
