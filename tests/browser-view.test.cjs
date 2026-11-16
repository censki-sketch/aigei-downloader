const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { test } = require('node:test')
const { parse, compileScript } = require('@vue/compiler-sfc')
const ts = require('typescript')
const vue = require('vue')

function createView(fetchPage) {
  const path = resolve(__dirname, '../src/renderer/views/BrowserView.vue')
  const { descriptor } = parse(readFileSync(path, 'utf8'))
  const compiled = ts.transpileModule(compileScript(descriptor, { id: 'browser-test' }).content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  const messages = []
  const loaded = { exports: {} }
  new Function('require', 'module', 'exports', compiled)((id) => {
    if (id === 'vue') return { ...vue, onMounted() {}, onUnmounted() {} }
    if (id === 'vue-router') return { useRouter: () => ({ push() {} }) }
    if (id === '../api') return { api: { scrape: { page: fetchPage } } }
    if (id === 'element-plus') return { ElMessage: {
      success: (message) => messages.push(message), warning: (message) => messages.push(message),
      error: (message) => messages.push(message)
    } }
    if (id === '@element-plus/icons-vue') return {}
    throw new Error(`Unexpected UI dependency: ${id}`)
  }, loaded, loaded.exports)
  return { view: loaded.exports.default.setup({}, { expose() {} }), messages }
}

const result = (url, title) => ({ currentUrl: url, currentPage: 1, pages: [], items: [{ title }] })

test('switching categories keeps the newest response when the previous request finishes later', async () => {
  const pending = []
  const { view, messages } = createView((url) => new Promise((resolve) => pending.push({ url, resolve })))
  const first = view.scrape('https://www.aigei.com/game/index/')
  const second = view.scrape('https://www.aigei.com/ue/list/')
  pending[1].resolve(result(pending[1].url, 'UE resource'))
  await second
  pending[0].resolve(result(pending[0].url, 'Old game resource'))
  await first
  assert.equal(view.resources.value[0].title, 'UE resource')
  assert.equal(view.urlInput.value, 'https://www.aigei.com/ue/list/')
  assert.equal(view.loading.value, false)
  assert.equal(messages.length, 1)
})

test('a failed category switch clears previous rows and pagination instead of showing stale data', async () => {
  let fail = false
  const { view } = createView(async (url) => {
    if (fail) throw new Error('Network unavailable')
    return result(url, 'Old resource')
  })
  await view.scrape('https://www.aigei.com/game/index/')
  assert.equal(view.resources.value.length, 1)
  fail = true
  await view.scrape('https://www.aigei.com/ue/list/')
  assert.equal(view.resources.value.length, 0)
  assert.equal(view.pageInfo.value, null)
  assert.equal(view.selected.value.length, 0)
})

test('refreshing and applying a VIP filter always request the current URL without a forced free filter', async () => {
  const requested = []
  const { view } = createView(async (url) => {
    requested.push(url)
    return result(url, `Resource ${requested.length}`)
  })
  const url = 'https://www.aigei.com/ue/list/?dim=is_vip_true'
  await view.scrape(url)
  await view.scrape(url)
  assert.deepEqual(requested, [url, url])
  assert.equal(view.resources.value[0].title, 'Resource 2')
})
