const STATE_KEY = 'funtastic1688ActiveRun'
const NEXT_ALARM = 'funtastic-1688-next'
const TIMEOUT_ALARM = 'funtastic-1688-timeout'
const EXTENSION_SOURCE = 'funtastic-1688-extension'
const ORDER_LIST_URL = 'https://air.1688.com/app/ctf-page/trade-order-list/buyer-order-list.html'
const ORDER_DELAY_MS = 2_500
const PAGE_TIMEOUT_MS = 40_000

let resultInFlight = false

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void handleMessage(message, sender)
    .then((response) => sendResponse(response))
    .catch((error) => sendResponse({ ok: false, error: errorMessage(error) }))
  return true
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === NEXT_ALARM) void navigateToCurrentOrder()
  if (alarm.name === TIMEOUT_ALARM) void handlePageTimeout()
})

chrome.tabs.onRemoved.addListener((tabId) => {
  void getRun().then((run) => {
    if (run?.collectorTabId === tabId && run.status === 'running') {
      return failRun(run, '1688 주문조회 탭이 닫혀 수집을 중단했습니다.', false)
    }
  })
})

async function handleMessage(message, sender) {
  if (!message || typeof message !== 'object') return { ok: false }

  if (message.type === 'FUNTASTIC_1688_START') {
    if (!sender.tab?.id || !isSaasUrl(sender.tab.url)) {
      return { ok: false, error: 'SaaS 품목 화면에서 시작해주세요.' }
    }
    return startRun(message, sender.tab.id)
  }

  if (message.type === 'FUNTASTIC_1688_CANCEL') {
    const run = await getRun()
    if (!run || (message.runId && message.runId !== run.runId)) return { ok: true }
    await cancelRun(run)
    return { ok: true }
  }

  if (message.type === 'FUNTASTIC_1688_READY') {
    const run = await getRun()
    const active = Boolean(
      run
      && run.status === 'running'
      && sender.tab?.id === run.collectorTabId,
    )
    return active
      ? { active: true, runId: run.runId, orderNumber: run.orders[run.index]?.orderNumber }
      : { active: false }
  }

  if (message.type === 'FUNTASTIC_1688_PAGE_RESULT') {
    const run = await getRun()
    if (!run || sender.tab?.id !== run.collectorTabId || resultInFlight) {
      return { ok: false }
    }
    const current = run.orders[run.index]
    if (!current || message.orderNumber !== current.orderNumber) return { ok: false }

    resultInFlight = true
    try {
      if (message.fatal) {
        await failRun(run, message.message || '1688 로그인을 확인해주세요.', true)
      } else {
        await advanceRun(run, {
          orderNumber: current.orderNumber,
          candidates: Array.isArray(message.candidates) ? message.candidates.slice(0, 30) : [],
          message: typeof message.message === 'string' ? message.message : null,
        })
      }
    } finally {
      resultInFlight = false
    }
    return { ok: true }
  }

  if (message.type === 'FUNTASTIC_1688_GET_STATUS') {
    const run = await getRun()
    return run
      ? { ok: true, running: true, index: run.index, total: run.orders.length }
      : { ok: true, running: false }
  }

  return { ok: false }
}

async function startRun(message, sourceTabId) {
  const orders = uniqueOrders(message.orders)
  if (!message.runId || orders.length === 0) {
    return { ok: false, error: '수집할 주문번호가 없습니다.' }
  }

  const previous = await getRun()
  if (previous) await clearRun(previous, true)

  const firstUrl = orderUrl(orders[0].orderNumber)
  const collectorTab = await chrome.tabs.create({ url: firstUrl, active: true })
  if (!collectorTab.id) throw new Error('1688 주문조회 탭을 열지 못했습니다.')

  const run = {
    runId: String(message.runId),
    sourceTabId,
    collectorTabId: collectorTab.id,
    orders,
    index: 0,
    status: 'running',
    startedAt: Date.now(),
  }
  await setRun(run)
  await scheduleTimeout()
  await sendToSaas(run, {
    type: 'FUNTASTIC_1688_ACK',
    total: orders.length,
  })
  return { ok: true, total: orders.length }
}

async function advanceRun(run, result) {
  await chrome.alarms.clear(TIMEOUT_ALARM)
  await sendToSaas(run, {
    type: 'FUNTASTIC_1688_RESULT',
    orderNumber: result.orderNumber,
    candidates: result.candidates,
    message: result.message,
  })

  run.index += 1
  if (run.index >= run.orders.length) {
    await sendToSaas(run, {
      type: 'FUNTASTIC_1688_COMPLETE',
      total: run.orders.length,
    })
    await clearRun(run, true)
    await chrome.tabs.update(run.sourceTabId, { active: true }).catch(() => {})
    return
  }

  await setRun(run)
  await chrome.alarms.create(NEXT_ALARM, { when: Date.now() + ORDER_DELAY_MS })
}

async function navigateToCurrentOrder() {
  const run = await getRun()
  if (!run || run.status !== 'running') return
  const current = run.orders[run.index]
  if (!current) return

  try {
    await chrome.tabs.update(run.collectorTabId, { url: orderUrl(current.orderNumber) })
    await scheduleTimeout()
  } catch {
    await failRun(run, '1688 주문조회 탭을 다시 열지 못했습니다.', false)
  }
}

async function handlePageTimeout() {
  const run = await getRun()
  if (!run || run.status !== 'running' || resultInFlight) return
  const current = run.orders[run.index]
  if (!current) return

  resultInFlight = true
  try {
    await advanceRun(run, {
      orderNumber: current.orderNumber,
      candidates: [],
      message: '1688 페이지 응답 시간 초과',
    })
  } finally {
    resultInFlight = false
  }
}

async function cancelRun(run) {
  await sendToSaas(run, { type: 'FUNTASTIC_1688_CANCELLED' })
  await clearRun(run, true)
  await chrome.tabs.update(run.sourceTabId, { active: true }).catch(() => {})
}

async function failRun(run, message, keepCollectorTab) {
  await sendToSaas(run, { type: 'FUNTASTIC_1688_ERROR', message })
  await clearRun(run, !keepCollectorTab)
  if (!keepCollectorTab) {
    await chrome.tabs.update(run.sourceTabId, { active: true }).catch(() => {})
  }
}

async function clearRun(run, closeCollectorTab) {
  await Promise.all([
    chrome.alarms.clear(NEXT_ALARM),
    chrome.alarms.clear(TIMEOUT_ALARM),
    chrome.storage.session.remove(STATE_KEY),
  ])
  if (closeCollectorTab && run.collectorTabId) {
    await chrome.tabs.remove(run.collectorTabId).catch(() => {})
  }
}

async function sendToSaas(run, payload) {
  await chrome.tabs.sendMessage(run.sourceTabId, {
    source: EXTENSION_SOURCE,
    runId: run.runId,
    ...payload,
  })
}

async function scheduleTimeout() {
  await chrome.alarms.clear(TIMEOUT_ALARM)
  await chrome.alarms.create(TIMEOUT_ALARM, { when: Date.now() + PAGE_TIMEOUT_MS })
}

async function getRun() {
  const stored = await chrome.storage.session.get(STATE_KEY)
  return stored[STATE_KEY] || null
}

async function setRun(run) {
  await chrome.storage.session.set({ [STATE_KEY]: run })
}

function orderUrl(orderNumber) {
  const url = new URL(ORDER_LIST_URL)
  url.searchParams.set('word', orderNumber)
  url.searchParams.set('page', '1')
  url.searchParams.set('pageSize', '10')
  return url.toString()
}

function uniqueOrders(value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const orders = []
  for (const item of value) {
    const orderNumber = String(item?.orderNumber || '').trim()
    if (!/^\d{10,40}$/.test(orderNumber) || seen.has(orderNumber)) continue
    seen.add(orderNumber)
    orders.push({ orderNumber })
    if (orders.length >= 300) break
  }
  return orders
}

function isSaasUrl(value) {
  if (!value) return false
  try {
    const url = new URL(value)
    return url.origin === 'https://funtastic-saas-vercel.vercel.app'
      || url.origin === 'http://localhost:3000'
  } catch {
    return false
  }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}
