<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { CopyDocument, Delete, Download, Files, FolderOpened, Refresh, Search, View } from '@element-plus/icons-vue'
import { api } from '../api'

const router = useRouter()
const history = ref<any[]>([])
const loading = ref(false)
const keyword = ref('')
const archiveDialogVisible = ref(false)
const archiveLoading = ref(false)
const archiveInspection = ref<any | null>(null)
const archiveTarget = ref<any | null>(null)
const extractingId = ref<number | null>(null)

const filteredHistory = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return history.value
  return history.value.filter((row) => searchableText(row).includes(kw))
})

const archiveEntries = computed(() => archiveInspection.value?.entries || [])

const archiveDialogTitle = computed(() => {
  if (!archiveTarget.value?.title) return '压缩包内容'
  return `压缩包内容 - ${archiveTarget.value.title}`
})

const getPath = (row: any): string => {
  return row.filePath || row.savePath || ''
}

const searchableText = (row: any): string => {
  return [
    row.title,
    row.fileType,
    row.format,
    row.duration,
    row.description,
    row.author,
    row.category,
    row.url,
    row.detailUrl,
    getPath(row),
    row.extractedPath,
    archiveFormatText(row.archiveSummary?.formats),
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

const archiveFormatText = (formats?: Record<string, number>): string => {
  if (!formats) return '-'
  const entries = Object.entries(formats)
    .filter(([, count]) => Number(count) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, 4)
  if (entries.length === 0) return '-'
  return entries.map(([format, count]) => `${format} ${count}`).join(' / ')
}

const formatBytes = (bytes?: number): string => {
  if (!bytes || bytes === 0) return '-'
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let val = bytes
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024
    i++
  }
  return `${val.toFixed(1)} ${units[i]}`
}

const formatDate = (value?: number | string): string => {
  if (!value) return '-'
  const date = typeof value === 'number' ? new Date(value) : new Date(String(value).replace(' ', 'T'))
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString('zh-CN')
}

const loadHistory = async () => {
  loading.value = true
  try {
    history.value = await api.history.list()
  } finally {
    loading.value = false
  }
}

const clearHistory = async () => {
  if (history.value.length === 0) return
  try {
    await ElMessageBox.confirm('确定要清空下载历史吗？', '确认', { type: 'warning' })
    await api.history.clear()
    await loadHistory()
    ElMessage.success('下载历史已清空')
  } catch {
    // 取消
  }
}

const copyPath = async (row: any) => {
  const targetPath = getPath(row)
  if (!targetPath) return
  try {
    await navigator.clipboard.writeText(targetPath)
    ElMessage.success('路径已复制')
  } catch {
    ElMessage.warning('复制失败，请手动复制路径')
  }
}

const openLocation = async (row: any) => {
  const targetPath = getPath(row)
  if (!targetPath) return
  try {
    await api.system.showItemInFolder(targetPath)
  } catch (e: any) {
    ElMessage.error('打开位置失败: ' + e.message)
  }
}

const openExtractedPath = async (row: any) => {
  if (!row.extractedPath) return
  try {
    await api.system.openPath(row.extractedPath)
  } catch (e: any) {
    ElMessage.error('打开目录失败: ' + e.message)
  }
}

const openHistoryDetail = (row: any) => {
  const targetUrl = row.detailUrl || row.url
  if (!targetUrl) return
  router.push({ path: '/verify', query: { url: targetUrl } })
}

const inspectHistoryArchive = async (row: any) => {
  if (!row.id) return
  archiveTarget.value = row
  archiveInspection.value = null
  archiveDialogVisible.value = true
  archiveLoading.value = true
  try {
    archiveInspection.value = await api.history.inspectArchive(row.id)
  } catch (e: any) {
    archiveDialogVisible.value = false
    ElMessage.error('查看压缩包失败: ' + e.message)
  } finally {
    archiveLoading.value = false
  }
}

const extractHistoryArchive = async (row: any) => {
  if (!row.id) return
  try {
    extractingId.value = Number(row.id)
    const result = await api.history.extractArchive(row.id)
    Object.assign(row, {
      extractedPath: result.extractedPath,
      extractedAt: result.extractedAt,
      archiveEntryCount: result.inspection?.fileCount,
      archiveSummary: result.archiveSummary
    })
    if (archiveTarget.value?.id === row.id) {
      archiveTarget.value = row
      archiveInspection.value = result.inspection
    }
    ElMessage.success('解压完成')
  } catch (e: any) {
    ElMessage.error('解压失败: ' + e.message)
  } finally {
    extractingId.value = null
  }
}

onMounted(() => {
  void loadHistory()
})
</script>

<template>
  <div class="history-view">
    <el-card class="history-card" v-loading="loading" shadow="never">
      <template #header>
        <div class="header">
          <div class="title-block">
            <span>下载历史</span>
            <span class="count">显示 {{ filteredHistory.length }} / 共 {{ history.length }} 条</span>
          </div>
          <div class="actions">
            <el-input
              v-model="keyword"
              class="search-input"
              size="small"
              clearable
              :prefix-icon="Search"
              placeholder="搜索标题、标签、分类、格式、路径"
            />
            <el-button size="small" :icon="Refresh" @click="loadHistory" :loading="loading">刷新</el-button>
            <el-button size="small" type="danger" plain :icon="Delete" :disabled="history.length === 0" @click="clearHistory">
              清空
            </el-button>
          </div>
        </div>
      </template>

      <div v-if="filteredHistory.length === 0" class="empty-pane">
        <el-empty :description="history.length === 0 ? '暂无下载历史' : '没有匹配的历史记录'" />
      </div>

      <div v-else class="table-pane">
        <el-table :data="filteredHistory" height="100%" stripe>
          <el-table-column label="资源" min-width="330">
            <template #default="{ row }">
              <div class="title-cell">
                <button class="title-link" :title="row.detailUrl || row.url" @click="openHistoryDetail(row)">
                  {{ row.title || '未命名资源' }}
                </button>
                <div v-if="row.detailUrl || row.url" class="url-text">{{ row.detailUrl || row.url }}</div>
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
          <el-table-column label="文件信息" min-width="300">
            <template #default="{ row }">
              <div class="meta-grid">
                <span><em>类型</em><strong>{{ row.fileType || '-' }}</strong></span>
                <span><em>格式</em><strong>{{ row.format || archiveFormatText(row.archiveSummary?.formats) }}</strong></span>
                <span><em>时长</em><strong>{{ row.duration || '-' }}</strong></span>
                <span><em>大小</em><strong>{{ formatBytes(row.fileSize || row.totalBytes) }}</strong></span>
                <span><em>文件数</em><strong>{{ row.archiveEntryCount || row.archiveSummary?.fileCount || '-' }}</strong></span>
                <span><em>下载时间</em><strong>{{ formatDate(row.createdAt || row.finishedAt) }}</strong></span>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="保存路径" min-width="300">
            <template #default="{ row }">
              <div class="path-cell">
                <span class="path-text">{{ getPath(row) || '-' }}</span>
                <span v-if="row.extractedPath" class="path-text extracted">已解压：{{ row.extractedPath }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="230" fixed="right">
            <template #default="{ row }">
              <div class="row-actions">
                <el-button size="small" :icon="FolderOpened" @click="openLocation(row)">位置</el-button>
                <el-button size="small" :icon="View" @click="inspectHistoryArchive(row)">内容</el-button>
                <el-button
                  size="small"
                  type="primary"
                  plain
                  :icon="Download"
                  :loading="extractingId === Number(row.id)"
                  @click="extractHistoryArchive(row)"
                >
                  解压
                </el-button>
                <el-button v-if="row.extractedPath" size="small" :icon="Files" @click="openExtractedPath(row)">目录</el-button>
                <el-button size="small" :icon="CopyDocument" @click="copyPath(row)">复制</el-button>
              </div>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </el-card>

    <el-dialog
      v-model="archiveDialogVisible"
      :title="archiveDialogTitle"
      width="760px"
      top="7vh"
      append-to-body
    >
      <div class="archive-dialog" v-loading="archiveLoading">
        <div v-if="archiveInspection" class="archive-summary">
          <span><em>文件</em><strong>{{ archiveInspection.fileCount }}</strong></span>
          <span><em>目录</em><strong>{{ archiveInspection.directoryCount }}</strong></span>
          <span><em>体积</em><strong>{{ formatBytes(archiveInspection.totalSize) }}</strong></span>
          <span><em>格式</em><strong>{{ archiveFormatText(archiveInspection.formats) }}</strong></span>
        </div>
        <el-table v-if="archiveInspection" :data="archiveEntries" height="360" size="small" stripe>
          <el-table-column prop="path" label="路径" min-width="360" show-overflow-tooltip />
          <el-table-column label="格式" width="90">
            <template #default="{ row }">{{ row.isDirectory ? '目录' : row.extension || '-' }}</template>
          </el-table-column>
          <el-table-column label="大小" width="110">
            <template #default="{ row }">{{ row.isDirectory ? '-' : formatBytes(row.size) }}</template>
          </el-table-column>
          <el-table-column label="修改时间" width="170">
            <template #default="{ row }">{{ formatDate(row.modifiedAt) }}</template>
          </el-table-column>
        </el-table>
      </div>
      <template #footer>
        <div class="dialog-footer">
          <span v-if="archiveTarget?.extractedPath" class="filter-url">已解压到 {{ archiveTarget.extractedPath }}</span>
          <span v-else></span>
          <div class="filter-actions">
            <el-button v-if="archiveTarget?.extractedPath" :icon="Files" @click="openExtractedPath(archiveTarget)">打开目录</el-button>
            <el-button
              type="primary"
              :icon="Download"
              :loading="archiveTarget && extractingId === Number(archiveTarget.id)"
              :disabled="!archiveTarget"
              @click="archiveTarget && extractHistoryArchive(archiveTarget)"
            >
              解压
            </el-button>
          </div>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.history-view {
  height: 100%;
  min-height: 0;
  display: flex;
  overflow: hidden;
}

.history-card {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.history-card :deep(.el-card__header) {
  padding: 10px 12px;
}

.history-card :deep(.el-card__body) {
  flex: 1;
  min-height: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
}

.title-block,
.actions {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.count {
  color: #909399;
  font-size: 13px;
  white-space: nowrap;
}

.actions {
  flex-shrink: 0;
}

.search-input {
  width: 300px;
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

.title-cell,
.path-cell {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
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

.url-text,
.path-text {
  min-width: 0;
  color: #909399;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.path-text.extracted {
  color: #67c23a;
}

.tag-line {
  min-height: 24px;
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
  overflow: hidden;
}

.meta-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(118px, 1fr));
  gap: 7px 10px;
}

.meta-grid span,
.archive-summary span {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
}

.meta-grid em,
.archive-summary em {
  flex-shrink: 0;
  color: #909399;
  font-size: 12px;
  font-style: normal;
}

.meta-grid strong,
.archive-summary strong {
  min-width: 0;
  color: #606266;
  font-size: 12px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.archive-dialog {
  min-height: 430px;
}

.archive-summary {
  margin-bottom: 12px;
  padding: 10px 12px;
  border: 1px solid #ebeef5;
  border-radius: 6px;
  background: #f8fafc;
  display: grid;
  grid-template-columns: repeat(4, minmax(100px, 1fr));
  gap: 10px;
}

.dialog-footer {
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
  .header {
    align-items: stretch;
    flex-direction: column;
  }

  .actions,
  .search-input {
    width: 100%;
  }

  .actions {
    flex-wrap: wrap;
  }
}
</style>
