/** Executed in the site's main world; all dependencies must stay inside this function. */
export function installAuthorizationHook(itemId: string): boolean {
  const site = window as any
  if (typeof site.fileProcess !== 'function' ||
      typeof site.jsInterface_download_proessResultJson !== 'function' ||
      typeof site.jsInterface_downloadConfirm !== 'function') return false

  const originalProcess = site.fileProcess
  const originalResult = site.jsInterface_download_proessResultJson
  let pending: { response: any; options: any } | undefined
  let released = false
  let coinConfirmed = false
  const state: any = { authorizationState: 'pending' }
  site.__aigeiAuthorization = {
    state,
    release() {
      if (!pending || released) return false
      released = true
      originalProcess.call(site, pending.response, pending.options)
      return true
    }
  }
  const matches = (options: any) => options?.model === 'down' && String(options.itemId) === itemId
  const waitForUser = () => { if (!pending) state.authorizationState = 'waiting' }
  const plainText = (value: any) => String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  const isVerification = (value: any) => /验证码|安全验证|人机验证|系统验证|滑块|captcha|geetest|aliyun/i.test(plainText(value))
  const handleProc = (proc: any): boolean => {
    const text = plainText(String(proc?.title || '') + ' ' + String(proc?.content || ''))
    if (proc?.procCompType === 'vcode' || proc?.procCompType === 'banIp' || isVerification(text)) {
      waitForUser()
      return false // Keep the native CAPTCHA flow, including its callbacks.
    }
    // A coin-confirmation tip can contain VIP promotional copy. The native
    // action identifies the download confirmation; promotion is not a VIP gate.
    if (!coinConfirmed && proc?.procCompType === 'tip' && proc.actionButton?.action === 'download' &&
        /铜币/.test(text) && /消耗|扣除|下载确认/.test(text) &&
        !/人民币|现金|充值|余额不足|铜币不足/.test(text) && matches(site._curFileDownOpts)) {
      coinConfirmed = true
      site.jsInterface_downloadConfirm()
      return true
    }
    state.authorizationState = 'rejected'
    state.error = text.slice(0, 240) || '网站未授权，请检查登录状态、铜币余额或资源权限'
    return true
  }
  const originalConfirm = site.jsInterface_downloadConfirm
  site.jsInterface_downloadConfirm = function () {
    if (matches(site._curFileDownOpts)) state.authorizationState = 'pending'
    return originalConfirm.apply(this, arguments)
  }
  // Auto-confirm only coin spending; surface the native CAPTCHA for the user.
  const router = site.gei?.ajaxComp?.ajaxExProcRoute
  if (typeof router?.route === 'function') {
    const originalRoute = router.route
    router.route = function (proc: any, url: string, options: any) {
      if (matches(options) && handleProc(proc)) return
      return originalRoute.apply(this, arguments)
    }
  }
  const util = site.gei?.util
  if (typeof util?.pop === 'function') {
    const originalPop = util.pop
    util.pop = function (config: any) {
      if (matches(site._curFileDownOpts) && !pending) {
        const text = plainText(String(config?.title || '') + ' ' + String(config?.message || ''))
        if (isVerification(text) || state.authorizationState === 'waiting') waitForUser()
        else {
          state.authorizationState = 'rejected'
          state.error = text.slice(0, 240) || '网站未授权，请检查资源权限'
          return
        }
      }
      return originalPop.apply(this, arguments)
    }
  }
  if (typeof site.itemFileDownAjaxPost === 'function') {
    const originalPost = site.itemFileDownAjaxPost
    site.itemFileDownAjaxPost = function () {
      if (matches(site._curFileDownOpts) && !pending) state.authorizationState = 'pending'
      return originalPost.apply(this, arguments)
    }
  }
  site.fileProcess = function (response: any, options: any) {
    if (!matches(options)) return originalProcess.apply(this, arguments)
    if (pending || response?.statusCode !== 'success') return
    pending = { response, options }
    state.authorizationState = 'authorized'
    const fund = response.consumeFundValue
    if (fund?.fundType === 'down' && fund.value != null && Number.isFinite(Number(fund.value)) && Number(fund.value) >= 0) {
      state.coinsSpent = Number(fund.value)
    }
    if (response.consumeFundRemain != null && Number.isFinite(Number(response.consumeFundRemain))) {
      state.coinBalance = Number(response.consumeFundRemain)
    }
    // Host persists authorization before allowing the native file transfer.
  }
  site.jsInterface_download_proessResultJson = function (response: any, options: any, url: string) {
    if (!matches(options)) return originalResult.apply(this, arguments)
    if (pending) return
    if (response?.statusCode === 'success') return site.fileProcess(response, options)
    if (typeof router?.route !== 'function' && handleProc(response?.ajaxExProc)) return
    return originalResult.apply(this, arguments)
  }
  return true
}
