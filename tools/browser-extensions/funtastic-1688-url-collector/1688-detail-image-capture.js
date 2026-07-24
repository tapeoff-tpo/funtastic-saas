const DETAIL_IMAGES_READY = 'FUNTASTIC_1688_DETAIL_IMAGES_READY'
const DETAIL_IMAGES_RESULT = 'FUNTASTIC_1688_DETAIL_IMAGES_RESULT'
const POLL_INTERVAL_MS = 700
const SCAN_TIMEOUT_MS = 45_000
const MAX_IMAGES = 30

void collectDetailImages()

async function collectDetailImages() {
  const url = canonicalOfferUrl(window.location.href)
  if (!url) return

  let task = null
  for (let attempt = 0; attempt < 20 && !task?.active; attempt += 1) {
    task = await sendRuntimeMessage({ type: DETAIL_IMAGES_READY, url })
    if (!task?.active) await delay(250)
  }
  if (!task?.active || task.url !== url) return

  if (isLoginPage()) {
    await report(task, url, [], '1688 로그인이 필요합니다. 로그인 후 다시 실행해주세요.')
    return
  }

  const startedAt = Date.now()
  let stableFingerprint = ''
  let stableCount = 0
  let scrollStep = 0
  while (Date.now() - startedAt < SCAN_TIMEOUT_MS) {
    const text = pageText()
    if (isLoginPage() || looksLoggedOut(text)) {
      await report(task, url, [], '1688 로그인 상태가 만료되었습니다. 로그인 후 다시 실행해주세요.')
      return
    }
    if (looksLikeSecurityChallenge(text)) {
      await report(task, url, [], '1688 보안 확인이 필요합니다. 화면에서 확인을 마친 뒤 다시 실행해주세요.')
      return
    }
    if (looksLikeUnavailableProduct(text)) {
      await report(task, url, [], '1688에서 상품 없음 또는 판매중지로 표시됩니다.')
      return
    }

    const images = collectImages()
    const fingerprint = images.join('|')
    if (images.length > 0 && fingerprint === stableFingerprint) stableCount += 1
    else {
      stableFingerprint = fingerprint
      stableCount = 0
    }

    if (images.length >= 2 && stableCount >= 2) {
      await report(task, url, images, null)
      return
    }

    const elapsed = Date.now() - startedAt
    if (elapsed > 1_500 && scrollStep < 3) {
      scrollStep += 1
      const height = Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0)
      window.scrollTo({ top: Math.round((height * scrollStep) / 4), behavior: 'auto' })
    }
    await delay(POLL_INTERVAL_MS)
  }

  const images = collectImages()
  await report(task, url, images, images.length ? null : '1688 상품 이미지를 찾지 못했습니다.')
}

function collectImages() {
  const images = new Set()
  for (const image of document.images) {
    const width = Math.max(image.naturalWidth || 0, image.width || 0)
    const height = Math.max(image.naturalHeight || 0, image.height || 0)
    if (width < 80 || height < 80) continue

    const candidates = [
      image.currentSrc,
      image.src,
      image.getAttribute('data-src'),
      image.getAttribute('data-lazy-src'),
      image.getAttribute('data-original'),
    ]
    for (const candidate of candidates) {
      const normalized = normalizeImageUrl(candidate)
      if (!normalized || images.size >= MAX_IMAGES) continue
      images.add(normalized)
    }
  }
  return Array.from(images)
}

function normalizeImageUrl(value) {
  if (!value || value.startsWith('data:')) return null
  try {
    const url = new URL(value.startsWith('//') ? `https:${value}` : value, window.location.href)
    if (!['http:', 'https:'].includes(url.protocol)) return null
    if (!/alicdn|1688|taobaocdn/i.test(url.hostname)) return null
    return url.toString()
  } catch {
    return null
  }
}

function canonicalOfferUrl(value) {
  try {
    const url = new URL(value)
    const match = url.pathname.match(/^\/offer\/(\d{6,30})\.html\/?$/i)
    return url.hostname === 'detail.1688.com' && match
      ? `https://detail.1688.com/offer/${match[1]}.html`
      : null
  } catch {
    return null
  }
}

function isLoginPage() {
  const host = window.location.hostname.toLowerCase()
  return host.includes('login.1688.com') || host.includes('passport.1688.com')
}

function pageText() {
  return (document.body?.innerText || document.documentElement?.innerText || '').replace(/\s+/g, ' ').slice(0, 100_000)
}

function looksLoggedOut(text) {
  return /请登录|登录后|账号登录|扫码登录/i.test(text)
}

function looksLikeSecurityChallenge(text) {
  return /访问过于频繁|安全验证|请完成验证|滑动验证|请输入验证码|系统繁忙，请稍后再试/i.test(text)
}

function looksLikeUnavailableProduct(text) {
  return /商品不存在|商品已下架|您查看的商品不存在|找不到.{0,12}(商品|宝贝)|很抱歉.{0,30}(商品|宝贝).{0,20}(不存在|下架)/i.test(text)
}

async function report(task, url, images, message) {
  await sendRuntimeMessage({
    type: DETAIL_IMAGES_RESULT,
    runId: task.runId,
    jobId: task.jobId,
    url,
    images,
    message,
  })
}

function sendRuntimeMessage(message) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        resolve(chrome.runtime.lastError ? null : response)
      })
    } catch {
      resolve(null)
    }
  })
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
