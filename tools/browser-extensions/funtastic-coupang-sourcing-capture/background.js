const PENDING_KEY = 'funtasticCoupangSourcingPending'
const EXTENSION_SOURCE = 'funtastic-coupang-sourcing-extension'
const LOCAL_SOURCING_URL = 'http://localhost:3000/operations/sourcing'
const PROD_SOURCING_URL = 'https://funtastic-saas-vercel.vercel.app/operations/sourcing'
const MAX_PENDING = 50

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void handleMessage(message, sender)
    .then((response) => sendResponse(response))
    .catch((error) => sendResponse({ ok: false, error: errorMessage(error) }))
  return true
})

async function handleMessage(message, sender) {
  if (!message || typeof message !== 'object') return { ok: false }

  if (message.type === 'FUNTASTIC_COUPANG_CAPTURE') {
    const capture = normalizeCapture(message.capture, sender.tab?.url)
    if (!capture) return { ok: false, error: '쿠팡 상품 정보를 찾지 못했습니다.' }
    await addPendingCapture(capture)
    const tab = await ensureSourcingTab(sender.tab?.url)
    await sendCaptureToSaas(tab.id, capture)
    return { ok: true, captureId: capture.captureId }
  }

  if (message.type === 'FUNTASTIC_COUPANG_CAPTURE_ACTIVE') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id || !isCoupangUrl(tab.url)) {
      return { ok: false, error: '쿠팡 상품 페이지에서 실행해 주세요.' }
    }
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'FUNTASTIC_COUPANG_EXTRACT' })
      .catch((error) => ({ ok: false, error: errorMessage(error) }))
    if (!response?.ok || !response.capture) {
      return { ok: false, error: response?.error || '쿠팡 상품 정보를 읽지 못했습니다.' }
    }
    const capture = normalizeCapture(response.capture, tab.url)
    if (!capture) return { ok: false, error: '쿠팡 상품 정보를 찾지 못했습니다.' }
    await addPendingCapture(capture)
    const saasTab = await ensureSourcingTab(tab.url)
    await sendCaptureToSaas(saasTab.id, capture)
    return { ok: true, captureId: capture.captureId }
  }

  if (message.type === 'FUNTASTIC_COUPANG_GET_PENDING') {
    const captures = await getPendingCaptures()
    return { ok: true, captures, pendingCount: captures.length }
  }

  if (message.type === 'FUNTASTIC_COUPANG_CAPTURE_SAVED') {
    await removePendingCapture(String(message.captureId || ''))
    return { ok: true }
  }

  if (message.type === 'FUNTASTIC_COUPANG_GET_STATUS') {
    const captures = await getPendingCaptures()
    return { ok: true, pendingCount: captures.length }
  }

  if (message.type === 'FUNTASTIC_COUPANG_OPEN_SAAS') {
    const tab = await ensureSourcingTab(null)
    if (tab.id) await chrome.tabs.update(tab.id, { active: true })
    return { ok: true }
  }

  return { ok: false }
}

function normalizeCapture(raw, fallbackUrl) {
  if (!raw || typeof raw !== 'object') return null
  const sourceTitle = cleanText(raw.sourceTitle || raw.title)
  if (!sourceTitle) return null
  const sourceUrl = cleanText(raw.sourceUrl || fallbackUrl)
  const captureId = cleanText(raw.captureId) || `coupang:${Date.now()}:${Math.random().toString(36).slice(2)}`
  return {
    captureId,
    sourceTitle,
    sourceUrl,
    imageUrl: cleanText(raw.imageUrl),
    category: cleanText(raw.category),
    sourceRank: cleanNumber(raw.sourceRank),
    sourcePrice: cleanNumber(raw.sourcePrice),
    keyword: cleanText(raw.keyword),
    memo: cleanText(raw.memo) || '쿠팡 확장프로그램에서 저장',
    capturedAt: new Date().toISOString(),
  }
}

async function getPendingCaptures() {
  const result = await chrome.storage.local.get(PENDING_KEY)
  return Array.isArray(result[PENDING_KEY]) ? result[PENDING_KEY] : []
}

async function addPendingCapture(capture) {
  const captures = await getPendingCaptures()
  const withoutSameUrl = captures.filter((item) => (
    item.captureId !== capture.captureId
    && (!capture.sourceUrl || item.sourceUrl !== capture.sourceUrl)
  ))
  await chrome.storage.local.set({
    [PENDING_KEY]: [capture, ...withoutSameUrl].slice(0, MAX_PENDING),
  })
}

async function removePendingCapture(captureId) {
  if (!captureId) return
  const captures = await getPendingCaptures()
  await chrome.storage.local.set({
    [PENDING_KEY]: captures.filter((capture) => capture.captureId !== captureId),
  })
}

async function ensureSourcingTab(sourceUrl) {
  const existing = await findSourcingTab()
  if (existing?.id) return existing

  const baseUrl = sourceUrl && sourceUrl.startsWith('http://localhost:')
    ? LOCAL_SOURCING_URL
    : await preferredSourcingUrl()
  return chrome.tabs.create({ url: baseUrl, active: true })
}

async function preferredSourcingUrl() {
  const tabs = await chrome.tabs.query({})
  if (tabs.some((tab) => tab.url?.startsWith('http://localhost:3000/'))) return LOCAL_SOURCING_URL
  if (tabs.some((tab) => tab.url?.startsWith('https://funtastic-saas-vercel.vercel.app/'))) return PROD_SOURCING_URL
  return LOCAL_SOURCING_URL
}

async function findSourcingTab() {
  const tabs = await chrome.tabs.query({})
  return tabs.find((tab) => isSourcingUrl(tab.url)) || null
}

async function sendCaptureToSaas(tabId, capture) {
  if (!tabId) return
  await chrome.tabs.sendMessage(tabId, {
    source: EXTENSION_SOURCE,
    type: 'FUNTASTIC_COUPANG_CAPTURED',
    capture,
  }).catch(() => {})
}

function isSourcingUrl(url) {
  return typeof url === 'string'
    && (
      url.startsWith('http://localhost:3000/operations/sourcing')
      || url.startsWith('https://funtastic-saas-vercel.vercel.app/operations/sourcing')
    )
}

function isCoupangUrl(url) {
  try {
    const parsed = new URL(url || '')
    return parsed.hostname === 'coupang.com' || parsed.hostname.endsWith('.coupang.com')
  } catch {
    return false
  }
}

function cleanText(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  return text || null
}

function cleanNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : null
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error || '알 수 없는 오류')
}
