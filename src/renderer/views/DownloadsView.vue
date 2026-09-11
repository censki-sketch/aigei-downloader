<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../api'

const loading = ref(false)
const tasks = ref<any[]>([])
const filterStatus = ref('all')
const paused = ref(false)

const statusOptions = [
  { label: '全部', value: 'all' },
  { label: '等待中', value: 'pending' },
  { label: '下载中', value: 'downloading' },
  { label: '已完成', value: 'completed' },
  { label: '失败', value: 'failed' }
]

const statusTagType: Record<string, string> = {
  pending: 'info',
  downloading: 'primary',
  completed: 'success',
  failed: 'danger',
  paused: 'warning'
}

const statusLabel: Record<string, string> = {
  pending: '等待中',
  downloading: '下载中',
  completed: '已完成',
  failed: '失败',
  paused: '已暂停'
}

const loadTasks = async () => {
  loading.value = true
  try {
    tasks.value = await api.download.list(filterStatus.value)
  } finally {
    loading.value = false
  }
}

const retryTask = async (index: number) => {
  try {
    await api.download.retry(index)
    ElMessage.success('已重新加入队列')
    await loadTasks()
  } catch (e: any) {
    ElMessage.error('重试失败: ' + e.message)
  }
}

const removeTask = async (index: number) => {
  try {
    await ElMessageBox.confirm('确定要从队列中移除这个任务吗？', '确认', { type: 'warning' })
    await api.download.remove(index)
    await loadTasks()
  } catch {
    // 取消
  }
}

const togglePause = async () => {
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
  try {
    await ElMessageBox.confirm('确定要清除所有已完成的任务吗？', '确认', { type: 'warning' })
    // 这里需要添加清除已完成任务的 IPC，暂时用 remove 逐个删除
    const completed = tasks.value.filter((t) => t.status === 'completed')
    for (let i = 0; i < completed.length; i++) {
      await api.download.remove(i)
    }
    await loadTasks()
    ElMessage.success('已清除完成任务')
  } catch {
    // 取消
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

let unsubProgress: (() => void) | null = null
let unsubStatus: (() => void) | null = null

onMounted(() => {
  loadTasks()
  // 监听进度更新
  unsubProgress = api.download.onProgress((data: any) => {
    const task = tasks.value.find((t) => t.id === data.id)
    if (task) {
      task.progress = data.progress
      task.downloadedBytes = data.downloadedBytes
      task.totalBytes = data.totalBytes
      task.speed = data.speed
    }
  })
  unsubStatus = api.download.onStatusChange((data: any) => {
    const task = tasks.value.find((t) => t.id === data.id)
    if (task) {
      task.status = data.status
      task.error = data.error
    }
    if (data.status === 'completed' || data.status === 'failed') {
      setTimeout(loadTasks, 1000)
    }
  })
  // 定时刷新
  const timer = setInterval(loadTasks, 5000)
  onUnmounted(() => {
    clearInterval(timer)
  })
})

onUnmounted(() => {
  unsubProgress?.()
  unsubStatus?.()
})
</script>

<template>
  <div class="downloads-view">
    <el-card>
      <template #header>
        <div class="header">
          <div class="left">
            <el-select v-model="filterStatus" @change="loadTasks" size="small" style="width: 120px">
              <el-option
                v-for="opt in statusOptions"
                :key="opt.value"
                :label="opt.label"
                :value="opt.value"
              />
            </el-select>
            <span class="count">共 {{ tasks.length }} 个任务</span>
          </div>
          <div class="actions">
            <el-button size="small" @click="togglePause" :type="paused ? 'success' : 'warning'">
              {{ paused ? '▶ 恢复' : '⏸ 暂停' }}
            </el-button>
            <el-button size="small" @click="clearCompleted">清除已完成</el-button>
            <el-button size="small" @click="loadTasks" :loading="loading">刷新</el-button>
          </div>
        </div>
      </template>

      <el-empty v-if="tasks.length === 0" description="暂无下载任务，去资源浏览页添加吧" />

      <div v-else class="task-list">
        <div v-for="(task, index) in tasks" :key="task.id" class="task-item">
          <div class="task-info">
            <div class="task-title">
              <span class="title-text">{{ task.title }}</span>
              <el-tag :type="statusTagType[task.status]" size="small">
                {{ statusLabel[task.status] || task.status }}
              </el-tag>
            </div>
            <div class="task-meta">
              <span>{{ formatProgress(task) }}</span>
              <span v-if="task.status === 'downloading'">速度: {{ formatSpeed(task.speed) }}</span>
              <span v-if="task.error" class="error">{{ task.error }}</span>
            </div>
            <el-progress
              v-if="task.status === 'downloading' || task.status === 'completed'"
              :percentage="Math.round(task.progress)"
              :status="task.status === 'completed' ? 'success' : undefined"
              :stroke-width="6"
            />
          </div>
          <div class="task-actions">
            <el-button
              v-if="task.status === 'failed'"
              size="small"
              type="primary"
              @click="retryTask(index)"
            >
              重试
            </el-button>
            <el-button size="small" type="danger" plain @click="removeTask(index)">
              删除
            </el-button>
          </div>
        </div>
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.count {
  color: #909399;
  font-size: 14px;
}

.actions {
  display: flex;
  gap: 8px;
}

.task-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.task-item {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 12px 16px;
  background: #fafafa;
  border-radius: 8px;
  border: 1px solid #ebeef5;
}

.task-info {
  flex: 1;
}

.task-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.title-text {
  font-weight: 500;
  font-size: 14px;
}

.task-meta {
  display: flex;
  gap: 16px;
  font-size: 12px;
  color: #909399;
  margin-bottom: 8px;
}

.error {
  color: #f56c6c;
}

.task-actions {
  display: flex;
  gap: 8px;
  margin-left: 16px;
}
</style>
