<template>
  <div class="settings-view">
    <el-card>
      <template #header><span>下载设置</span></template>

      <el-form label-width="160px" style="max-width: 600px">
        <el-form-item label="默认保存目录">
          <el-input v-model="saveDir" placeholder="下载文件保存位置" />
        </el-form-item>
        <el-form-item label="最大并发数">
          <el-input-number v-model="concurrent" :min="1" :max="5" @change="saveConcurrent" />
          <span style="margin-left: 12px; color: #909399; font-size: 13px">建议 2-3，过高可能触发风控</span>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="saveSettings">保存设置</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card style="margin-top: 16px">
      <template #header><span>关于</span></template>
      <el-descriptions :column="1" border>
        <el-descriptions-item label="应用名称">爱给下载器</el-descriptions-item>
        <el-descriptions-item label="版本">1.0.0</el-descriptions-item>
        <el-descriptions-item label="技术栈">Electron + Vue 3 + Playwright</el-descriptions-item>
        <el-descriptions-item label="用途">爱给网会员个人资源批量下载</el-descriptions-item>
      </el-descriptions>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'

const saveDir = ref('')
const concurrent = ref(2)

const loadSettings = async () => {
  saveDir.value = (await window.api.settings.getSaveDir()) as string
  const c = await window.api.settings.get('concurrent')
  concurrent.value = c ? Number(c) : 2
}

const saveConcurrent = async () => {
  await window.api.download.setConcurrent(concurrent.value)
}

const saveSettings = async () => {
  await window.api.settings.set('saveDir', saveDir.value)
  await window.api.download.setConcurrent(concurrent.value)
  ElMessage.success('设置已保存')
}

onMounted(loadSettings)
</script>

<style scoped>
.settings-view {
  max-width: 800px;
  margin: 0 auto;
}
</style>
