// Response fixture only: signing, cookies and encryption stay in the native page.
// Prompt wording/amounts are synthetic; see contracts/aigei-authorization.yaml.
const http = require('node:http')
const state = async () => (await pm.state.get('aigei.authorizations')) || { charges: 0, requests: 0 }
http.createServer(async (req, res) => {
  const send = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  }
  if (req.url === '/__state' && req.method === 'GET') return send(200, await state())
  if (req.url === '/__reset' && req.method === 'POST') {
    await pm.state.set('aigei.authorizations', { charges: 0, requests: 0 })
    return send(200, await state())
  }
  if (req.url !== '/f/d' || req.method !== 'POST') return send(501, { error: 'Not modeled' })
  const body = typeof req.body === 'object' ? req.body : Object.fromEntries(new URLSearchParams(req.body || ''))
  const scenario = body.scenario || 'success'
  const current = await state()
  current.requests++
  await pm.state.set('aigei.authorizations', current)
  if (scenario === 'rejected') return send(200, {
    statusCode: 'error', ajaxExProc: { procCompType: 'tip', content: '铜币不足' }
  })
  if (String(body.confirm) !== 'true' && scenario !== 'free') return send(200, {
    statusCode: 'error', ajaxExProc: {
      procCompType: 'tip', content: '本次下载消耗25铜币，是否继续？', actionButton: { action: 'download' }
    }
  })
  if (scenario === 'captcha' && String(body.captcha) !== 'true') return send(200, {
    statusCode: 'error', ajaxExProc: { procCompType: 'vcode', actionType: 'refresh', type: 'normal', content: '请完成验证码' }
  })
  const cost = scenario === 'free' ? 0 : 25
  current.charges += cost
  await pm.state.set('aigei.authorizations', current)
  if (scenario === 'charge-timeout') await new Promise(resolve => setTimeout(resolve, 1500))
  send(200, {
    statusCode: 'success', message: 'synthetic-native-url',
    consumeFundValue: { fundType: 'down', value: cost }, consumeFundRemain: 100 - cost
  })
}).listen(process.env.PORT)
