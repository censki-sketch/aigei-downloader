<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { FolderOpened, Refresh } from '@element-plus/icons-vue'
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

const toSeconds = (value: string | null | undefined, fallback: number) => {
  const raw = Number(value)
  if (!Number.isFinite(raw) || raw <= 0) return fallback
  return raw >= 1000 ? Math.round(raw / 1000) : raw
}

const loadSettings = async () => {
  loading.value = true
  try {
    defaultSaveDir.value = await api.settings.getSaveDir()
    form.downloadDir = (await api.settings.get('downloadDir')) || defaultSaveDir.value
    form.maxConcurrent = Number((await api.settings.get('maxConcurrent')) || 2)
    form.retryCount = Number((await api.settings.get('retryCount')) || 3)
    form.retryDelay = toSeconds(await api.settings.get('retryDelay'), 5)
    form.requestDelay = toSeconds(await api.settings.get('requestDelay'), 5)
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
    await api.download.setConcurrent(form.maxConcurrent)
    ElMessage.success('设置已保存')
  } finally {
    loading.value = false
  }
}

const chooseDownloadDir = async () => {
  const selected = await api.settings.selectDownloadDir()
  if (selected) form.downloadDir = selected
}

const openDownloadDir = async () => {
  if (!form.downloadDir) return
  try {
    await api.system.openPath(form.downloadDir)
  } catch (e: any) {
    ElMessage.error('打开目录失败: ' + e.message)
  }
}

const openLogLocation = async () => {
  if (!logPath.value) return
  try {
    await api.system.showItemInFolder(logPath.value)
  } catch (e: any) {
    ElMessage.error('打开日志位置失败: ' + e.message)
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

const toggleDebug = async (val: boolean) => {
  await api.debug.setMode(val)
  debugMode.value = val
  if (val) {
    logPath.value = await api.debug.getLogPath()
    ElMessage.success('调试模式已开启')
  } else {
    ElMessage.info('调试模式已关闭')
  }
}

onMounted(() => {
  void loadSettings()
})
</script>

<template>
  <div class="settings-view">
    <el-card class="settings-card" v-loading="loading" shadow="never">
      <template #header>
        <div class="header">
          <span>应用设置</span>
          <el-button size="small" :icon="Refresh" @click="loadSettings" :loading="loading">刷新</el-button>
        </div>
      </template>

      <div class="settings-scroll">
        <section class="settings-section">
          <h3>下载</h3>
          <el-form :model="form" label-width="120px" class="settings-form">
            <el-form-item label="保存目录">
              <div class="path-row">
                <el-input v-model="form.downloadDir" placeholder="下载文件保存位置" />
                <el-button :icon="FolderOpened" @click="chooseDownloadDir">选择</el-button>
                <el-button @click="openDownloadDir">打开</el-button>
              </div>
              <div class="hint">默认: {{ defaultSaveDir }}</div>
            </el-form-item>

            <el-form-item label="最大并发数">
              <el-input-number v-model="form.maxConcurrent" :min="1" :max="5" />
              <span class="hint inline">建议 2-3，过高可能触发网站风控</span>
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
              <span class="hint inline">每个下载任务之间的间隔时间</span>
            </el-form-item>

            <el-form-item>
              <el-button type="primary" @click="save">保存设置</el-button>
              <el-button @click="resetDefault">恢复默认</el-button>
            </el-form-item>
          </el-form>
        </section>

        <section class="settings-section">
          <h3>排查</h3>
          <el-form label-width="120px" class="settings-form">
            <el-form-item label="调试日志">
              <div class="debug-row">
                <el-switch v-model="debugMode" @change="toggleDebug" />
                <span class="hint">{{ debugMode ? '已开启' : '开启后会在桌面生成日志文件' }}</span>
                <el-button v-if="debugMode" size="small" @click="openLogLocation">打开日志位置</el-button>
              </div>
              <div v-if="debugMode" class="hint log-path">{{ logPath }}</div>
            </el-form-item>
          </el-form>
        </section>

        <section class="settings-section">
          <el-alert type="warning" :closable="false" show-icon title="使用须知">
            <ul class="notice">
              <li>本工具仅供个人学习备份使用，请勿用于商业用途或二次分发下载的资源</li>
              <li>批量下载可能违反爱给网用户协议，请控制频率避免封号</li>
              <li>下载 VIP 资源需要已开通对应等级的会员</li>
              <li>如遇加密逻辑失效，需要重新扣取爱给网加密 JS</li>
            </ul>
          </el-alert>
        </section>
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.settings-view {
  height: 100%;
  min-height: 0;
  display: flex;
}

.settings-card {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.settings-card :deep(.el-card__body) {
  flex: 1;
  min-height: 0;
  padding: 0;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.settings-scroll {
  height: 100%;
  overflow: auto;
  padding: 24px 32px;
}

.settings-section {
  max-width: 920px;
  margin-bottom: 24px;
}

.settings-section h3 {
  margin: 0 0 18px;
  color: #303133;
  font-size: 15px;
  font-weight: 600;
}

.settings-form {
  max-width: 820px;
}

.path-row,
.debug-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.path-row .el-input {
  min-width: 0;
}

.hint {
  font-size: 12px;
  color: #909399;
  line-height: 1.6;
}

.hint.inline {
  margin-left: 10px;
}

.unit {
  margin-left: 8px;
  color: #909399;
}

.log-path {
  width: 100%;
  margin-top: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.notice {
  margin: 8px 0 0 18px;
  line-height: 1.8;
}
</style>
