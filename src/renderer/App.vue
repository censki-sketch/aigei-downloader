<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { api } from './api'
import AigeiVerifyView from './views/AigeiVerifyView.vue'

const router = useRouter()
const route = useRoute()
const activeMenu = ref('browser')
const isLoggedIn = ref(false)
const loginStatus = ref<any>(null)
const LOGIN_HOME_URL = 'https://www.aigei.com/'
const verifyPanelMounted = ref(true)

// ===== Webview 预加载 =====
const webviewRef = ref<any>(null)
const webviewReady = ref(false) // CSS 注入完成
const showLoginWebview = ref(false)
const webviewLoading = ref(true) // 加载动画
const loginMaskText = ref('正在加载登录页...')
const loginConfirming = ref(false)
let loginDetected = false
let loginCheckTimer: ReturnType<typeof setTimeout> | null = null
let loginCssInjected = false
let unsubLoginSuccess: (() => void) | null = null

const handleMenuSelect = (index: string) => {
  activeMenu.value = index
  router.push(`/${index}`)
}

const openVerifyPage = () => {
  router.push('/verify')
}

const formatCoins = (coins?: number) => {
  return typeof coins === 'number' ? coins.toLocaleString('zh-CN') : ''
}

const syncActiveMenu = (path: string) => {
  const index = path.split('/')[1] || 'browser'
  activeMenu.value = ['browser', 'verify', 'downloads', 'history', 'settings'].includes(index) ? index : ''
}

const checkLoginState = async () => {
  try {
    const status = await api.login.check()
    const loggedIn = !!status?.isLoggedIn
    isLoggedIn.value = loggedIn
    loginStatus.value = status
    if (route.path === '/login') {
      showLoginWebview.value = !loggedIn
      if (loggedIn) coverLoginWebview('正在同步登录状态...', false)
    }
  } catch {
    isLoggedIn.value = false
    loginStatus.value = { isLoggedIn: false }
    if (route.path === '/login') showLoginWebview.value = true
  }
}

// 登录成功事件只代表主进程已通过真实登录校验，前端不再用 SESSION 做乐观成功。
const handleLoginSuccess = async (statusFromEvent?: any, showWarning = true) => {
  if (loginDetected) return
  if (loginConfirming.value && !statusFromEvent?.isLoggedIn) return
  loginConfirming.value = true
  coverLoginWebview('正在确认登录状态...', false)
  try {
    const status = statusFromEvent?.isLoggedIn ? statusFromEvent : await api.login.check()
    if (!status?.isLoggedIn) {
      if (loginDetected) return
      loginDetected = false
      isLoggedIn.value = false
      loginStatus.value = { isLoggedIn: false }
      if (route.path === '/login') showLoginWebview.value = true
      revealLoginWebview()
      if (showWarning) ElMessage.warning('登录未完成，请继续完成验证')
      return
    }

    if (loginDetected) return
    loginDetected = true
    ElMessage.success('登录成功！登录态已保存')
    showLoginWebview.value = false
    webviewLoading.value = true
    isLoggedIn.value = true
    loginStatus.value = status
  } finally {
    loginConfirming.value = false
  }
}

const coverLoginWebview = (message = '正在加载登录页...', resetInjectedCss = true) => {
  loginMaskText.value = message
  webviewLoading.value = true
  if (resetInjectedCss) {
    loginCssInjected = false
    webviewReady.value = false
  }
}

const revealLoginWebview = () => {
  if (route.path === '/login' && !loginCssInjected) return
  loginMaskText.value = '正在加载登录页...'
  webviewReady.value = true
  webviewLoading.value = false
}

const scheduleLoginCheckFromWebview = (delay = 700) => {
  if (loginCheckTimer) clearTimeout(loginCheckTimer)
  loginCheckTimer = setTimeout(() => {
    void handleLoginSuccess(undefined, false)
  }, delay)
}

const handleWebviewReady = () => {
  const wv = webviewRef.value
  if (!wv) return
  if (wv.__aigeiLoginBound) return
  wv.__aigeiLoginBound = true
  loginDetected = false
  let hasTriggered = false

  const startCover = () => {
    if (route.path === '/login' && !isLoggedIn.value) {
      coverLoginWebview('正在加载登录页...')
    }
  }

  wv.addEventListener('did-start-loading', startCover)
  wv.addEventListener('will-navigate', startCover)
  wv.addEventListener('did-navigate', () => {
    if (route.path === '/login' && !isLoggedIn.value) {
      coverLoginWebview('正在确认登录状态...')
      scheduleLoginCheckFromWebview()
    }
  })
  wv.addEventListener('did-navigate-in-page', () => {
    if (route.path === '/login' && !isLoggedIn.value) {
      scheduleLoginCheckFromWebview()
    }
  })
  wv.addEventListener('did-stop-loading', () => {
    if (route.path === '/login' && !isLoggedIn.value) {
      scheduleLoginCheckFromWebview(400)
    }
  })

  wv.addEventListener('dom-ready', async () => {
    console.log('[WEBVIEW] dom-ready 触发')
    if (route.path === '/login' && !isLoggedIn.value) {
      coverLoginWebview('正在准备登录窗口...')
    }

    // 注入 CSS 隐藏背景
    await wv.insertCSS(`
      html { background: #fff !important; }
      body { visibility: hidden !important; background: #fff !important; }
      body > * { visibility: hidden !important; }
      .login-modal, .login-box, .login-dialog, .login-layer,
      .modal-dialog, .popup-login, .dialog-login,
      [class*="login-modal"], [class*="login-box"], [class*="login-dialog"],
      [class*="login-layer"], [class*="popup-login"] {
        visibility: visible !important; position: fixed !important;
        top: 50% !important; left: 50% !important;
        transform: translate(-50%, -50%) !important;
        margin: 0 !important; z-index: 999999 !important;
      }
      .login-modal *, .login-box *, .login-dialog *, .login-layer *,
      .modal-dialog *, .popup-login *, .dialog-login *,
      [class*="login-modal"] *, [class*="login-box"] *, [class*="login-dialog"] *,
      [class*="login-layer"] *, [class*="popup-login"] * { visibility: visible !important; }
      .login-modal .close, .login-modal .close-btn,
      [class*="login-modal"] .close, [class*="login-modal"] [class*="close"],
      [class*="login-box"] .close, [class*="login-box"] [class*="close"] {
        visibility: hidden !important; pointer-events: none !important;
      }
      .modal-backdrop, .mask-layer, .modal-mask, .overlay,
      [class*="backdrop"], [class*="mask-layer"] { visibility: hidden !important; }
    `).catch(() => {})
    loginCssInjected = true

    // 自动触发登录弹窗
    if (!hasTriggered && !isLoggedIn.value) {
      hasTriggered = true
      await wv.executeJavaScript(`
        (function() {
          var btn = document.querySelector('a[href*="login"], .login-btn, .btn-login, [class*="login"]:not([class*="logged"])');
          if (btn) btn.click();
          if (typeof window.showLogin === 'function') window.showLogin();
          if (typeof window.openLogin === 'function') window.openLogin();
        })();
      `).catch(() => {})
    }

    // 等待页面脚本落稳，再二次确认；未登录时才显示被裁剪后的登录弹窗。
    await new Promise(r => setTimeout(r, 1000))
    if (!isLoggedIn.value) {
      if (route.path === '/login') {
        scheduleLoginCheckFromWebview(0)
      } else {
        revealLoginWebview()
      }
    }
  })
}

const logout = async () => {
  try {
    console.log('[LOGOUT] 开始退出登录')
    await api.login.logout()
    console.log('[LOGOUT] cookie 已清除')
    loginDetected = false
    isLoggedIn.value = false
    loginStatus.value = { isLoggedIn: false }
    showLoginWebview.value = true
    webviewReady.value = false
    loginCssInjected = false
    webviewLoading.value = true
    console.log('[LOGOUT] 重新加载 webview')
    // 强制重新加载，不用 reload（可能不触发 dom-ready），用 src 重新赋值
    if (webviewRef.value) {
      webviewRef.value.src = LOGIN_HOME_URL
    }
    ElMessage.success('已退出登录')
    // 5 秒后如果 webview 还没 ready，强制显示（避免白屏）
    setTimeout(() => {
      if (!webviewReady.value) {
        console.log('[LOGOUT] 5秒超时，强制显示 webview')
        webviewLoading.value = false
        webviewReady.value = true
      }
    }, 5000)
  } catch (e: any) {
    console.log('[LOGOUT] 退出失败:', e.message)
    ElMessage.error('退出失败: ' + e.message)
  }
}

watch([() => route.path, isLoggedIn], ([path, loggedIn]) => {
  syncActiveMenu(path)
  if (path === '/verify') verifyPanelMounted.value = true
  showLoginWebview.value = (path === '/login' && !loggedIn)
}, { immediate: true })

onMounted(() => {
  checkLoginState()
  unsubLoginSuccess = api.login.onSuccess((status) => handleLoginSuccess(status))
})

onUnmounted(() => {
  if (loginCheckTimer) clearTimeout(loginCheckTimer)
  if (unsubLoginSuccess) unsubLoginSuccess()
})
</script>

<template>
  <el-container class="app-container">
    <el-header class="app-header">
      <div class="logo">
        <span class="logo-icon">📦</span>
        <span class="logo-text">爱给下载器</span>
      </div>
      <el-menu :default-active="activeMenu" mode="horizontal" @select="handleMenuSelect" class="nav-menu">
        <el-menu-item index="browser">资源浏览</el-menu-item>
        <el-menu-item index="verify">网页登录验证</el-menu-item>
        <el-menu-item index="downloads">下载队列</el-menu-item>
        <el-menu-item index="history">下载历史</el-menu-item>
        <el-menu-item index="settings">设置</el-menu-item>
      </el-menu>
      <div class="header-right">
        <el-button :type="isLoggedIn ? 'success' : 'primary'" size="small" @click="router.push('/login')">
          {{ isLoggedIn ? '✓ 已登录' : '登录爱给网' }}
        </el-button>
      </div>
    </el-header>
    <el-main class="app-main">
      <div class="route-content" :class="{ hidden: route.path === '/verify' }">
        <router-view v-slot="{ Component }">
          <keep-alive include="BrowserView">
            <component :is="Component" v-if="route.path !== '/verify'" />
          </keep-alive>
        </router-view>
      </div>

      <AigeiVerifyView
        v-if="verifyPanelMounted"
        class="persistent-verify-view"
        :class="{ active: route.path === '/verify' }"
      />

      <!-- 登录 webview（预加载，始终存活）-->
      <div class="login-overlay" v-show="showLoginWebview">
        <!-- 加载动画 -->
        <div class="loading-mask" v-if="webviewLoading || loginConfirming">
          <div class="loading-spinner">
            <div class="spinner"></div>
            <p>{{ loginMaskText }}</p>
          </div>
        </div>

        <!-- webview（CSS 注入完成后才显示）-->
        <div class="webview-wrapper" :class="{ ready: webviewReady && !webviewLoading && !loginConfirming }">
          <webview
            ref="webviewRef"
            class="login-webview"
            :src="LOGIN_HOME_URL"
            allowpopups
            @did-attach="handleWebviewReady"
          ></webview>
        </div>
      </div>

      <!-- 已登录状态 -->
      <div class="login-status-overlay" v-if="route.path === '/login' && isLoggedIn">
        <el-card class="login-card">
          <template #header><div class="card-header"><span>🔐 爱给网登录管理</span></div></template>
          <el-result icon="success" title="已登录" sub-title="您的登录态已保存，可以开始下载了">
            <template #extra>
              <el-descriptions :column="1" border class="user-info">
                <el-descriptions-item label="用户名">{{ loginStatus?.username || '加载中...' }}</el-descriptions-item>
                <el-descriptions-item label="用户ID">{{ loginStatus?.userId || '-' }}</el-descriptions-item>
                <el-descriptions-item label="会员等级">
                  <el-tag type="warning">{{ loginStatus?.vipLevel || '普通用户' }}</el-tag>
                </el-descriptions-item>
                <el-descriptions-item label="铜币">
                  <span v-if="formatCoins(loginStatus?.coins)">{{ formatCoins(loginStatus?.coins) }}</span>
                  <el-button v-else type="primary" link @click="openVerifyPage">网页中查看</el-button>
                </el-descriptions-item>
              </el-descriptions>
              <div class="actions">
                <el-button type="primary" @click="router.push('/browser')">开始浏览资源</el-button>
                <el-button plain @click="openVerifyPage">查看网页登录状态</el-button>
                <el-button type="danger" plain @click="logout">退出登录</el-button>
              </div>
            </template>
          </el-result>
        </el-card>
      </div>
    </el-main>
  </el-container>
</template>

<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body, #app { height: 100%; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Microsoft YaHei', sans-serif; }
*::-webkit-scrollbar { width: 10px; height: 10px; }
*::-webkit-scrollbar-track { background: transparent; }
*::-webkit-scrollbar-thumb { background: #cdd3dc; border: 2px solid transparent; border-radius: 8px; background-clip: content-box; }
*::-webkit-scrollbar-thumb:hover { background: #aeb7c4; border: 2px solid transparent; background-clip: content-box; }
*::-webkit-scrollbar-corner { background: transparent; }
.app-container { height: 100vh; display: flex; flex-direction: column; }
.app-header { display: flex; align-items: center; background: #fff; border-bottom: 1px solid #e4e7ed; padding: 0 20px; height: 60px; }
.logo { display: flex; align-items: center; gap: 8px; margin-right: 40px; }
.logo-icon { font-size: 24px; }
.logo-text { font-size: 18px; font-weight: 600; color: #303133; }
.nav-menu { flex: 1; border-bottom: none !important; }
.header-right { margin-left: auto; }
.app-main {
  flex: 1;
  min-height: 0;
  height: calc(100vh - 60px);
  overflow: hidden;
  background: #f5f7fa;
  padding: 20px;
  position: relative;
}

.route-content {
  height: 100%;
  min-height: 0;
}

.route-content.hidden {
  visibility: hidden;
  pointer-events: none;
}

.persistent-verify-view {
  position: absolute;
  top: 20px;
  left: 20px;
  right: 20px;
  bottom: 20px;
  visibility: hidden;
  opacity: 0;
  pointer-events: none;
}

.persistent-verify-view.active {
  visibility: visible;
  opacity: 1;
  pointer-events: auto;
}

.login-overlay { position: absolute; top: 20px; left: 20px; right: 20px; bottom: 20px; z-index: 100; }

.loading-mask {
  position: absolute; top: 0; left: 0; right: 0; bottom: 0;
  background: #fff; z-index: 101;
  display: flex; align-items: center; justify-content: center;
}
.loading-spinner { text-align: center; }
.spinner {
  width: 40px; height: 40px; margin: 0 auto 16px;
  border: 4px solid #e4e7ed; border-top-color: #409eff;
  border-radius: 50%; animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.webview-wrapper { position: absolute; top: 0; left: 0; right: 0; bottom: 0; }
.webview-wrapper .login-webview { width: 100%; height: 100%; border: none; }
.webview-wrapper:not(.ready) .login-webview { visibility: hidden !important; }

.login-status-overlay { position: absolute; top: 20px; left: 20px; right: 20px; bottom: 20px; z-index: 101; }
.login-card { max-width: 760px; margin: 0 auto; box-shadow: 0 2px 12px rgba(0,0,0,0.08); }
.card-header { font-size: 16px; font-weight: 600; }
.user-info { margin: 20px 0; }
.actions { display: flex; gap: 12px; justify-content: center; margin-top: 20px; }
</style>
