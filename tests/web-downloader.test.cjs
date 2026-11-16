const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { mkdtempSync, readFileSync, writeFileSync, rmSync } = require('node:fs')
const { createRequire } = require('node:module')
const { tmpdir } = require('node:os')
const { dirname, join, resolve } = require('node:path')
const { test } = require('node:test')
const vm = require('node:vm')
const { parse } = require('node-html-parser')
const ts = require('typescript')

const targetId = '83347402'
const url = 'https://www.aigei.com/item/ue_ge_shi_yu_zh.html'
// Structure observed on the failing resource; no real site token is retained.
const directButton = `<li class="options-btns-right-down-Btn">
  <span id="itemDownBtn_${targetId}" class="dropdown-toggle btn btn-down btn-down-hover gei-btn gei-btn-primary"
    onclick="itemFileDownWithDisable(this)" itemid="${targetId}" item-down-type="threeD_model">
    <input type="hidden" ftype="threeD_model" fmodel="down" rurl="${targetId}" token="test-only">
    &nbsp; ZIP &nbsp; 45m
  </span></li>`
const recommendation = '<span id="itemDownBtn_999" class="js-down-btn-with-drop-down" itemid="999" item-down-type="threeD_model"></span>'

function harness(t, html, { holdReset = false, scenario = 'success', endpoint, timeoutMs, userDelay = 10, userAction = 'auto' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'aigei-download-test-'))
  t.after(() => {
    assert.equal(dirname(dir), tmpdir())
    rmSync(dir, { recursive: true, force: true })
  })
  const session = new EventEmitter()
  session.webRequest = { onBeforeRequest() {} }
  const windows = []
  const clicks = []
  const requests = []
  const resets = []
  const authorizations = []
  let fileTransfers = 0
  let confirmations = 0
  let nativeDialogs = 0
  const hookFile = resolve(__dirname, '../src/main/site-authorization.ts')
  const hookCode = ts.transpileModule(readFileSync(hookFile, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  const hook = { exports: {} }
  new Function('module', 'exports', hookCode)(hook, hook.exports)
  class FakeWindow extends EventEmitter {
    constructor() {
      super()
      this.shown = 0
      this.visible = false
      this.destroyed = false
      this.webContents = new EventEmitter()
      this.webContents.id = windows.length + 1
      this.webContents.setUserAgent = () => {}
      this.webContents.getURL = () => this.url
      this.webContents.executeJavaScript = async (script) => vm.runInContext(script, this.context)
      this.createContext = () => {
        const site = {
          itemFileDown: (element) => this.download(element),
          fileProcess: () => this.transfer(),
          jsInterface_download_proessResultJson(response, options) {
            if (response.statusCode === 'success') site.fileProcess(response, options)
            else site.gei.ajaxComp.ajaxExProcRoute.route(response.ajaxExProc, '/f/d', options)
          },
          jsInterface_downloadConfirm: () => {
            this.dialogVisible = false
            confirmations++
            void this.respond(true)
          },
          itemFileDownAjaxPost() {},
          completeCaptcha: () => {
            this.dialogVisible = false
            this.captchaSolved = true
            site.itemFileDownAjaxPost()
            void this.respond(this.lastConfirm || false)
          },
          gei: {
            util: { pop: () => { nativeDialogs++; this.dialogVisible = true } },
            ajaxComp: { ajaxExProcRoute: { route: () => site.gei.util.pop() } }
          }
        }
        this.site = site
        this.context = vm.createContext({
        document: this.document,
        window: site,
        URLSearchParams,
        fetch: async (endpoint, options) => {
          requests.push({ endpoint, options })
          return { url: endpoint, text: async () => '<a class="item-down-btn" itemid="83347402" item-down-type="threeD_model"><span class="td-format">ZIP</span></a>' }
        },
        // Polling is instantaneous in this isolated page; no real network or site click occurs.
        setTimeout: (callback) => queueMicrotask(callback)
      })
      }
      windows.push(this)
    }
    async loadURL(nextUrl) {
      if (nextUrl === 'about:blank' && holdReset) {
        await new Promise((resolve) => resets.push(resolve))
      }
      this.url = nextUrl
      const root = parse(`<body><div class="item-page-prev-container" itemid="${targetId}"></div>${html}</body>`)
      for (const button of root.querySelectorAll('[item-down-type]')) button.click = () => this.download(button)
      this.document = {
        querySelector: (selector) => root.querySelector(selector),
        querySelectorAll: (selector) => selector.includes('.modal.in') && this.dialogVisible
          ? [{ getClientRects: () => [{}] }] : root.querySelectorAll(selector),
        getElementById: (id) => root.querySelector(`[id="${id}"]`),
        createElement: (tag) => {
          const element = parse(`<${tag}></${tag}>`).firstChild
          element.style = {}
          return element
        },
        body: root.querySelector('body')
      }
      this.createContext()
      this.webContents.emit('did-finish-load')
    }
    download(element) {
      clicks.push(element.getAttribute('itemid'))
      void this.respond(false)
    }
    async respond(confirm) {
      this.lastConfirm = confirm
      const site = this.site
      const options = { itemId: targetId, model: 'down' }
      site._curFileDownOpts = options
      let response
      if (endpoint) {
        try {
          const result = await fetch(endpoint + '/f/d', {
            method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ confirm: String(confirm), scenario, captcha: String(!!this.captchaSolved) })
          })
          response = await result.json()
        } catch { return }
      } else if (scenario === 'timeout') {
        return
      } else if (scenario === 'rejected') {
        response = { statusCode: 'error', ajaxExProc: { procCompType: 'tip', content: '铜币不足' } }
      } else if (scenario === 'vip') {
        response = { statusCode: 'error', ajaxExProc: { procCompType: 'vip', content: '需要VIP会员' } }
      } else if (scenario === 'cash') {
        response = { statusCode: 'error', ajaxExProc: { procCompType: 'tip', content: '支付现金购买铜币', actionButton: { action: 'download' } } }
      } else if (scenario === 'captcha-first' && !this.captchaSolved) {
        response = { statusCode: 'error', ajaxExProc: { procCompType: 'vcode', content: '请完成验证码' } }
      } else if ((!confirm || scenario === 'repeat-confirm') && scenario !== 'free') {
        response = { statusCode: 'error', ajaxExProc: { procCompType: 'tip', content: scenario === 'vip-promo' ? '下载确认 消耗铜币25枚 我的铜币余额4022枚 VIP铜币每日赠送200枚 不登录也送 容量5000枚 查看详情' : '本次下载消耗25铜币，是否继续？', actionButton: { action: 'download' } } }
      } else if (['captcha', 'form'].includes(scenario) && !this.captchaSolved) {
        response = { statusCode: 'error', ajaxExProc: { procCompType: 'vcode', content: '请完成验证码' } }
      } else {
        response = { statusCode: 'success', message: 'test-url', consumeFundValue: { fundType: 'down', value: scenario === 'free' ? 0 : 25 }, consumeFundRemain: 75 }
      }
      if (site !== this.site || this.url === 'about:blank') return
      if (scenario === 'precheck' && !confirm) {
        site.gei.ajaxComp.ajaxExProcRoute.route(response.ajaxExProc, '/gei-common/jsonComp/f/c', options)
      } else if (scenario === 'form' && !this.captchaSolved && confirm) {
        site.gei.util.pop({ title: '验证码', message: '请完成验证码' })
      } else {
        site.jsInterface_download_proessResultJson(response, options, '/f/d')
      }
    }
    transfer() {
      fileTransfers++
      const item = new EventEmitter()
      item.getFilename = () => 'spaceship.zip'
      item.setSavePath = (path) => {
        writeFileSync(path, Buffer.from('PK\x03\x04test-file'))
        queueMicrotask(() => item.emit('done', {}, scenario === 'file-failure' ? 'interrupted' : 'completed'))
      }
      item.cancel = () => {}
      session.emit('will-download', {}, item, this.webContents)
    }
    setTitle(title) { this.title = title }
    show() {
      this.shown++
      this.visible = true
      if (userAction === 'none') return
      setTimeout(() => {
        if (this.destroyed || this.url === 'about:blank') return
        if (userAction === 'dismiss') this.dialogVisible = false
        else if (userAction === 'close' || ['rejected', 'vip', 'cash'].includes(scenario)) this.destroy()
        else this.site.completeCaptcha()
      }, userDelay)
    }
    focus() {}
    hide() { this.visible = false }
    isDestroyed() { return this.destroyed }
    destroy() { this.destroyed = true; this.emit('closed') }
  }
  const filename = resolve(__dirname, '../src/main/web-downloader.ts')
  const source = readFileSync(filename, 'utf8').replace('const DOWNLOAD_START_TIMEOUT = 30_000', 'const DOWNLOAD_START_TIMEOUT = ' + (timeoutMs || 30000))
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  const loaded = { exports: {} }
  const realRequire = createRequire(filename)
  new Function('require', 'module', 'exports', code)((id) => {
    if (id === './site-authorization.js') return hook.exports
    if (id === 'electron') return { BrowserWindow: FakeWindow, session: { defaultSession: session } }
    if (id === '../shared/aigei-constants.js') return { AIGEI_UA: 'Test UA' }
    return realRequire(id)
  }, loaded, loaded.exports)
  return { download: (input = {}) => loaded.exports.downloadThroughWebPage(
    { itemId: targetId, title: 'Spaceship', url, ...input }, join(dir, 'spaceship.zip'), undefined, (state) => authorizations.push(structuredClone(state))),
    windows, clicks, requests, resets, authorizations,
    get fileTransfers() { return fileTransfers }, get confirmations() { return confirmations },
    get nativeDialogs() { return nativeDialogs } }
}

test('downloads through the exact native single-file button without requesting a format dropdown', async (t) => {
  const app = harness(t, recommendation + directButton)
  const result = await app.download()
  assert.equal(result.success, true)
  assert.equal(result.format, 'zip')
  assert.deepEqual(app.clicks, [targetId])
  assert.equal(app.requests.length, 0)
})

test('a legacy task with a slug ID resolves the numeric ID from the main detail page', async (t) => {
  const app = harness(t, recommendation + directButton)
  assert.equal((await app.download({ itemId: 'ue_ge_shi_yu_zh' })).success, true)
  assert.deepEqual(app.clicks, [targetId])
})

test('a missing target never falls back to another resource in recommendations', async (t) => {
  const app = harness(t, recommendation)
  const result = await app.download()
  assert.equal(result.success, false)
  assert.match(result.error, /当前资源的下载按钮/)
  assert.equal(result.retryable, false)
  assert.equal(app.clicks.length, 0)
  assert.equal(app.requests.length, 0)
})

test('the existing dropdown path still selects and downloads the matching resource', async (t) => {
  const app = harness(t, recommendation + `<span id="itemDownBtn_${targetId}"
    class="js-down-btn-with-drop-down" itemid="${targetId}" item-down-type="threeD_model"></span>`)
  assert.equal((await app.download()).success, true)
  assert.deepEqual(app.clicks, [targetId])
  assert.equal(app.requests.length, 1)
  assert.equal(new URLSearchParams(app.requests[0].options.body).get('itemId'), targetId)
})

test('a worker stays busy until its previous page has finished resetting', async (t) => {
  const app = harness(t, directButton, { holdReset: true })
  const first = app.download()
  while (app.resets.length < 1) await new Promise((resolve) => setImmediate(resolve))
  const second = app.download()
  while (app.resets.length < 2) await new Promise((resolve) => setImmediate(resolve))
  assert.equal(app.windows.length, 2)
  app.resets.forEach((finish) => finish())
  assert.equal((await first).success, true)
  assert.equal((await second).success, true)
})


test('unlock automatically confirms coins without displaying a confirmation window or transferring a file', async (t) => {
  const app = harness(t, directButton)
  const result = await app.download({ operationMode: 'unlock' })
  assert.equal(result.success, true)
  assert.equal(result.authorizationState, 'authorized')
  assert.equal(result.coinsSpent, 25)
  assert.equal(result.coinBalance, 75)
  assert.equal(result.filePath, undefined)
  assert.equal(app.fileTransfers, 0)
  assert.equal(app.confirmations, 1)
  assert.deepEqual(app.authorizations.map(x => x.authorizationState), ['pending', 'authorized'])
  assert.equal(app.windows[0].shown, 0)
})

test('download retains successful authorization if saving the file fails', async (t) => {
  const app = harness(t, directButton, { scenario: 'file-failure' })
  const result = await app.download()
  assert.equal(result.success, false)
  assert.equal(result.authorizationState, 'authorized')
  assert.equal(result.coinsSpent, 25)
  assert.equal(result.retryable, false)
  assert.equal(app.confirmations, 1)
})

test('free resources finish authorization without forced coin consumption', async (t) => {
  const app = harness(t, directButton, { scenario: 'free' })
  const result = await app.download({ operationMode: 'unlock' })
  assert.equal(result.success, true)
  assert.equal(result.coinsSpent, 0)
  assert.equal(app.confirmations, 0)
  assert.equal(app.fileTransfers, 0)
})

for (const scenario of ['rejected', 'vip', 'cash']) {
  test('does not auto-confirm ' + scenario, async (t) => {
    const app = harness(t, directButton, { scenario })
    const result = await app.download({ operationMode: 'unlock' })
    assert.equal(result.success, false)
    assert.equal(result.authorizationState, 'rejected')
    assert.equal(app.confirmations, 0)
    assert.equal(app.fileTransfers, 0)
    assert.equal(app.nativeDialogs, 0)
    assert.equal(app.windows[0].shown, 0)
  })
}

test('a missing authorization response returns unknown and never retries', async (t) => {
  const app = harness(t, directButton, { scenario: 'timeout', timeoutMs: 50 })
  const result = await app.download({ operationMode: 'unlock' })
  assert.equal(result.success, false)
  assert.equal(result.authorizationState, 'unknown')
  assert.equal(result.retryable, false)
  assert.equal(app.clicks.length, 1)
})

const simulationUrl = process.env.AIGEI_SIMULATION_URL
for (const mode of ['unlock', 'download']) {
  test('HTTP simulation: coin authorization in ' + mode + ' mode', { skip: !simulationUrl }, async (t) => {
    const app = harness(t, directButton, { endpoint: simulationUrl })
    const result = await app.download({ operationMode: mode })
    assert.equal(result.success, true)
    assert.equal(result.coinsSpent, 25)
    assert.equal(app.confirmations, 1)
    assert.equal(app.fileTransfers, mode === 'unlock' ? 0 : 1)
  })
}

test('HTTP simulation: committed charge with a delayed response stays unknown without retry', { skip: !simulationUrl }, async (t) => {
  await fetch(simulationUrl + '/__reset', { method: 'POST' })
  const app = harness(t, directButton, { endpoint: simulationUrl, scenario: 'charge-timeout', timeoutMs: 800 })
  const result = await app.download({ operationMode: 'unlock' })
  assert.equal(result.success, false)
  assert.equal(result.authorizationState, 'unknown')
  assert.equal(result.retryable, false)
  const state = await (await fetch(simulationUrl + '/__state')).json()
  assert.equal(state.charges, 25)
  assert.equal(state.requests, 2)
  assert.equal(app.confirmations, 1)
  assert.equal(app.fileTransfers, 0)
})


for (const operationMode of ['unlock', 'download']) {
  test('manual CAPTCHA continues the same ' + operationMode + ' task without another click', async (t) => {
    const app = harness(t, directButton, { scenario: 'captcha', userAction: 'none' })
    const promise = app.download({ operationMode })
    while (!app.windows[0]?.shown) await new Promise(resolve => setImmediate(resolve))
    assert.equal(app.confirmations, 1)
    assert.equal(app.fileTransfers, 0)
    assert.equal(app.authorizations.at(-1).authorizationState, 'waiting')
    assert.match(app.windows[0].title, /手动完成验证码/)
    app.windows[0].site.completeCaptcha()
    const result = await promise
    assert.equal(result.success, true)
    assert.equal(app.confirmations, 1)
    assert.equal(app.fileTransfers, operationMode === 'unlock' ? 0 : 1)
    assert.equal(app.clicks.length, 1)
    assert.equal(app.windows[0].visible, false)
  })
}

test('manual input can take longer than the normal download-start timeout', async (t) => {
  const app = harness(t, directButton, { scenario: 'captcha', timeoutMs: 250, userDelay: 450 })
  const result = await app.download({ operationMode: 'unlock' })
  assert.equal(result.success, true)
  assert.equal(app.confirmations, 1)
  assert.equal(app.clicks.length, 1)
})

test('closing the native task window settles once without retry or file transfer', async (t) => {
  const app = harness(t, directButton, { scenario: 'captcha', userAction: 'close' })
  const result = await app.download({ operationMode: 'unlock' })
  assert.equal(result.success, false)
  assert.equal(result.authorizationState, 'unknown')
  assert.equal(result.retryable, false)
  assert.equal(app.clicks.length, 1)
  assert.equal(app.confirmations, 1)
})

for (const scenario of ['captcha', 'form']) {
  test('native ' + scenario + ' dialogs before /f/d are shown and continue the same task', async (t) => {
    const app = harness(t, directButton, { scenario })
    const result = await app.download({ operationMode: 'unlock' })
    assert.equal(result.success, true)
    assert.equal(app.windows[0].shown, 1)
    assert.equal(app.nativeDialogs, 1)
    assert.equal(app.confirmations, 1)
    assert.equal(app.fileTransfers, 0)
  })
}

test('dismissing CAPTCHA stops without another confirmation or file transfer', async (t) => {
  const app = harness(t, directButton, { scenario: 'captcha', userAction: 'dismiss' })
  const result = await app.download({ operationMode: 'unlock' })
  assert.equal(result.success, false)
  assert.equal(result.authorizationState, 'rejected')
  assert.equal(app.confirmations, 1)
  assert.equal(app.fileTransfers, 0)
})


for (const operationMode of ['unlock', 'download']) {
  test('coin confirmation with VIP promotion auto-confirms in ' + operationMode + ' mode', async (t) => {
    const app = harness(t, directButton, { scenario: 'vip-promo', userAction: 'none' })
    const result = await app.download({ operationMode })
    assert.equal(result.success, true)
    assert.equal(app.confirmations, 1)
    assert.equal(app.nativeDialogs, 0)
    assert.equal(app.windows[0].shown, 0)
    assert.equal(app.fileTransfers, operationMode === 'unlock' ? 0 : 1)
  })
}

test('a repeated coin confirmation never triggers a second automatic charge request', async (t) => {
  const app = harness(t, directButton, { scenario: 'repeat-confirm', userAction: 'none' })
  const result = await app.download({ operationMode: 'unlock' })
  assert.equal(result.success, false)
  assert.equal(result.authorizationState, 'rejected')
  assert.equal(app.confirmations, 1)
  assert.equal(app.nativeDialogs, 0)
})

test('coin confirmation returned by the pre-download check also auto-confirms', async (t) => {
  const app = harness(t, directButton, { scenario: 'precheck', userAction: 'none' })
  assert.equal((await app.download({ operationMode: 'unlock' })).success, true)
  assert.equal(app.confirmations, 1)
  assert.equal(app.windows[0].shown, 0)
})

test('CAPTCHA before the coin prompt is completed manually, then coins confirm automatically', async (t) => {
  const app = harness(t, directButton, { scenario: 'captcha-first' })
  const result = await app.download({ operationMode: 'unlock' })
  assert.equal(result.success, true)
  assert.equal(app.windows[0].shown, 1)
  assert.equal(app.nativeDialogs, 1)
  assert.equal(app.confirmations, 1)
  assert.equal(app.fileTransfers, 0)
})

for (const operationMode of ['unlock', 'download']) {
  test('HTTP simulation: auto coin confirmation then manual CAPTCHA in ' + operationMode, { skip: !simulationUrl }, async (t) => {
    const app = harness(t, directButton, { endpoint: simulationUrl, scenario: 'captcha' })
    const result = await app.download({ operationMode })
    assert.equal(result.success, true)
    assert.equal(app.windows[0].shown, 1)
    assert.equal(app.confirmations, 1)
    assert.equal(app.fileTransfers, operationMode === 'unlock' ? 0 : 1)
  })
}
