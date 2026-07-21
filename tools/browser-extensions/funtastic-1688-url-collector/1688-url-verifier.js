const VERIFY_READY_MESSAGE = 'FUNTASTIC_1688_VERIFY_READY'
const VERIFY_RESULT_MESSAGE = 'FUNTASTIC_1688_VERIFY_RESULT'
const VERIFY_RETRY_COUNT = 20
const VERIFY_POLL_INTERVAL_MS = 750
const VERIFY_SCAN_TIMEOUT_MS = 20_000

void beginVerification()

async function beginVerification() {
  const url = canonicalOfferUrl(window.location.href)
  if (!url) return

  let task = null
  for (let attempt = 0; attempt < VERIFY_RETRY_COUNT && !task?.active; attempt += 1) {
    task = await sendRuntimeMessage({ type: VERIFY_READY_MESSAGE, url })
    if (!task?.active) await delay(250)
  }
  if (!task?.active || task.url !== url) return

  if (isLoginPage()) {
    await report(url, 'unknown', '1688 로그인이 필요합니다. 로그인 후 다시 실행해주세요.', true)
    return
  }

  const startedAt = Date.now()
  while (Date.now() - startedAt < VERIFY_SCAN_TIMEOUT_MS) {
    const text = pageText()
    if (isLoginPage() || looksLoggedOut(text)) {
      await report(url, 'unknown', '1688 로그인 상태가 만료되었습니다. 로그인 후 다시 실행해주세요.', true)
      return
    }
    if (looksLikeSecurityChallenge(text)) {
      await report(url, 'unknown', '1688 보안 확인이 필요합니다. 화면에서 확인을 마친 뒤 다시 실행해주세요.', true)
      return
    }
    if (looksLikeUnavailableProduct(text)) {
      await report(url, 'unavailable', '1688에서 상품 없음 또는 판매중지로 표시됩니다.')
      return
    }
    if (looksLikeLoadedProduct(url, text)) {
      await report(url, 'open', null)
      return
    }
    await delay(VERIFY_POLL_INTERVAL_MS)
  }

  await report(url, 'unknown', '상품 화면을 확인하지 못했습니다. 로그인 또는 보안 확인 상태를 점검해주세요.')
}

function looksLikeLoadedProduct(url, text) {
  const offerId = new URL(url).pathname.match(/\/offer\/(\d+)\.html/i)?.[1]
  const markup = document.documentElement?.innerHTML || ''
  const hasOfferMarker = Boolean(
    offerId
    && (markup.includes(offerId) || document.querySelector('[data-offer-id], [data-offerid], #offer-detail')),
  )
  return hasOfferMarker && text.length >= 80
}

function looksLikeUnavailableProduct(text) {
  return /商品不存在|商品已下架|您查看的商品不存在|找不到.{0,12}(商品|宝贝)|很抱歉.{0,30}(商品|宝贝).{0,20}(不存在|下架)/i.test(text)
}

function looksLikeSecurityChallenge(text) {
  return /访问过于频繁|安全验证|请完成验证|滑动验证|请输入验证码|系统繁忙，请稍后再试/i.test(text)
}

function looksLoggedOut(text) {
  return /请登录|登录后|账号登录|扫码登录/i.test(text)
}

function isLoginPage() {
  const host = window.location.hostname.toLowerCase()
  return host.includes('login.1688.com') || host.includes('passport.1688.com')
}

function pageText() {
  return (document.body?.innerText || document.documentElement?.innerText || '').replace(/\s+/g, ' ').slice(0, 100_000)
}

async function report(url, status, message, fatal = false) {
  await sendRuntimeMessage({
    type: VERIFY_RESULT_MESSAGE,
    url,
    status,
    message,
    fatal,
  })
}

function canonicalOfferUrl(value) {
  try {
    const url = new URL(value)
    if (url.hostname !== 'detail.1688.com') return null
    const match = url.pathname.match(/^\/offer\/(\d{6,30})\.html\/?$/i)
    return match ? `https://detail.1688.com/offer/${match[1]}.html` : null
  } catch {
    return null
  }
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
