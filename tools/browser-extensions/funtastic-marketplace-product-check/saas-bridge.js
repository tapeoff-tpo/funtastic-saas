const PAGE_SOURCE = 'funtastic-saas'
const EXTENSION_SOURCE = 'funtastic-marketplace-check-extension'

window.addEventListener('message', (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return
  const message = event.data
  if (!message || message.source !== PAGE_SOURCE || typeof message.type !== 'string') return

  if (message.type === 'FUNTASTIC_MARKET_CHECK_PING') {
    chrome.runtime.sendMessage({ type: message.type }, (response) => {
      if (!response?.ok) return
      window.postMessage({ source: EXTENSION_SOURCE, type: 'FUNTASTIC_MARKET_CHECK_PONG' }, window.location.origin)
    })
  }
  if (message.type === 'FUNTASTIC_MARKET_CHECK_START') {
    chrome.runtime.sendMessage({ type: message.type, check: message.check })
  }
})

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.source !== EXTENSION_SOURCE || message.type !== 'FUNTASTIC_MARKET_CHECK_RESULT') return false
  void saveCheck(message.payload).then(sendResponse)
  return true
})

async function saveCheck(payload) {
  try {
    const response = await fetch('/api/analytics/price-table/checks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(body.error || '확인 결과 저장에 실패했습니다.')
    await chrome.runtime.sendMessage({ type: 'FUNTASTIC_MARKET_CHECK_SAVED_ACK' })
    window.postMessage({ source: EXTENSION_SOURCE, type: 'FUNTASTIC_MARKET_CHECK_SAVED', check: body.check }, window.location.origin)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
