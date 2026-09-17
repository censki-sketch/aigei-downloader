<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Check, Coin, Download, House, Refresh, User } from '@element-plus/icons-vue'
import { api } from '../api'

defineOptions({ name: 'AigeiVerifyView' })

const router = useRouter()
const route = useRoute()
const webviewRef = ref<any>(null)
const loading = ref(true)
const SITE_HOME_URL = 'https://www.aigei.com/sound/class/'
const DOWNLOADS_URL = 'https://www.aigei.com/home/mark?markType=down'
const COIN_URL = 'https://www.aigei.com/home/coin'
const currentUrl = ref(SITE_HOME_URL)
const loginStatus = ref<any>({ isLoggedIn: false })
const visibleAccount = ref<{ username?: string; userId?: string; coins?: string }>({})
const verifyHint = ref('')
let hasLoadedOnce = false
let showNextLoading = true
let lastRequestedUrl = SITE_HOME_URL
let lastSecurityRecoveryAt = 0
let securityRecoveryCount = 0
let securityRecoveryTimer: ReturnType<typeof setTimeout> | null = null
let securityPollTimer: ReturnType<typeof setInterval> | null = null
let unsubLoginSuccess: (() => void) | null = null
let webviewReady = false
let securityInspectionRunning = false

const checkStatus = async () => {
  try {
    const status = await api.login.check()
    loginStatus.value = status
    if (!status?.isLoggedIn) visibleAccount.value = {}
  } catch {
    loginStatus.value = { isLoggedIn: false }
    visibleAccount.value = {}
  }
}

const syncVisibleAccount = async () => {
  const wv = webviewRef.value
  if (!wv || !webviewReady) return

  try {
    const result = await wv.executeJavaScript(`
      (function() {
        var text = document.body ? document.body.innerText : '';
        var byId = function(id) {
          var el = document.getElementById(id);
          return el && el.textContent ? el.textContent.trim() : '';
        };
        var fromText = function(regex) {
          var match = text.match(regex);
          return match ? match[1].trim() : '';
        };
        return {
          username: byId('loginUserInfoName') || byId('myNickName') || window.loginUserName || '',
          userId: byId('myGeiId') || window.loginUserId || fromText(/爱给ID\\s*[:：]?\\s*([0-9]+)/),
          coins: byId('myCoin') || window.userTotalFundDown || fromText(/铜币\\s*[:：]?\\s*([0-9,.]+)/)
        };
      })();
    `)
    visibleAccount.value = {
      username: result?.username || undefined,
      userId: result?.userId || undefined,
      coins: result?.coins || undefined
    }
  } catch {
    visibleAccount.value = {}
  }
}

const reloadPage = () => {
  showNextLoading = true
  loading.value = true
  clearSecurityRecoveryTimer()
  webviewRef.value?.reload()
  void checkStatus()
}

const normalizeRouteUrl = (value: unknown): string => {
  const raw = Array.isArray(value) ? value[0] : value
  if (typeof raw !== 'string') return ''
  try {
    return new URL(raw).toString()
  } catch {
    return ''
  }
}

const navigateTo = (url: string, options: { force?: boolean; keepTarget?: boolean } = {}) => {
  if (!url) return
  if (!isSecurityPageUrl(url) && !options.keepTarget) {
    lastRequestedUrl = url
    securityRecoveryCount = 0
  }
  if (currentUrl.value === url && !options.force) return
  showNextLoading = true
  loading.value = true
  verifyHint.value = ''
  currentUrl.value = url
  if (options.force) {
    webviewRef.value?.loadURL?.(url)
  }
  void checkStatus()
}

const goHome = () => navigateTo(SITE_HOME_URL, { force: true })

const goDownloads = () => {
  navigateTo(DOWNLOADS_URL)
}

const goCoin = () => {
  navigateTo(COIN_URL)
}

const goLogin = () => {
  router.push('/login')
}

const isSecurityPageUrl = (url: string): boolean => {
  return /verify|captcha|security|validate|safe|check|challenge|banIp\/route/i.test(url)
}

const clearSecurityRecoveryTimer = () => {
  if (securityRecoveryTimer) {
    clearTimeout(securityRecoveryTimer)
    securityRecoveryTimer = null
  }
}

const ensureSecurityPoller = () => {
  if (securityPollTimer) return
  securityPollTimer = setInterval(() => {
    if (route.path === '/verify') void inspectSecurityState('poll')
  }, 5000)
}

const stopSecurityPoller = () => {
  if (securityPollTimer) {
    clearInterval(securityPollTimer)
    securityPollTimer = null
  }
}

const readSecurityState = async (): Promise<{
  url: string
  isSecurityPage: boolean
  isIpLimited: boolean
  hasManualChallenge: boolean
  hasAccountInfo: boolean
}> => {
  const wv = webviewRef.value
  if (!wv || !webviewReady) {
    return { url: currentUrl.value, isSecurityPage: false, isIpLimited: false, hasManualChallenge: false, hasAccountInfo: false }
  }

  const result = await wv.executeJavaScript(`
    (function() {
      var text = document.body ? document.body.innerText || '' : '';
      var title = document.title || '';
      var href = window.location.href;
      var has = function(regex) { return regex.test(text) || regex.test(title) || regex.test(href); };
      var hasAccountInfo =
        !!document.getElementById('loginUserInfoName') ||
        !!document.getElementById('myNickName') ||
        !!document.getElementById('myCoin') ||
        !!window.loginUserId ||
        !!window.loginUserName;
      return {
        url: href,
        isSecurityPage: has(/通过验证以确保正常访问|自动.*完成验证|请点击下方按钮完成验证|访问验证|安全验证|captcha|challenge|banIp\/route/i),
        isIpLimited: /\/banIp\/route/i.test(href) || /休息会.*将在\s*\d+\s*秒后回来|访问过于频繁|IP地址.*(?:限制|频繁)|限制访问频率/.test(text),
        hasManualChallenge: /请输入上图文字|请完成安全验证|拖.*完成拼图|验证码/.test(text),
        hasAccountInfo: hasAccountInfo
      };
    })();
  `)

  return {
    url: result?.url || currentUrl.value,
    isSecurityPage: !!result?.isSecurityPage,
    isIpLimited: !!result?.isIpLimited,
    hasManualChallenge: !!result?.hasManualChallenge,
    hasAccountInfo: !!result?.hasAccountInfo
  }
}

const inspectSecurityState = async (_source: string) => {
  if (route.path !== '/verify' || !webviewReady || securityInspectionRunning) return
  securityInspectionRunning = true

  let state
  try {
    state = await readSecurityState()
  } catch {
    return
  } finally {
    securityInspectionRunning = false
  }

  if (state.url && state.url !== currentUrl.value) {
    currentUrl.value = state.url
  }

  if (!state.isSecurityPage) {
    stopSecurityPoller()
    clearSecurityRecoveryTimer()
    securityRecoveryCount = 0
    verifyHint.value = ''
    if (state.hasAccountInfo) {
      void syncVisibleAccount()
      void checkStatus()
    }
    return
  }

  ensureSecurityPoller()
  if (state.isIpLimited) {
    clearSecurityRecoveryTimer()
    verifyHint.value = '当前 IP 访问频率已被限制，请等待页面倒计时结束后再刷新'
    return
  }
  verifyHint.value = state.hasManualChallenge
    ? '检测到爱给安全验证，请在下方完成验证'
    : '检测到安全验证中间页，稍后会自动返回资源页'

  if (state.hasManualChallenge) {
    clearSecurityRecoveryTimer()
    return
  }

  if (securityRecoveryTimer) return
  securityRecoveryTimer = setTimeout(async () => {
    securityRecoveryTimer = null
    await recoverAfterSecurityCheck()
  }, 4500)
}

const recoverAfterSecurityCheck = async () => {
  if (route.path !== '/verify') return
  const now = Date.now()
  if (now - lastSecurityRecoveryAt < 5000) return
  lastSecurityRecoveryAt = now

  let state
  try {
    state = await readSecurityState()
  } catch {
    return
  }
  if (!state.isSecurityPage || state.hasManualChallenge) return

  await api.login.saveCookies().catch(() => false)
  await checkStatus()
  await syncVisibleAccount()
  verifyHint.value = '验证已处理，正在返回资源页'

  const targetUrl =
    securityRecoveryCount === 0 && lastRequestedUrl && !isSecurityPageUrl(lastRequestedUrl)
      ? lastRequestedUrl
      : SITE_HOME_URL
  securityRecoveryCount += 1
  navigateTo(targetUrl, { force: true, keepTarget: true })
  ElMessage.success('验证完成，已返回资源页')
}

const handlePageSettled = () => {
  webviewReady = true
  hasLoadedOnce = true
  showNextLoading = false
  loading.value = false
  void checkStatus()
  void syncVisibleAccount()
  void inspectSecurityState('settled')
}

const handleAttach = () => {
  const wv = webviewRef.value
  if (!wv || wv.__aigeiVerifyBound) return
  wv.__aigeiVerifyBound = true

  wv.addEventListener('did-start-loading', () => {
    webviewReady = false
    stopSecurityPoller()
    if (!hasLoadedOnce || showNextLoading) {
      loading.value = true
    }
  })
  wv.addEventListener('dom-ready', () => {
    webviewReady = true
  })
  wv.addEventListener('did-stop-loading', handlePageSettled)
  wv.addEventListener('did-navigate', (event: any) => {
    if (event?.url) currentUrl.value = event.url
    void checkStatus()
  })
  wv.addEventListener('did-navigate-in-page', (event: any) => {
    if (event?.url) currentUrl.value = event.url
    void checkStatus()
  })
}

onMounted(() => {
  void checkStatus()
  unsubLoginSuccess = api.login.onSuccess((status) => {
    loginStatus.value = status || { isLoggedIn: true }
    void syncVisibleAccount()
  })
})

watch(
  () => [route.path, route.query.url],
  ([path, queryUrl]) => {
    if (path !== '/verify') return
    const targetUrl = normalizeRouteUrl(queryUrl)
    if (targetUrl && targetUrl !== currentUrl.value) {
      navigateTo(targetUrl)
    }
    void checkStatus()
    if (webviewReady) {
      void syncVisibleAccount()
      void inspectSecurityState('route')
    }
  },
  { immediate: true }
)

onUnmounted(() => {
  clearSecurityRecoveryTimer()
  stopSecurityPoller()
  if (unsubLoginSuccess) unsubLoginSuccess()
})
</script>

<template>
  <div class="verify-view">
    <div class="verify-toolbar">
      <div class="account-state">
        <el-icon :class="loginStatus?.isLoggedIn ? 'ok' : 'muted'">
          <Check v-if="loginStatus?.isLoggedIn" />
          <User v-else />
        </el-icon>
        <span>{{ loginStatus?.isLoggedIn ? '已登录' : '未确认登录' }}</span>
        <span v-if="visibleAccount.username || loginStatus?.username" class="muted">
          {{ visibleAccount.username || loginStatus.username }}
        </span>
        <span v-if="visibleAccount.userId || loginStatus?.userId" class="muted">
          ID {{ visibleAccount.userId || loginStatus.userId }}
        </span>
        <span v-if="visibleAccount.coins" class="coin-value">铜币 {{ visibleAccount.coins }}</span>
        <span v-if="verifyHint" class="verify-hint">{{ verifyHint }}</span>
      </div>

      <div class="toolbar-actions">
        <el-button :icon="House" @click="goHome">资源首页</el-button>
        <el-button :icon="Download" @click="goDownloads">我的下载</el-button>
        <el-button :icon="Coin" @click="goCoin">铜币</el-button>
        <el-button :icon="Refresh" @click="reloadPage" :loading="loading">刷新</el-button>
        <el-button v-if="!loginStatus?.isLoggedIn" type="primary" @click="goLogin">登录</el-button>
      </div>
    </div>

    <div class="verify-browser" v-loading="loading">
      <webview
        ref="webviewRef"
        class="verify-webview"
        :src="currentUrl"
        allowpopups
        @did-attach="handleAttach"
      ></webview>
    </div>
  </div>
</template>

<style scoped>
.verify-view {
  height: 100%;
  min-height: 580px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.verify-toolbar {
  min-height: 48px;
  padding: 8px 12px;
  background: #fff;
  border: 1px solid #e4e7ed;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.account-state,
.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.ok {
  color: #67c23a;
}

.muted {
  color: #909399;
}

.coin-value {
  color: #e6a23c;
  font-weight: 600;
}

.verify-hint {
  color: #e6a23c;
  font-size: 13px;
}

.verify-browser {
  flex: 1;
  min-height: 0;
  background: #fff;
  border: 1px solid #e4e7ed;
  border-radius: 6px;
  overflow: hidden;
}

.verify-webview {
  width: 100%;
  height: 100%;
  border: none;
}
</style>
