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
    window.postMessage({
      source: EXTENSION_SOURCE,
      type: 'FUNTASTIC_1688_PONG',
      version,
    }, window.location.origin)
    return
  }

  if (message.type !== 'FUNTASTIC_1688_START' && message.type !== 'FUNTASTIC_1688_CANCEL') return
  try {
    if (!chrome.runtime?.id) return
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError || response?.ok !== false) return
      window.postMessage({
        source: EXTENSION_SOURCE,
        type: 'FUNTASTIC_1688_ERROR',
        runId: message.runId,
        message: response.error || '확장프로그램 작업을 시작하지 못했습니다.',
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
