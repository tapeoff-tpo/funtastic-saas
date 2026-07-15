const PANEL_ID = 'funtastic-1688-sourcing-panel'
const SENT_KEY_PREFIX = 'funtastic1688Sent'
const SCAN_INTERVAL_MS = 2500
const SCAN_TIMEOUT_MS = 90_000

void boot()

async function boot() {
  const response = await sendRuntimeMessage({ type: 'FUNTASTIC_1688_SOURCING_READY' })
  if (!response?.active || !response.search) return
  const search = response.search
  installPanel(search)
  tryAutoCollect(search)
}

function installPanel(search) {
  if (!isTopFrame() || document.getElementById(PANEL_ID)) return
  const panel = document.createElement('div')
  panel.id = PANEL_ID
  panel.innerHTML = `
    <div class="funtastic-head">
      <strong>Funtastic 1688 검색</strong>
      <span id="funtastic-1688-status">대기</span>
    </div>
    <div class="funtastic-body">
      <img src="${escapeAttr(search.imageUrl)}" alt="">
      <div>
        <div class="funtastic-title">${escapeHtml(search.sourceTitle)}</div>
        <div class="funtastic-help">이미지 검색 결과가 보이면 후보 수집을 누르세요.</div>
      </div>
    </div>
    <div class="funtastic-actions">
      <button type="button" id="funtastic-copy-image">이미지 URL 복사</button>
      <button type="button" id="funtastic-text-search">텍스트 검색</button>
      <button type="button" id="funtastic-collect">후보 수집</button>
    </div>
  `
  const style = document.createElement('style')
  style.textContent = `
    #${PANEL_ID} {
      position: fixed;
      right: 18px;
      bottom: 18px;
      z-index: 2147483647;
      width: 330px;
      border: 1px solid rgba(17, 24, 39, 0.12);
      border-radius: 12px;
      background: #fff;
      color: #111827;
      box-shadow: 0 18px 44px rgba(15, 23, 42, 0.22);
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      overflow: hidden;
    }
    #${PANEL_ID} .funtastic-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 10px 12px;
      border-bottom: 1px solid #e5e7eb;
      font-size: 13px;
    }
    #${PANEL_ID} .funtastic-head span {
      border-radius: 999px;
      background: #f3f4f6;
      color: #4b5563;
      font-size: 11px;
      font-weight: 700;
      padding: 3px 7px;
    }
    #${PANEL_ID} .funtastic-body {
      display: grid;
      grid-template-columns: 54px minmax(0, 1fr);
      gap: 10px;
      padding: 12px;
      align-items: center;
    }
    #${PANEL_ID} img {
      width: 54px;
      height: 54px;
      border-radius: 8px;
      border: 1px solid #e5e7eb;
      object-fit: cover;
      background: #f9fafb;
    }
    #${PANEL_ID} .funtastic-title {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 13px;
      font-weight: 700;
    }
    #${PANEL_ID} .funtastic-help {
      margin-top: 4px;
      color: #6b7280;
      font-size: 12px;
      line-height: 1.35;
    }
    #${PANEL_ID} .funtastic-actions {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 6px;
      padding: 0 12px 12px;
    }
    #${PANEL_ID} button {
      height: 30px;
      border: 1px solid #d1d5db;
      border-radius: 8px;
      background: #fff;
      color: #111827;
      cursor: pointer;
      font-size: 12px;
      font-weight: 700;
    }
    #${PANEL_ID} #funtastic-collect {
      border-color: #111827;
      background: #111827;
      color: #fff;
    }
  `
  document.documentElement.appendChild(style)
  document.body.appendChild(panel)

  document.getElementById('funtastic-copy-image')?.addEventListener('click', async () => {
    await navigator.clipboard?.writeText(search.imageUrl).catch(() => undefined)
    setStatus('복사됨')
  })
  document.getElementById('funtastic-text-search')?.addEventListener('click', () => {
    window.location.href = textSearchUrl(search)
  })
  document.getElementById('funtastic-collect')?.addEventListener('click', () => {
    void collectAndSend(search, true)
  })
}

async function tryAutoCollect(search) {
  const startedAt = Date.now()
  let sentCount = 0
  while (Date.now() - startedAt < SCAN_TIMEOUT_MS) {
    const count = await collectAndSend(search, false)
    if (count > 0 && count === sentCount) return
    if (count > sentCount) sentCount = count
    await delay(SCAN_INTERVAL_MS)
  }
}

async function collectAndSend(search, manual) {
  const candidates = collectCandidates().slice(0, 30)
  if (!candidates.length) {
    if (manual) setStatus('후보 없음')
    return 0
  }

  const fingerprint = candidates.map((candidate) => candidate.candidateUrl).sort().join('|')
  const sentKey = `${SENT_KEY_PREFIX}:${search.searchId}`
  if (!manual && sessionStorage.getItem(sentKey) === fingerprint) return candidates.length
  sessionStorage.setItem(sentKey, fingerprint)

  setStatus(`${candidates.length}개 전송`)
  await sendRuntimeMessage({
    type: 'FUNTASTIC_1688_SOURCING_CANDIDATES',
    searchId: search.searchId,
    itemId: search.itemId,
    candidates,
  })
  return candidates.length
}

function collectCandidates() {
  const candidates = []
  const seen = new Set()
  for (const anchor of document.querySelectorAll('a[href]')) {
    const url = offerUrl(anchor.getAttribute('href'))
    if (!url || seen.has(url)) continue
    seen.add(url)
    const root = cardRoot(anchor)
    const title = cleanText(anchor.textContent) || cleanText(root?.textContent)?.slice(0, 180) || null
    candidates.push({
      candidateUrl: url,
      title,
      imageUrl: firstImage(root || anchor),
      priceText: priceText(root || anchor),
      supplierName: supplierName(root || anchor),
      matchScore: null,
    })
  }
  return candidates
}

function offerUrl(value) {
  if (!value) return null
  try {
    const url = new URL(value, window.location.href)
    const match = url.href.match(/detail\.1688\.com\/offer\/(\d+)\.html/i)
    return match ? `https://detail.1688.com/offer/${match[1]}.html` : null
  } catch {
    return null
  }
}

function cardRoot(anchor) {
  let node = anchor
  for (let depth = 0; node && depth < 5; depth += 1) {
    const text = cleanText(node.textContent) || ''
    if (node.querySelector?.('img') && /¥|￥|元|起批|成交|件/.test(text)) return node
    node = node.parentElement
  }
  return anchor.closest('div') || anchor
}

function firstImage(root) {
  const image = root?.querySelector?.('img')
  if (!image) return null
  return absoluteUrl(image.currentSrc || image.src || image.getAttribute('data-src') || image.getAttribute('data-lazy-src'))
}

function priceText(root) {
  const text = cleanText(root?.textContent) || ''
  const match = text.match(/[¥￥]\s*[0-9]+(?:\.[0-9]+)?|[0-9]+(?:\.[0-9]+)?\s*元/)
  return match ? match[0].replace(/\s+/g, '') : null
}

function supplierName(root) {
  const text = cleanText(root?.textContent) || ''
  const match = text.match(/([\u4e00-\u9fa5A-Za-z0-9（）()·.\-\s]{2,40}(?:公司|厂|店|商行|工厂))/)
  return match ? cleanText(match[1]) : null
}

function textSearchUrl(search) {
  return `https://s.1688.com/selloffer/offer_search.htm?keywords=${encodeURIComponent(search.keyword || search.sourceTitle)}&funtasticSourcing=1`
}

function setStatus(text) {
  const status = document.getElementById('funtastic-1688-status')
  if (status) status.textContent = text
}

function sendRuntimeMessage(message) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) resolve(null)
        else resolve(response)
      })
    } catch {
      resolve(null)
    }
  })
}

function isTopFrame() {
  try {
    return window.top === window
  } catch {
    return false
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

function cleanText(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  return text || null
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char])
}

function escapeAttr(value) {
  return escapeHtml(value)
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
