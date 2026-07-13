const READY_MESSAGE = 'FUNTASTIC_1688_READY'
const RESULT_MESSAGE = 'FUNTASTIC_1688_PAGE_RESULT'
const CAPTURE_MESSAGE = 'FUNTASTIC_1688_CAPTURE_URL'
const CAPTURE_STATUS_MESSAGE = 'FUNTASTIC_1688_GET_CAPTURED'
const PAGE_PROBE_SOURCE = 'funtastic-1688-page-probe'
const COLLECTOR_SOURCE = 'funtastic-1688-collector'
const POLL_INTERVAL_MS = 500
const SCAN_TIMEOUT_MS = 30_000

window.addEventListener('message', (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return
  const message = event.data
  if (!message || message.source !== PAGE_PROBE_SOURCE || message.type !== 'FUNTASTIC_1688_CAPTURED_URL') return
  void sendRuntimeMessage({ type: CAPTURE_MESSAGE, url: message.url })
})

void beginCollection()

async function beginCollection() {
  const on1688 = window.location.hostname === '1688.com'
    || window.location.hostname.endsWith('.1688.com')
  const inheritedFrame = !isTopFrame()
    && ['about:', 'blob:', 'data:'].includes(window.location.protocol)
  if (!on1688 && !inheritedFrame) return

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
  let probeRequested = false
  let clickAttempted = false
  let clickTargetCount = 0
  let orderSeen = false
  let lastFrameReportAt = 0

  while (Date.now() - startedAt < SCAN_TIMEOUT_MS) {
    const text = visiblePageText()
    if ((isTopFrame() || isLoginPage()) && looksLoggedOut(text, task.orderNumber)) {
      await report({
        orderNumber: task.orderNumber,
        candidates: [],
        fatal: true,
        message: '1688 로그인 상태가 만료되었습니다. 로그인 후 다시 실행해주세요.',
      })
      return
    }

    const orderVisible = text.includes(task.orderNumber) || markupContains(task.orderNumber)
    if (orderVisible) orderSeen = true
    const elapsed = Date.now() - startedAt
    if (elapsed - lastFrameReportAt >= 5_000 || lastFrameReportAt === 0) {
      lastFrameReportAt = elapsed
      await reportFrame(task.orderNumber, text, orderVisible)
    }
    const directCandidates = orderVisible ? findOfferCandidates(task.orderNumber) : []
    const capturedCandidates = await getCapturedCandidates()
    const candidates = uniqueCandidates([
      ...(Array.isArray(task.candidates) ? task.candidates : []),
      ...directCandidates,
      ...capturedCandidates,
    ])

    if (candidates.length > 0) {
      const fingerprint = candidates.map((candidate) => candidate.url).sort().join('|')
      if (fingerprint === stableFingerprint) stableCount += 1
      else {
        stableFingerprint = fingerprint
        stableCount = 0
      }
      if (stableCount >= 1) {
        await report({ orderNumber: task.orderNumber, candidates, fatal: false })
        return
      }
    }

    if (elapsed > 1_000 && !probeRequested) {
      probeRequested = true
      window.postMessage({
        source: COLLECTOR_SOURCE,
        type: 'FUNTASTIC_1688_PROBE_ORDER',
        orderNumber: task.orderNumber,
      }, window.location.origin)
    }

    if (orderVisible && elapsed > 2_000 && !clickAttempted) {
      clickAttempted = true
      clickTargetCount = await clickLikelyProductTargets(task.orderNumber)
    }

    if (orderVisible && elapsed > 4_000 && looksLikeNoResult(text)) {
      await report({
        orderNumber: task.orderNumber,
        candidates: [],
        fatal: false,
        message: '검색 결과 없음',
      })
      return
    }

    if (clickAttempted && elapsed > 10_000) {
      await report({
        orderNumber: task.orderNumber,
        candidates: [],
        fatal: false,
        message: clickTargetCount > 0
          ? `상품 ${clickTargetCount}개를 열었지만 상세주소를 확인하지 못했습니다.`
          : '주문은 조회됐지만 클릭할 상품 영역을 찾지 못했습니다.',
      })
      return
    }
    await delay(POLL_INTERVAL_MS)
  }

  if (!isTopFrame()) return
  const captureStatus = await getCaptureStatus()
  const frameReports = Array.isArray(captureStatus.frameReports) ? captureStatus.frameReports : []
  const anyFrameSawOrder = orderSeen || frameReports.some((report) => report?.hasOrder)
  await report({
    orderNumber: task.orderNumber,
    candidates: [],
    fatal: false,
    message: anyFrameSawOrder
      ? `주문번호는 인식했지만 상품 상세주소를 확인하지 못했습니다. ${frameSummary(frameReports)}`
      : `주문번호를 1688 화면 데이터에서 확인하지 못했습니다. ${frameSummary(frameReports)}`,
  })
}

function findOfferCandidates(orderNumber) {
  const scopes = findOrderScopes(orderNumber)
  for (const scope of scopes) {
    const candidates = candidatesFromRoot(scope)
    if (candidates.length > 0) return candidates
  }
  return []
}

function findOrderScopes(orderNumber) {
  const scopes = []
  const seen = new Set()
  for (const root of documentRoots(document)) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()
    while (node) {
      if (node.nodeValue?.includes(orderNumber)) {
        let element = node.parentElement
        let fallback = null
        for (let depth = 0; element && depth < 14; depth += 1) {
          const textLength = cleanText(element.textContent).length
          if (textLength > orderNumber.length && textLength < 40_000) fallback = element
          if (textLength < 40_000 && element.querySelectorAll?.('img').length > 0) {
            if (!seen.has(element)) {
              seen.add(element)
              scopes.push(element)
            }
            break
          }
          element = parentElementAcrossShadow(element)
        }
        if (fallback && !seen.has(fallback)) {
          seen.add(fallback)
          scopes.push(fallback)
        }
      }
      node = walker.nextNode()
    }
  }
  return scopes.sort((left, right) => (
    cleanText(left.textContent).length - cleanText(right.textContent).length
  ))
}

function candidatesFromRoot(root) {
  const candidates = new Map()
  const addCandidate = (value, title = null) => {
    for (const url of extractCanonicalUrls(value)) {
      if (!candidates.has(url)) candidates.set(url, { url, title: cleanText(title).slice(0, 500) || null })
    }
  }

  for (const currentRoot of documentRoots(root)) {
    for (const element of currentRoot.querySelectorAll?.('*') || []) {
      for (const attribute of element.attributes || []) addCandidate(attribute.value, candidateTitle(element))
    }
    if (currentRoot instanceof Element) addCandidate(currentRoot.outerHTML, candidateTitle(currentRoot))
    else addCandidate(currentRoot.documentElement?.outerHTML, null)
  }
  return Array.from(candidates.values())
}

async function clickLikelyProductTargets(orderNumber) {
  const scope = findOrderScopes(orderNumber)[0]
  if (!scope) return 0

  const targets = []
  const seen = new Set()
  const images = Array.from(scope.querySelectorAll('img'))
    .filter(isLikelyProductImage)
    .sort((left, right) => imageArea(right) - imageArea(left))

  for (const image of images) {
    const target = clickableProductAncestor(image, scope)
    if (!target || seen.has(target)) continue
    seen.add(target)
    targets.push(target)
    if (targets.length >= 12) break
  }

  for (const target of targets) {
    const anchor = target instanceof HTMLAnchorElement ? target : target.closest('a')
    const previousTarget = anchor?.getAttribute('target')
    if (anchor) anchor.setAttribute('target', '_blank')
    try {
      target.click()
    } catch {
      target.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        view: window,
      }))
    }
    await delay(900)
    if (anchor) {
      if (previousTarget === null) anchor.removeAttribute('target')
      else anchor.setAttribute('target', previousTarget)
    }
  }
  return targets.length
}

function clickableProductAncestor(image, scope) {
  let element = image
  for (let depth = 0; element && depth < 7; depth += 1) {
    if (element instanceof HTMLAnchorElement || element.getAttribute('role') === 'link') return element
    const hint = `${element.className || ''} ${element.id || ''}`
    if (/(product|goods|item|offer|title|pic|image)/i.test(hint)) return element
    if (element === scope) break
    element = element.parentElement
  }
  return image
}

function isLikelyProductImage(image) {
  const rect = image.getBoundingClientRect()
  if (rect.width < 40 || rect.height < 40 || rect.width * rect.height < 2_000) return false
  if (rect.bottom < 0 || rect.right < 0 || rect.top > window.innerHeight * 2) return false
  const label = cleanText(`${image.alt || ''} ${image.title || ''} ${image.className || ''}`)
  return !/(二维码|头像|店铺|logo|icon|avatar|qrcode)/i.test(label)
}

function imageArea(image) {
  const rect = image.getBoundingClientRect()
  return rect.width * rect.height
}

function extractCanonicalUrls(value) {
  if (typeof value !== 'string' || !value) return []
  const decoded = safeDecodeURIComponent(value)
    .replace(/&amp;/gi, '&')
    .replace(/\\u002f/gi, '/')
    .replace(/\\\//g, '/')
  const urls = []
  const pattern = /(?:https?:)?\/\/detail\.1688\.com\/offer\/(\d{6,30})\.html/gi
  let match = pattern.exec(decoded)
  while (match) {
    urls.push(`https://detail.1688.com/offer/${match[1]}.html`)
    match = pattern.exec(decoded)
  }
  return Array.from(new Set(urls))
}

function uniqueCandidates(values) {
  const candidates = new Map()
  for (const value of values) {
    const url = canonicalOfferUrl(typeof value === 'string' ? value : value?.url)
    if (!url || candidates.has(url)) continue
    candidates.set(url, {
      url,
      title: typeof value === 'object' && value ? cleanText(value.title).slice(0, 500) || null : null,
    })
  }
  return Array.from(candidates.values())
}

function canonicalOfferUrl(value) {
  return extractCanonicalUrls(value)[0] || null
}

async function getCapturedCandidates() {
  const response = await getCaptureStatus()
  return Array.isArray(response?.candidates) ? response.candidates : []
}

function getCaptureStatus() {
  return sendRuntimeMessage({ type: CAPTURE_STATUS_MESSAGE }).then((response) => response || {})
}

function reportFrame(orderNumber, text, hasOrder) {
  return sendRuntimeMessage({
    type: 'FUNTASTIC_1688_FRAME_REPORT',
    orderNumber,
    url: window.location.href,
    isTop: isTopFrame(),
    textLength: text.length,
    hasOrder,
  })
}

function frameSummary(reports) {
  const hosts = Array.from(new Set(reports.map((report) => {
    try {
      const url = new URL(report.url)
      return url.hostname || url.protocol
    } catch {
      return 'unknown'
    }
  }))).slice(0, 4)
  const orderFrames = reports.filter((report) => report?.hasOrder).length
  return `(접근 프레임 ${reports.length}개, 주문 인식 ${orderFrames}개${hosts.length ? `, ${hosts.join(', ')}` : ''})`
}

function markupContains(value) {
  try {
    return document.documentElement?.innerHTML.includes(value) || false
  } catch {
    return false
  }
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

function candidateTitle(element) {
  const direct = cleanText(element.textContent)
  if (direct && direct.length <= 500) return direct
  const titled = cleanText(element.getAttribute?.('title'))
  if (titled) return titled
  const imageAlt = cleanText(element.querySelector?.('img')?.getAttribute('alt'))
  if (imageAlt) return imageAlt
  return cleanText(element.parentElement?.textContent).slice(0, 500)
}

function visiblePageText() {
  return cleanText(documentRoots(document).map((root) => {
    if (root instanceof Document) return root.body?.innerText || root.documentElement?.textContent
    return root.textContent
  }).join(' '))
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

function isTopFrame() {
  return window.top === window
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

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
