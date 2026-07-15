const BUTTON_ID = 'funtastic-coupang-sourcing-button'

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'FUNTASTIC_COUPANG_EXTRACT') return false
  const capture = extractCoupangProduct()
  sendResponse(capture ? { ok: true, capture } : { ok: false, error: '쿠팡 상품 정보를 찾지 못했습니다.' })
  return false
})

installCaptureButton()

function installCaptureButton() {
  if (document.getElementById(BUTTON_ID)) return
  if (!document.body) {
    window.setTimeout(installCaptureButton, 300)
    return
  }

  const button = document.createElement('button')
  button.id = BUTTON_ID
  button.type = 'button'
  button.textContent = 'F 소싱'
  button.setAttribute('aria-label', 'Funtastic 소싱 저장')
  Object.assign(button.style, {
    position: 'fixed',
    right: '18px',
    bottom: '18px',
    zIndex: '2147483647',
    height: '38px',
    padding: '0 14px',
    border: '0',
    borderRadius: '999px',
    background: '#111827',
    color: '#fff',
    fontSize: '13px',
    fontWeight: '700',
    lineHeight: '38px',
    boxShadow: '0 10px 24px rgba(15, 23, 42, 0.24)',
    cursor: 'pointer',
  })
  button.addEventListener('mouseenter', () => { button.style.background = '#000' })
  button.addEventListener('mouseleave', () => { button.style.background = '#111827' })
  button.addEventListener('click', () => void captureCurrentPage(button))
  document.body.appendChild(button)
}

async function captureCurrentPage(button) {
  const capture = extractCoupangProduct()
  if (!capture) {
    showButtonStatus(button, '정보 없음', true)
    return
  }

  showButtonStatus(button, '저장 중...', false)
  chrome.runtime.sendMessage({ type: 'FUNTASTIC_COUPANG_CAPTURE', capture }, (response) => {
    if (chrome.runtime.lastError || !response?.ok) {
      showButtonStatus(button, '저장 실패', true)
      return
    }
    showButtonStatus(button, '저장 완료', false)
  })
}

function extractCoupangProduct() {
  const sourceUrl = normalizeUrl(window.location.href)
  const sourceTitle = firstText([
    textFromSelector('.prod-buy-header__title'),
    textFromSelector('[class*="prod-buy-header"] h1'),
    textFromSelector('h1'),
    metaContent('property', 'og:title'),
    metaContent('name', 'title'),
    document.title,
  ])?.replace(/\s*-\s*쿠팡!?\s*$/i, '')

  if (!sourceTitle) return null

  return {
    captureId: `coupang:${Date.now()}:${Math.random().toString(36).slice(2)}`,
    sourceTitle,
    sourceUrl,
    imageUrl: firstText([
      metaContent('property', 'og:image'),
      metaContent('name', 'twitter:image'),
      imageFromSelector('.prod-image__detail'),
      imageFromSelector('.prod-image__item img'),
      imageFromSelector('[class*="prod-image"] img'),
      largestImageUrl(),
    ]),
    category: categoryText(),
    sourceRank: rankFromUrl(),
    sourcePrice: priceFromPage(),
    keyword: keywordFromUrl(),
    memo: '쿠팡 확장프로그램에서 저장',
  }
}

function textFromSelector(selector) {
  return cleanText(document.querySelector(selector)?.textContent)
}

function imageFromSelector(selector) {
  const element = document.querySelector(selector)
  if (!element) return null
  const src = element.getAttribute('src') || element.getAttribute('data-src') || element.getAttribute('data-original')
  return absoluteUrl(src)
}

function largestImageUrl() {
  const images = Array.from(document.images || [])
    .map((img) => ({
      src: absoluteUrl(img.currentSrc || img.src || img.getAttribute('data-src')),
      area: Math.max(0, img.naturalWidth || img.width || 0) * Math.max(0, img.naturalHeight || img.height || 0),
    }))
    .filter((item) => item.src && item.area > 10_000)
    .sort((a, b) => b.area - a.area)
  return images[0]?.src || null
}

function metaContent(attribute, value) {
  return cleanText(document.querySelector(`meta[${attribute}="${value}"]`)?.getAttribute('content'))
}

function categoryText() {
  const selectors = [
    '.breadcrumb a',
    '.breadcrumb-link',
    '[class*="breadcrumb"] a',
    '[class*="breadcrumb"] span',
  ]
  for (const selector of selectors) {
    const parts = Array.from(document.querySelectorAll(selector))
      .map((element) => cleanText(element.textContent))
      .filter(Boolean)
    if (parts.length) return parts.join(' > ')
  }
  return null
}

function priceFromPage() {
  const selectors = [
    '.total-price strong',
    '.prod-sale-price .total-price',
    '.prod-coupon-price .total-price',
    '[class*="total-price"]',
    '[class*="sale-price"]',
  ]
  for (const selector of selectors) {
    const value = parseWon(textFromSelector(selector))
    if (value != null) return value
  }

  const text = cleanText(document.body?.innerText || '')
  const match = text.match(/([0-9][0-9,]{2,})\s*원/)
  return match ? parseWon(match[1]) : null
}

function rankFromUrl() {
  const params = new URLSearchParams(window.location.search)
  for (const key of ['rank', 'itemRank', 'pageRank']) {
    const value = Number(params.get(key))
    if (Number.isFinite(value) && value > 0) return Math.trunc(value)
  }
  return null
}

function keywordFromUrl() {
  const params = new URLSearchParams(window.location.search)
  for (const key of ['q', 'keyword', 'component']) {
    const value = cleanText(params.get(key))
    if (value) return value
  }
  return null
}

function normalizeUrl(value) {
  try {
    const url = new URL(value)
    const keep = new URLSearchParams()
    for (const key of ['itemId', 'vendorItemId', 'sourceType', 'q', 'keyword', 'rank']) {
      const param = url.searchParams.get(key)
      if (param) keep.set(key, param)
    }
    url.search = keep.toString()
    url.hash = ''
    return url.toString()
  } catch {
    return value
  }
}

function absoluteUrl(value) {
  const text = cleanText(value)
  if (!text) return null
  try {
    return new URL(text, window.location.href).toString()
  } catch {
    return text
  }
}

function parseWon(value) {
  const text = cleanText(value)
  if (!text) return null
  const match = text.match(/[0-9][0-9,]*/)
  if (!match) return null
  const number = Number(match[0].replace(/,/g, ''))
  return Number.isFinite(number) ? Math.trunc(number) : null
}

function firstText(values) {
  return values.map(cleanText).find(Boolean) || null
}

function cleanText(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  return text || null
}

function showButtonStatus(button, label, isError) {
  const previous = button.textContent
  button.textContent = label
  button.style.background = isError ? '#dc2626' : '#059669'
  window.setTimeout(() => {
    button.textContent = previous === '저장 중...' ? 'F 소싱' : previous
    button.style.background = '#111827'
  }, 1600)
}
