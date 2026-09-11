<template>
  <div class="downloads-view">
    <el-card>
      <template #header>
        <div class="card-header">
          <span>下载队列</span>
          <div>
            <el-button size="small" @click="refresh">刷新</el-button>
            <el-button size="small" @click="pause">暂停</el-button>
            <el-button size="small" type="primary" @click="resume">继续</el-button>
          </div>
        </div>
      </template>

      <el-table :data="downloads" height="560">
        <el-table-column prop="id" label="#" width="60" />
        <el-table-column prop="title" label="标题" min-width="200" show-overflow-tooltip />
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" size="small">{{ statusText(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="进度" width="180">
          <template #default="{ row }">
            <el-progress
              :percentage="progressPercent(row)"
              :status="row.status === 'completed' ? 'success' : row.status === 'failed' ? 'exception' : undefined"
            />
          </template>
        </el-table-column>
        <el-table-column prop="file_size" label="大小" width="90">
          <template #default="{ row }">{{ formatSize(row.file_size) }}</template>
        </el-table-column>
        <el-table-column prop="save_path" label="保存路径" min-width="200" show-overflow-tooltip />
        <el-table-column prop="error_msg" label="错误" min-width="150" show-overflow-tooltip />
        <el-table-column label="操作" width="140" fixed="right">
          <template #default="{ row }">
            <el-button v-if="row.status === 'failed'" size="small" link @click="retry(row.id)">重试</el-button>
            <el-button size="small" link type="danger" @click="remove(row.id)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { ElMessage } from 'element-plus'

interface DownloadRecord {
  id: number
  item_id: string
  title?: string
  type?: string
  url?: string
  save_path?: string
  file_size?: number
  downloaded_size?: number
  status?: string
  error_msg?: string
}

const downloads = ref<DownloadRecord[]>([])
let unsubProgress: (() => void) | null = null

const refresh = async () => {
  downloads.value = await window.api.download.list()
}

const pause = async () => {
  await window.api.download.pause()
  ElMessage.info('已暂停队列')
}

const resume = async () => {
  await window.api.download.resume()
  ElMessage.success('已继续队列')
}

const retry = async (id: number) => {
  await window.api.download.retry(id)
  ElMessage.success('已重新加入队列')
  refresh()
}

const remove = async (id: number) => {
  await window.api.download.remove(id)
  refresh()
}

const statusType = (s?: string) => {
  const map: Record<string, string> = {
    pending: 'info',
    downloading: '',
    completed: 'success',
    failed: 'danger'
  }
  return (map[s || ''] || 'info') as any
}

const statusText = (s?: string) => {
  const map: Record<string, string> = {
    pending: '等待中',
    downloading: '下载中',
    completed: '已完成',
    failed: '失败'
  }
  return map[s || ''] || s || ''
}

const progressPercent = (row: DownloadRecord) => {
  if (row.status === 'completed') return 100
  if (!row.file_size || row.file_size === 0) return 0
  return Math.min(100, Math.round(((row.downloaded_size || 0) / row.file_size) * 100))
}

const formatSize = (bytes?: number) => {
  if (!bytes) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let n = bytes
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return n.toFixed(1) + ' ' + units[i]
}

onMounted(() => {
  refresh()
  unsubProgress = window.api.download.onProgress(() => {
    refresh()
  })
})

onUnmounted(() => {
  unsubProgress?.()
})
</script>

<style scoped>
.downloads-view {
  max-width: 1200px;
  margin: 0 auto;
}
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
</style>
