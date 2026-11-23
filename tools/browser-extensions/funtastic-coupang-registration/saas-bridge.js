;(function () {
  const PAGE_SOURCE = 'funtastic-coupang-registration'
  const EXTENSION_SOURCE = 'funtastic-coupang-registration-extension'
  const tokens = new Map()
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.source !== PAGE_SOURCE) return
    const { type, requestId, job } = event.data
    if (!['PING', 'START', 'CHECK'].includes(type) || typeof requestId !== 'string') return
    if (type !== 'PING' && job && typeof job.jobId === 'string' && typeof job.token === 'string') tokens.set(job.jobId, job.token)
    try {
      chrome.runtime.sendMessage({ channel: PAGE_SOURCE, type, job }, response => {
        const error = chrome.runtime.lastError?.message
        window.postMessage({ source: EXTENSION_SOURCE, type: 'RESPONSE', requestId, ...(error ? { ok: false, error: '쿠팡 등록 확장을 새로고침해주세요.' } : response) }, location.origin)
      })
    } catch {
      window.postMessage({ source: EXTENSION_SOURCE, type: 'RESPONSE', requestId, ok: false, error: '쿠팡 등록 확장을 새로고침해주세요.' }, location.origin)
    }
  })
  chrome.runtime.onMessage.addListener(message => {
    if (message?.channel !== EXTENSION_SOURCE || message.type !== 'PROGRESS') return
    const progress = message.progress
    if (!progress || tokens.get(progress.jobId) !== progress.token) return
    window.postMessage({ source: EXTENSION_SOURCE, type: 'PROGRESS', progress }, location.origin)
  })
})()
