<script setup lang="ts">
import { computed, ref, reactive, onMounted, onUnmounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, ArrowRight, Download, Filter, Link, Picture, Refresh, Search, User, VideoPlay } from '@element-plus/icons-vue'
import { useRouter } from 'vue-router'
import { api } from '../api'
import type { ResourcePageResult } from '../../shared/types'

defineOptions({ name: 'BrowserView' })

const router = useRouter()
const loading = ref(false)
const DEFAULT_LIST_URL = 'https://www.aigei.com/sound/class/'
const urlInput = ref(DEFAULT_LIST_URL)
const keyword = ref('')
const resources = ref<any[]>([])
const selected = ref<any[]>([])
const pageInfo = ref<ResourcePageResult | null>(null)
const advancedFilterVisible = ref(false)
const advancedFilterUrl = ref(DEFAULT_LIST_URL)
const advancedFilterCurrentUrl = ref(DEFAULT_LIST_URL)
const advancedFilterLoading = ref(false)
const advancedFilterWebviewRef = ref<any>(null)
let hasAutoScraped = false
let unsubLoginSuccess: (() => void) | null = null
const pageCache = new Map<string, ResourcePageResult>()

const categories = reactive([
  { name: '音效', url: 'https://www.aigei.com/sound/class/' },
  { name: '配乐', url: 'https://www.aigei.com/music/class/' },
  { name: '视频', url: 'https://www.aigei.com/video/index/' },
  { name: '3D', url: 'https://www.aigei.com/3d/model/' },
  { name: '平面', url: 'https://www.aigei.com/design/index/' },
  { name: '游戏', url: 'https://www.aigei.com/game/index/' },
  { name: '教程', url: 'https://www.aigei.com/course/all/' }
])

const filteredResources = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return resources.value
  return resources.value.filter((row) => searchableText(row).includes(kw))
})

const activeCategory = computed(() => {
  const current = normalizeAigeiUrl(pageInfo.value?.currentUrl || urlInput.value)
  return categories.find((category) => {
    const target = new URL(category.url)
    const actual = new URL(current)
    return actual.hostname === target.hostname && actual.pathname.startsWith(target.pathname)
  })?.name || ''
})

const scrape = async (url?: string, options: { silent?: boolean; force?: boolean } = {}) => {
  const targetUrl = normalizeAigeiUrl(url || urlInput.value)
  if (!targetUrl) {
    ElMessage.warning('请输入资源列表页 URL')
    return
  }
  if (loading.value) return
  loading.value = true
  try {
    urlInput.value = targetUrl
    advancedFilterUrl.value = targetUrl
    advancedFilterCurrentUrl.value = targetUrl
    let result = !options.force ? pageCache.get(targetUrl) : undefined
    if (!result) {
      result = await api.scrape.page(targetUrl)
      pageCache.set(result.currentUrl, result)
      pageCache.set(targetUrl, result)
    }
    resources.value = result.items
    pageInfo.value = result
    urlInput.value = result.currentUrl
    selected.value = []
    if (resources.value.length === 0) {
      if (!options.silent) ElMessage.warning('未抓取到资源，可能需要先登录或页面结构有变化')
    } else if (!options.silent) {
      ElMessage.success(`抓取到 ${resources.value.length} 个资源`)
    }
  } catch (e: any) {
    const message = e?.message || '未知错误'
    if (/安全验证|验证码|访问验证/.test(message)) {
      if (!options.silent) ElMessage.warning(message)
      router.push({ path: '/verify', query: { url: targetUrl } })
    } else if (!options.silent) {
      ElMessage.error('抓取失败: ' + message)
    }
  } finally {
    loading.value = false
  }
}

const goToPage = async (url?: string) => {
  if (!url || loading.value) return
  await scrape(url)
}

const normalizeAigeiUrl = (value: string): string => {
  try {
    const url = new URL(value || DEFAULT_LIST_URL, DEFAULT_LIST_URL)
    return url.toString()
  } catch {
    return DEFAULT_LIST_URL
  }
}

const inferSearchType = (value: string): string => {
  try {
    const url = new URL(value || DEFAULT_LIST_URL, DEFAULT_LIST_URL)
    const fromQuery = url.searchParams.get('type')
    if (fromQuery) return fromQuery
    const match = url.pathname.match(/\/(sound|music|video|3d|design|image|psd|game|course|software)\//i)
    return match?.[1]?.toLowerCase() === 'psd' ? 'design' : match?.[1]?.toLowerCase() || 'sound'
  } catch {
    return 'sound'
  }
}

const searchSite = async () => {
  const query = keyword.value.trim()
  if (!query) {
    ElMessage.warning('请输入搜索关键词')
    return
  }
  const searchUrl = new URL('/s', DEFAULT_LIST_URL)
  searchUrl.searchParams.set('q', query)
  searchUrl.searchParams.set('type', inferSearchType(urlInput.value))
  await scrape(searchUrl.toString())
}

const autoScrapeOnce = async () => {
  if (hasAutoScraped || loading.value || resources.value.length > 0) return
  try {
    const status = await api.login.check()
    if (!status?.isLoggedIn) return
    hasAutoScraped = true
    await scrape(DEFAULT_LIST_URL, { silent: true })
  } catch {
    // 启动自动抓取失败时保持安静，避免和登录状态提示叠在一起。
  }
}

const handleSelectionChange = (rows: any[]) => {
  selected.value = rows
}

const handleExpandChange = (row: any, expandedRows: any[]) => {
  if (!expandedRows.includes(row) || row.__detailStatus === 'loaded' || row.__detailStatus === 'loading') return
  void loadResourceDetail(row)
}

const loadResourceDetail = async (row: any) => {
  const targetUrl = row.detailUrl || row.url
  if (!targetUrl) return
  row.__detailStatus = 'loading'
  row.__detailError = ''
  try {
    const detail = await api.scrape.item(targetUrl)
    const tags = Array.from(new Set([...normalizeList(row.tags), ...normalizeList(detail.tags)]))
    const categoryPath = Array.from(new Set([...normalizeList(row.categoryPath), ...normalizeList(detail.categoryPath)]))
    Object.assign(row, {
      ...detail,
      sourceUrl: row.sourceUrl,
      detailUrl: row.detailUrl || detail.detailUrl || detail.url,
      thumbnail: detail.thumbnail || row.thumbnail,
      previewUrl: detail.previewUrl || row.previewUrl,
      description: detail.description || row.description,
      category: row.category || detail.category || categoryPath[0],
      categoryPath,
      tags,
      metadata: { ...(row.metadata || {}), ...(detail.metadata || {}) },
      __detailStatus: 'loaded',
      __detailError: ''
    })
  } catch (e: any) {
    const message = e?.message || '详情加载失败'
    row.__detailStatus = 'error'
    row.__detailError = message
    if (/安全验证|验证码|访问验证|限制.*IP|限制.*频率/.test(message)) {
      ElMessage.warning(message)
      router.push({ path: '/verify', query: { url: targetUrl } })
    }
  }
}

const loadAudioPreview = async (row: any) => {
  if (row.previewUrl || row.__previewLoading) return
  row.__previewLoading = true
  await loadResourceDetail(row)
  row.__previewLoading = false
  if (!row.previewUrl && row.__detailStatus === 'loaded') ElMessage.info('该资源暂未提供可用试听地址')
}

const pasteUrl = async () => {
  try {
    const text = await navigator.clipboard?.readText()
    if (!text) {
      ElMessage.info('剪贴板里没有可用地址')
      return
    }
    urlInput.value = text.trim()
  } catch {
    ElMessage.warning('无法读取剪贴板，请手动粘贴 URL')
  }
}

const openAdvancedFilter = () => {
  const targetUrl = normalizeAigeiUrl(urlInput.value)
  advancedFilterUrl.value = targetUrl
  advancedFilterCurrentUrl.value = targetUrl
  advancedFilterLoading.value = true
  advancedFilterVisible.value = true
}

const reloadAdvancedFilter = () => {
  advancedFilterLoading.value = true
  advancedFilterWebviewRef.value?.reload()
}

const syncAdvancedFilterUrl = async () => {
  const wv = advancedFilterWebviewRef.value
  if (!wv) return advancedFilterCurrentUrl.value
  try {
    const url = wv.getURL?.() || await wv.executeJavaScript('window.location.href')
    advancedFilterCurrentUrl.value = normalizeAigeiUrl(url)
  } catch {
    // keep current URL
  }
  return advancedFilterCurrentUrl.value
}

const applyAdvancedFilter = async () => {
  const url = await syncAdvancedFilterUrl()
  advancedFilterVisible.value = false
  await scrape(url)
}

const handleAdvancedFilterAttach = () => {
  const wv = advancedFilterWebviewRef.value
  if (!wv || wv.__aigeiFilterBound) return
  wv.__aigeiFilterBound = true

  const updateUrl = (event?: any) => {
    if (event?.url) advancedFilterCurrentUrl.value = normalizeAigeiUrl(event.url)
    else void syncAdvancedFilterUrl()
  }

  const injectFilterStyles = async () => {
    await wv.insertCSS(`
      html, body {
        min-width: 0 !important;
        width: 100% !important;
        background: #fff !important;
        overflow: auto !important;
      }
      body {
        padding: 0 18px 32px !important;
      }
      .navbar,
      .main-top-nav,
      .search-page-head-nav,
      .site-logo,
      #loginTopBar,
      #searchBar,
      .footer,
      .publish-container,
      .friend-links,
      .bottom-span,
      .fixed-right,
      .right-fixed,
      .right-aside,
      .main-fixed,
      .modal-backdrop,
      .clear-all,
      [class*="advert"],
      [class*="adver"],
      [class*="float"] {
        display: none !important;
      }
      .main-container-screen,
      .main-container-screen-search,
      .main-container-screen-narrow,
      .view-page-head-nav-container,
      .head-nav-container,
      .search-container,
      #resContainer {
        width: 100% !important;
        min-width: 0 !important;
        max-width: none !important;
        margin-left: 0 !important;
        margin-right: 0 !important;
      }
      .tab-mount-content-container,
      #tab-mount-content,
      .pagination,
      .pager,
      .pagebar,
      .publish-link {
        display: none !important;
      }
      #dimContainer_hold,
      #dimSelectorContainer,
      #resContainer,
      #dimContainer,
      .dim-selector,
      .tab-mount-nav-container,
      [class*="dim-selector"] {
        display: block !important;
        visibility: visible !important;
      }
    `).catch(() => {})

    await wv.executeJavaScript(`
      (function() {
        var target = document.querySelector('#dimSelectorContainer, #dimContainer, #dimContainer_hold, .dim-selector, .tab-mount-nav-container');
        if (target && target.scrollIntoView) target.scrollIntoView({ block: 'start' });
      })();
    `).catch(() => {})
  }

  wv.addEventListener('did-start-loading', () => {
    advancedFilterLoading.value = true
  })
  wv.addEventListener('dom-ready', () => {
    void injectFilterStyles()
  })
  wv.addEventListener('did-stop-loading', () => {
    advancedFilterLoading.value = false
    void injectFilterStyles()
    void syncAdvancedFilterUrl()
  })
  wv.addEventListener('did-navigate', updateUrl)
  wv.addEventListener('did-navigate-in-page', updateUrl)
}

const openVerify = () => {
  router.push('/verify')
}

const openResourceDetail = (row: any) => {
  const targetUrl = row.detailUrl || row.sourceUrl || row.url
  if (!targetUrl) return
  router.push({ path: '/verify', query: { url: targetUrl } })
}

const downloadSelected = async () => {
  if (selected.value.length === 0) {
    ElMessage.warning('请先勾选要下载的资源')
    return
  }
  try {
    await ElMessageBox.confirm(
      `确定要下载选中的 ${selected.value.length} 个资源吗？`,
      '确认下载',
      { type: 'info' }
    )
    const items = selected.value.map(resourceToDownloadInput).filter((item) => item.url)
    await api.download.addBatch(items)
    ElMessage.success(`已添加 ${items.length} 个任务到下载队列`)
    router.push('/downloads')
  } catch {
    // 取消
  }
}

const downloadOne = async (row: any) => {
  try {
    await api.download.add(resourceToDownloadInput(row))
    ElMessage.success(`已添加「${row.title}」到下载队列`)
  } catch (e: any) {
    ElMessage.error('添加失败: ' + e.message)
  }
}

const resourceToDownloadInput = (row: any) => ({
  itemId: row.itemId,
  url: row.url || row.detailUrl || row.sourceUrl,
  title: row.title || row.url || '未命名资源',
  type: row.fileType,
  fileType: row.fileType,
  thumbnail: row.thumbnail,
  detailUrl: row.detailUrl || row.url,
  sourceUrl: row.sourceUrl || row.url,
  previewUrl: row.previewUrl,
  description: row.description,
  category: row.category,
  categoryPath: normalizeList(row.categoryPath),
  tags: normalizeList(row.tags),
  licenseType: row.licenseType,
  format: row.format,
  duration: row.duration,
  downloadCount: row.downloadCount,
  uploadTime: row.uploadTime,
  author: row.author,
  metadata: row.metadata
})

const searchableText = (row: any): string => {
  return [
    row.title,
    row.fileType,
    row.size,
    row.description,
    row.category,
    row.licenseType,
    row.format,
    row.duration,
    row.downloadCount,
    row.uploadTime,
    row.author,
    row.url,
    row.detailUrl,
    ...normalizeList(row.categoryPath),
    ...normalizeList(row.tags)
  ].filter(Boolean).join(' ').toLowerCase()
}

const normalizeList = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.filter(Boolean).map(String)
  if (typeof value === 'string' && value.trim()) return [value.trim()]
  return []
}

const visibleTags = (row: any): string[] => normalizeList(row.tags).slice(0, 6)

const categoryText = (row: any): string => {
  const path = normalizeList(row.categoryPath)
  if (path.length > 0) return path.join(' / ')
  return row.category || '-'
}

const isAudioResource = (row: any): boolean => {
  const type = String(row.fileType || '').toLowerCase()
  const format = String(row.format || '').toLowerCase()
  return ['sound', 'music', 'audio', 'audio_mp3'].includes(type) || ['mp3', 'wav', 'ogg', 'm4a', 'aac'].includes(format)
}

const markThumbnailBroken = (row: any) => {
  row.thumbnail = ''
}

const formatSize = (size?: string) => size || '-'

onMounted(() => {
  void autoScrapeOnce()
  unsubLoginSuccess = api.login.onSuccess(() => {
    void autoScrapeOnce()
  })
})

onUnmounted(() => {
  if (unsubLoginSuccess) unsubLoginSuccess()
})
</script>

<template>
  <div class="browser-view">
    <el-card class="url-card" shadow="never">
      <div class="url-input-row">
        <el-input
          v-model="urlInput"
          class="url-input"
          placeholder="输入爱给网资源列表页 URL"
          size="default"
          @keyup.enter="scrape()"
        >
          <template #prepend>URL</template>
        </el-input>
        <el-button :icon="Link" @click="pasteUrl">粘贴</el-button>
        <el-button :icon="Filter" @click="openAdvancedFilter">高级筛选</el-button>
        <el-button type="primary" :icon="Search" @click="scrape(undefined, { force: true })" :loading="loading">
          抓取
        </el-button>
        <el-button
          :type="selected.length > 0 ? 'success' : 'info'"
          :icon="Download"
          :disabled="selected.length === 0"
          @click="downloadSelected"
        >下载选中（{{ selected.length }}）</el-button>
      </div>
      <div class="quick-row">
        <div class="search-controls">
          <el-input
            v-model="keyword"
            class="keyword-input"
            clearable
            :prefix-icon="Search"
            placeholder="搜索资源：标题、标签、分类、格式"
            @keyup.enter="searchSite"
          />
          <el-button :icon="Search" @click="searchSite" :loading="loading">站内搜索</el-button>
        </div>
        <div class="categories">
          <span class="label">快捷分类</span>
          <el-button
            v-for="cat in categories"
            :key="cat.url"
            size="small"
            :type="activeCategory === cat.name ? 'primary' : 'default'"
            :plain="activeCategory !== cat.name"
            @click="scrape(cat.url)"
          >
            {{ cat.name }}
          </el-button>
        </div>
      </div>
    </el-card>

    <el-card class="list-card" v-loading="loading" shadow="never">
      <div v-if="filteredResources.length === 0 && !loading" class="empty-pane">
        <el-empty :description="resources.length === 0 ? '暂无资源，请输入 URL 抓取' : '没有匹配的资源'">
          <template #extra>
            <el-button type="primary" :icon="Search" @click="scrape(undefined, { force: true })">抓取当前 URL</el-button>
            <el-button :icon="User" @click="openVerify">网页登录验证</el-button>
          </template>
        </el-empty>
      </div>

      <div v-else class="table-pane">
        <el-table
          :data="filteredResources"
          @selection-change="handleSelectionChange"
          @expand-change="handleExpandChange"
          height="100%"
          stripe
        >
          <el-table-column type="selection" width="42" />
          <el-table-column type="expand" width="42">
            <template #default="{ row }">
              <div class="detail-panel">
                <div v-if="row.__detailStatus === 'loading'" class="detail-state">正在加载详情...</div>
                <div v-else-if="row.__detailStatus === 'error'" class="detail-state error">
                  <span>{{ row.__detailError }}</span>
                  <el-button size="small" @click="loadResourceDetail(row)">重试</el-button>
                </div>
                <div v-else class="detail-content">
                  <div><span>作者</span><strong>{{ row.author || '-' }}</strong></div>
                  <div><span>上传时间</span><strong>{{ row.uploadTime || '-' }}</strong></div>
                  <div><span>资源编号</span><strong>{{ row.itemId || '-' }}</strong></div>
                  <div><span>详情状态</span><strong>已缓存，30 分钟内不会重复请求</strong></div>
                  <p v-if="row.description">{{ row.description }}</p>
                </div>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="预览" width="150">
            <template #default="{ row }">
              <div class="preview-box">
                <audio
                  v-if="isAudioResource(row) && row.previewUrl"
                  class="audio-preview"
                  :src="row.previewUrl"
                  preload="none"
                  controls
                ></audio>
                <el-button
                  v-else-if="isAudioResource(row)"
                  class="audio-load-button"
                  circle
                  :icon="VideoPlay"
                  :loading="row.__previewLoading"
                  title="加载试听"
                  @click="loadAudioPreview(row)"
                />
                <el-image
                  v-else-if="row.thumbnail"
                  class="thumb"
                  :src="row.thumbnail"
                  :preview-src-list="[row.thumbnail]"
                  :preview-teleported="true"
                  fit="cover"
                  referrerpolicy="no-referrer"
                  @error="markThumbnailBroken(row)"
                />
                <el-icon v-else-if="String(row.fileType || '').toLowerCase().includes('video')" class="preview-icon"><VideoPlay /></el-icon>
                <el-icon v-else class="preview-icon"><Picture /></el-icon>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="资源信息" min-width="360">
            <template #default="{ row }">
              <div class="resource-cell">
                <button class="title-link" :title="row.detailUrl || row.url" @click="openResourceDetail(row)">
                  {{ row.title || '未命名资源' }}
                </button>
                <div v-if="row.description" class="description">{{ row.description }}</div>
                <div class="tag-line">
                  <el-tag v-if="categoryText(row) !== '-'" size="small" type="success" effect="plain">
                    {{ categoryText(row) }}
                  </el-tag>
                  <el-tag v-for="tag in visibleTags(row)" :key="tag" size="small" type="info" effect="plain">
                    {{ tag }}
                  </el-tag>
                </div>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="属性" min-width="260">
            <template #default="{ row }">
              <div class="meta-grid">
                <span><em>类型</em><strong>{{ row.fileType || '-' }}</strong></span>
                <span><em>格式</em><strong>{{ row.format || '-' }}</strong></span>
                <span><em>时长</em><strong>{{ row.duration || '-' }}</strong></span>
                <span><em>大小</em><strong>{{ formatSize(row.size) }}</strong></span>
                <span><em>下载</em><strong>{{ row.downloadCount || '-' }}</strong></span>
                <span><em>授权</em><strong>{{ row.licenseType || '-' }}</strong></span>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="96" fixed="right">
            <template #default="{ row }">
              <el-button size="small" type="primary" :icon="Download" @click="downloadOne(row)">下载</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
      <div v-if="pageInfo" class="pagination-bar">
        <el-button :icon="ArrowLeft" :disabled="!pageInfo.previousUrl || loading" @click="goToPage(pageInfo.previousUrl)">上一页</el-button>
        <span class="page-summary">第 {{ pageInfo.currentPage }} 页 · 本页 {{ resources.length }} 条<span v-if="keyword.trim()"> · 筛选后 {{ filteredResources.length }} 条</span></span>
        <el-button :icon="ArrowRight" :disabled="!pageInfo.nextUrl || loading" @click="goToPage(pageInfo.nextUrl)">下一页</el-button>
      </div>
    </el-card>

    <el-dialog
      v-model="advancedFilterVisible"
      title="高级筛选"
      width="88%"
      top="4vh"
      class="advanced-filter-dialog"
      append-to-body
    >
      <div class="advanced-filter-shell" v-loading="advancedFilterLoading">
        <webview
          v-if="advancedFilterVisible"
          ref="advancedFilterWebviewRef"
          class="advanced-filter-webview"
          :src="advancedFilterUrl"
          @did-attach="handleAdvancedFilterAttach"
        ></webview>
      </div>
      <template #footer>
        <div class="advanced-filter-footer">
          <span class="filter-url">{{ advancedFilterCurrentUrl }}</span>
          <div class="filter-actions">
            <el-button :icon="Refresh" @click="reloadAdvancedFilter" :loading="advancedFilterLoading">刷新网页</el-button>
            <el-button @click="advancedFilterVisible = false">取消</el-button>
            <el-button type="primary" :icon="Search" @click="applyAdvancedFilter">应用筛选</el-button>
          </div>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.browser-view {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow: hidden;
}

.url-card {
  flex: 0 0 auto;
}

.url-card :deep(.el-card__body) {
  padding: 12px;
}

.url-input-row,
.quick-row,
.categories,
.list-header,
.list-title,
.actions {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.url-input {
  min-width: 0;
}

.url-input-row .el-button {
  flex-shrink: 0;
}

.quick-row {
  margin-top: 10px;
  justify-content: space-between;
}

.keyword-input {
  width: 280px;
  flex-shrink: 0;
}

.search-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.search-controls .keyword-input {
  flex: 1;
  min-width: 0;
}

.categories {
  justify-content: flex-end;
  flex-wrap: wrap;
}

.label {
  color: #909399;
  font-size: 13px;
}

.list-header {
  justify-content: space-between;
}

.count {
  color: #909399;
  font-size: 13px;
}

.list-card {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.list-card :deep(.el-card__body) {
  flex: 1;
  min-height: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.empty-pane {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.table-pane {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.table-pane :deep(.el-table .cell) {
  line-height: 1.35;
}

.table-pane :deep(.el-table__cell) {
  padding-top: 6px;
  padding-bottom: 6px;
}

.detail-panel {
  min-height: 64px;
  padding: 12px 24px 14px 84px;
  background: #f8fafc;
}

.detail-state {
  min-height: 40px;
  display: flex;
  align-items: center;
  gap: 12px;
  color: #909399;
  font-size: 13px;
}

.detail-state.error {
  color: #f56c6c;
}

.detail-content {
  display: grid;
  grid-template-columns: repeat(4, minmax(140px, 1fr));
  gap: 8px 18px;
}

.detail-content div {
  min-width: 0;
  display: flex;
  gap: 8px;
  font-size: 12px;
}

.detail-content span {
  flex-shrink: 0;
  color: #909399;
}

.detail-content strong {
  min-width: 0;
  color: #606266;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail-content p {
  grid-column: 1 / -1;
  margin: 2px 0 0;
  color: #606266;
  font-size: 12px;
  line-height: 1.5;
}

.preview-box {
  width: 122px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border: 1px solid #ebeef5;
  border-radius: 6px;
  background: #f8fafc;
}

.audio-load-button {
  width: 36px;
  height: 36px;
  color: #409eff;
  border-color: #409eff;
}

.thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.audio-preview {
  width: 116px;
  height: 32px;
}

.preview-icon {
  color: #909399;
  font-size: 24px;
}

.preview-icon.audio {
  color: #409eff;
}

.resource-cell {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.title-link {
  min-width: 0;
  padding: 0;
  border: none;
  background: transparent;
  color: #303133;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.35;
  text-align: left;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.title-link:hover {
  color: #409eff;
}

.description {
  color: #606266;
  font-size: 12px;
  line-height: 1.45;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tag-line {
  min-height: 24px;
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: nowrap;
  max-height: 24px;
  overflow: hidden;
}

.pagination-bar {
  flex: 0 0 auto;
  min-height: 42px;
  padding: 6px 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border-top: 1px solid #ebeef5;
  background: #fff;
}

.page-summary {
  min-width: 150px;
  color: #606266;
  font-size: 13px;
  text-align: center;
}

.meta-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(96px, 1fr));
  gap: 7px 10px;
}

.meta-grid span {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
}

.meta-grid em {
  flex-shrink: 0;
  color: #909399;
  font-size: 12px;
  font-style: normal;
}

.meta-grid strong {
  min-width: 0;
  color: #606266;
  font-size: 12px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.advanced-filter-shell {
  height: 68vh;
  min-height: 520px;
  overflow: hidden;
  border: 1px solid #e4e7ed;
  border-radius: 6px;
  background: #fff;
}

.advanced-filter-webview {
  width: 100%;
  height: 100%;
  border: none;
}

.advanced-filter-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.filter-url {
  min-width: 0;
  color: #909399;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.filter-actions {
  flex-shrink: 0;
  display: flex;
  gap: 8px;
}

@media (max-width: 1100px) {
  .url-input-row,
  .quick-row,
  .list-header {
    align-items: stretch;
    flex-direction: column;
  }

  .search-controls,
  .actions {
    width: 100%;
  }

  .search-controls .keyword-input {
    width: auto;
  }

  .categories {
    justify-content: flex-start;
  }

  .detail-panel {
    padding-left: 24px;
  }

  .detail-content {
    grid-template-columns: repeat(2, minmax(140px, 1fr));
  }
}
</style>
