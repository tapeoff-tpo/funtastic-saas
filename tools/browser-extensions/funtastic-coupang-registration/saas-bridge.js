;(function () {
  const PAGE_SOURCE = 'funtastic-coupang-registration'
  const EXTENSION_SOURCE = 'funtastic-coupang-registration-extension'
  const tokens = new Map()
  // The bridge loads on every SaaS entry page so Next client navigation can
  // reach registration without another document load. Commands stay scoped.
  const registrationPage = () => ['https://funtastic-saas-vercel.vercel.app', 'http://localhost:3000', 'http://localhost:3001'].includes(location.origin)
    && location.pathname === '/operations/coupang-registration'
  const identity = () => typeof chrome.runtime.id === 'string' ? { extensionId: chrome.runtime.id } : {}
  window.addEventListener('message', event => {
    if (!registrationPage() || event.source !== window || event.origin !== location.origin || event.data?.source !== PAGE_SOURCE) return
    const { type, requestId, job, queries, categoryId, extensionId } = event.data
    if (extensionId !== undefined && extensionId !== chrome.runtime.id) return
    if (!['PING', 'START', 'CHECK', 'CATEGORY_SEARCH', 'CATEGORY_TEMPLATE'].includes(type) || typeof requestId !== 'string' || requestId.length > 200) return
    if (['START', 'CHECK'].includes(type) && job && typeof job.jobId === 'string' && typeof job.token === 'string') tokens.set(job.jobId, job.token)
    try {
      const args = type === 'CATEGORY_SEARCH' ? { queries } : type === 'CATEGORY_TEMPLATE' ? { categoryId } : { job }
      chrome.runtime.sendMessage({ channel: PAGE_SOURCE, type, ...args }, response => {
        if (!registrationPage()) return
        const error = chrome.runtime.lastError?.message
        const valid = response && typeof response === 'object' && typeof response.ok === 'boolean'
        window.postMessage({ source: EXTENSION_SOURCE, type: 'RESPONSE', requestId, ...(error || !valid ? { ok: false, error: '쿠팡 등록 확장을 새로고침해주세요.' } : response), ...identity() }, location.origin)
      })
    } catch {
      window.postMessage({ source: EXTENSION_SOURCE, type: 'RESPONSE', requestId, ok: false, error: '쿠팡 등록 확장을 새로고침해주세요.', ...identity() }, location.origin)
    }
  })
  chrome.runtime.onMessage.addListener(message => {
    if (!registrationPage() || message?.channel !== EXTENSION_SOURCE || message.type !== 'PROGRESS') return
    const progress = message.progress
    if (!progress || tokens.get(progress.jobId) !== progress.token) return
    window.postMessage({ source: EXTENSION_SOURCE, type: 'PROGRESS', progress }, location.origin)
  })
})()
