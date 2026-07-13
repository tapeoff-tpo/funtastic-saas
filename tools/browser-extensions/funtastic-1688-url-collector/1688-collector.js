const READY_MESSAGE = 'FUNTASTIC_1688_READY'
const RESULT_MESSAGE = 'FUNTASTIC_1688_PAGE_RESULT'
const POLL_INTERVAL_MS = 500
const SCAN_TIMEOUT_MS = 30_000

void beginCollection()

async function beginCollection() {
  const onOrderList = window.location.hostname === 'air.1688.com'
    && window.location.pathname.includes('/trade-order-list/')
  if (!onOrderList && !isLoginPage()) return

  const pageOrderNumber = new URL(window.location.href).searchParams.get('word')
  let task = null
  for (let attempt = 0; attempt < 20 && !task?.active; attempt += 1) {
    task = await sendRuntimeMessage({ type: READY_MESSAGE, pageOrderNumber })
    if (!task?.active) await delay(250)
  }
  if (!task?.active || !task.orderNumber) return

  if (isLoginPage()) {
    await report({
      orderNumber: task.orderNumber,
      candidates: [],
      fatal: true,
      message: '1688 로그인이 필요합니다. 로그인 후 다시 실행해주세요.',
    })
    return
  }

  const startedAt = Date.now()
  let stableFingerprint = ''
  let stableCount = 0

  while (Date.now() - startedAt < SCAN_TIMEOUT_MS) {
    const text = visiblePageText()
    if (looksLoggedOut(text, task.orderNumber)) {
      await report({
        orderNumber: task.orderNumber,
        candidates: [],
        fatal: true,
        message: '1688 로그인 상태가 만료되었습니다. 로그인 후 다시 실행해주세요.',
      })
      return
    }

    const orderVisible = text.includes(task.orderNumber)
    const candidates = orderVisible ? findOfferCandidates(task.orderNumber) : []
    if (candidates.length > 0) {
      const fingerprint = candidates.map((candidate) => candidate.url).sort().join('|')
      if (fingerprint === stableFingerprint) stableCount += 1
      else {
        stableFingerprint = fingerprint
        stableCount = 0
      }
      if (stableCount >= 2) {
        await report({ orderNumber: task.orderNumber, candidates, fatal: false })
        return
      }
    }

    if (Date.now() - startedAt > 4_000 && looksLikeNoResult(text)) {
      await report({
        orderNumber: task.orderNumber,
        candidates: [],
        fatal: false,
        message: '검색 결과 없음',
      })
      return
    }
    await delay(POLL_INTERVAL_MS)
  }

  await report({
    orderNumber: task.orderNumber,
    candidates: [],
    fatal: false,
    message: '상품 링크를 찾지 못했습니다.',
  })
}

function findOfferCandidates(orderNumber) {
  const scopes = findOrderScopes(orderNumber)
  for (const scope of scopes) {
    const candidates = candidatesFromRoot(scope)
    if (candidates.length > 0) return candidates
  }

  const allCandidates = candidatesFromRoot(document)
  return allCandidates.length <= 20 ? allCandidates : []
}

function findOrderScopes(orderNumber) {
  const scopes = []
  const roots = documentRoots(document)
  for (const root of roots) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()
    while (node) {
      if (node.nodeValue?.includes(orderNumber)) {
        let element = node.parentElement
        for (let depth = 0; element && depth < 12; depth += 1) {
          const textLength = (element.textContent || '').length
          if (textLength < 30_000 && candidatesFromRoot(element).length > 0) {
            scopes.push(element)
            break
          }
          element = parentElementAcrossShadow(element)
        }
      }
      node = walker.nextNode()
    }
  }
  return scopes.sort((left, right) => (
    (left.textContent || '').length - (right.textContent || '').length
  ))
}

function candidatesFromRoot(root) {
  const candidates = new Map()
  for (const currentRoot of documentRoots(root)) {
    for (const anchor of currentRoot.querySelectorAll?.('a[href]') || []) {
      const url = canonicalOfferUrl(anchor.getAttribute('href'))
      if (!url || candidates.has(url)) continue
      candidates.set(url, {
        url,
        title: candidateTitle(anchor).slice(0, 500) || null,
      })
    }
  }
  return Array.from(candidates.values())
}

function documentRoots(root) {
  const roots = [root]
  const elements = root.querySelectorAll?.('*') || []
  for (const element of elements) {
    if (element.shadowRoot) roots.push(...documentRoots(element.shadowRoot))
  }
  return roots
}

function parentElementAcrossShadow(element) {
  if (element.parentElement) return element.parentElement
  const root = element.getRootNode?.()
  return root instanceof ShadowRoot ? root.host : null
}

function candidateTitle(anchor) {
  const direct = cleanText(anchor.textContent)
  if (direct) return direct
  const titled = cleanText(anchor.getAttribute('title'))
  if (titled) return titled
  const imageAlt = cleanText(anchor.querySelector('img')?.getAttribute('alt'))
  if (imageAlt) return imageAlt
  return cleanText(anchor.parentElement?.textContent)
}

function canonicalOfferUrl(value) {
  if (!value) return null
  try {
    const url = new URL(value, window.location.href)
    if (!['http:', 'https:'].includes(url.protocol) || url.hostname !== 'detail.1688.com') return null
    const match = url.pathname.match(/^\/offer\/(\d{6,30})\.html\/?$/i)
    return match ? `https://detail.1688.com/offer/${match[1]}.html` : null
  } catch {
    return null
  }
}

function visiblePageText() {
  return cleanText(document.body?.innerText)
}

function looksLikeNoResult(text) {
  return [
    '没有找到相关订单',
    '暂无相关订单',
    '暂无订单',
    '没有符合条件的订单',
    '未找到相关订单',
  ].some((phrase) => text.includes(phrase))
}

function looksLoggedOut(text, orderNumber) {
  if (text.includes(orderNumber)) return false
  return ['请登录', '登录后查看', '重新登录'].some((phrase) => text.includes(phrase))
}

function isLoginPage() {
  return window.location.hostname === 'login.1688.com'
    || window.location.hostname.endsWith('.login.1688.com')
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function report(payload) {
  return sendRuntimeMessage({ type: RESULT_MESSAGE, ...payload })
}

function sendRuntimeMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) resolve(null)
      else resolve(response)
    })
  })
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
