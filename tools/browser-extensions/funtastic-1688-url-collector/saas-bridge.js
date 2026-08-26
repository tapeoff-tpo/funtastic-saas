const PAGE_SOURCE = 'funtastic-saas'
const EXTENSION_SOURCE = 'funtastic-1688-extension'

window.addEventListener('message', (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return
  const message = event.data
  if (!message || message.source !== PAGE_SOURCE || typeof message.type !== 'string') return

  if (message.type === 'FUNTASTIC_1688_PING') {
    let version = null
    try {
      if (!chrome.runtime?.id) return
      version = chrome.runtime.getManifest().version
    } catch {
      return
    }
    chrome.runtime.sendMessage({ type: 'FUNTASTIC_1688_GET_STATUS' }, (response) => {
      if (chrome.runtime.lastError) return
      window.postMessage({
        source: EXTENSION_SOURCE,
        type: 'FUNTASTIC_1688_PONG',
        version,
        ...response,
      }, window.location.origin)
    })
    return
  }

  if (
    message.type !== 'FUNTASTIC_1688_START'
    && message.type !== 'FUNTASTIC_1688_CANCEL'
    && message.type !== 'FUNTASTIC_1688_RESULT_SAVED'
    && message.type !== 'FUNTASTIC_1688_VERIFY_START'
    && message.type !== 'FUNTASTIC_1688_VERIFY_CANCEL'
    && message.type !== 'FUNTASTIC_1688_VERIFY_RESULT_SAVED'
    && message.type !== 'FUNTASTIC_1688_DETAIL_IMAGES_START'
    && message.type !== 'FUNTASTIC_1688_PRICE_LOOKUP_START'
  ) return
  try {
    if (!chrome.runtime?.id) return
    if (message.type === 'FUNTASTIC_1688_PRICE_LOOKUP_START') {
      window.postMessage({
        source: EXTENSION_SOURCE,
        type: 'FUNTASTIC_1688_PRICE_LOOKUP_ACK',
        requestId: message.requestId,
      }, window.location.origin)
    }
    chrome.runtime.sendMessage(message, (response) => {
      if (!chrome.runtime.lastError && response?.ok !== false) {
        if (message.type === 'FUNTASTIC_1688_PRICE_LOOKUP_START') {
          window.postMessage({
            source: EXTENSION_SOURCE,
            type: 'FUNTASTIC_1688_PRICE_LOOKUP_RESULT',
            requestId: message.requestId,
            ...response,
          }, window.location.origin)
        }
        return
      }
      window.postMessage({
        source: EXTENSION_SOURCE,
        type: message.type === 'FUNTASTIC_1688_DETAIL_IMAGES_START'
          ? 'FUNTASTIC_1688_DETAIL_IMAGES_ERROR'
          : message.type === 'FUNTASTIC_1688_PRICE_LOOKUP_START'
            ? 'FUNTASTIC_1688_PRICE_LOOKUP_ERROR'
            : 'FUNTASTIC_1688_ERROR',
        runId: message.runId,
        requestId: message.requestId,
        message: response?.error || chrome.runtime.lastError?.message || '확장프로그램 작업을 시작하지 못했습니다.',
      }, window.location.origin)
    })
  } catch {
    // Reloading the unpacked extension invalidates scripts in already-open SaaS tabs.
  }
})

chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.source !== EXTENSION_SOURCE || typeof message.type !== 'string') return
  window.postMessage(message, window.location.origin)
})
