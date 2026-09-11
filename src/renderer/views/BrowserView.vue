<script setup lang="ts">
import { ref, reactive } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useRouter } from 'vue-router'
import { api } from '../api'

const router = useRouter()
const loading = ref(false)
const urlInput = ref('https://www.aigei.com/sound/class/')
const resources = ref<any[]>([])
const selected = ref<any[]>([])

const categories = reactive([
  { name: '音效', url: 'https://www.aigei.com/sound/class/' },
  { name: '配乐', url: 'https://www.aigei.com/sound/class/?type=music' },
  { name: '视频', url: 'https://www.aigei.com/video/class/' },
  { name: '3D模型', url: 'https://www.aigei.com/3d/class/' },
  { name: '平面设计', url: 'https://www.aigei.com/psd/class/' },
  { name: '图片', url: 'https://www.aigei.com/image/class/' }
])

const scrape = async (url?: string) => {
  const targetUrl = url || urlInput.value
  if (!targetUrl) {
    ElMessage.warning('请输入资源列表页 URL')
    return
  }
  loading.value = true
  try {
    urlInput.value = targetUrl
    resources.value = await api.scrape.list(targetUrl)
    if (resources.value.length === 0) {
      ElMessage.warning('未抓取到资源，可能需要先登录或页面结构有变化')
    } else {
      ElMessage.success(`抓取到 ${resources.value.length} 个资源`)
    }
  } catch (e: any) {
    ElMessage.error('抓取失败: ' + e.message)
  } finally {
    loading.value = false
  }
}

const handleSelectionChange = (rows: any[]) => {
  selected.value = rows
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
    const items = selected.value.map((r) => ({
      url: r.url,
      title: r.title,
      type: r.fileType
    }))
    await api.download.addBatch(items)
    ElMessage.success(`已添加 ${items.length} 个任务到下载队列`)
    router.push('/downloads')
  } catch {
    // 取消
  }
}

const downloadOne = async (row: any) => {
  try {
    await api.download.add(row.url, row.title, row.fileType)
    ElMessage.success(`已添加「${row.title}」到下载队列`)
  } catch (e: any) {
    ElMessage.error('添加失败: ' + e.message)
  }
}

const formatSize = (size?: string) => size || '-'
</script>

<template>
  <div class="browser-view">
    <el-card class="url-card">
      <div class="url-input-row">
        <el-input
          v-model="urlInput"
          placeholder="输入爱给网资源列表页 URL"
          size="large"
          @keyup.enter="scrape()"
        />
        <el-button type="primary" size="large" @click="scrape()" :loading="loading">
          抓取资源
        </el-button>
      </div>
      <div class="categories">
        <span class="label">快捷分类：</span>
        <el-button
          v-for="cat in categories"
          :key="cat.url"
          size="small"
          @click="scrape(cat.url)"
        >
          {{ cat.name }}
        </el-button>
      </div>
    </el-card>

    <el-card class="list-card" v-loading="loading">
      <template #header>
        <div class="list-header">
          <span>资源列表（共 {{ resources.length }} 个）</span>
          <div class="actions">
            <el-button
              type="success"
              :disabled="selected.length === 0"
              @click="downloadSelected"
            >
              下载选中（{{ selected.length }}）
            </el-button>
          </div>
        </div>
      </template>

      <el-empty v-if="resources.length === 0 && !loading" description="暂无资源，请输入 URL 抓取" />

      <el-table
        v-else
        :data="resources"
        @selection-change="handleSelectionChange"
        height="500"
        stripe
      >
        <el-table-column type="selection" width="50" />
        <el-table-column label="缩略图" width="80">
          <template #default="{ row }">
            <el-image
              v-if="row.thumbnail"
              :src="row.thumbnail"
              style="width: 50px; height: 50px"
              fit="cover"
              :preview-src-list="[row.thumbnail]"
            />
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column prop="title" label="标题" min-width="200" show-overflow-tooltip />
        <el-table-column prop="fileType" label="类型" width="100">
          <template #default="{ row }">
            <el-tag size="small">{{ row.fileType }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="VIP" width="60">
          <template #default="{ row }">
            <el-tag v-if="row.isVip" type="warning" size="small">VIP</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="大小" width="80">
          <template #default="{ row }">{{ formatSize(row.size) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <el-button size="small" type="primary" @click="downloadOne(row)">下载</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<style scoped>
.browser-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.url-input-row {
  display: flex;
  gap: 12px;
}

.categories {
  margin-top: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.label {
  color: #909399;
  font-size: 14px;
}

.list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.actions {
  display: flex;
  gap: 8px;
}
</style>
