const PAGE_SOURCE = 'funtastic-saas'
const EXTENSION_SOURCE = 'funtastic-coupang-sourcing-extension'

window.addEventListener('message', (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return
  const message = event.data
  if (!message || message.source !== PAGE_SOURCE || typeof message.type !== 'string') return

  if (message.type === 'FUNTASTIC_COUPANG_PING') {
    try {
      if (!chrome.runtime?.id) return
      chrome.runtime.sendMessage({ type: 'FUNTASTIC_COUPANG_GET_STATUS' }, (response) => {
        if (chrome.runtime.lastError) return
        window.postMessage({
          source: EXTENSION_SOURCE,
          type: 'FUNTASTIC_COUPANG_PONG',
          version: chrome.runtime.getManifest().version,
          pendingCount: response?.pendingCount || 0,
        }, window.location.origin)
      })
    } catch {
      // The unpacked extension may have been reloaded while the SaaS tab was open.
    }
    return
  }

  if (message.type === 'FUNTASTIC_COUPANG_GET_PENDING') {
    try {
      if (!chrome.runtime?.id) return
      chrome.runtime.sendMessage({ type: 'FUNTASTIC_COUPANG_GET_PENDING' }, (response) => {
        if (chrome.runtime.lastError) return
        window.postMessage({
          source: EXTENSION_SOURCE,
          type: 'FUNTASTIC_COUPANG_PENDING',
          captures: Array.isArray(response?.captures) ? response.captures : [],
        }, window.location.origin)
      })
    } catch {
      // Ignore stale extension contexts.
    }
    return
  }

  if (
    message.type === 'FUNTASTIC_COUPANG_CAPTURE_SAVED'
    || message.type === 'FUNTASTIC_1688_SOURCING_START'
    || message.type === 'FUNTASTIC_1688_SOURCING_CANDIDATES_SAVED'
  ) {
    try {
      if (!chrome.runtime?.id) return
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError || response?.ok !== false) return
        window.postMessage({
          source: EXTENSION_SOURCE,
          type: message.type === 'FUNTASTIC_1688_SOURCING_START'
            ? 'FUNTASTIC_1688_SOURCING_ERROR'
            : 'FUNTASTIC_COUPANG_ERROR',
          message: response.error || '확장프로그램 작업을 처리하지 못했습니다.',
        }, window.location.origin)
      })
    } catch {
      // Ignore stale extension contexts.
    }
  }
})

chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.source !== EXTENSION_SOURCE || typeof message.type !== 'string') return
  window.postMessage(message, window.location.origin)
})
