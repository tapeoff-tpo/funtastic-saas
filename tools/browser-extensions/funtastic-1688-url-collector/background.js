const STATE_KEY = 'funtastic1688ActiveRun'
const QUEUE_KEY = 'funtastic1688ActiveQueue'
const CHECKPOINT_KEY = 'funtastic1688QueueCheckpoint'
const NEXT_ALARM = 'funtastic-1688-next'
const TIMEOUT_ALARM = 'funtastic-1688-timeout'
const SAVE_TIMEOUT_ALARM = 'funtastic-1688-save-timeout'
const VERIFY_STATE_KEY = 'funtastic1688VerificationRun'
const VERIFY_QUEUE_KEY = 'funtastic1688VerificationQueue'
const VERIFY_CHECKPOINT_KEY = 'funtastic1688VerificationCheckpoint'
const VERIFY_NEXT_ALARM = 'funtastic-1688-verify-next'
const VERIFY_TIMEOUT_ALARM = 'funtastic-1688-verify-timeout'
const VERIFY_SAVE_TIMEOUT_ALARM = 'funtastic-1688-verify-save-timeout'
const DETAIL_IMAGES_STATE_KEY = 'funtastic1688DetailImagesRun'
const DETAIL_IMAGES_TIMEOUT_ALARM = 'funtastic-1688-detail-images-timeout'
const VERIFICATION_ISSUE_LIMIT = 100
const EXTENSION_SOURCE = 'funtastic-1688-extension'
const ORDER_LIST_URL = 'https://air.1688.com/app/ctf-page/trade-order-list/buyer-order-list.html'
const LOCAL_QUEUE_FILE = 'order-queue.json'
const ORDER_DELAY_MS = 2_500
const PAGE_TIMEOUT_MS = 40_000
const SAVE_TIMEOUT_MS = 30_000
const MAX_ORDERS = 10_000
const CHECKPOINT_INTERVAL = 10
const VERIFY_DELAY_MS = 2_500
const VERIFY_PAGE_TIMEOUT_MS = 30_000
const VERIFY_SAVE_TIMEOUT_MS = 30_000
const MAX_VERIFY_LINKS = 2_000
const DETAIL_IMAGES_PAGE_TIMEOUT_MS = 60_000

let resultInFlight = false
let checkpointCache = null
let verificationResultInFlight = false
let verificationCheckpointCache = null

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void handleMessage(message, sender)
    .then((response) => sendResponse(response))
    .catch((error) => sendResponse({ ok: false, error: errorMessage(error) }))
  return true
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === NEXT_ALARM) void navigateToCurrentOrder()
  if (alarm.name === TIMEOUT_ALARM) void handlePageTimeout()
  if (alarm.name === SAVE_TIMEOUT_ALARM) void handleSaveTimeout()
  if (alarm.name === VERIFY_NEXT_ALARM) void navigateToCurrentVerification()
  if (alarm.name === VERIFY_TIMEOUT_ALARM) void handleVerificationPageTimeout()
  if (alarm.name === VERIFY_SAVE_TIMEOUT_ALARM) void handleVerificationSaveTimeout()
  if (alarm.name === DETAIL_IMAGES_TIMEOUT_ALARM) void handleDetailImagesTimeout()
})

chrome.tabs.onCreated.addListener((tab) => {
  void registerCaptureTab(tab)
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const url = changeInfo.url || tab.url
  if (url) void captureDetailNavigation(tabId, url, tab.openerTabId)
  if (changeInfo.status === 'complete') void collectDetailImagesFromTab(tabId)
})

chrome.tabs.onRemoved.addListener((tabId) => {
  void Promise.all([getRun(), getVerificationRun(), getDetailImagesRun()]).then(([run, verificationRun, detailImagesRun]) => {
    if (run?.collectorTabId === tabId && run.status === 'running') {
      return failRun(run, '1688 주문조회 탭이 닫혀 수집을 중단했습니다.', false)
    }
    if (verificationRun?.collectorTabId === tabId && verificationRun.status === 'running') {
      return failVerificationRun(verificationRun, '1688 URL 검증 탭이 닫혀 검증을 중단했습니다.', false)
    }
    if (detailImagesRun?.collectorTabId === tabId && detailImagesRun.status === 'running') {
      return failDetailImagesRun(detailImagesRun, '1688 이미지 수집 탭이 닫혀 수집을 중단했습니다.')
    }
  })
})

async function handleMessage(message, sender) {
  if (!message || typeof message !== 'object') return { ok: false }

  if (message.type === 'FUNTASTIC_1688_START') {
    if (!sender.tab?.id || !isSaasUrl(sender.tab.url)) {
      return { ok: false, error: 'SaaS 품목 화면에서 시작해주세요.' }
    }
    if (await getVerificationRun()) {
      return { ok: false, error: 'URL 검증이 진행 중입니다. 먼저 검증을 중단해주세요.' }
    }
    return startRun(message, sender.tab.id)
  }

  if (message.type === 'FUNTASTIC_1688_VERIFY_START') {
    if (!sender.tab?.id || !isSaasUrl(sender.tab.url)) {
      return { ok: false, error: 'SaaS 품목 화면에서 시작해주세요.' }
    }
    if (await getRun()) {
      return { ok: false, error: '구매 URL 수집이 진행 중입니다. 먼저 수집을 중단해주세요.' }
    }
    return startVerificationRun(message, sender.tab.id)
  }

  if (message.type === 'FUNTASTIC_1688_DETAIL_IMAGES_START') {
    if (!sender.tab?.id || !isSaasUrl(sender.tab.url)) {
      return { ok: false, error: 'SaaS 상세페이지 제작 화면에서 시작해주세요.' }
    }
    const [run, verificationRun] = await Promise.all([getRun(), getVerificationRun()])
    if (run || verificationRun) {
      return { ok: false, error: '진행 중인 1688 URL 작업이 있습니다. 해당 작업을 먼저 마친 뒤 이미지 수집을 시작해주세요.' }
    }
    return startDetailImagesRun(message, sender.tab.id)
  }

  if (message.type === 'FUNTASTIC_1688_CANCEL') {
    const run = await getRun()
    if (!run || (message.runId && message.runId !== run.runId)) return { ok: true }
    await cancelRun(run)
    return { ok: true }
  }

  if (message.type === 'FUNTASTIC_1688_VERIFY_CANCEL') {
    const run = await getVerificationRun()
    if (!run || (message.runId && message.runId !== run.runId)) return { ok: true }
    await cancelVerificationRun(run)
    return { ok: true }
  }

  if (message.type === 'FUNTASTIC_1688_GET_STATUS') {
    const verificationRun = await getVerificationRun()
    if (verificationRun) {
      if (sender.tab?.id && isSaasUrl(sender.tab.url)) {
        verificationRun.sourceTabId = sender.tab.id
        await setVerificationRun(verificationRun)
        if (verificationRun.pendingResult) {
          setTimeout(() => void resendPendingVerificationResult(), 500)
        }
      }
      return {
        ok: true,
        running: true,
        mode: 'verification',
        runId: verificationRun.runId,
        index: verificationRun.index,
        total: verificationRun.links.length,
        summary: verificationRun.summary,
      }
    }

    const run = await getRun()
    if (!run) {
      const [checkpoint, verificationCheckpoint] = await Promise.all([
        getCheckpoint(),
        getVerificationCheckpoint(),
      ])
      return {
        ok: true,
        running: false,
        checkpoint: checkpoint ? checkpointStatus(checkpoint) : null,
        verificationCheckpoint: verificationCheckpoint
          ? verificationCheckpointStatus(verificationCheckpoint)
          : null,
      }
    }

    if (sender.tab?.id && isSaasUrl(sender.tab.url)) {
      run.sourceTabId = sender.tab.id
      await setRun(run)
      if (run.pendingResult) {
        setTimeout(() => void resendPendingResult(), 500)
      }
    }
    return {
      ok: true,
      running: true,
      mode: 'collection',
      runId: run.runId,
      index: run.index,
      total: run.orders.length,
      summary: run.summary,
      queueSource: run.queueSource,
    }
  }

  if (message.type === 'FUNTASTIC_1688_READY') {
    const run = await getRun()
    const active = Boolean(
      run
      && run.status === 'running'
      && sender.tab?.id === run.collectorTabId,
    )
    return active
      ? {
          active: true,
          runId: run.runId,
          orderNumber: run.orders[run.index]?.orderNumber,
          candidates: run.capturedCandidates || [],
        }
      : { active: false }
  }

  if (message.type === 'FUNTASTIC_1688_DETAIL_IMAGES_READY') {
    const run = await getDetailImagesRun()
    if (
      !run
      || run.status !== 'running'
      || sender.tab?.id !== run.collectorTabId
      || canonicalOfferUrl(message.url) !== run.url
    ) return { active: false }

    return {
      active: true,
      runId: run.runId,
      jobId: run.jobId,
      url: run.url,
    }
  }

  if (message.type === 'FUNTASTIC_1688_DETAIL_IMAGES_RESULT') {
    const run = await getDetailImagesRun()
    if (
      !run
      || run.status !== 'running'
      || sender.tab?.id !== run.collectorTabId
      || message.runId !== run.runId
      || message.jobId !== run.jobId
      || canonicalOfferUrl(message.url) !== run.url
    ) return { ok: false }

    const images = uniqueDetailImageUrls(message.images)
    if (images.length === 0) {
      await failDetailImagesRun(run, typeof message.message === 'string' ? message.message : '1688 상품 이미지를 찾지 못했습니다.')
      return { ok: true }
    }

    await completeDetailImagesRun(run, images)
    return { ok: true }
  }

  if (message.type === 'FUNTASTIC_1688_RESULT_SAVED') {
    const run = await getRun()
    if (
      !run
      || sender.tab?.id !== run.sourceTabId
      || !run.pendingResult
      || message.runId !== run.runId
      || message.orderNumber !== run.pendingResult.orderNumber
    ) return { ok: false }

    await completeCurrentOrder(run, message)
    return { ok: true }
  }

  if (message.type === 'FUNTASTIC_1688_VERIFY_READY') {
    const run = await getVerificationRun()
    const current = run?.links[run.index]
    if (
      !run
      || sender.tab?.id !== run.collectorTabId
      || !current
      || canonicalOfferUrl(message.url) !== current.url
    ) return { active: false }

    return {
      active: true,
      runId: run.runId,
      url: current.url,
      items: current.items,
    }
  }

  if (message.type === 'FUNTASTIC_1688_VERIFY_RESULT') {
    const run = await getVerificationRun()
    const current = run?.links[run.index]
    if (
      !run
      || sender.tab?.id !== run.collectorTabId
      || verificationResultInFlight
      || run.pendingResult
      || !current
      || canonicalOfferUrl(message.url) !== current.url
    ) return { ok: false }

    if (message.fatal) {
      await failVerificationRun(
        run,
        typeof message.message === 'string'
          ? message.message
          : '1688 로그인 또는 보안 확인이 필요합니다.',
        true,
      )
      return { ok: true }
    }

    const status = ['open', 'unavailable', 'unknown'].includes(message.status)
      ? message.status
      : 'unknown'
    verificationResultInFlight = true
    try {
      await queueVerificationResult(run, {
        url: current.url,
        items: current.items,
        status,
        message: typeof message.message === 'string' ? message.message.slice(0, 500) : null,
      })
    } finally {
      verificationResultInFlight = false
    }
    return { ok: true }
  }

  if (message.type === 'FUNTASTIC_1688_VERIFY_RESULT_SAVED') {
    const run = await getVerificationRun()
    if (
      !run
      || sender.tab?.id !== run.sourceTabId
      || !run.pendingResult
      || message.runId !== run.runId
      || canonicalOfferUrl(message.url) !== run.pendingResult.url
    ) return { ok: false }

    await completeCurrentVerification(run, message)
    return { ok: true }
  }

  if (message.type === 'FUNTASTIC_1688_FRAME_REPORT') {
    const run = await getRun()
    const current = run?.orders[run.index]
    if (!run || sender.tab?.id !== run.collectorTabId || message.orderNumber !== current?.orderNumber) {
      return { ok: false }
    }

    const report = {
      frameId: Number.isInteger(sender.frameId) ? sender.frameId : -1,
      url: typeof message.url === 'string' ? message.url.slice(0, 500) : '',
      isTop: Boolean(message.isTop),
      textLength: Math.max(0, Math.min(Number(message.textLength) || 0, 1_000_000)),
      hasOrder: Boolean(message.hasOrder),
    }
    const reports = [...(run.frameReports || [])]
    const existingIndex = reports.findIndex((item) => (
      item.frameId === report.frameId && item.url === report.url
    ))
    if (existingIndex >= 0) reports[existingIndex] = report
    else reports.push(report)
    run.frameReports = reports.slice(-30)
    await setRun(run)
    return { ok: true }
  }

  if (message.type === 'FUNTASTIC_1688_CAPTURE_URL') {
    const run = await getRun()
    if (!run || sender.tab?.id !== run.collectorTabId) return { ok: false, candidates: [] }
    await addCapturedCandidate(run, message.url)
    return { ok: true, candidates: run.capturedCandidates || [] }
  }

  if (message.type === 'FUNTASTIC_1688_GET_CAPTURED') {
    const run = await getRun()
    if (!run || sender.tab?.id !== run.collectorTabId) return { ok: false, candidates: [] }
    return {
      ok: true,
      candidates: run.capturedCandidates || [],
      frameReports: run.frameReports || [],
    }
  }

  if (message.type === 'FUNTASTIC_1688_PAGE_RESULT') {
    const run = await getRun()
    if (!run || sender.tab?.id !== run.collectorTabId || resultInFlight || run.pendingResult) {
      return { ok: false }
    }
    const current = run.orders[run.index]
    if (!current || message.orderNumber !== current.orderNumber) return { ok: false }

    resultInFlight = true
    try {
      if (message.fatal) {
        await failRun(run, message.message || '1688 로그인을 확인해주세요.', true)
      } else {
        await queueResultForSave(run, {
          orderNumber: current.orderNumber,
          candidates: uniqueCandidateUrls([
            ...(run.capturedCandidates || []),
            ...(Array.isArray(message.candidates) ? message.candidates : []),
          ]).slice(0, 30),
          message: typeof message.message === 'string' ? message.message : null,
        })
      }
    } finally {
      resultInFlight = false
    }
    return { ok: true }
  }

  return { ok: false }
}

async function startRun(message, sourceTabId) {
  const localQueue = await loadLocalQueue()
  const serverOrders = uniqueOrders(message.orders)
  const orders = localQueue?.orders.length ? localQueue.orders : serverOrders
  if (!message.runId || orders.length === 0) {
    return { ok: false, error: '수집할 주문번호가 없습니다.' }
  }

  const previous = await getRun()
  if (previous) await clearRun(previous, true)

  const queueId = localQueue?.queueId || queueFingerprint(orders)
  const previousCheckpoint = await getCheckpoint()
  const canResume = previousCheckpoint?.queueId === queueId
    && previousCheckpoint.total === orders.length
    && previousCheckpoint.nextIndex > 0
    && previousCheckpoint.nextIndex < orders.length
  const checkpoint = canResume
    ? normalizeCheckpoint(previousCheckpoint, queueId, orders.length)
    : createCheckpoint(queueId, orders.length)
  checkpointCache = checkpoint
  await saveCheckpoint(true)

  const index = canResume ? checkpoint.nextIndex : 0
  const firstUrl = orderUrl(orders[index].orderNumber)
  const collectorTab = await chrome.tabs.create({ url: firstUrl, active: true })
  if (!collectorTab.id) throw new Error('1688 주문조회 탭을 열지 못했습니다.')

  const run = {
    runId: String(message.runId),
    queueId,
    queueSource: localQueue?.orders.length ? 'excel' : 'saas',
    sourceTabId,
    collectorTabId: collectorTab.id,
    orders,
    index,
    status: 'running',
    startedAt: checkpoint.startedAt,
    summary: normalizeSummary(checkpoint.summary),
    pendingResult: null,
    capturedCandidates: [],
    captureTabIds: [],
    frameReports: [],
  }
  await setQueue(orders)
  await setRun(run)
  await scheduleTimeout()
  await sendToSaas(run, {
    type: 'FUNTASTIC_1688_ACK',
    total: orders.length,
    resumedFrom: index,
    queueSource: run.queueSource,
    summary: run.summary,
  })
  return { ok: true, total: orders.length, resumedFrom: index }
}

async function queueResultForSave(run, result) {
  await chrome.alarms.clear(TIMEOUT_ALARM)
  await closeCaptureTabs(run)
  const current = run.orders[run.index]
  if (!current || current.orderNumber !== result.orderNumber) return

  run.pendingResult = {
    orderNumber: result.orderNumber,
    items: current.items || [],
    candidates: result.candidates,
    message: result.message,
    saveAttempts: 1,
  }
  await setRun(run)
  await scheduleSaveTimeout()
  try {
    await sendPendingResult(run)
  } catch {
    await failRun(run, 'SaaS 화면에 수집 결과를 전달하지 못했습니다. 다시 시작하면 이어서 진행합니다.', false)
  }
}

async function completeCurrentOrder(run, acknowledgement) {
  await chrome.alarms.clear(SAVE_TIMEOUT_ALARM)
  const pendingResult = run.pendingResult
  if (!pendingResult) return

  updateSummary(run, pendingResult, acknowledgement)
  updateCheckpoint(run, pendingResult, acknowledgement)
  run.index += 1
  run.pendingResult = null
  run.capturedCandidates = []
  run.captureTabIds = []
  run.frameReports = []

  if (run.index >= run.orders.length) {
    if (checkpointCache) checkpointCache.completedAt = new Date().toISOString()
    await saveCheckpoint(true)
    await sendToSaas(run, {
      type: 'FUNTASTIC_1688_COMPLETE',
      total: run.orders.length,
      summary: run.summary,
    }).catch(() => {})
    await clearRun(run, true)
    await chrome.tabs.update(run.sourceTabId, { active: true }).catch(() => {})
    return
  }

  await setRun(run)
  await saveCheckpoint(run.index % CHECKPOINT_INTERVAL === 0)
  await chrome.alarms.create(NEXT_ALARM, { when: Date.now() + ORDER_DELAY_MS })
}

async function navigateToCurrentOrder() {
  const run = await getRun()
  if (!run || run.status !== 'running' || run.pendingResult) return
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
  if (!run || run.status !== 'running' || resultInFlight || run.pendingResult) return
  const current = run.orders[run.index]
  if (!current) return

  resultInFlight = true
  try {
    await queueResultForSave(run, {
      orderNumber: current.orderNumber,
      candidates: [],
      message: '1688 페이지 응답 시간 초과',
    })
  } finally {
    resultInFlight = false
  }
}

async function handleSaveTimeout() {
  const run = await getRun()
  if (!run?.pendingResult) return
  if (run.pendingResult.saveAttempts >= 3) {
    await failRun(run, 'SaaS 저장 응답이 없어 수집을 멈췄습니다. 다시 시작하면 같은 주문부터 이어집니다.', false)
    return
  }

  run.pendingResult.saveAttempts += 1
  await setRun(run)
  await scheduleSaveTimeout()
  try {
    await sendPendingResult(run)
  } catch {
    await failRun(run, 'SaaS 화면과 연결이 끊겼습니다. 다시 시작하면 같은 주문부터 이어집니다.', false)
  }
}

async function resendPendingResult() {
  const run = await getRun()
  if (!run?.pendingResult) return
  await sendPendingResult(run).catch(() => {})
}

async function sendPendingResult(run) {
  if (!run.pendingResult) return
  await sendToSaas(run, {
    type: 'FUNTASTIC_1688_RESULT',
    orderNumber: run.pendingResult.orderNumber,
    items: run.pendingResult.items,
    candidates: run.pendingResult.candidates,
    message: run.pendingResult.message,
  })
}

async function cancelRun(run) {
  await syncCheckpointFromRun(run)
  await saveCheckpoint(true)
  await sendToSaas(run, { type: 'FUNTASTIC_1688_CANCELLED' }).catch(() => {})
  await clearRun(run, true)
  await chrome.tabs.update(run.sourceTabId, { active: true }).catch(() => {})
}

async function failRun(run, message, keepCollectorTab) {
  await syncCheckpointFromRun(run)
  await saveCheckpoint(true)
  await sendToSaas(run, { type: 'FUNTASTIC_1688_ERROR', message }).catch(() => {})
  await clearRun(run, !keepCollectorTab)
  if (!keepCollectorTab) {
    await chrome.tabs.update(run.sourceTabId, { active: true }).catch(() => {})
  }
}

async function clearRun(run, closeCollectorTab) {
  await Promise.all([
    chrome.alarms.clear(NEXT_ALARM),
    chrome.alarms.clear(TIMEOUT_ALARM),
    chrome.alarms.clear(SAVE_TIMEOUT_ALARM),
    chrome.storage.session.remove([STATE_KEY, QUEUE_KEY]),
  ])
  await closeCaptureTabs(run)
  if (closeCollectorTab && run.collectorTabId) {
    await chrome.tabs.remove(run.collectorTabId).catch(() => {})
  }
}

async function registerCaptureTab(tab) {
  if (!tab.id) return
  const run = await getRun()
  if (!run || run.status !== 'running' || tab.openerTabId !== run.collectorTabId) return

  run.captureTabIds = Array.from(new Set([...(run.captureTabIds || []), tab.id]))
  await setRun(run)
  if (tab.url) await captureDetailNavigation(tab.id, tab.url, tab.openerTabId)
}

async function captureDetailNavigation(tabId, value, openerTabId) {
  const url = canonicalOfferUrl(value)
  if (!url) return

  const run = await getRun()
  if (!run || run.status !== 'running') return
  const isCollector = tabId === run.collectorTabId
  const isCaptureTab = openerTabId === run.collectorTabId
    || (run.captureTabIds || []).includes(tabId)
  if (!isCollector && !isCaptureTab) return

  await addCapturedCandidate(run, url)

  if (isCollector) {
    const current = run.orders[run.index]
    if (current) {
      await chrome.tabs.update(run.collectorTabId, { url: orderUrl(current.orderNumber) }).catch(() => {})
    }
    return
  }

  run.captureTabIds = (run.captureTabIds || []).filter((id) => id !== tabId)
  await setRun(run)
  await chrome.tabs.remove(tabId).catch(() => {})
  await chrome.tabs.update(run.collectorTabId, { active: true }).catch(() => {})
}

async function addCapturedCandidate(run, value) {
  const url = canonicalOfferUrl(value)
  if (!url) return false
  const candidates = new Set(run.capturedCandidates || [])
  const previousSize = candidates.size
  candidates.add(url)
  run.capturedCandidates = Array.from(candidates).slice(0, 30)
  if (candidates.size !== previousSize) await setRun(run)
  return candidates.size !== previousSize
}

async function closeCaptureTabs(run) {
  const tabIds = Array.from(new Set(run.captureTabIds || []))
  if (tabIds.length === 0) return
  await Promise.all(tabIds.map((tabId) => chrome.tabs.remove(tabId).catch(() => {})))
}

async function sendToSaas(run, payload) {
  await chrome.tabs.sendMessage(run.sourceTabId, {
    source: EXTENSION_SOURCE,
    runId: run.runId,
    ...payload,
  })
}

async function startDetailImagesRun(message, sourceTabId) {
  const url = canonicalOfferUrl(message.url)
  const runId = typeof message.runId === 'string' ? message.runId : ''
  const jobId = typeof message.jobId === 'string' ? message.jobId : ''
  if (!url || !runId || !jobId) {
    return { ok: false, error: '상세페이지 이미지 수집 요청이 올바르지 않습니다.' }
  }

  const previous = await getDetailImagesRun()
  if (previous) await clearDetailImagesRun(previous, true)

  const collectorTab = await chrome.tabs.create({ url, active: true })
  if (!collectorTab.id) throw new Error('1688 상품 페이지를 열지 못했습니다.')

  const run = {
    runId,
    jobId,
    sourceTabId,
    collectorTabId: collectorTab.id,
    url,
    status: 'running',
    collecting: false,
  }
  await setDetailImagesRun(run)
  await scheduleDetailImagesTimeout()
  await sendDetailImagesToSaas(run, { type: 'FUNTASTIC_1688_DETAIL_IMAGES_ACK', jobId })
  const latestTab = await chrome.tabs.get(collectorTab.id).catch(() => null)
  if (latestTab?.status === 'complete') void collectDetailImagesFromTab(collectorTab.id)
  return { ok: true }
}

async function collectDetailImagesFromTab(tabId) {
  const run = await getDetailImagesRun()
  if (!run || run.status !== 'running' || run.collecting || run.collectorTabId !== tabId) return

  run.collecting = true
  await setDetailImagesRun(run)
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: collect1688DetailImagesInPage,
    })
    const value = result?.result
    const images = uniqueDetailImageUrls(value?.images)
    if (images.length === 0) {
      await failDetailImagesRun(run, typeof value?.error === 'string' ? value.error : '1688 상품 이미지를 찾지 못했습니다.')
      return
    }
    await completeDetailImagesRun(run, images)
  } catch (error) {
    await failDetailImagesRun(run, `1688 이미지 수집을 실행하지 못했습니다: ${errorMessage(error)}`)
  }
}

async function completeDetailImagesRun(run, images) {
  await chrome.alarms.clear(DETAIL_IMAGES_TIMEOUT_ALARM)
  await sendDetailImagesToSaas(run, {
    type: 'FUNTASTIC_1688_DETAIL_IMAGES_RESULT',
    jobId: run.jobId,
    images,
  }).catch(async (error) => {
    await failDetailImagesRun(run, `SaaS 화면에 이미지 수집 결과를 전달하지 못했습니다: ${errorMessage(error)}`)
  })
  await clearDetailImagesRun(run, true)
  await chrome.tabs.update(run.sourceTabId, { active: true }).catch(() => {})
}

async function failDetailImagesRun(run, message) {
  await chrome.alarms.clear(DETAIL_IMAGES_TIMEOUT_ALARM)
  await sendDetailImagesToSaas(run, {
    type: 'FUNTASTIC_1688_DETAIL_IMAGES_ERROR',
    jobId: run.jobId,
    message,
  }).catch(() => {})
  await clearDetailImagesRun(run, true)
  await chrome.tabs.update(run.sourceTabId, { active: true }).catch(() => {})
}

async function handleDetailImagesTimeout() {
  const run = await getDetailImagesRun()
  if (!run || run.status !== 'running') return
  await failDetailImagesRun(run, '1688 상품 페이지 응답 시간이 초과되었습니다. 로그인 또는 보안 확인 상태를 확인해주세요.')
}

async function clearDetailImagesRun(run, closeCollectorTab) {
  await Promise.all([
    chrome.alarms.clear(DETAIL_IMAGES_TIMEOUT_ALARM),
    chrome.storage.session.remove(DETAIL_IMAGES_STATE_KEY),
  ])
  if (closeCollectorTab && run.collectorTabId) {
    await chrome.tabs.remove(run.collectorTabId).catch(() => {})
  }
}

async function getDetailImagesRun() {
  const stored = await chrome.storage.session.get(DETAIL_IMAGES_STATE_KEY)
  return stored[DETAIL_IMAGES_STATE_KEY] || null
}

async function setDetailImagesRun(run) {
  await chrome.storage.session.set({ [DETAIL_IMAGES_STATE_KEY]: run })
}

async function scheduleDetailImagesTimeout() {
  await chrome.alarms.clear(DETAIL_IMAGES_TIMEOUT_ALARM)
  await chrome.alarms.create(DETAIL_IMAGES_TIMEOUT_ALARM, { when: Date.now() + DETAIL_IMAGES_PAGE_TIMEOUT_MS })
}

async function collect1688DetailImagesInPage() {
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const pageText = () => (document.body?.innerText || document.documentElement?.innerText || '').replace(/\s+/g, ' ').slice(0, 100_000)
  const text = pageText()
  if (/请登录|登录后|账号登录|扫码登录/i.test(text)) {
    return { images: [], error: '1688 로그인이 필요합니다. 로그인 후 다시 실행해주세요.' }
  }
  if (/访问过于频繁|安全验证|请完成验证|滑动验证|请输入验证码|系统繁忙，请稍后再试/i.test(text)) {
    return { images: [], error: '1688 보안 확인이 필요합니다. 화면에서 확인을 마친 뒤 다시 실행해주세요.' }
  }
  if (/商品不存在|商品已下架|您查看的商品不存在|找不到.{0,12}(商品|宝贝)|很抱歉.{0,30}(商品|宝贝).{0,20}(不存在|下架)/i.test(text)) {
    return { images: [], error: '1688에서 상품 없음 또는 판매중지로 표시됩니다.' }
  }

  const collect = () => {
    const images = new Set()
    for (const image of document.images) {
      const width = Math.max(image.naturalWidth || 0, image.width || 0)
      const height = Math.max(image.naturalHeight || 0, image.height || 0)
      if (width < 80 || height < 80) continue
      for (const value of [image.currentSrc, image.src, image.getAttribute('data-src'), image.getAttribute('data-lazy-src'), image.getAttribute('data-original')]) {
        if (!value || value.startsWith('data:') || images.size >= 30) continue
        try {
          const url = new URL(value.startsWith('//') ? `https:${value}` : value, window.location.href)
          if (!['http:', 'https:'].includes(url.protocol)) continue
          if (!/alicdn|1688|taobaocdn/i.test(url.hostname)) continue
          images.add(url.toString())
        } catch {
          // Ignore malformed image values rendered by the product page.
        }
      }
    }
    return Array.from(images)
  }

  let previous = ''
  let latestImages = []
  for (let step = 0; step < 7; step += 1) {
    latestImages = collect()
    const fingerprint = latestImages.join('|')
    if (latestImages.length >= 2 && fingerprint === previous) return { images: latestImages }
    previous = fingerprint
    const height = Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0)
    window.scrollTo({ top: Math.round((height * Math.min(step + 1, 4)) / 4), behavior: 'auto' })
    await delay(900)
  }
  return latestImages.length > 0
    ? { images: latestImages }
    : { images: [], error: '1688 상품 이미지를 찾지 못했습니다.' }
}

async function sendDetailImagesToSaas(run, payload) {
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

async function scheduleSaveTimeout() {
  await chrome.alarms.clear(SAVE_TIMEOUT_ALARM)
  await chrome.alarms.create(SAVE_TIMEOUT_ALARM, { when: Date.now() + SAVE_TIMEOUT_MS })
}

async function getRun() {
  const stored = await chrome.storage.session.get([STATE_KEY, QUEUE_KEY])
  const state = stored[STATE_KEY]
  const orders = stored[QUEUE_KEY]
  return state && Array.isArray(orders) ? { ...state, orders } : null
}

async function setRun(run) {
  const { orders: _orders, ...state } = run
  await chrome.storage.session.set({ [STATE_KEY]: state })
}

async function setQueue(orders) {
  await chrome.storage.session.set({ [QUEUE_KEY]: orders })
}

async function loadLocalQueue() {
  try {
    const response = await fetch(chrome.runtime.getURL(LOCAL_QUEUE_FILE), { cache: 'no-store' })
    if (!response.ok) return null
    const value = await response.json()
    const orders = uniqueOrders(value?.orders)
    if (orders.length === 0) return null
    return {
      queueId: typeof value?.queueId === 'string' && value.queueId.length <= 120
        ? value.queueId
        : queueFingerprint(orders),
      orders,
    }
  } catch {
    return null
  }
}

async function getCheckpoint() {
  if (checkpointCache) return checkpointCache
  const stored = await chrome.storage.local.get(CHECKPOINT_KEY)
  checkpointCache = stored[CHECKPOINT_KEY] || null
  return checkpointCache
}

async function saveCheckpoint(force) {
  if (!checkpointCache) return
  if (!force && checkpointCache.nextIndex % CHECKPOINT_INTERVAL !== 0) return
  checkpointCache.updatedAt = new Date().toISOString()
  await chrome.storage.local.set({ [CHECKPOINT_KEY]: checkpointCache })
}

async function syncCheckpointFromRun(run) {
  const checkpoint = await getCheckpoint()
  if (!checkpoint || checkpoint.queueId !== run.queueId) return
  checkpoint.nextIndex = run.index
  checkpoint.summary = normalizeSummary(run.summary)
}

function createCheckpoint(queueId, total) {
  const now = new Date().toISOString()
  return {
    version: 1,
    queueId,
    total,
    nextIndex: 0,
    summary: emptySummary(),
    notFound: [],
    ambiguous: [],
    failed: [],
    startedAt: now,
    updatedAt: now,
    completedAt: null,
  }
}

function normalizeCheckpoint(value, queueId, total) {
  return {
    version: 1,
    queueId,
    total,
    nextIndex: Math.min(Math.max(Number(value.nextIndex) || 0, 0), total),
    summary: normalizeSummary(value.summary),
    notFound: Array.isArray(value.notFound) ? value.notFound : [],
    ambiguous: Array.isArray(value.ambiguous) ? value.ambiguous : [],
    failed: Array.isArray(value.failed) ? value.failed : [],
    startedAt: typeof value.startedAt === 'string' ? value.startedAt : new Date().toISOString(),
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString(),
    completedAt: typeof value.completedAt === 'string' ? value.completedAt : null,
  }
}

function checkpointStatus(checkpoint) {
  return {
    queueId: checkpoint.queueId,
    total: checkpoint.total,
    nextIndex: checkpoint.nextIndex,
    summary: normalizeSummary(checkpoint.summary),
    completedAt: checkpoint.completedAt,
  }
}

function updateSummary(run, result, acknowledgement) {
  const summary = normalizeSummary(run.summary)
  summary.processed = run.index + 1
  let issue = null

  if (!acknowledgement.ok) {
    summary.failed += 1
    issue = `${result.orderNumber}: ${acknowledgement.message || 'SaaS 저장 실패'}`
  } else if (acknowledgement.status === 'updated') {
    summary.updated += Math.max(0, Number(acknowledgement.updatedCount) || 0)
  } else if (acknowledgement.status === 'ambiguous') {
    summary.review += 1
    issue = `${result.orderNumber}: 상품 링크가 여러 개라 확인 필요`
  } else if (acknowledgement.status === 'not_found') {
    summary.notFound += 1
    issue = `${result.orderNumber}: ${result.message || '상품 링크 미발견'}`
  } else if (acknowledgement.status === 'unmatched') {
    summary.failed += 1
    issue = `${result.orderNumber}: 품목코드 매칭 실패`
  } else if (acknowledgement.status === 'already_set') {
    summary.alreadySet += 1
  }

  if (issue) summary.recentIssues = [issue, ...summary.recentIssues].slice(0, 6)
  run.summary = summary
}

function updateCheckpoint(run, result, acknowledgement) {
  if (!checkpointCache || checkpointCache.queueId !== run.queueId) return
  checkpointCache.nextIndex = run.index + 1
  checkpointCache.summary = normalizeSummary(run.summary)
  removeReportEntry(checkpointCache, result.orderNumber)

  if (!acknowledgement.ok || acknowledgement.status === 'unmatched') {
    checkpointCache.failed.push({
      orderNumber: result.orderNumber,
      message: acknowledgement.message || '품목코드 매칭 또는 저장 실패',
    })
  } else if (acknowledgement.status === 'not_found') {
    checkpointCache.notFound.push({
      orderNumber: result.orderNumber,
      message: result.message || '상품 링크 미발견',
    })
  } else if (acknowledgement.status === 'ambiguous') {
    checkpointCache.ambiguous.push({
      orderNumber: result.orderNumber,
      candidates: result.candidates.map((candidate) => candidate.url),
    })
  }
}

function removeReportEntry(checkpoint, orderNumber) {
  checkpoint.notFound = checkpoint.notFound.filter((item) => item.orderNumber !== orderNumber)
  checkpoint.ambiguous = checkpoint.ambiguous.filter((item) => item.orderNumber !== orderNumber)
  checkpoint.failed = checkpoint.failed.filter((item) => item.orderNumber !== orderNumber)
}

function emptySummary() {
  return {
    processed: 0,
    updated: 0,
    alreadySet: 0,
    review: 0,
    notFound: 0,
    failed: 0,
    recentIssues: [],
  }
}

function normalizeSummary(value) {
  const summary = value && typeof value === 'object' ? value : {}
  return {
    processed: Math.max(0, Number(summary.processed) || 0),
    updated: Math.max(0, Number(summary.updated) || 0),
    alreadySet: Math.max(0, Number(summary.alreadySet) || 0),
    review: Math.max(0, Number(summary.review) || 0),
    notFound: Math.max(0, Number(summary.notFound) || 0),
    failed: Math.max(0, Number(summary.failed) || 0),
    recentIssues: Array.isArray(summary.recentIssues)
      ? summary.recentIssues.filter((item) => typeof item === 'string').slice(0, 6)
      : [],
  }
}

function orderUrl(orderNumber) {
  const url = new URL(ORDER_LIST_URL)
  url.searchParams.set('word', orderNumber)
  url.searchParams.set('page', '1')
  url.searchParams.set('pageSize', '10')
  return url.toString()
}

function canonicalOfferUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const decoded = safeDecodeURIComponent(value.trim()).replace(/\\\//g, '/')
    const url = new URL(decoded.startsWith('//') ? `https:${decoded}` : decoded)
    if (!['http:', 'https:'].includes(url.protocol) || url.hostname !== 'detail.1688.com') return null
    const match = url.pathname.match(/^\/offer\/(\d{6,30})\.html\/?$/i)
    return match ? `https://detail.1688.com/offer/${match[1]}.html` : null
  } catch {
    return null
  }
}

function uniqueCandidateUrls(values) {
  const candidates = new Map()
  for (const value of values) {
    const raw = typeof value === 'string' ? value : value?.url
    const url = canonicalOfferUrl(raw)
    if (!url || candidates.has(url)) continue
    candidates.set(url, {
      url,
      title: typeof value === 'object' && typeof value?.title === 'string'
        ? value.title.slice(0, 1_000)
        : null,
    })
  }
  return Array.from(candidates.values())
}

function uniqueDetailImageUrls(values) {
  if (!Array.isArray(values)) return []
  const images = new Set()
  for (const value of values) {
    if (typeof value !== 'string' || images.size >= 30) continue
    try {
      const url = new URL(value.startsWith('//') ? `https:${value}` : value)
      if (!['http:', 'https:'].includes(url.protocol)) continue
      if (!/alicdn|1688|taobaocdn/i.test(url.hostname)) continue
      images.add(url.toString())
    } catch {
      // Ignore malformed image URLs returned by the product page.
    }
  }
  return Array.from(images)
}

function uniqueOrders(value) {
  if (!Array.isArray(value)) return []
  const orders = new Map()
  for (const item of value) {
    const orderNumber = String(item?.orderNumber || '').trim()
    if (!/^\d{10,40}$/.test(orderNumber)) continue
    const existing = orders.get(orderNumber) || { orderNumber, items: [] }
    const skuSet = new Set(existing.items.map((entry) => entry.sku))
    for (const candidate of Array.isArray(item?.items) ? item.items : []) {
      const sku = String(candidate?.sku || '').trim()
      if (!sku || sku.length > 100 || skuSet.has(sku) || existing.items.length >= 200) continue
      skuSet.add(sku)
      existing.items.push({ sku })
    }
    orders.set(orderNumber, existing)
    if (orders.size >= MAX_ORDERS) break
  }
  return Array.from(orders.values())
}

function queueFingerprint(orders) {
  let hash = 2166136261
  for (const order of orders) {
    const value = `${order.orderNumber}:${order.items.map((item) => item.sku).join(',')}|`
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index)
      hash = Math.imul(hash, 16777619)
    }
  }
  return `queue-${orders.length}-${(hash >>> 0).toString(16)}`
}

function isSaasUrl(value) {
  if (!value) return false
  try {
    const url = new URL(value)
    return url.origin === 'https://funtastic-saas-vercel.vercel.app'
      || url.origin === 'http://localhost:3000'
      || url.origin === 'http://localhost:3001'
  } catch {
    return false
  }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

async function startVerificationRun(message, sourceTabId) {
  const links = uniqueVerificationLinks(message.links)
  if (!message.runId || links.length === 0) {
    return { ok: false, error: '검증할 구매 URL이 없습니다.' }
  }

  const previous = await getVerificationRun()
  if (previous) await clearVerificationRun(previous, true)

  const queueId = verificationQueueFingerprint(links)
  const previousCheckpoint = await getVerificationCheckpoint()
  const canResume = previousCheckpoint?.queueId === queueId
    && previousCheckpoint.total === links.length
    && previousCheckpoint.nextIndex > 0
    && previousCheckpoint.nextIndex < links.length
  const checkpoint = canResume
    ? normalizeVerificationCheckpoint(previousCheckpoint, queueId, links.length)
    : createVerificationCheckpoint(queueId, links.length)
  verificationCheckpointCache = checkpoint
  await saveVerificationCheckpoint(true)

  const index = canResume ? checkpoint.nextIndex : 0
  const collectorTab = await chrome.tabs.create({ url: links[index].url, active: true })
  if (!collectorTab.id) throw new Error('1688 URL 검증 탭을 열지 못했습니다.')

  const run = {
    runId: String(message.runId),
    queueId,
    sourceTabId,
    collectorTabId: collectorTab.id,
    links,
    index,
    status: 'running',
    startedAt: checkpoint.startedAt,
    summary: normalizeVerificationSummary(checkpoint.summary),
    pendingResult: null,
  }
  await setVerificationQueue(links)
  await setVerificationRun(run)
  await scheduleVerificationTimeout()
  await sendToSaas(run, {
    type: 'FUNTASTIC_1688_VERIFY_ACK',
    total: links.length,
    resumedFrom: index,
    summary: run.summary,
  })
  return { ok: true, total: links.length, resumedFrom: index }
}

async function queueVerificationResult(run, result) {
  await chrome.alarms.clear(VERIFY_TIMEOUT_ALARM)
  const current = run.links[run.index]
  if (!current || current.url !== result.url) return

  run.pendingResult = {
    ...result,
    saveAttempts: 1,
  }
  await setVerificationRun(run)
  await scheduleVerificationSaveTimeout()
  try {
    await sendPendingVerificationResult(run)
  } catch {
    await failVerificationRun(run, 'SaaS 화면에 URL 검증 결과를 전달하지 못했습니다. 다시 시작하면 이어서 진행합니다.', false)
  }
}

async function completeCurrentVerification(run, acknowledgement) {
  await chrome.alarms.clear(VERIFY_SAVE_TIMEOUT_ALARM)
  const pendingResult = run.pendingResult
  if (!pendingResult) return

  updateVerificationSummary(run, pendingResult, acknowledgement)
  updateVerificationCheckpoint(run)
  run.index += 1
  run.pendingResult = null

  if (run.index >= run.links.length) {
    if (verificationCheckpointCache) verificationCheckpointCache.completedAt = new Date().toISOString()
    await saveVerificationCheckpoint(true)
    await sendToSaas(run, {
      type: 'FUNTASTIC_1688_VERIFY_COMPLETE',
      total: run.links.length,
      summary: run.summary,
    }).catch(() => {})
    await clearVerificationRun(run, true)
    await chrome.tabs.update(run.sourceTabId, { active: true }).catch(() => {})
    return
  }

  await setVerificationRun(run)
  await saveVerificationCheckpoint(true)
  await chrome.alarms.create(VERIFY_NEXT_ALARM, { when: Date.now() + VERIFY_DELAY_MS })
}

async function navigateToCurrentVerification() {
  const run = await getVerificationRun()
  if (!run || run.status !== 'running' || run.pendingResult) return
  const current = run.links[run.index]
  if (!current) return

  try {
    await chrome.tabs.update(run.collectorTabId, { url: current.url })
    await scheduleVerificationTimeout()
  } catch {
    await failVerificationRun(run, '1688 URL 검증 탭을 다시 열지 못했습니다.', false)
  }
}

async function handleVerificationPageTimeout() {
  const run = await getVerificationRun()
  if (!run || run.status !== 'running' || verificationResultInFlight || run.pendingResult) return
  const current = run.links[run.index]
  if (!current) return

  verificationResultInFlight = true
  try {
    await queueVerificationResult(run, {
      url: current.url,
      items: current.items,
      status: 'unknown',
      message: '1688 페이지 응답 시간 초과',
    })
  } finally {
    verificationResultInFlight = false
  }
}

async function handleVerificationSaveTimeout() {
  const run = await getVerificationRun()
  if (!run?.pendingResult) return
  if (run.pendingResult.saveAttempts >= 3) {
    await failVerificationRun(run, 'SaaS 저장 응답이 없어 URL 검증을 멈췄습니다. 다시 시작하면 이어서 진행합니다.', false)
    return
  }

  run.pendingResult.saveAttempts += 1
  await setVerificationRun(run)
  await scheduleVerificationSaveTimeout()
  try {
    await sendPendingVerificationResult(run)
  } catch {
    await failVerificationRun(run, 'SaaS 화면과 연결이 끊겼습니다. 다시 시작하면 이어서 진행합니다.', false)
  }
}

async function sendPendingVerificationResult(run) {
  if (!run.pendingResult) return
  await sendToSaas(run, {
    type: 'FUNTASTIC_1688_VERIFY_RESULT',
    url: run.pendingResult.url,
    items: run.pendingResult.items,
    status: run.pendingResult.status,
    message: run.pendingResult.message,
  })
}

async function resendPendingVerificationResult() {
  const run = await getVerificationRun()
  if (!run?.pendingResult) return
  await sendPendingVerificationResult(run).catch(() => {})
}

async function cancelVerificationRun(run) {
  await syncVerificationCheckpointFromRun(run)
  await saveVerificationCheckpoint(true)
  await sendToSaas(run, { type: 'FUNTASTIC_1688_VERIFY_CANCELLED' }).catch(() => {})
  await clearVerificationRun(run, true)
  await chrome.tabs.update(run.sourceTabId, { active: true }).catch(() => {})
}

async function failVerificationRun(run, message, keepCollectorTab) {
  await syncVerificationCheckpointFromRun(run)
  await saveVerificationCheckpoint(true)
  await sendToSaas(run, { type: 'FUNTASTIC_1688_VERIFY_ERROR', message }).catch(() => {})
  await clearVerificationRun(run, !keepCollectorTab)
  if (!keepCollectorTab) {
    await chrome.tabs.update(run.sourceTabId, { active: true }).catch(() => {})
  }
}

async function clearVerificationRun(run, closeCollectorTab) {
  await Promise.all([
    chrome.alarms.clear(VERIFY_NEXT_ALARM),
    chrome.alarms.clear(VERIFY_TIMEOUT_ALARM),
    chrome.alarms.clear(VERIFY_SAVE_TIMEOUT_ALARM),
    chrome.storage.session.remove([VERIFY_STATE_KEY, VERIFY_QUEUE_KEY]),
  ])
  if (closeCollectorTab && run.collectorTabId) {
    await chrome.tabs.remove(run.collectorTabId).catch(() => {})
  }
}

async function scheduleVerificationTimeout() {
  await chrome.alarms.clear(VERIFY_TIMEOUT_ALARM)
  await chrome.alarms.create(VERIFY_TIMEOUT_ALARM, { when: Date.now() + VERIFY_PAGE_TIMEOUT_MS })
}

async function scheduleVerificationSaveTimeout() {
  await chrome.alarms.clear(VERIFY_SAVE_TIMEOUT_ALARM)
  await chrome.alarms.create(VERIFY_SAVE_TIMEOUT_ALARM, { when: Date.now() + VERIFY_SAVE_TIMEOUT_MS })
}

async function getVerificationRun() {
  const stored = await chrome.storage.session.get([VERIFY_STATE_KEY, VERIFY_QUEUE_KEY])
  const state = stored[VERIFY_STATE_KEY]
  const links = stored[VERIFY_QUEUE_KEY]
  return state && Array.isArray(links) ? { ...state, links } : null
}

async function setVerificationRun(run) {
  const { links: _links, ...state } = run
  await chrome.storage.session.set({ [VERIFY_STATE_KEY]: state })
}

async function setVerificationQueue(links) {
  await chrome.storage.session.set({ [VERIFY_QUEUE_KEY]: links })
}

async function getVerificationCheckpoint() {
  if (verificationCheckpointCache) return verificationCheckpointCache
  const stored = await chrome.storage.local.get(VERIFY_CHECKPOINT_KEY)
  verificationCheckpointCache = stored[VERIFY_CHECKPOINT_KEY] || null
  return verificationCheckpointCache
}

async function saveVerificationCheckpoint(force) {
  if (!verificationCheckpointCache || !force) return
  verificationCheckpointCache.updatedAt = new Date().toISOString()
  await chrome.storage.local.set({ [VERIFY_CHECKPOINT_KEY]: verificationCheckpointCache })
}

async function syncVerificationCheckpointFromRun(run) {
  const checkpoint = await getVerificationCheckpoint()
  if (!checkpoint || checkpoint.queueId !== run.queueId) return
  checkpoint.nextIndex = run.index
  checkpoint.summary = normalizeVerificationSummary(run.summary)
}

function createVerificationCheckpoint(queueId, total) {
  const now = new Date().toISOString()
  return {
    version: 1,
    queueId,
    total,
    nextIndex: 0,
    summary: emptyVerificationSummary(),
    startedAt: now,
    updatedAt: now,
    completedAt: null,
  }
}

function normalizeVerificationCheckpoint(value, queueId, total) {
  return {
    version: 1,
    queueId,
    total,
    nextIndex: Math.min(Math.max(Number(value.nextIndex) || 0, 0), total),
    summary: normalizeVerificationSummary(value.summary),
    startedAt: typeof value.startedAt === 'string' ? value.startedAt : new Date().toISOString(),
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString(),
    completedAt: typeof value.completedAt === 'string' ? value.completedAt : null,
  }
}

function verificationCheckpointStatus(checkpoint) {
  return {
    queueId: checkpoint.queueId,
    total: checkpoint.total,
    nextIndex: checkpoint.nextIndex,
    summary: normalizeVerificationSummary(checkpoint.summary),
    completedAt: checkpoint.completedAt,
  }
}

function updateVerificationSummary(run, result, acknowledgement) {
  const summary = normalizeVerificationSummary(run.summary)
  summary.processed = run.index + 1
  if (result.status === 'open') summary.open += 1
  if (result.status === 'unavailable') {
    summary.unavailable += 1
    summary.recentIssues = [
      `[상품 없음] ${verificationItemLabel(result.items)}: ${result.message || '1688에서 상품 없음 또는 판매중지로 표시됩니다.'}`,
      ...summary.recentIssues,
    ].slice(0, VERIFICATION_ISSUE_LIMIT)
  }
  if (result.status === 'unknown') {
    summary.unknown += 1
    summary.recentIssues = [
      `[확인 필요] ${verificationItemLabel(result.items)}: ${result.message || '정상 열림 여부 확인 필요'}`,
      ...summary.recentIssues,
    ].slice(0, VERIFICATION_ISSUE_LIMIT)
  }
  run.summary = summary
}

function verificationItemLabel(items) {
  const labels = items
    .slice(0, 4)
    .map((item) => `${item.productName || '품목'} (${item.sku})`)
  return labels.length > 0 ? labels.join(', ') : '품목'
}

function updateVerificationCheckpoint(run) {
  if (!verificationCheckpointCache || verificationCheckpointCache.queueId !== run.queueId) return
  verificationCheckpointCache.nextIndex = run.index + 1
  verificationCheckpointCache.summary = normalizeVerificationSummary(run.summary)
}

function emptyVerificationSummary() {
  return {
    processed: 0,
    open: 0,
    unavailable: 0,
    unknown: 0,
    recentIssues: [],
  }
}

function normalizeVerificationSummary(value) {
  const summary = value && typeof value === 'object' ? value : {}
  return {
    processed: Math.max(0, Number(summary.processed) || 0),
    open: Math.max(0, Number(summary.open) || 0),
    unavailable: Math.max(0, Number(summary.unavailable) || 0),
    unknown: Math.max(0, Number(summary.unknown) || 0),
    recentIssues: Array.isArray(summary.recentIssues)
      ? summary.recentIssues.filter((item) => typeof item === 'string').slice(0, VERIFICATION_ISSUE_LIMIT)
      : [],
  }
}

function uniqueVerificationLinks(value) {
  if (!Array.isArray(value)) return []
  const links = new Map()
  for (const item of value) {
    const url = canonicalOfferUrl(item?.url)
    if (!url) continue
    const existing = links.get(url) || { url, items: [] }
    const itemSkus = new Set(existing.items.map((entry) => entry.sku))
    for (const sourceItem of Array.isArray(item?.items) ? item.items : []) {
      const sku = String(sourceItem?.sku || '').trim()
      const productName = String(sourceItem?.productName || '').trim()
      if (!sku || sku.length > 100 || itemSkus.has(sku) || existing.items.length >= 200) continue
      itemSkus.add(sku)
      existing.items.push({ sku, productName: productName.slice(0, 500) })
    }
    links.set(url, existing)
    if (links.size >= MAX_VERIFY_LINKS) break
  }
  return Array.from(links.values())
    .map((link) => ({
      ...link,
      items: link.items.sort((left, right) => left.sku.localeCompare(right.sku)),
    }))
    .sort((left, right) => left.url.localeCompare(right.url))
}

function verificationQueueFingerprint(links) {
  let hash = 2166136261
  for (const link of links) {
    const value = `${link.url}:${link.items.map((item) => item.sku).join(',')}|`
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index)
      hash = Math.imul(hash, 16777619)
    }
  }
  return `verify-${links.length}-${(hash >>> 0).toString(16)}`
}
