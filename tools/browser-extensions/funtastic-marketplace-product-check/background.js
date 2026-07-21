const ACTIVE_KEY = 'funtasticMarketplaceActiveCheck'
const PROD_URLS = [
  'https://funtastic-saas.vercel.app/analytics/price-table',
  'https://funtastic-saas-vercel.vercel.app/analytics/price-table',
]

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void handleMessage(message, sender).then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message }))
  return true
})

async function handleMessage(message, sender) {
  if (!message || typeof message.type !== 'string') return { ok: false }
  if (message.type === 'FUNTASTIC_MARKET_CHECK_PING') return { ok: true }
  if (message.type === 'FUNTASTIC_MARKET_CHECK_START') {
    const check = normalizeCheck(message.check)
    if (!check) return { ok: false, error: '확인할 상품 정보가 없습니다.' }
    await chrome.storage.local.set({ [ACTIVE_KEY]: check })
    return { ok: true, check }
  }
  if (message.type === 'FUNTASTIC_MARKET_CHECK_GET_ACTIVE') {
    return { ok: true, check: await getActiveCheck() }
  }
  if (message.type === 'FUNTASTIC_MARKET_CHECK_ANALYZE') {
    const check = await getActiveCheck()
    if (!check) return { ok: false, error: 'SaaS에서 먼저 확인할 상품을 선택해주세요.' }
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) return { ok: false, error: '현재 탭을 확인할 수 없습니다.' }
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'FUNTASTIC_MARKET_CHECK_READ', check })
      .catch((error) => ({ ok: false, error: error.message }))
    if (!response?.ok) return response
    return saveResult({ ...response.result, check })
  }
  if (message.type === 'FUNTASTIC_MARKET_CHECK_MANUAL') {
    const check = await getActiveCheck()
    if (!check) return { ok: false, error: 'SaaS에서 먼저 확인할 상품을 선택해주세요.' }
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    return saveResult({
      check,
      status: message.status,
      marketplaceProductId: check.productIds[0] || null,
      marketplaceProductName: check.productName,
      sellerUrl: tab?.url || check.sellerUrl,
      rawData: { manual: true, pageTitle: tab?.title || null },
    })
  }
  if (message.type === 'FUNTASTIC_MARKET_CHECK_SAVED_ACK') {
    await chrome.storage.local.remove(ACTIVE_KEY)
    return { ok: true }
  }
  if (message.type === 'FUNTASTIC_MARKET_CHECK_OPEN_SAAS') {
    const tab = await findSaasTab()
    if (tab?.id) await chrome.tabs.update(tab.id, { active: true })
    else await chrome.tabs.create({ url: PROD_URLS[0], active: true })
    return { ok: true }
  }
  return { ok: false }
}

async function saveResult(result) {
  const payload = {
    productCode: result.check.productCode,
    marketplaceKey: result.check.marketplaceKey,
    marketplaceName: result.check.marketplaceName,
    accountKey: result.check.accountKey,
    status: ['registered', 'missing', 'needs_review', 'stopped'].includes(result.status) ? result.status : 'needs_review',
    marketplaceProductId: clean(result.marketplaceProductId),
    marketplaceProductName: clean(result.marketplaceProductName),
    sellerUrl: clean(result.sellerUrl),
    source: 'browser_extension',
    rawData: result.rawData || {},
  }
  const tab = await findSaasTab()
  if (!tab?.id) {
    await chrome.tabs.create({ url: PROD_URLS[0], active: true })
    return { ok: false, error: 'SaaS를 연 뒤 다시 저장해주세요.' }
  }
  await chrome.tabs.sendMessage(tab.id, {
    source: 'funtastic-marketplace-check-extension',
    type: 'FUNTASTIC_MARKET_CHECK_RESULT',
    payload,
  })
  return { ok: true, result: payload }
}

async function getActiveCheck() {
  const data = await chrome.storage.local.get(ACTIVE_KEY)
  return data[ACTIVE_KEY] || null
}

async function findSaasTab() {
  const tabs = await chrome.tabs.query({})
  return tabs.find((tab) => typeof tab.url === 'string' && (
    tab.url.startsWith('http://localhost:3000/analytics/price-table')
    || PROD_URLS.some((url) => tab.url.startsWith(url))
  )) || null
}

function normalizeCheck(value) {
  if (!value || typeof value !== 'object') return null
  const productCode = clean(value.productCode)
  const marketplaceKey = clean(value.marketplaceKey)
  const marketplaceName = clean(value.marketplaceName)
  if (!productCode || !marketplaceKey || !marketplaceName) return null
  return {
    productCode,
    productName: clean(value.productName),
    marketplaceKey,
    marketplaceName,
    accountKey: clean(value.accountKey) || marketplaceName,
    productIds: Array.isArray(value.productIds) ? value.productIds.map(clean).filter(Boolean) : [],
    sellerUrl: clean(value.sellerUrl),
    startedAt: new Date().toISOString(),
  }
}

function clean(value) {
  const result = String(value || '').replace(/\s+/g, ' ').trim()
  return result || null
}
