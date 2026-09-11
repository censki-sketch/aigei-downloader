<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../api'

// 历史记录暂时通过设置接口读取，后续可添加专用 IPC
const history = ref<any[]>([])
const loading = ref(false)

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

const formatDate = (ts: number): string => {
  return new Date(ts).toLocaleString('zh-CN')
}

const loadHistory = async () => {
  loading.value = true
  try {
    // 暂时使用下载列表中已完成的任务作为历史
    const completed = await api.download.list('completed')
    history.value = completed
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  loadHistory()
})
</script>

<template>
  <div class="history-view">
    <el-card v-loading="loading">
      <template #header>
        <div class="header">
          <span>下载历史</span>
          <el-button size="small" @click="loadHistory">刷新</el-button>
        </div>
      </template>

      <el-empty v-if="history.length === 0" description="暂无下载历史" />

      <el-table v-else :data="history" stripe>
        <el-table-column prop="title" label="标题" min-width="200" show-overflow-tooltip />
        <el-table-column prop="fileType" label="类型" width="100">
          <template #default="{ row }">
            <el-tag size="small">{{ row.fileType }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="大小" width="100">
          <template #default="{ row }">{{ formatBytes(row.totalBytes) }}</template>
        </el-table-column>
        <el-table-column label="下载时间" width="180">
          <template #default="{ row }">{{ formatDate(row.finishedAt || row.createdAt) }}</template>
        </el-table-column>
        <el-table-column prop="savePath" label="保存路径" min-width="200" show-overflow-tooltip />
      </el-table>
    </el-card>
  </div>
</template>

<style scoped>
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
</style>
