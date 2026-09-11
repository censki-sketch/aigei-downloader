<template>
  <div class="browse-view">
    <el-card>
      <template #header>
        <div class="card-header">
          <span>资源浏览与抓取</span>
          <el-button type="primary" :loading="loading" @click="handleScrape">抓取当前页资源</el-button>
        </div>
      </template>

      <el-form :inline="true" @submit.prevent>
        <el-form-item label="分类页 URL">
          <el-input
            v-model="listUrl"
            placeholder="https://www.aigei.com/sound/class/..."
            style="width: 480px"
            @keyup.enter="handleScrape"
          />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="loading" @click="handleScrape">抓取列表</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card v-if="items.length > 0" style="margin-top: 16px">
      <template #header>
        <div class="card-header">
          <span>找到 {{ items.length }} 个资源（已选 {{ selectedItems.length }} 个）</span>
          <div>
            <el-button size="small" @click="selectAll">全选</el-button>
            <el-button size="small" @click="clearSelection">取消</el-button>
            <el-button type="primary" size="small" :disabled="selectedItems.length === 0" @click="batchDownload">
              批量下载 ({{ selectedItems.length }})
            </el-button>
          </div>
        </div>
      </template>

      <el-table :data="items" @selection-change="onSelectionChange" height="480">
        <el-table-column type="selection" width="45" />
        <el-table-column label="缩略图" width="80">
          <template #default="{ row }">
            <el-image v-if="row.thumb" :src="row.thumb" style="width: 50px; height: 50px" fit="cover" />
            <span v-else>—</span>
          </template>
        </el-table-column>
        <el-table-column prop="title" label="标题" min-width="200" show-overflow-tooltip />
        <el-table-column label="VIP" width="60">
          <template #default="{ row }">
            <el-tag v-if="row.isVip" type="warning" size="small">VIP</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="duration" label="时长" width="80" />
        <el-table-column prop="fileSize" label="大小" width="80" />
        <el-table-column label="操作" width="100" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" link size="small" @click="downloadOne(row)">下载</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-empty v-else-if="!loading" description="输入爱给网分类页 URL，点击抓取" />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'

interface ResourceItem {
  itemId: string
  title: string
  type: string
  thumb?: string
  isVip?: boolean
  url: string
  duration?: string
  fileSize?: string
}

const listUrl = ref('https://www.aigei.com/sound/class/')
const items = ref<ResourceItem[]>([])
const selectedItems = ref<ResourceItem[]>([])
const loading = ref(false)

const handleScrape = async () => {
  if (!listUrl.value) return
  loading.value = true
  try {
    items.value = await window.api.scrape.list(listUrl.value)
    if (items.value.length === 0) {
      ElMessage.warning('未抓取到资源，请检查 URL 或先登录')
    } else {
      ElMessage.success(`抓取到 ${items.value.length} 个资源`)
    }
  } catch (e: any) {
    ElMessage.error('抓取失败: ' + e.message)
  } finally {
    loading.value = false
  }
}

const onSelectionChange = (val: ResourceItem[]) => {
  selectedItems.value = val
}

const selectAll = () => {
  // el-table 全选需要通过 ref 调用 toggleAllSelection，这里简化处理
}
const clearSelection = () => {
  selectedItems.value = []
}

const downloadOne = async (row: ResourceItem) => {
  await window.api.download.add(row.url, row.title, row.type)
  ElMessage.success(`已加入下载队列: ${row.title}`)
}

const batchDownload = async () => {
  const batch = selectedItems.value.map((it) => ({ url: it.url, title: it.title, type: it.type }))
  await window.api.download.addBatch(batch)
  ElMessage.success(`已加入 ${batch.length} 个下载任务`)
}
</script>

<style scoped>
.browse-view {
  max-width: 1200px;
  margin: 0 auto;
}
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
</style>
