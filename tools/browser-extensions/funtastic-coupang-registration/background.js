importScripts('shared.js')
const rules = globalThis.FuntasticSupplierRules
const CHANNEL = 'funtastic-coupang-registration'
const EXTENSION = 'funtastic-coupang-registration-extension'
const KEY = 'supplier-registration-jobs-v1'
const HUB = 'https://supplier.coupang.com/qvt/registration'
const WIMS = 'https://supplier.coupang.com/qvt/wims'
let serial = Promise.resolve()
const exclusively = action => {
  const result = serial.then(action, action)
  serial = result.catch(() => {})
  return result
}
async function jobs() { return (await chrome.storage.local.get(KEY))[KEY] || {} }
async function persist(all) { await chrome.storage.local.set({ [KEY]: all }) }
async function report(item, status, message, extra = {}) {
  item.lastProgress = { jobId: item.job.jobId, token: item.job.token, status, message, ...extra }
  await chrome.tabs.sendMessage(item.sourceTabId, { channel: EXTENSION, type: 'PROGRESS', progress: item.lastProgress }).catch(() => {})
}
async function openJob(job, sender, checkOnly) {
  job = rules.validateJob(job)
  const all = await jobs()
  let item = all[job.jobId]
  if (item && (item.job.token !== job.token || JSON.stringify(item.job) !== JSON.stringify(job))) throw new Error('이미 시작한 등록 작업의 내용이 변경되었습니다. 새 작업으로 등록해주세요.')
  if (!item) {
    if (checkOnly) throw new Error('이 Chrome에 저장된 등록 작업이 없습니다. 처음 등록을 시작한 Chrome에서 확인해주세요.')
    const other = Object.values(all).find(value => !['failed', 'succeeded'].includes(value.lastProgress?.status))
    if (other) throw new Error('진행 중인 쿠팡 등록 작업을 먼저 확인해주세요. 중복 업로드를 방지하기 위해 한 번에 한 작업씩 진행합니다.')
    const workbookName = job.files.find(file => file.kind === 'workbook').name
    if (Object.values(all).some(value => value.job.files.some(file => file.kind === 'workbook' && rules.clean(file.name) === rules.clean(workbookName)))) throw new Error('이 견적서 파일명은 이미 사용했습니다. 새 등록 작업의 고유 파일명을 사용해주세요.')
    item = { job, sourceTabId: sender.tab.id, phase: 'new', createdAt: new Date().toISOString() }
    all[job.jobId] = item
  }
  item.sourceTabId = sender.tab.id
  if (item.lastProgress?.status === 'succeeded') {
    await chrome.tabs.sendMessage(item.sourceTabId, { channel: EXTENSION, type: 'PROGRESS', progress: item.lastProgress }).catch(() => {})
    await persist(all)
    return { ok: true, started: true }
  }
  const existing = item.hubTabId && await chrome.tabs.get(item.hubTabId).catch(() => null)
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true })
    if (checkOnly || item.phase !== 'new') {
      item.checkOnly = true
      if (item.quoteId && existing.url !== WIMS) await chrome.tabs.update(existing.id, { url: WIMS })
    }
  } else {
    const tab = await chrome.tabs.create({ url: item.quoteId ? WIMS : HUB, active: true })
    item.hubTabId = tab.id
    item.checkOnly = item.phase !== 'new'
  }
  await report(item, 'running', item.phase === 'new' ? '서플라이어허브에서 견적서·품질표시 파일을 준비합니다.' : '이미 업로드한 작업의 검증·상품 검수 결과를 확인합니다.')
  await persist(all)
  await chrome.alarms.create('supplier-registration-check', { periodInMinutes: 1 })
  await dispatch(item).catch(() => {})
  return { ok: true, started: true }
}
async function dispatch(item) {
  const tab = await chrome.tabs.get(item.hubTabId).catch(() => null)
  if (!tab || tab.status !== 'complete') return
  if (!tab.url?.startsWith('https://supplier.coupang.com/')) {
    await report(item, 'login_required', '서플라이어허브 창에서 로그인한 뒤 SaaS의 결과 확인을 눌러주세요.')
    return
  }
  const type = item.quoteId ? 'CHECK_PRODUCTS' : item.phase === 'new' ? 'PREPARE' : item.phase === 'prepared' ? 'RESUME_PREPARED' : 'CHECK_QUOTE'
  // Content scripts report back through this worker. Do not hold the serialized worker
  // queue waiting for their response, or their CLAIM/PHASE message would deadlock.
  void chrome.tabs.sendMessage(item.hubTabId, { channel: CHANNEL, type, job: item.job, quoteId: item.quoteId }).catch(() => {})
}
async function fromSupplier(message, sender) {
  if (!sender.tab || !sender.url?.startsWith('https://supplier.coupang.com/')) throw new Error('잘못된 서플라이어허브 응답입니다.')
  const all = await jobs()
  const item = all[message.jobId]
  if (!item || item.hubTabId !== sender.tab.id || item.job.token !== message.token) throw new Error('등록 작업이 일치하지 않습니다.')
  if (message.type === 'CLAIM_PREPARATION') {
    if (item.phase !== 'new') return { ok: false, error: '이미 준비한 견적서입니다. 중복 업로드하지 않고 검증 결과를 확인합니다.' }
    item.phase = 'preparing'
    await persist(all)
    return { ok: true }
  }
  if (message.type === 'PHASE') {
    const previous = { prepared: 'preparing', submitting: 'prepared', submitted: 'submitting' }
    if (previous[message.phase] !== item.phase) throw new Error('업로드 상태가 일치하지 않습니다. 중복 검증하지 않고 결과를 확인해주세요.')
    if (['prepared', 'submitting', 'submitted'].includes(message.phase)) item.phase = message.phase
    await report(item, 'running', String(message.message || '서플라이어허브에서 확인 중입니다.'))
  } else if (message.type === 'OBSERVATION') {
    if (message.kind === 'quote') {
      const workbookName = item.job.files.find(file => file.kind === 'workbook').name
      const result = rules.quoteResult(message.rows || [], workbookName)
      if (result.state === 'verified') {
        if (item.quoteId && item.quoteId !== result.quoteId) throw new Error('견적서 ID가 변경되어 자동 진행하지 않습니다.')
        item.quoteId = result.quoteId
        item.phase = 'submitted'
        await report(item, 'running', '견적서 검증 완료. 실제 상품 검수 완료와 SKU를 확인합니다.', { receiptId: item.quoteId, receiptUrl: WIMS })
        await persist(all)
        await chrome.tabs.update(item.hubTabId, { url: WIMS })
      } else await report(item, result.state === 'failed' ? 'failed' : 'running', result.message)
    } else if (message.kind === 'products' && item.quoteId) {
      const result = rules.productResult(message.rows || [], item.job.rows.map(row => rules.clean(row.name)), item.quoteId)
      const extra = { receiptId: item.quoteId, receiptUrl: WIMS }
      if (result.state === 'succeeded') {
        const observedAt = new Date().toISOString()
        await report(item, 'succeeded', '모든 상품의 쿠팡 검수 완료와 SKU를 확인했습니다.', { ...extra, completedAt: observedAt, evidence: { workbookName: item.job.files.find(file => file.kind === 'workbook').name, quoteId: item.quoteId, products: result.products, observedAt } })
      } else await report(item, result.state === 'failed' ? 'failed' : 'running', result.message, extra)
    }
  } else if (message.type === 'STATE') {
    // Once file assignment started, an error may be ambiguous. Keep the batch active
    // so the SaaS cannot accidentally create a new submission and upload it again.
    const status = message.status === 'failed' && item.phase !== 'new' ? 'running' : ['running', 'login_required', 'failed'].includes(message.status) ? message.status : 'running'
    await report(item, status, String(message.message || '서플라이어허브에서 확인해주세요.'))
  }
  await persist(all)
  return { ok: true }
}

function categoryArguments(message) {
  if (message.type === 'CATEGORY_SEARCH') {
    if (!Array.isArray(message.queries) || !message.queries.length || message.queries.length > 6 || message.queries.some(query => typeof query !== 'string' || !query.trim() || query.trim().length > 200)) throw new Error('카테고리 검색어는 1~6개, 각 200자 이내로 입력해주세요.')
    return { queries: [...new Set(message.queries.map(query => query.trim()))] }
  }
  const categoryId = String(message.categoryId ?? '')
  if (!/^[1-9]\d*$/.test(categoryId) || !Number.isSafeInteger(Number(categoryId))) throw new Error('쿠팡 카테고리 ID를 확인해주세요.')
  return { categoryId }
}
function categoryDeadline(promise, milliseconds, message) {
  let timer
  return Promise.race([promise, new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds) })]).finally(() => clearTimeout(timer))
}
async function categoryTab() {
  const tabs = await chrome.tabs.query({ url: 'https://supplier.coupang.com/*' })
  const existing = tabs.find(tab => { try { const url = new URL(tab.url); return url.origin === 'https://supplier.coupang.com' && url.pathname === '/qvt/registration' } catch { return false } })
  const selected = existing || await chrome.tabs.create({ url: HUB, active: false })
  if (!Number.isInteger(selected.id)) throw new Error('서플라이어허브 창을 열지 못했습니다.')
  const started = Date.now()
  while (Date.now() - started < 15000) {
    const tab = await chrome.tabs.get(selected.id)
    if (tab.status === 'complete') {
      let url
      try { url = new URL(tab.url) } catch { throw new Error('서플라이어허브 주소를 확인하지 못했습니다.') }
      if (url.origin !== 'https://supplier.coupang.com' || /\/(?:login|signin)(?:\/|$)/i.test(url.pathname)) throw new Error('서플라이어허브 창에서 로그인한 뒤 다시 검색해주세요.')
      return selected.id
    }
    await new Promise(resolve => setTimeout(resolve, 150))
  }
  throw new Error('서플라이어허브 화면 연결 시간이 초과되었습니다. 창을 확인한 뒤 다시 시도해주세요.')
}
async function categoryCommand(message, sender) {
  if (!sender.tab || !rules.allowedSaas(sender.url || '')) throw new Error('쿠팡 상품등록 화면에서 시작해주세요.')
  const args = categoryArguments(message)
  const tabId = await categoryTab()
  const response = await categoryDeadline(chrome.tabs.sendMessage(tabId, { channel: CHANNEL, type: message.type, ...args }), 70000, '쿠팡 카테고리 응답 시간이 초과되었습니다. 다시 시도해주세요.')
  if (!response || typeof response.ok !== 'boolean') throw new Error('쿠팡 등록 확장을 새로고침한 뒤 다시 시도해주세요.')
  return response
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.channel !== CHANNEL) return
  if (message.type === 'PING') {
    if (!sender.tab || !rules.allowedSaas(sender.url || '')) respond({ ok: false, error: '쿠팡 상품등록 화면에서 시작해주세요.' })
    else respond({ ok: true, version: chrome.runtime.getManifest().version, supportsCategories: true })
    return true
  }
  if (['CATEGORY_SEARCH', 'CATEGORY_TEMPLATE'].includes(message.type)) {
    categoryCommand(message, sender).then(respond).catch(error => respond({ ok: false, error: error.message }))
    return true
  }
  exclusively(async () => {
    if (['START', 'CHECK'].includes(message.type)) {
      if (!sender.tab || !rules.allowedSaas(sender.url || '')) throw new Error('쿠팡 상품등록 화면에서 시작해주세요.')
      return openJob(message.job, sender, message.type === 'CHECK')
    }
    return fromSupplier(message, sender)
  }).then(respond).catch(error => respond({ ok: false, error: error.message }))
  return true
})
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status !== 'complete') return
  exclusively(async () => { const all = await jobs(); for (const item of Object.values(all)) if (item.hubTabId === tabId && !['failed', 'succeeded'].includes(item.lastProgress?.status)) await dispatch(item).catch(() => {}); await persist(all) })
})
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name !== 'supplier-registration-check') return
  exclusively(async () => {
    const all = await jobs()
    for (const item of Object.values(all)) {
      if (['failed', 'succeeded'].includes(item.lastProgress?.status)) continue
      await dispatch(item).catch(() => {})
    }
    await persist(all)
  })
})
