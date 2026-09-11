<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { api } from '../api'

const loading = ref(false)
const form = reactive({
  downloadDir: '',
  maxConcurrent: 2,
  retryCount: 3,
  retryDelay: 5,
  requestDelay: 5
})

const defaultSaveDir = ref('')
const debugMode = ref(false)
const logPath = ref('')

const loadSettings = async () => {
  loading.value = true
  try {
    defaultSaveDir.value = await api.settings.getSaveDir()
    form.downloadDir = (await api.settings.get('downloadDir')) || defaultSaveDir.value
    form.maxConcurrent = Number((await api.settings.get('maxConcurrent')) || 2)
    form.retryCount = Number((await api.settings.get('retryCount')) || 3)
    form.retryDelay = Number((await api.settings.get('retryDelay')) || 5)
    form.requestDelay = Number((await api.settings.get('requestDelay')) || 5)
    debugMode.value = await api.debug.getMode()
    logPath.value = await api.debug.getLogPath()
  } finally {
    loading.value = false
  }
}

const save = async () => {
  loading.value = true
  try {
    await api.settings.set('downloadDir', form.downloadDir)
    await api.settings.set('maxConcurrent', String(form.maxConcurrent))
    await api.settings.set('retryCount', String(form.retryCount))
    await api.settings.set('retryDelay', String(form.retryDelay * 1000))
    await api.settings.set('requestDelay', String(form.requestDelay * 1000))
    // 同步到下载队列
    await api.download.setConcurrent(form.maxConcurrent)
    ElMessage.success('设置已保存')
  } finally {
    loading.value = false
  }
}

const resetDefault = async () => {
  form.downloadDir = defaultSaveDir.value
  form.maxConcurrent = 2
  form.retryCount = 3
  form.retryDelay = 5
  form.requestDelay = 5
  await save()
}

onMounted(() => {
  loadSettings()
})

const toggleDebug = async (val: boolean) => {
  await api.debug.setMode(val)
  debugMode.value = val
  if (val) {
    logPath.value = await api.debug.getLogPath()
    ElMessage.success('调试模式已开启，日志文件：' + logPath.value)
  } else {
    ElMessage.info('调试模式已关闭')
  }
}
</script>

<template>
  <div class="settings-view">
    <el-card v-loading="loading">
      <template #header>
        <span>⚙️ 应用设置</span>
      </template>

      <el-form :model="form" label-width="140px" style="max-width: 600px">
        <el-form-item label="下载保存目录">
          <el-input v-model="form.downloadDir" placeholder="下载文件保存位置" />
          <div class="hint">默认: {{ defaultSaveDir }}</div>
        </el-form-item>

        <el-form-item label="最大并发数">
          <el-input-number v-model="form.maxConcurrent" :min="1" :max="5" />
          <div class="hint">建议 2-3，过高可能触发网站风控导致封号</div>
        </el-form-item>

        <el-form-item label="重试次数">
          <el-input-number v-model="form.retryCount" :min="0" :max="10" />
        </el-form-item>

        <el-form-item label="重试延迟">
          <el-input-number v-model="form.retryDelay" :min="1" :max="60" />
          <span class="unit">秒</span>
        </el-form-item>

        <el-form-item label="任务间隔">
          <el-input-number v-model="form.requestDelay" :min="1" :max="60" />
          <span class="unit">秒</span>
          <div class="hint">每个下载任务之间的间隔时间，避免请求过密</div>
        </el-form-item>

        <el-form-item>
          <el-button type="primary" @click="save">保存设置</el-button>
          <el-button @click="resetDefault">恢复默认</el-button>
        </el-form-item>
      </el-form>

      <el-divider />

      <el-form label-width="140px" style="max-width: 600px">
        <el-form-item label="调试日志">
          <el-switch v-model="debugMode" @change="toggleDebug" />
          <div class="hint" v-if="debugMode">日志文件：{{ logPath }}</div>
          <div class="hint" v-else>开启后会在桌面生成日志文件，用于排查问题</div>
        </el-form-item>
      </el-form>

      <el-divider />

      <el-alert type="warning" :closable="false" title="使用须知">
        <ul class="notice">
          <li>本工具仅供个人学习备份使用，请勿用于商业用途或二次分发下载的资源</li>
          <li>批量下载可能违反爱给网用户协议，请控制频率避免封号</li>
          <li>下载 VIP 资源需要已开通对应等级的会员</li>
          <li>如遇加密逻辑失效，需要重新扣取爱给网加密 JS</li>
        </ul>
      </el-alert>
    </el-card>
  </div>
</template>

<style scoped>
.settings-view {
  max-width: 800px;
  margin: 0 auto;
}

.hint {
  font-size: 12px;
  color: #909399;
  margin-top: 4px;
}

.unit {
  margin-left: 8px;
  color: #909399;
}

.notice {
  margin: 8px 0 0 20px;
  line-height: 1.8;
}
</style>
