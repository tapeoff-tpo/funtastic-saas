// Start the read-only tracking probe at DOM readiness, even when an unrelated
// image or analytics request keeps the tab's overall load event pending.
(() => {
  if (window.top !== window) return
  let attempts = 0
  const ready = () => {
    try {
      if (!chrome.runtime?.id) return
      chrome.runtime.sendMessage({ type: 'FUNTASTIC_1688_TRACKING_READY' }, (response) => {
        if (chrome.runtime.lastError || response?.active || ++attempts >= 4) return
        setTimeout(ready, 300)
      })
    } catch { /* Extension reloads invalidate content scripts already in a tab. */ }
  }
  ready()
})()
