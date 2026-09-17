<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { CopyDocument, Delete, Download, FolderOpened, Refresh } from '@element-plus/icons-vue'
import { api } from '../api'

const router = useRouter()
const loading = ref(false)
const tasks = ref<any[]>([])
const filterStatus = ref('all')
const paused = ref(false)

const statusOptions = [
  { label: '全部', value: 'all', count: () => totalCount.value },
  { label: '等待中', value: 'pending', count: () => pendingCount.value },
  { label: '进行中', value: 'downloading', count: () => downloadingCount.value },
  { label: '已完成', value: 'completed', count: () => completedCount.value },
  { label: '失败', value: 'failed', count: () => failedCount.value }
]

const statusTagType: Record<string, string> = {
  pending: 'info',
  queued: 'info',
  downloading: 'primary',
  completed: 'success',
  failed: 'danger',
  paused: 'warning'
}

const statusLabel: Record<string, string> = {
  pending: '等待中',
  queued: '排队中',
  downloading: '下载中',
  completed: '已完成',
  failed: '失败',
  paused: '已暂停'
}

const filteredTasks = computed(() => {
  if (filterStatus.value === 'all') return tasks.value
  return tasks.value.filter((task) => task.status === filterStatus.value)
})
const totalCount = computed(() => tasks.value.length)
const pendingCount = computed(() => tasks.value.filter((task) => task.status === 'pending' || task.status === 'queued').length)
const downloadingCount = computed(() => tasks.value.filter((task) => task.status === 'downloading').length)
const completedCount = computed(() => tasks.value.filter((task) => task.status === 'completed').length)
const failedCount = computed(() => tasks.value.filter((task) => task.status === 'failed').length)
const currentSpeed = computed(() =>
  tasks.value
    .filter((task) => task.status === 'downloading')
    .reduce((sum, task) => sum + (Number(task.speed) || 0), 0)
)

const loadTasks = async () => {
  loading.value = true
  try {
    tasks.value = await api.download.list()
  } finally {
    loading.value = false
  }
}

const retryTask = async (task: any) => {
  try {
    await api.download.retry(task.id)
    ElMessage.success('已重新加入队列')
    await loadTasks()
  } catch (e: any) {
    ElMessage.error('重试失败: ' + e.message)
  }
}

const removeTask = async (task: any) => {
  try {
    await ElMessageBox.confirm('确定要从队列中移除这个任务吗？', '确认', { type: 'warning' })
    await api.download.remove(task.id)
    await loadTasks()
  } catch {
    // 取消
  }
}

const togglePause = async () => {
  if (totalCount.value === 0) return
  if (paused.value) {
    await api.download.resume()
    paused.value = false
    ElMessage.success('已恢复下载')
  } else {
    await api.download.pause()
    paused.value = true
    ElMessage.info('已暂停下载')
  }
}

const clearCompleted = async () => {
  if (completedCount.value === 0) return
  try {
    await ElMessageBox.confirm(`确定要清除 ${completedCount.value} 个已完成任务吗？`, '确认', { type: 'warning' })
    await api.download.clearCompleted()
    await loadTasks()
    ElMessage.success('已清除完成任务')
  } catch {
    // 取消
  }
}

const goBrowse = () => {
  router.push('/browser')
}

const openTaskUrl = (task: any) => {
  if (!task.url) return
  router.push({ path: '/verify', query: { url: task.url } })
}

const copyText = async (text: string, label: string) => {
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success(`${label}已复制`)
  } catch {
    ElMessage.warning(`${label}复制失败`)
  }
}

const openLocation = async (task: any) => {
  if (!task.savePath) return
  try {
    await api.system.showItemInFolder(task.savePath)
  } catch (e: any) {
    ElMessage.error('打开位置失败: ' + e.message)
  }
}

const formatBytes = (bytes: number): string => {
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

const formatSpeed = (speed: number): string => {
  if (!speed || speed === 0) return '-'
  return `${formatBytes(speed)}/s`
}

const formatProgress = (row: any): string => {
  if (row.totalBytes > 0) {
    return `${formatBytes(row.downloadedBytes)} / ${formatBytes(row.totalBytes)}`
  }
  return formatBytes(row.downloadedBytes)
}

const formatDate = (value?: number): string => {
  if (!value) return '-'
  return new Date(value).toLocaleString('zh-CN')
}

const progressPercent = (task: any): number => {
  return Math.max(0, Math.min(100, Math.round(Number(task.progress) || 0)))
}

const averageSpeed = (task: any): number => {
  const bytes = Number(task.totalBytes || task.downloadedBytes || 0)
  const startedAt = Number(task.startedAt || 0)
  const finishedAt = Number(task.finishedAt || 0)
  if (!bytes || !startedAt || !finishedAt || finishedAt <= startedAt) return 0
  return bytes / ((finishedAt - startedAt) / 1000)
}

const displaySpeed = (task: any): string => {
  const speed = task.status === 'completed' ? Number(task.speed || averageSpeed(task)) : Number(task.speed || 0)
  return formatSpeed(speed)
}

const speedLabel = (task: any): string => {
  if (task.status === 'completed') return '平均速度'
  if (task.status === 'downloading') return '当前速度'
  return '速度'
}

const formatDuration = (task: any): string => {
  const startedAt = Number(task.startedAt || 0)
  const finishedAt = Number(task.finishedAt || 0)
  if (!startedAt) return '-'
  const endAt = finishedAt || Date.now()
  const seconds = Math.max(0, Math.round((endAt - startedAt) / 1000))
  if (seconds < 60) return `${seconds} 秒`
  const minutes = Math.floor(seconds / 60)
  const restSeconds = seconds % 60
  if (minutes < 60) return `${minutes} 分 ${restSeconds} 秒`
  const hours = Math.floor(minutes / 60)
  return `${hours} 小时 ${minutes % 60} 分`
}

let unsubProgress: (() => void) | null = null
let unsubStatus: (() => void) | null = null
let timer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  void loadTasks()
  unsubProgress = api.download.onProgress((data: any) => {
    const task = tasks.value.find((item) => item.id === data.id)
    if (task) {
      task.progress = data.progress
      task.downloadedBytes = data.downloadedBytes
      task.totalBytes = data.totalBytes
      task.speed = data.speed
    }
  })
  unsubStatus = api.download.onStatusChange((data: any) => {
    const task = tasks.value.find((item) => item.id === data.id)
    if (task) {
      task.status = data.status
      task.error = data.error
      task.progress = data.progress ?? task.progress
      task.downloadedBytes = data.downloadedBytes ?? task.downloadedBytes
      task.totalBytes = data.totalBytes ?? task.totalBytes
      task.speed = data.speed ?? task.speed
      task.startedAt = data.startedAt ?? task.startedAt
      task.finishedAt = data.finishedAt ?? task.finishedAt
    } else {
      void loadTasks()
    }
    if (data.status === 'completed' || data.status === 'failed') {
      setTimeout(loadTasks, 1000)
    }
  })
  timer = setInterval(loadTasks, 5000)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
  unsubProgress?.()
  unsubStatus?.()
})
</script>

<template>
  <div class="downloads-view">
    <el-card class="downloads-card" v-loading="loading" shadow="never">
      <template #header>
        <div class="header">
          <div class="left">
            <el-radio-group v-model="filterStatus" size="small">
              <el-radio-button
                v-for="opt in statusOptions"
                :key="opt.value"
                :label="opt.value"
              >
                <span class="tab-label">
                  <span>{{ opt.label }}</span>
                  <strong>{{ opt.count() }}</strong>
                </span>
              </el-radio-button>
            </el-radio-group>
          </div>
          <div class="actions">
            <div class="speed-pill">
              <span>当前速度</span>
              <strong>{{ formatSpeed(currentSpeed) }}</strong>
            </div>
            <el-button
              size="small"
              :disabled="totalCount === 0"
              @click="togglePause"
              :type="paused ? 'success' : 'warning'"
            >
              {{ paused ? '恢复' : '暂停' }}
            </el-button>
            <el-button size="small" :disabled="completedCount === 0" @click="clearCompleted">
              清除已完成
            </el-button>
            <el-button size="small" :icon="Refresh" @click="loadTasks" :loading="loading">
              刷新
            </el-button>
          </div>
        </div>
      </template>

      <div v-if="filteredTasks.length === 0" class="empty-pane">
        <el-empty :description="totalCount === 0 ? '暂无下载任务' : '当前筛选下没有任务'">
          <template #extra>
            <el-button type="primary" :icon="Download" @click="goBrowse">去资源浏览添加</el-button>
          </template>
        </el-empty>
      </div>

      <div v-else class="task-list">
        <div v-for="task in filteredTasks" :key="task.id" class="task-item">
          <div class="task-info">
            <div class="task-title">
              <div class="title-group">
                <span class="title-text">{{ task.title }}</span>
                <button class="url-link" :title="task.url" @click="openTaskUrl(task)">
                  {{ task.url }}
                </button>
              </div>
              <el-tag :type="statusTagType[task.status]" size="small">
                {{ statusLabel[task.status] || task.status }}
              </el-tag>
            </div>
            <div class="task-meta-grid">
              <div>
                <span class="meta-label">进度</span>
                <strong>{{ progressPercent(task) }}%</strong>
              </div>
              <div>
                <span class="meta-label">大小</span>
                <strong>{{ formatProgress(task) }}</strong>
              </div>
              <div>
                <span class="meta-label">{{ speedLabel(task) }}</span>
                <strong>{{ displaySpeed(task) }}</strong>
              </div>
              <div>
                <span class="meta-label">用时</span>
                <strong>{{ formatDuration(task) }}</strong>
              </div>
              <div>
                <span class="meta-label">类型</span>
                <el-tag size="small">{{ task.fileType || '-' }}</el-tag>
              </div>
              <div>
                <span class="meta-label">重试</span>
                <strong>{{ task.retryCount || 0 }}</strong>
              </div>
              <div>
                <span class="meta-label">创建时间</span>
                <strong>{{ formatDate(task.createdAt) }}</strong>
              </div>
            </div>
            <div class="path-row">
              <span class="meta-label">保存路径</span>
              <span class="path-text">{{ task.savePath || '-' }}</span>
            </div>
            <div v-if="task.error" class="error">{{ task.error }}</div>
            <el-progress
              v-if="task.status === 'downloading' || task.status === 'completed'"
              :percentage="progressPercent(task)"
              :status="task.status === 'completed' ? 'success' : undefined"
              :stroke-width="6"
            />
          </div>
          <div class="task-actions">
            <el-button
              v-if="task.status === 'failed'"
              size="small"
              type="primary"
              @click="retryTask(task)"
            >
              重试
            </el-button>
            <el-button
              size="small"
              :icon="FolderOpened"
              :disabled="!task.savePath"
              @click="openLocation(task)"
            >
              位置
            </el-button>
            <el-button
              size="small"
              :icon="CopyDocument"
              @click="copyText(task.savePath || task.url, task.savePath ? '路径' : '链接')"
            >
              复制
            </el-button>
            <el-button size="small" type="danger" plain :icon="Delete" @click="removeTask(task)">
              删除
            </el-button>
          </div>
        </div>
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.downloads-view {
  height: 100%;
  min-height: 0;
  display: flex;
}

.downloads-card {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.downloads-card :deep(.el-card__body) {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
}

.left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.tab-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.tab-label strong {
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: #f0f2f5;
  color: #606266;
  font-size: 12px;
  line-height: 18px;
  text-align: center;
}

:deep(.el-radio-button__original-radio:checked + .el-radio-button__inner .tab-label strong) {
  background: rgba(255, 255, 255, 0.24);
  color: #fff;
}

.actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.speed-pill {
  height: 28px;
  padding: 0 10px;
  border: 1px solid #ebeef5;
  border-radius: 14px;
  background: #f8fafc;
  display: flex;
  align-items: center;
  gap: 8px;
}

.speed-pill span {
  color: #909399;
  font-size: 12px;
}

.speed-pill strong {
  color: #303133;
  font-size: 13px;
}

.empty-pane {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.task-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-right: 4px;
}

.task-item {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  padding: 14px 16px;
  background: #fafafa;
  border-radius: 6px;
  border: 1px solid #ebeef5;
}

.task-info {
  flex: 1;
  min-width: 0;
}

.task-title {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
  min-width: 0;
}

.title-group {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.title-text,
.url-link,
.path-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
  font-size: 14px;
}

.url-link {
  max-width: 100%;
  padding: 0;
  border: none;
  background: transparent;
  color: #909399;
  cursor: pointer;
  font-size: 12px;
  font-weight: 400;
  text-align: left;
}

.url-link:hover {
  color: #409eff;
}

.task-meta-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 10px 16px;
  margin-bottom: 10px;
}

.task-meta-grid > div,
.path-row {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
}

.meta-label {
  flex-shrink: 0;
  font-size: 12px;
  color: #909399;
}

.task-meta-grid strong {
  min-width: 0;
  color: #606266;
  font-size: 12px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.path-row {
  margin-bottom: 10px;
}

.path-text {
  color: #606266;
  font-size: 12px;
  font-weight: 400;
}

.error {
  color: #f56c6c;
  font-size: 12px;
  margin-bottom: 8px;
}

.task-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
  width: 210px;
  flex-shrink: 0;
}

@media (max-width: 1100px) {
  .header {
    align-items: flex-start;
    flex-direction: column;
  }

  .actions {
    width: 100%;
    flex-wrap: wrap;
  }

  .task-item {
    flex-direction: column;
  }

  .task-actions {
    width: 100%;
    justify-content: flex-start;
  }

  .task-meta-grid {
    grid-template-columns: repeat(2, minmax(140px, 1fr));
  }
}
</style>
