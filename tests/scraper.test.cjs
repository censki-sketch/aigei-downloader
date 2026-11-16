const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { createRequire } = require('node:module')
const { resolve } = require('node:path')
const { test } = require('node:test')
const ts = require('typescript')

// Compile the production parser, isolating only the Electron session and logger.
const scraperPath = resolve(__dirname, '../src/main/scraper.ts')
const requireFromScraper = createRequire(scraperPath)
const compile = (path) => ts.transpileModule(readFileSync(path, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
}).outputText
const constants = {}
new Function('exports', compile(resolve(__dirname, '../src/shared/aigei-constants.ts')))(constants)
const scraperModule = { exports: {} }
new Function('require', 'module', 'exports', compile(scraperPath))((id) => {
  if (id === './browser.js') return { getCookieString: async () => '' }
  if (id === './debug-log.js') return { log: () => {} }
  if (id === '../shared/aigei-constants.js') return constants
  return requireFromScraper(id)
}, scraperModule, scraperModule.exports)
const { parseResourcePage, scrapeResourcePage, scrapeItemPage } = scraperModule.exports

const baseUrl = 'https://www.aigei.com/ue/list/military_weapons_4?page=2'
function card(id, { link = true, vip = false } = {}) {
  return `<div id="unitBox_item-${id}" itemid="${id}" js-item-code="code_${id}">
    <ul class="unit-content-main"><li><div class="mpic"><img src="//cdn.example/preview-${id}.jpg"></div>
      <span class="js-item-box-vip-with-sell-wrap">${vip ? '<span js-unit-isvip="true"></span>' : ''}</span></li>
      <li class="resc-info-bottom-info-name" title="Resource ${id}"><b class="trans-title">Resource ${id}</b></li>
      <li><span class="item-info-bottom-down">${id}</span><span class="format_desc">ue</span>
      <span class="item-info-bottom-file-size" title="文件体积:42m">42m</span></li></ul>
    ${link ? `<div class="item-view-url"><a href="/item/code_${id}.html">Resource ${id}</a></div>` : ''}
  </div>`
}
function page(cards, current = 2, total = 17) {
  return `<nav><a href="/3d/model/">3D</a><a href="/game/spine/">Spine</a></nav>
    <div id="resContainer"><div class="f-pager"><b class="pageInfo_currentPage">${current}</b>
    <i class="pageInfo_totalPage">${total}</i></div><div id="searchContainer">${cards}</div></div>
    <aside>${card(999)}</aside>`
}

test('reads all 40 cards, including nine without anchors, and excludes navigation/recommendations', () => {
  const cards = Array.from({ length: 40 }, (_, i) => card(i + 1, { link: i >= 9, vip: i === 10 })).join('')
  const result = parseResourcePage(page(cards), baseUrl)
  assert.equal(result.items.length, 40)
  assert.deepEqual(result.items.map((item) => item.itemId), Array.from({ length: 40 }, (_, i) => String(i + 1)))
  assert.equal(result.items[0].url, 'https://www.aigei.com/item/code_1.html')
  assert.equal(result.items[0].thumbnail, 'https://cdn.example/preview-1.jpg')
  assert.equal(result.items[0].format, 'UE')
  assert.equal(result.items[0].size, '42m')
  assert.equal(result.items[0].downloadCount, '1')
  assert.equal(result.items[0].fileType, 'ue')
  assert.equal(result.items[0].isVip, false)
  assert.equal(result.items[0].licenseType, undefined)
  assert.equal(result.items[10].isVip, true)
  assert.equal(result.items[10].licenseType, 'VIP')
})

test('deduplicates by resource ID and does not borrow metadata from the next card', () => {
  const html = page(card(1, { link: false }) + card(1) + card(2, { vip: true }))
  const result = parseResourcePage(html, baseUrl)
  assert.equal(result.items.length, 2)
  assert.equal(result.items[0].isVip, false)
  assert.equal(result.items[0].format, 'UE')
  assert.equal(result.items[1].isVip, true)
})

test('keeps filters while paging and disables next on the last page without padding the count', () => {
  const url = `${baseUrl}&dim=is_vip_true&sort=down`
  const result = parseResourcePage(page(card(1), 2, 2), url)
  assert.equal(result.items.length, 1)
  assert.equal(result.currentPage, 2)
  assert.equal(result.totalPages, 2)
  assert.equal(result.nextUrl, undefined)
  const previous = new URL(result.previousUrl)
  assert.equal(previous.searchParams.get('dim'), 'is_vip_true')
  assert.equal(previous.searchParams.get('sort'), 'down')
  assert.equal(previous.searchParams.has('page'), false)
})

test('reads JavaScript pagination buttons and does not treat category suffixes as page numbers', () => {
  const html = `<div id="resContainer"><div id="searchContainer">${card(1)}</div>
    <div class="f-pager"><a href="javascript:;" class="fp-prev disabled">上一页</a>
    <a href="javascript:;" title="下一页" js-param-pagenum="2">&gt;</a></div></div>`
  const result = parseResourcePage(html, 'https://www.aigei.com/ue/list/military_weapons_4')
  assert.equal(result.currentPage, 1)
  assert.equal(result.previousUrl, undefined)
  assert.equal(new URL(result.nextUrl).searchParams.get('page'), '2')
})

test('a homepage without pagination has its actual card count and no invented next page', () => {
  const result = parseResourcePage(`<div id="resContainer">${card(1)}${card(2)}</div>`, baseUrl)
  assert.equal(result.items.length, 2)
  assert.equal(result.nextUrl, undefined)
  assert.equal(result.previousUrl, undefined)
  assert.equal(parseResourcePage('<nav><a href="/item/foo.html">Navigation</a></nav>', baseUrl).items.length, 0)
})

test('scraping preserves free, VIP, copyright, and unrestricted URLs exactly', async () => {
  const originalFetch = global.fetch
  const requested = []
  global.fetch = async (url) => {
    requested.push(url)
    return { ok: true, status: 200, url, text: async () => page(card(1)) }
  }
  try {
    for (const suffix of ['', '?dim=is_vip_true', '?dim=copyright_resource', '?term=is_vip_false']) {
      const url = `https://www.aigei.com/game/index/${suffix}`
      const result = await scrapeResourcePage(url)
      assert.equal(result.currentUrl, url)
      assert.equal(requested.at(-1), url)
    }
  } finally {
    global.fetch = originalFetch
  }
})

test('detail expansion preserves the numeric download ID instead of replacing it with a slug', async () => {
  const originalFetch = global.fetch
  global.fetch = async (url) => ({ ok: true, status: 200, url,
    text: async () => '<title>Resource</title><div class="item-page-prev-container" itemid="60260824"></div>' })
  try {
    assert.equal((await scrapeItemPage('https://www.aigei.com/item/655073315504.html')).itemId, '60260824')
  } finally {
    global.fetch = originalFetch
  }
})

if (process.env.AIGEI_LIST_FIXTURE) {
  test('the captured UE military weapons second page contains all 40 resources', () => {
    const result = parseResourcePage(readFileSync(process.env.AIGEI_LIST_FIXTURE, 'utf8'), baseUrl)
    assert.equal(result.items.length, 40)
    assert.equal(result.items[1].itemId, '60260824')
    assert.equal(result.items[1].url, 'https://www.aigei.com/item/655073315504.html')
    assert.equal(result.currentPage, 2)
    assert.equal(result.totalPages, 17)
    assert.equal(result.items.some((item) => ['3D', 'Spine'].includes(item.title)), false)
  })
}

for (const [category, variable, expected] of [
  ['game', 'AIGEI_GAME_FIXTURE', 40],
  ['sound', 'AIGEI_SOUND_FIXTURE', 20]
]) {
  if (process.env[variable]) {
    test(`the captured ${category} page keeps its actual ${expected} cards`, () => {
      const result = parseResourcePage(readFileSync(process.env[variable], 'utf8'),
        `https://www.aigei.com/${category}/`)
      assert.equal(result.items.length, expected)
      assert.equal(new Set(result.items.map((item) => item.itemId)).size, expected)
      assert.equal(result.items.some((item) => ['3D', 'Spine'].includes(item.title)), false)
      assert.equal(result.currentPage, 1)
      assert.equal(result.totalPages, 200)
    })
  }
}
