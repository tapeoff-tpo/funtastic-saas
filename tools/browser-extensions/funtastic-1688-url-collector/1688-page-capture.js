(() => {
  const INSTALL_KEY = '__funtastic1688CaptureInstalled'
  const PAGE_PROBE_SOURCE = 'funtastic-1688-page-probe'
  const COLLECTOR_SOURCE = 'funtastic-1688-collector'
  const emitted = new Set()

  if (window[INSTALL_KEY]) return
  window[INSTALL_KEY] = true

  const originalOpen = window.open
  try {
    window.open = function funtasticCapturedOpen(url, ...args) {
      emitFromString(url)
      return Reflect.apply(originalOpen, this, [url, ...args])
    }
  } catch {
    // Capturing click metadata below still works if the page protects window.open.
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return
    const message = event.data
    if (!message || message.source !== COLLECTOR_SOURCE || message.type !== 'FUNTASTIC_1688_PROBE_ORDER') return
    probeOrder(message.orderNumber)
  })

  document.addEventListener('click', (event) => {
    const context = { seen: new WeakSet(), budget: { visited: 0 } }
    let element = event.target instanceof Element ? event.target : null
    for (let depth = 0; element && depth < 8; depth += 1) {
      scanElement(element, context)
      element = element.parentElement
    }
  }, true)

  function probeOrder(orderNumber) {
    if (!/^\d{10,40}$/.test(String(orderNumber || ''))) return
    const scope = findOrderScope(String(orderNumber))
    if (scope) {
      emitFromString(scope.outerHTML)
      const context = { seen: new WeakSet(), budget: { visited: 0 } }
      const elements = [scope, ...Array.from(scope.querySelectorAll('*')).slice(0, 1_500)]
      for (const element of elements) {
        scanElement(element, context)
        if (context.budget.visited >= 4_000) break
      }
      return
    }

    probeFrameworkOrderData(String(orderNumber))
  }

  function findOrderScope(orderNumber) {
    const candidates = []
    for (const root of documentRoots(document)) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      let node = walker.nextNode()
      while (node) {
        if (node.nodeValue?.includes(orderNumber)) {
          let element = node.parentElement
          for (let depth = 0; element && depth < 14; depth += 1) {
            const textLength = cleanText(element.textContent).length
            if (textLength < 40_000 && element.querySelectorAll('img').length > 0) {
              candidates.push(element)
              break
            }
            element = parentElementAcrossShadow(element)
          }
        }
        node = walker.nextNode()
      }
    }
    return candidates.sort((left, right) => (
      cleanText(left.textContent).length - cleanText(right.textContent).length
    ))[0] || null
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

  function scanElement(element, context) {
    for (const attribute of element.attributes || []) emitFromString(attribute.value)

    let keys = []
    try {
      keys = Reflect.ownKeys(element)
    } catch {
      return
    }
    for (const key of keys) {
      if (typeof key !== 'string' || !/(react|vue|props|context|data|item|offer|product|goods)/i.test(key)) continue
      try {
        scanValue(element[key], key, 0, context.seen, context.budget)
      } catch {
        // Third-party framework internals can contain throwing accessors.
      }
    }
  }

  function scanValue(value, keyHint, depth, seen, budget) {
    if (budget.visited >= 4_000 || depth > 5 || value === null || value === undefined) return
    budget.visited += 1

    if (typeof value === 'string') {
      emitFromString(value)
      emitOfferId(keyHint, value)
      return
    }
    if (typeof value === 'number' || typeof value === 'bigint') {
      emitOfferId(keyHint, String(value))
      return
    }
    if (typeof value !== 'object' && typeof value !== 'function') return
    if (seen.has(value)) return
    seen.add(value)

    let keys = []
    try {
      keys = Reflect.ownKeys(value).slice(0, 200)
    } catch {
      return
    }
    for (const key of keys) {
      if (value instanceof Node && (key === 'ownerDocument' || key === 'parentNode' || key === 'children')) continue
      try {
        scanValue(value[key], String(key), depth + 1, seen, budget)
      } catch {
        // Ignore accessors that reject inspection.
      }
    }
  }

  function probeFrameworkOrderData(orderNumber) {
    const seen = new WeakSet()
    const budget = { visited: 0 }
    const elements = documentRoots(document).flatMap((root) => (
      [root instanceof Element ? root : null, ...Array.from(root.querySelectorAll?.('*') || [])]
        .filter(Boolean)
    )).slice(0, 2_000)

    for (const element of elements) {
      let keys = []
      try {
        keys = Reflect.ownKeys(element)
      } catch {
        continue
      }
      for (const key of keys) {
        if (typeof key !== 'string' || !/(react|vue|props|context|data|state|store)/i.test(key)) continue
        try {
          findAndScanOrderObject(element[key], orderNumber, 0, seen, budget)
        } catch {
          // Ignore framework accessors that reject inspection.
        }
        if (budget.visited >= 12_000) return
      }
    }
  }

  function findAndScanOrderObject(value, orderNumber, depth, seen, budget) {
    if (budget.visited >= 12_000 || depth > 9 || value === null || value === undefined) return false
    budget.visited += 1
    if (typeof value !== 'object' && typeof value !== 'function') {
      return String(value).includes(orderNumber)
    }
    if (seen.has(value)) return false
    seen.add(value)

    let keys = []
    try {
      keys = Reflect.ownKeys(value).slice(0, 250)
    } catch {
      return false
    }

    const hasDirectOrderValue = keys.some((key) => {
      try {
        const child = value[key]
        return (typeof child === 'string' || typeof child === 'number' || typeof child === 'bigint')
          && String(child).includes(orderNumber)
      } catch {
        return false
      }
    })
    if (hasDirectOrderValue) {
      scanValue(value, 'matchedOrderRecord', 0, new WeakSet(), { visited: 0 })
      return true
    }

    let found = false
    for (const key of keys) {
      if (value instanceof Node && (key === 'ownerDocument' || key === 'parentNode' || key === 'children')) continue
      try {
        if (findAndScanOrderObject(value[key], orderNumber, depth + 1, seen, budget)) found = true
      } catch {
        // Ignore inaccessible framework fields.
      }
      if (budget.visited >= 12_000) break
    }
    return found
  }

  function emitOfferId(keyHint, value) {
    if (!/(offer.*id|item.*id|product.*id|goods.*id|resource.*id)/i.test(String(keyHint))) return
    if (/(order|trade)/i.test(String(keyHint))) return
    const match = String(value).match(/^\d{8,16}$/)
    if (match) emit(`https://detail.1688.com/offer/${match[0]}.html`)
  }

  function emitFromString(value) {
    if (value === null || value === undefined) return
    const decoded = safeDecodeURIComponent(String(value))
      .replace(/&amp;/gi, '&')
      .replace(/\\u002f/gi, '/')
      .replace(/\\\//g, '/')
    const pattern = /(?:https?:)?\/\/detail\.1688\.com\/offer\/(\d{6,30})\.html/gi
    let match = pattern.exec(decoded)
    while (match) {
      emit(`https://detail.1688.com/offer/${match[1]}.html`)
      match = pattern.exec(decoded)
    }
  }

  function emit(url) {
    if (emitted.has(url)) return
    emitted.add(url)
    window.postMessage({
      source: PAGE_PROBE_SOURCE,
      type: 'FUNTASTIC_1688_CAPTURED_URL',
      url,
    }, window.location.origin)
  }

  function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim()
  }

  function safeDecodeURIComponent(value) {
    try {
      return decodeURIComponent(value)
    } catch {
      return value
    }
  }
})()
