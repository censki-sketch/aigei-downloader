<template>
  <div class="app-layout">
    <el-container class="app-layout">
      <el-header class="app-header">
        <div class="app-logo">🎵 爱给下载器</div>
        <div class="app-nav">
          <el-menu mode="horizontal" :default-active="activeTab" @select="activeTab = $event" class="app-menu">
            <el-menu-item index="browse">资源浏览</el-menu-item>
            <el-menu-item index="downloads">下载队列</el-menu-item>
            <el-menu-item index="settings">设置</el-menu-item>
          </el-menu>
        </div>
        <div class="app-user">
          <span class="login-status-badge" :style="{ background: loggedIn ? 'rgba(103,194,58,0.3)' : 'rgba(245,108,108,0.3)' }">
            {{ loggedIn ? '✓ 已登录' : '✗ 未登录' }}
          </span>
          <el-button v-if="!loggedIn" type="primary" size="small" @click="handleLogin">登录</el-button>
          <el-button v-else size="small" @click="handleLogout">退出</el-button>
        </div>
      </el-header>
      <el-main class="app-main">
        <BrowseView v-if="activeTab === 'browse'" />
        <DownloadsView v-else-if="activeTab === 'downloads'" />
        <SettingsView v-else-if="activeTab === 'settings'" />
      </el-main>
    </el-container>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import BrowseView from './views/BrowseView.vue'
import DownloadsView from './views/DownloadsView.vue'
import SettingsView from './views/SettingsView.vue'

const activeTab = ref('browse')
const loggedIn = ref(false)

const checkLogin = async () => {
  try {
    loggedIn.value = await window.api.login.check()
  } catch (e) {
    console.error(e)
  }
}

const handleLogin = async () => {
  const ok = await window.api.login.open()
  if (ok) {
    loggedIn.value = true
    ElMessage.success('登录成功')
  } else {
    ElMessage.info('登录窗口已关闭')
  }
  checkLogin()
}

const handleLogout = async () => {
  await window.api.login.logout()
  loggedIn.value = false
  ElMessage.success('已退出登录')
}

onMounted(() => {
  checkLogin()
})
</script>
