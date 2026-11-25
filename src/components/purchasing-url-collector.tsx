'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Link2,
  LoaderCircle,
  Square,
} from 'lucide-react'
import { toast } from 'sonner'

const PAGE_SOURCE = 'funtastic-saas'
const EXTENSION_SOURCE = 'funtastic-1688-extension'
const SHOW_COLLECTION_CONTROLS = false

type QueueResponse = {
  orders: Array<{
    orderNumber: string
    items?: Array<{ sku: string }>
  }>
  totalItems: number
  skippedInvalid: number
  hasMore: boolean
  error?: string
}

type VerificationQueueResponse = {
  links: Array<{
    url: string
    items: Array<{ sku: string; productName: string }>
  }>
  totalItems: number
  skippedInvalid: number
  hasMore: boolean
  nextCursor?: string | null
  totalLinks?: number
  counts?: VerificationCounts
  error?: string
}

type VerificationMode = 'due' | 'issues' | 'all'
type VerificationCounts = Record<VerificationMode, number>
type VerificationBatch = {
  runId: string
  links: VerificationQueueResponse['links']
  nextCursor: string | null
  hasMore: boolean
  progress: VerificationProgress
  savedUrls: string[]
  acknowledgedAt?: Record<string, number>
  startedAt?: number
  acknowledged?: boolean
}
type VerificationSession = {
  version: 1
  mode: VerificationMode
  total: number
  cursor: string | null
  completed: VerificationProgress
  batch: VerificationBatch | null
  phase: 'running' | 'awaitingIdle' | 'paused' | 'loading'
  previousRunId?: string | null
}

type Candidate = {
  url: string
  title?: string | null
}

type CollectorMessage = {
  source: typeof EXTENSION_SOURCE
  type: string
  runId?: string
  total?: number
  orderNumber?: string
  url?: string
  status?: VerificationStatus
  mode?: 'collection' | 'verification'
  items?: Array<{ sku: string; productName?: string }>
  candidates?: Candidate[]
  message?: string
  running?: boolean
  index?: number
  summary?: CollectorSummary & VerificationSummary
  checkpoint?: {
    total: number
    nextIndex: number
    summary?: CollectorSummary
    completedAt?: string | null
  } | null
  verificationCheckpoint?: {
    total: number
    nextIndex: number
    summary?: VerificationSummary
    completedAt?: string | null
  } | null
}

type CollectorSummary = Partial<Pick<Progress, 'processed' | 'updated' | 'review' | 'notFound' | 'failed'>> & {
  recentIssues?: string[]
}

type SaveResponse = {
  status: 'updated' | 'ambiguous' | 'not_found' | 'already_set' | 'unmatched'
  orderNumber: string
  updated?: Array<{ sku: string; productName: string; url: string }>
  error?: string
}

type Progress = {
  total: number
  processed: number
  updated: number
  review: number
  notFound: number
  failed: number
  message: string
  issues: string[]
}

type VerificationStatus = 'open' | 'unavailable' | 'unknown'

type VerificationProgress = {
  total: number
  processed: number
  open: number
  unavailable: number
  unknown: number
  message: string
  issues: string[]
}

type VerificationSummary = Partial<Pick<VerificationProgress, 'processed' | 'open' | 'unavailable' | 'unknown'>> & {
  recentIssues?: string[]
}

const EMPTY_PROGRESS: Progress = {
  total: 0,
  processed: 0,
  updated: 0,
  review: 0,
  notFound: 0,
  failed: 0,
  message: '',
  issues: [],
}

const EMPTY_VERIFICATION_PROGRESS: VerificationProgress = {
  total: 0,
  processed: 0,
  open: 0,
  unavailable: 0,
  unknown: 0,
  message: '',
  issues: [],
}

const VERIFICATION_ISSUE_LIMIT = 100
const VERIFICATION_BATCH_SIZE = 200
const VERIFICATION_SESSION_KEY = 'funtastic1688VerificationSessionV1'

function readVerificationSession(): VerificationSession | null {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(VERIFICATION_SESSION_KEY) ?? 'null')
    if (!value || value.version !== 1 || !['due', 'issues', 'all'].includes(value.mode)
      || !['running', 'awaitingIdle', 'paused', 'loading'].includes(value.phase)
      || !Number.isFinite(value.total) || !value.completed
      || (value.cursor !== null && typeof value.cursor !== 'string')) return null
    if (value.batch && (typeof value.batch.runId !== 'string' || !Array.isArray(value.batch.links)
      || value.batch.links.length > VERIFICATION_BATCH_SIZE || !value.batch.progress || !Array.isArray(value.batch.savedUrls))) return null
    return value as VerificationSession
  } catch { return null }
}

function storeVerificationSession(session: VerificationSession | null) {
  try {
    if (session) window.sessionStorage.setItem(VERIFICATION_SESSION_KEY, JSON.stringify(session))
    else window.sessionStorage.removeItem(VERIFICATION_SESSION_KEY)
  } catch { /* A blocked browser store must not discard a saved verification result. */ }
}

function combinedVerificationProgress(session: VerificationSession, detail?: string): VerificationProgress {
  const batch = session.batch?.progress ?? EMPTY_VERIFICATION_PROGRESS
  return {
    total: session.total,
    processed: session.completed.processed + batch.processed,
    open: session.completed.open + batch.open,
    unavailable: session.completed.unavailable + batch.unavailable,
    unknown: session.completed.unknown + batch.unknown,
    message: detail ?? batch.message,
    issues: [...batch.issues, ...session.completed.issues].slice(0, VERIFICATION_ISSUE_LIMIT),
  }
}

export function PurchasingUrlCollector({ onUrlsChanged }: { onUrlsChanged?: () => void } = {}) {
  const router = useRouter()
  const [extensionReady, setExtensionReady] = useState(false)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<Progress>(EMPTY_PROGRESS)
  const [verificationRunning, setVerificationRunning] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [verificationProgress, setVerificationProgress] = useState<VerificationProgress>(EMPTY_VERIFICATION_PROGRESS)
  const [verificationCounts, setVerificationCounts] = useState<VerificationCounts | null>(null)
  const [resumeAvailable, setResumeAvailable] = useState(false)
  const [legacyVerification, setLegacyVerification] = useState(false)
  const verificationMenuRef = useRef<HTMLDetailsElement | null>(null)
  const runIdRef = useRef<string | null>(null)
  const verificationRunIdRef = useRef<string | null>(null)
  const pendingSavesRef = useRef(0)
  const extensionFinishedRef = useRef(false)
  const finalizedRef = useRef(false)
  const verificationUrlChangedRef = useRef(false)
  const cancelledVerificationRunIdRef = useRef<string | null>(null)
  const verificationSessionRef = useRef<VerificationSession | null>(null)
  const verificationActiveRef = useRef(false)
  const verificationFetchIdRef = useRef(0)
  const verificationIdleCountRef = useRef(0)
  const verificationIdleAtRef = useRef(0)
  const verificationSavesRef = useRef(new Map<string, Promise<void>>())
  const legacySavedResultsRef = useRef(new Set<string>())
  const verificationAcksRef = useRef(new Map<string, number>())
  const verificationFetchBusyRef = useRef(false)
  const verificationOperationRef = useRef(0)
  const verificationCheckpointRef = useRef<CollectorMessage['verificationCheckpoint']>(null)

  useEffect(() => {
    const closeOutsideMenu = (event: PointerEvent) => {
      const menu = verificationMenuRef.current
      if (menu?.open && event.target instanceof Node && !menu.contains(event.target)) menu.open = false
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      const menu = verificationMenuRef.current
      if (event.key === 'Escape' && menu?.open) {
        menu.open = false
        menu.querySelector('summary')?.focus()
      }
    }
    document.addEventListener('pointerdown', closeOutsideMenu)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutsideMenu)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [])

  const closeVerificationMenu = () => {
    if (verificationMenuRef.current) verificationMenuRef.current.open = false
  }

  const refreshVerificationCounts = useCallback(async () => {
    try {
      const response = await fetch('/api/purchasing/purchase-url-verification?mode=due&limit=1', { cache: 'no-store' })
      const body = await response.json() as VerificationQueueResponse
      if (response.ok && body.counts) setVerificationCounts(body.counts)
    } catch { /* Counts are refreshed again when a verification starts. */ }
  }, [])

  const persistVerificationSession = useCallback((session: VerificationSession | null) => {
    verificationSessionRef.current = session
    storeVerificationSession(session)
    setResumeAvailable(Boolean(session && session.phase === 'paused'))
  }, [])

  const finalizeVerification = useCallback(() => {
    verificationActiveRef.current = false
    verificationOperationRef.current += 1
    verificationFetchBusyRef.current = false
    cancelledVerificationRunIdRef.current = verificationRunIdRef.current
    verificationRunIdRef.current = null
    persistVerificationSession(null)
    setVerificationRunning(false)
    setLegacyVerification(false)
    setVerificationProgress(EMPTY_VERIFICATION_PROGRESS)
    if (verificationUrlChangedRef.current) {
      verificationUrlChangedRef.current = false
      router.refresh()
      onUrlsChanged?.()
    }
    toast.success('1688 구매 URL 검증을 완료했습니다.')
    void refreshVerificationCounts()
  }, [router, onUrlsChanged, persistVerificationSession, refreshVerificationCounts])

  const pauseVerification = useCallback((detail: string) => {
    verificationActiveRef.current = false
    verificationOperationRef.current += 1
    verificationFetchBusyRef.current = false
    verificationFetchIdRef.current += 1
    const session = verificationSessionRef.current
    if (session) persistVerificationSession({ ...session, phase: 'paused' })
    cancelledVerificationRunIdRef.current = verificationRunIdRef.current ?? cancelledVerificationRunIdRef.current
    verificationRunIdRef.current = null
    setVerificationRunning(false)
    setVerificationProgress(current => ({ ...current, message: detail }))
    void refreshVerificationCounts()
  }, [persistVerificationSession, refreshVerificationCounts])

  const launchVerificationBatch = useCallback(async () => {
    const session = verificationSessionRef.current
    if (!session || !verificationActiveRef.current) return
    const fetchId = ++verificationFetchIdRef.current
    verificationFetchBusyRef.current = true
    persistVerificationSession({ ...session, phase: 'loading' })
    const query = new URLSearchParams({ mode: session.mode, limit: String(VERIFICATION_BATCH_SIZE) })
    if (session.cursor) query.set('cursor', session.cursor)
    let response: Response
    try { response = await fetch(`/api/purchasing/purchase-url-verification?${query}`, { cache: 'no-store' }) }
    catch (error) {
      if (fetchId !== verificationFetchIdRef.current || !verificationActiveRef.current) return
      throw error
    }
    finally { if (fetchId === verificationFetchIdRef.current) verificationFetchBusyRef.current = false }
    let body = await response.json() as VerificationQueueResponse
    if (fetchId !== verificationFetchIdRef.current || !verificationActiveRef.current) return
    if (!response.ok) throw new Error(body.error ?? '구매 URL 검증 목록을 불러오지 못했습니다.')
    const checkpoint = verificationCheckpointRef.current
    // An unrelated old partial queue with the same fingerprint must not make a
    // fresh full run silently skip its first URLs. A different first batch size
    // resets that legacy checkpoint; its omitted tail remains in the next page.
    if (!session.total && !session.cursor && checkpoint && checkpoint.nextIndex > 0
      && checkpoint.nextIndex < checkpoint.total && body.links.length === checkpoint.total) {
      query.set('limit', String(body.links.length - 1))
      verificationFetchBusyRef.current = true
      try {
        response = await fetch(`/api/purchasing/purchase-url-verification?${query}`, { cache: 'no-store' })
        body = await response.json() as VerificationQueueResponse
      } catch (error) {
        if (fetchId !== verificationFetchIdRef.current || !verificationActiveRef.current) return
        throw error
      } finally { if (fetchId === verificationFetchIdRef.current) verificationFetchBusyRef.current = false }
      if (fetchId !== verificationFetchIdRef.current || !verificationActiveRef.current) return
      if (!response.ok) throw new Error(body.error ?? '구매 URL 검증 목록을 불러오지 못했습니다.')
    }
    if (body.counts) setVerificationCounts(body.counts)
    if (!body.links.length) {
      if (session.completed.processed) finalizeVerification()
      else {
        pauseVerification('현재 검증할 구매 URL이 없습니다.')
        persistVerificationSession(null)
        toast.info('현재 검증할 구매 URL이 없습니다.')
      }
      return
    }
    const runId = crypto.randomUUID()
    const total = session.total || body.totalLinks || body.links.length
    const batch: VerificationBatch = {
      runId, links: body.links, nextCursor: body.nextCursor ?? body.links.at(-1)?.url ?? null,
      hasMore: body.hasMore,
      progress: { ...EMPTY_VERIFICATION_PROGRESS,
        total: body.links.length,
        message: `${total.toLocaleString('ko-KR')}개 링크를 순서대로 검증합니다.`,
        issues: body.skippedInvalid > 0
          ? [`1688 상품 주소 형식이 맞지 않는 URL ${body.skippedInvalid.toLocaleString('ko-KR')}개는 제외했습니다.`] : [],
      },
      savedUrls: [],
      acknowledgedAt: {}, startedAt: Date.now(), acknowledged: false,
    }
    const next = { ...session, total, batch, phase: 'running' as const }
    persistVerificationSession(next)
    verificationRunIdRef.current = runId
    cancelledVerificationRunIdRef.current = null
    verificationIdleCountRef.current = 0
    setVerificationProgress(combinedVerificationProgress(next))
    window.postMessage({ source: PAGE_SOURCE, type: 'FUNTASTIC_1688_VERIFY_START', runId, links: batch.links }, window.location.origin)
  }, [finalizeVerification, pauseVerification, persistVerificationSession])

  const completeVerificationBatch = useCallback((message: CollectorMessage) => {
    const session = verificationSessionRef.current
    const batch = session?.batch
    if (!session || !batch || batch.runId !== message.runId || session.phase !== 'running') return
    const progress = batch.progress
    const finished: VerificationProgress = {
      ...progress,
      processed: batch.links.length,
      open: Math.max(progress.open, message.summary?.open ?? 0),
      unavailable: Math.max(progress.unavailable, message.summary?.unavailable ?? 0),
      unknown: Math.max(progress.unknown, message.summary?.unknown ?? 0),
    }
    const completed = combinedVerificationProgress({ ...session, batch: { ...batch, progress: finished } }, '다음 검증 목록을 준비하고 있습니다.')
    if (!batch.hasMore) { finalizeVerification(); return }
    if (!batch.nextCursor || batch.nextCursor === session.cursor) {
      pauseVerification('다음 검증 목록의 위치를 확인하지 못했습니다. 다시 시작해주세요.')
      return
    }
    const next: VerificationSession = { ...session, cursor: batch.nextCursor, batch: null, completed,
      phase: 'awaitingIdle', previousRunId: batch.runId }
    persistVerificationSession(next)
    verificationRunIdRef.current = null
    verificationIdleCountRef.current = 0
    verificationIdleAtRef.current = 0
    setVerificationProgress(completed)
    // Extension 1.14 sends COMPLETE before clearing its shared run/alarms.
    // Wait for two separately polled idle observations before starting again.
    window.postMessage({ source: PAGE_SOURCE, type: 'FUNTASTIC_1688_PING' }, window.location.origin)
  }, [finalizeVerification, pauseVerification, persistVerificationSession])

  const finalizeRun = useCallback(() => {
    if (
      finalizedRef.current
      || !extensionFinishedRef.current
      || pendingSavesRef.current > 0
    ) return

    finalizedRef.current = true
    setRunning(false)
    setProgress((current) => ({
      ...current,
      message: '1688 구매 URL 수집이 완료되었습니다.',
    }))
    router.refresh()
    toast.success('1688 구매 URL 수집을 완료했습니다.')
  }, [router])

  const saveResult = useCallback(async (message: CollectorMessage) => {
    if (!message.orderNumber) return
    pendingSavesRef.current += 1
    let acknowledgement: {
      ok: boolean
      status?: SaveResponse['status']
      updatedCount?: number
      message?: string
    } = { ok: false, message: '구매 URL 저장에 실패했습니다.' }

    try {
      const response = await fetch('/api/purchasing/purchase-urls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderNumber: message.orderNumber,
          skus: Array.from(new Set((message.items ?? []).map((item) => item.sku))),
          candidates: message.candidates ?? [],
        }),
      })
      const body = await response.json() as SaveResponse
      if (!response.ok) throw new Error(body.error ?? '구매 URL 저장에 실패했습니다.')
      acknowledgement = {
        ok: true,
        status: body.status,
        updatedCount: body.updated?.length ?? 0,
      }

      setProgress((current) => {
        const issues = [...current.issues]
        let updated = current.updated
        let review = current.review
        let notFound = current.notFound
        let failed = current.failed

        if (body.status === 'updated') updated += body.updated?.length ?? 0
        if (body.status === 'ambiguous') {
          review += 1
          issues.unshift(`${body.orderNumber}: 상품 링크가 여러 개라 확인이 필요합니다.`)
        }
        if (body.status === 'not_found') {
          notFound += 1
          issues.unshift(`${body.orderNumber}: ${message.message?.trim() || '1688 상품 링크를 찾지 못했습니다.'}`)
        }
        if (body.status === 'unmatched') {
          failed += 1
          issues.unshift(`${body.orderNumber}: SaaS 발주건과 다시 매칭하지 못했습니다.`)
        }

        return {
          ...current,
          processed: Math.min(current.total, current.processed + 1),
          updated,
          review,
          notFound,
          failed,
          message: `${body.orderNumber} 처리 완료`,
          issues: issues.slice(0, 6),
        }
      })
    } catch (error) {
      acknowledgement = {
        ok: false,
        message: error instanceof Error ? error.message : '저장 실패',
      }
      setProgress((current) => ({
        ...current,
        processed: Math.min(current.total, current.processed + 1),
        failed: current.failed + 1,
        message: `${message.orderNumber} 저장 실패`,
        issues: [
          `${message.orderNumber}: ${error instanceof Error ? error.message : '저장 실패'}`,
          ...current.issues,
        ].slice(0, 6),
      }))
    } finally {
      window.postMessage({
        source: PAGE_SOURCE,
        type: 'FUNTASTIC_1688_RESULT_SAVED',
        runId: message.runId,
        orderNumber: message.orderNumber,
        ...acknowledgement,
      }, window.location.origin)
      pendingSavesRef.current -= 1
      finalizeRun()
    }
  }, [finalizeRun])

  const acknowledgeVerificationResult = useCallback(async (message: CollectorMessage) => {
    if (!message.url || !message.status) return
    const key = `${message.runId}:${message.url}`
    const pending = verificationSavesRef.current.get(key)
    if (pending) return pending
    const session = verificationSessionRef.current
    const alreadySaved = session && session.batch && session.batch.runId === message.runId
      ? session.batch.savedUrls.includes(message.url) : legacySavedResultsRef.current.has(key)
    const acknowledgeSavedUrl = () => {
      const current = verificationSessionRef.current
      const batch = current && current.batch && current.batch.runId === message.runId ? current.batch : null
      const lastAckAt = batch?.acknowledgedAt?.[message.url!] ?? verificationAcksRef.current.get(key)
      const now = Date.now()
      if (lastAckAt !== undefined && now - lastAckAt < 5_000) return
      verificationAcksRef.current.set(key, now)
      if (batch && current) persistVerificationSession({ ...current, batch: {
        ...batch, acknowledgedAt: { ...batch.acknowledgedAt, [message.url!]: now },
      } })
      window.postMessage({ source: PAGE_SOURCE, type: 'FUNTASTIC_1688_VERIFY_RESULT_SAVED',
        runId: message.runId, url: message.url, ok: true }, window.location.origin)
    }
    // A reload may happen after durable saving but before the ACK. Replay that
    // ACK once in the restored page without re-posting or counting the result.
    if (alreadySaved) {
      acknowledgeSavedUrl()
      return
    }

    const save = (async () => {
    const items = message.items ?? []
    if (!items.length) throw new Error('검증한 URL의 품목 정보를 확인하지 못했습니다. 다시 시작해주세요.')
    let replaced = 0
    if (items.length > 0) {
      const response = await fetch('/api/purchasing/purchase-url-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: message.url,
          skus: items.map((item) => item.sku),
          status: message.status,
          reason: message.message ?? null,
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(body.error ?? 'URL 검증 기록을 저장하지 못했습니다.')
      }
      replaced = Number(body.replaced ?? 0) + (message.status === 'open' ? 0 : Number(body.updatedWorkflow ?? 0))
      if (message.status !== 'open' || body.updated > 0 || body.updatedWorkflow > 0 || replaced > 0) verificationUrlChangedRef.current = true
    }

    // A result that finished saving during cancellation stays in history, but
    // must not advance an old extension run or overwrite a new session.
    if (message.runId !== verificationRunIdRef.current || !verificationActiveRef.current) return
    const currentSession = verificationSessionRef.current
    const currentBatch = currentSession?.batch ?? null
    const updateProgress = (current: VerificationProgress): VerificationProgress => {
      const itemLabel = items
        .slice(0, 4)
        .map((item) => `${item.productName || '품목'} (${item.sku})`)
        .join(', ')
      const issues = [...current.issues]
      let open = current.open
      let unavailable = current.unavailable
      let unknown = current.unknown

      if (message.status === 'open') open += 1
      if (message.status === 'unavailable') {
        unavailable += 1
        issues.unshift(`[상품 없음] ${itemLabel || message.url}: 1688 상품 없음 또는 판매중지`)
      }
      if (message.status === 'unknown') {
        unknown += 1
        issues.unshift(`[확인 필요] ${itemLabel || message.url}: ${message.message || '정상 열림 여부 확인 필요'}`)
      }
      if (replaced > 0) issues.unshift(`[발주 URL로 갱신] ${itemLabel}: ${replaced}건 반영`)

      return {
        ...current,
        processed: Math.min(current.total, current.processed + 1),
        open,
        unavailable,
        unknown,
        message: itemLabel ? `${itemLabel} 검증 완료` : '구매 URL 검증 완료',
        issues: issues.slice(0, VERIFICATION_ISSUE_LIMIT),
      }
    }
    if (currentSession && currentBatch && currentBatch.runId === message.runId) {
      const next = { ...currentSession, batch: { ...currentBatch,
        savedUrls: [...currentBatch.savedUrls, message.url!], progress: updateProgress(currentBatch.progress) } }
      persistVerificationSession(next)
      setVerificationProgress(combinedVerificationProgress(next))
    } else {
      legacySavedResultsRef.current.add(key)
      setVerificationProgress(updateProgress)
    }

    acknowledgeSavedUrl()
    })()
    verificationSavesRef.current.set(key, save)
    try { await save }
    finally { verificationSavesRef.current.delete(key) }
  }, [persistVerificationSession])

  useEffect(() => {
    const restore = async () => {
      const session = readVerificationSession()
      if (session) {
        verificationSessionRef.current = session
        verificationRunIdRef.current = session.batch?.runId ?? null
        verificationActiveRef.current = session.phase !== 'paused'
        setResumeAvailable(session.phase === 'paused')
        setVerificationRunning(session.phase !== 'paused')
        setVerificationProgress(combinedVerificationProgress(session, session.phase === 'paused'
          ? '중단된 검증을 이어서 진행할 수 있습니다.' : '진행 중인 URL 검증에 다시 연결하고 있습니다.'))
      }
      await refreshVerificationCounts()
    }
    void restore()
  }, [refreshVerificationCounts])

  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>) => {
      if (event.source !== window || event.origin !== window.location.origin) return
      if (!isCollectorMessage(event.data)) return
      const message = event.data

      if (message.type === 'FUNTASTIC_1688_PONG') {
        setExtensionReady(true)
        verificationCheckpointRef.current = message.verificationCheckpoint ?? null
        const session = verificationSessionRef.current
        if (session?.phase === 'paused') return
        if (session) {
          if (session.phase === 'awaitingIdle' && !session.batch && message.running
            && message.runId === session.previousRunId) {
            verificationIdleCountRef.current = 0
            verificationIdleAtRef.current = 0
            return
          }
          if (message.mode === 'verification' && message.running && message.runId && session.batch
            && message.runId === session.batch.runId) {
            if (session.phase !== 'running') return
            verificationIdleCountRef.current = 0
            verificationActiveRef.current = true
            verificationRunIdRef.current = message.runId
            const batch = session.batch
            const old = batch.progress
            const next = { ...session, batch: { ...batch, acknowledged: true, progress: {
              ...old,
              processed: Math.max(old.processed, message.summary?.processed ?? message.index ?? 0),
              open: Math.max(old.open, message.summary?.open ?? 0),
              unavailable: Math.max(old.unavailable, message.summary?.unavailable ?? 0),
              unknown: Math.max(old.unknown, message.summary?.unknown ?? 0),
            } } }
            persistVerificationSession(next)
            setVerificationRunning(true)
            setVerificationProgress(combinedVerificationProgress(next, '진행 중인 URL 검증에 다시 연결했습니다.'))
            return
          }
          if (!message.running && verificationActiveRef.current) {
            if (verificationFetchBusyRef.current || (session.batch?.startedAt
              && !session.batch.acknowledged && Date.now() - session.batch.startedAt < 10_000)) return
            const now = Date.now()
            if (!verificationIdleAtRef.current || now - verificationIdleAtRef.current >= 4_000) {
              verificationIdleCountRef.current += 1
              verificationIdleAtRef.current = now
            }
            if (verificationIdleCountRef.current >= 2) {
              verificationIdleCountRef.current = 0
              if (session.batch) {
                if (session.batch.progress.processed >= session.batch.links.length) {
                  completeVerificationBatch({ source: EXTENSION_SOURCE, type: 'FUNTASTIC_1688_VERIFY_COMPLETE', runId: session.batch.runId })
                } else {
                  // The worker stopped during a reload. Reuse the exact batch
                  // so its existing extension checkpoint can resume.
                  const resumed = { ...session, phase: 'running' as const }
                  persistVerificationSession(resumed)
                  verificationRunIdRef.current = session.batch.runId
                  window.postMessage({ source: PAGE_SOURCE, type: 'FUNTASTIC_1688_VERIFY_START',
                    runId: session.batch.runId, links: session.batch.links }, window.location.origin)
                }
              } else if (session.phase === 'awaitingIdle' || session.phase === 'loading') {
                void launchVerificationBatch().catch(error => {
                  const detail = error instanceof Error ? error.message : '다음 검증 목록을 불러오지 못했습니다.'
                  pauseVerification(detail)
                  toast.error(detail)
                })
              }
            }
            return
          }
          if (message.running) {
            // A different/old worker must be stopped explicitly; never replace
            // it automatically with this page's remaining batch.
            pauseVerification('다른 URL 검증이 실행 중입니다. 기존 검증을 중단한 뒤 이어서 진행해주세요.')
          }
          return
        }
        if (message.mode === 'verification') {
          if (
            message.running
            && message.runId
            && message.runId !== cancelledVerificationRunIdRef.current
          ) {
            verificationRunIdRef.current = message.runId
            verificationActiveRef.current = true
            setVerificationRunning(true)
            setLegacyVerification(true)
            setVerificationProgress((current) => ({
              ...current,
              total: message.total ?? current.total,
              processed: message.summary?.processed ?? message.index ?? current.processed,
              open: message.summary?.open ?? current.open,
              unavailable: message.summary?.unavailable ?? current.unavailable,
              unknown: message.summary?.unknown ?? current.unknown,
              message: '진행 중인 1688 URL 검증에 다시 연결했습니다.',
              issues: message.summary?.recentIssues?.slice(0, VERIFICATION_ISSUE_LIMIT) ?? current.issues,
            }))
          }
          return
        }
        if (message.running && message.runId) {
          runIdRef.current = message.runId
          setRunning(true)
          setProgress((current) => ({
            ...current,
            total: message.total ?? current.total,
            processed: message.summary?.processed ?? message.index ?? current.processed,
            updated: message.summary?.updated ?? current.updated,
            review: message.summary?.review ?? current.review,
            notFound: message.summary?.notFound ?? current.notFound,
            failed: message.summary?.failed ?? current.failed,
            message: '진행 중인 1688 수집에 다시 연결했습니다.',
          }))
        } else if (message.checkpoint?.total) {
          const checkpoint = message.checkpoint
          const processed = Math.min(checkpoint.nextIndex, checkpoint.total)
          setRunning(false)
          setProgress({
            total: checkpoint.total,
            processed,
            updated: checkpoint.summary?.updated ?? 0,
            review: checkpoint.summary?.review ?? 0,
            notFound: checkpoint.summary?.notFound ?? 0,
            failed: checkpoint.summary?.failed ?? 0,
            message: checkpoint.completedAt
              ? '최근 1688 구매 URL 수집이 완료되었습니다.'
              : `최근 수집이 ${processed.toLocaleString('ko-KR')}건 처리 후 중단되었습니다. 다시 시작하면 이어집니다.`,
            issues: checkpoint.summary?.recentIssues?.slice(0, 6) ?? [],
          })
        }
        return
      }
      if (message.runId && message.runId === verificationRunIdRef.current) {
        if (message.type === 'FUNTASTIC_1688_VERIFY_ACK') {
          const session = verificationSessionRef.current
          if (session?.batch) persistVerificationSession({ ...session, batch: { ...session.batch, acknowledged: true } })
          setVerificationProgress((current) => ({
            ...current,
            total: verificationSessionRef.current?.total ?? message.total ?? current.total,
            message: '1688 구매 URL 검증을 시작했습니다.',
          }))
          return
        }
        if (message.type === 'FUNTASTIC_1688_VERIFY_RESULT') {
          void acknowledgeVerificationResult(message).catch((error) => {
            const detail = error instanceof Error ? error.message : '확인 필요 URL을 반영하지 못했습니다.'
            setVerificationProgress((current) => ({ ...current, message: detail }))
            toast.error(detail)
          })
          return
        }
        if (message.type === 'FUNTASTIC_1688_VERIFY_COMPLETE') {
          if (verificationSessionRef.current) completeVerificationBatch(message)
          else finalizeVerification()
          return
        }
        if (message.type === 'FUNTASTIC_1688_VERIFY_CANCELLED') {
          pauseVerification('검증을 중단했습니다. 저장한 기록부터 이어서 진행할 수 있습니다.')
          toast.info('1688 구매 URL 검증을 중단했습니다.')
          return
        }
        if (message.type === 'FUNTASTIC_1688_ERROR' && verificationSessionRef.current?.batch?.acknowledged) {
          setVerificationProgress(current => ({ ...current, message: message.message ?? '확장프로그램 응답을 다시 확인하고 있습니다.' }))
          return
        }
        if (message.type === 'FUNTASTIC_1688_VERIFY_ERROR' || message.type === 'FUNTASTIC_1688_ERROR') {
          pauseVerification(message.message ?? '1688 URL 검증 중 오류가 발생했습니다.')
          toast.error(message.message ?? '1688 URL 검증 중 오류가 발생했습니다.')
          return
        }
      }
      if (message.runId && message.runId !== runIdRef.current) return

      if (message.type === 'FUNTASTIC_1688_ACK') {
        setProgress((current) => ({
          ...current,
          total: message.total ?? current.total,
          message: '1688 주문 조회를 시작했습니다.',
        }))
        return
      }
      if (message.type === 'FUNTASTIC_1688_RESULT') {
        void saveResult(message)
        return
      }
      if (message.type === 'FUNTASTIC_1688_COMPLETE') {
        extensionFinishedRef.current = true
        finalizeRun()
        return
      }
      if (message.type === 'FUNTASTIC_1688_CANCELLED') {
        extensionFinishedRef.current = true
        finalizedRef.current = true
        setRunning(false)
        setProgress((current) => ({ ...current, message: '수집을 중단했습니다.' }))
        toast.info('1688 구매 URL 수집을 중단했습니다.')
        return
      }
      if (message.type === 'FUNTASTIC_1688_ERROR') {
        extensionFinishedRef.current = true
        finalizedRef.current = true
        setRunning(false)
        setProgress((current) => ({
          ...current,
          failed: current.failed + 1,
          message: message.message ?? '1688 수집 중 오류가 발생했습니다.',
        }))
        toast.error(message.message ?? '1688 수집 중 오류가 발생했습니다.')
      }
    }

    window.addEventListener('message', onMessage)
    const ping = () => window.postMessage(
      { source: PAGE_SOURCE, type: 'FUNTASTIC_1688_PING' },
      window.location.origin,
    )
    ping()
    const timer = window.setInterval(ping, 5_000)
    return () => {
      window.removeEventListener('message', onMessage)
      window.clearInterval(timer)
    }
  }, [acknowledgeVerificationResult, completeVerificationBatch, finalizeRun, finalizeVerification,
    launchVerificationBatch, pauseVerification, persistVerificationSession, saveResult])

  const startCollection = async () => {
    if (!extensionReady) {
      toast.error('1688 수집 확장프로그램을 먼저 설치해주세요.')
      return
    }

    setRunning(true)
    setProgress({ ...EMPTY_PROGRESS, message: '수집할 발주건을 확인하고 있습니다.' })
    try {
      const response = await fetch('/api/purchasing/purchase-urls?limit=300', {
        cache: 'no-store',
      })
      const body = await response.json() as QueueResponse
      if (!response.ok) throw new Error(body.error ?? '수집 목록을 불러오지 못했습니다.')
      const runId = crypto.randomUUID()
      runIdRef.current = runId
      pendingSavesRef.current = 0
      extensionFinishedRef.current = false
      finalizedRef.current = false
      setProgress({
        ...EMPTY_PROGRESS,
        total: body.orders.length,
        message: body.hasMore
          ? `먼저 ${body.orders.length.toLocaleString('ko-KR')}건을 수집합니다.`
          : `${body.orders.length.toLocaleString('ko-KR')}건을 수집합니다.`,
        issues: body.skippedInvalid > 0
          ? [`주문번호 형식이 맞지 않는 발주건 ${body.skippedInvalid.toLocaleString('ko-KR')}건은 제외했습니다.`]
          : [],
      })

      window.postMessage({
        source: PAGE_SOURCE,
        type: 'FUNTASTIC_1688_START',
        runId,
        orders: body.orders.map(({ orderNumber, items }) => ({
          orderNumber,
          items: (items ?? []).map(({ sku }) => ({ sku })),
        })),
      }, window.location.origin)
    } catch (error) {
      setRunning(false)
      setProgress(EMPTY_PROGRESS)
      toast.error(error instanceof Error ? error.message : '구매 URL 자동수집을 시작하지 못했습니다.')
    }
  }

  const cancelCollection = () => {
    if (!runIdRef.current) return
    window.postMessage({
      source: PAGE_SOURCE,
      type: 'FUNTASTIC_1688_CANCEL',
      runId: runIdRef.current,
    }, window.location.origin)
  }

  const startVerification = async (mode: VerificationMode = 'due') => {
    if (!extensionReady) {
      toast.error('1688 수집 확장프로그램을 먼저 설치해주세요.')
      return
    }

    setVerificationRunning(true)
    setLegacyVerification(false)
    verificationActiveRef.current = true
    verificationUrlChangedRef.current = false
    verificationIdleCountRef.current = 0
    verificationIdleAtRef.current = 0
    legacySavedResultsRef.current.clear()
    verificationAcksRef.current.clear()
    const operation = ++verificationOperationRef.current
    verificationFetchBusyRef.current = true
    const previousRunId = verificationSessionRef.current?.batch?.runId ?? cancelledVerificationRunIdRef.current
    persistVerificationSession({ version: 1, mode, total: 0, cursor: null,
      completed: EMPTY_VERIFICATION_PROGRESS, batch: null, phase: 'loading', previousRunId })
    setVerificationProgress({ ...EMPTY_VERIFICATION_PROGRESS, message: '검증할 구매 URL을 확인하고 있습니다.' })
    try {
      await syncSavedPurchaseUrls()
      if (operation !== verificationOperationRef.current || !verificationActiveRef.current) return
      verificationFetchBusyRef.current = false
      if (previousRunId) {
        const session = verificationSessionRef.current
        if (session) persistVerificationSession({ ...session, phase: 'awaitingIdle' })
        window.postMessage({ source: PAGE_SOURCE, type: 'FUNTASTIC_1688_PING' }, window.location.origin)
      } else await launchVerificationBatch()
    } catch (error) {
      if (operation !== verificationOperationRef.current) return
      verificationFetchBusyRef.current = false
      const detail = error instanceof Error ? error.message : '구매 URL 검증을 시작하지 못했습니다.'
      pauseVerification(detail)
      toast.error(detail)
    }
  }

  const resumeVerification = () => {
    const session = verificationSessionRef.current
    if (!session || !extensionReady) return
    verificationActiveRef.current = true
    verificationIdleCountRef.current = 0
    verificationIdleAtRef.current = 0
    cancelledVerificationRunIdRef.current = null
    const next = { ...session, phase: session.batch ? 'running' as const : 'awaitingIdle' as const }
    persistVerificationSession(next)
    verificationRunIdRef.current = session.batch?.runId ?? null
    setVerificationRunning(true)
    setVerificationProgress(combinedVerificationProgress(next, '저장한 검증 기록부터 이어서 진행하고 있습니다.'))
    window.postMessage({ source: PAGE_SOURCE, type: 'FUNTASTIC_1688_PING' }, window.location.origin)
  }

  const syncSavedPurchaseUrls = async () => {
    const response = await fetch('/api/purchasing/purchase-url-verification', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'sync' }),
    })
    const body = await response.json()
    if (!response.ok) throw new Error(body.error ?? '발주 URL을 연동하지 못했습니다.')
    if (body.updatedProducts > 0 || body.updatedWorkflow > 0) {
      router.refresh()
      onUrlsChanged?.()
    }
    return body as { updatedProducts: number; updatedWorkflow: number }
  }

  const syncPurchaseUrls = async () => {
    setSyncing(true)
    try {
      const result = await syncSavedPurchaseUrls()
      void refreshVerificationCounts()
      toast.success(`발주 URL 연동 완료 · 품목 ${result.updatedProducts}건 · 상품관리 ${result.updatedWorkflow}건`)
    } catch (error) { toast.error(error instanceof Error ? error.message : '발주 URL 연동 실패') }
    finally { setSyncing(false) }
  }

  const cancelVerification = () => {
    const runId = verificationRunIdRef.current
    cancelledVerificationRunIdRef.current = runId
    pauseVerification('검증을 중단했습니다. 저장한 기록부터 이어서 진행할 수 있습니다.')
    setLegacyVerification(false)
    if (runId) window.postMessage({
      source: PAGE_SOURCE,
      type: 'FUNTASTIC_1688_VERIFY_CANCEL',
      runId,
    }, window.location.origin)
    toast.info('1688 구매 URL 검증을 중단했습니다.')
  }

  const percentage = progress.total > 0
    ? Math.round((progress.processed / progress.total) * 100)
    : 0
  const verificationPercentage = verificationProgress.total > 0
    ? Math.round((verificationProgress.processed / verificationProgress.total) * 100)
    : 0

  return (
    <div className="flex max-w-2xl flex-col items-end gap-2">
      <div className="flex items-center justify-end gap-2">
        {SHOW_COLLECTION_CONTROLS ? (
          <>
            <button
              type="button"
              onClick={() => void startCollection()}
              disabled={running || verificationRunning}
              className="inline-flex h-9 items-center gap-2 rounded-md bg-foreground px-3 text-sm font-semibold text-background hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-55"
            >
              {running
                ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                : <Link2 className="size-4" aria-hidden="true" />}
              {running ? `${progress.processed}/${progress.total} 수집 중` : '1688 URL 자동수집'}
            </button>
            {running ? (
              <button
                type="button"
                onClick={cancelCollection}
                className="inline-flex size-9 items-center justify-center rounded-md border bg-background hover:bg-muted"
                aria-label="구매 URL 수집 중단"
                title="수집 중단"
              >
                <Square className="size-4" aria-hidden="true" />
              </button>
            ) : null}
          </>
        ) : null}
        <div className="inline-flex items-center">
        <button
          type="button"
          onClick={() => void startVerification('due')}
          disabled={syncing || running || verificationRunning}
          className={`inline-flex h-9 items-center gap-2 border bg-background px-3 text-sm font-semibold hover:bg-muted disabled:cursor-not-allowed disabled:opacity-55 ${verificationRunning ? 'rounded-md' : 'rounded-l-md'}`}
        >
          {verificationRunning
            ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
            : <CheckCircle2 className="size-4" aria-hidden="true" />}
          {verificationRunning
            ? `${legacyVerification ? '기존 검증 ' : ''}${verificationProgress.processed}/${verificationProgress.total} 검증 중`
            : `URL 검증${verificationCounts ? ` ${verificationCounts.due.toLocaleString('ko-KR')}개` : ''}`}
        </button>
        {!verificationRunning ? <details ref={verificationMenuRef} className="group relative shrink-0">
          <summary role="button" aria-label="URL 검증 메뉴" title="URL 검증 메뉴"
            className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-r-md border border-l-0 bg-background hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 [&::-webkit-details-marker]:hidden">
            <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden="true" />
          </summary>
          <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-md border bg-background p-1 text-left shadow-lg">
            {resumeAvailable ? <button type="button" onClick={() => { closeVerificationMenu(); resumeVerification() }}
              disabled={syncing || running || !extensionReady}
              className="flex min-h-9 w-full items-center rounded-sm px-3 py-2 text-left text-sm font-medium hover:bg-muted disabled:opacity-50">
              중단한 검증 이어서
            </button> : null}
            <button type="button" onClick={() => { closeVerificationMenu(); void startVerification('issues') }} disabled={syncing || running}
              className="flex min-h-9 w-full items-center justify-between gap-3 rounded-sm px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-50">
              <span>문제 URL 재검증</span><span className="text-muted-foreground tabular-nums">{verificationCounts ? `${verificationCounts.issues.toLocaleString('ko-KR')}개` : ''}</span>
            </button>
            <button type="button" onClick={() => { closeVerificationMenu(); void startVerification('all') }} disabled={syncing || running}
              className="flex min-h-9 w-full items-center justify-between gap-3 rounded-sm px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-50">
              <span>전체 URL 검증</span><span className="text-muted-foreground tabular-nums">{verificationCounts ? `${verificationCounts.all.toLocaleString('ko-KR')}개` : ''}</span>
            </button>
            <div className="my-1 border-t" />
            <button type="button" onClick={() => { closeVerificationMenu(); void syncPurchaseUrls() }} disabled={syncing || running}
              className="flex min-h-9 w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-50">
              {syncing ? <LoaderCircle className="size-4 animate-spin" /> : <Link2 className="size-4" />}발주 URL 연동
            </button>
            <p className="px-3 py-2 text-xs leading-relaxed text-muted-foreground">기본 검증은 미검증·변경된 URL과 정상 확인 후 30일 지난 URL만 확인합니다. 단종은 제외됩니다.</p>
          </div>
        </details> : null}
        </div>
        {verificationRunning ? (
          <button
            type="button"
            onClick={cancelVerification}
            className="inline-flex size-9 items-center justify-center rounded-md border bg-background hover:bg-muted"
            aria-label="구매 URL 검증 중단"
            title="검증 중단"
          >
            <Square className="size-4" aria-hidden="true" />
          </button>
        ) : null}
        <span
          className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs font-medium ${
            extensionReady
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-zinc-200 bg-zinc-50 text-zinc-500'
          }`}
        >
          {extensionReady
            ? <CheckCircle2 className="size-3.5" aria-hidden="true" />
            : <AlertTriangle className="size-3.5" aria-hidden="true" />}
          {extensionReady ? '연결됨' : '미연결'}
        </span>
      </div>

      {legacyVerification ? <p className="text-xs text-amber-700">이전 방식의 검증이 실행 중입니다. 중단 후 필요한 URL 검증을 시작해주세요.</p> : null}

      {SHOW_COLLECTION_CONTROLS && progress.total > 0 ? (
        <div className="w-full min-w-0 rounded-md border bg-background px-3 py-2 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium">{progress.message}</span>
            <span className="tabular-nums text-muted-foreground">
              저장 {progress.updated} · 확인 {progress.review} · 미발견 {progress.notFound} · 오류 {progress.failed}
            </span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-foreground transition-[width]"
              style={{ width: `${percentage}%` }}
            />
          </div>
          {progress.issues.length > 0 ? (
            <div className="mt-2 space-y-1 text-red-700">
              {progress.issues.map((issue) => <p key={issue}>{issue}</p>)}
            </div>
          ) : null}
        </div>
      ) : null}

      {(verificationRunning || resumeAvailable) && verificationProgress.total > 0 ? (
        <div className="w-full min-w-0 rounded-md border bg-background px-3 py-2 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium">{verificationProgress.message}</span>
            <span className="tabular-nums text-muted-foreground">
              정상 {verificationProgress.open} · 상품 없음 {verificationProgress.unavailable} · 확인 필요 {verificationProgress.unknown}
            </span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-foreground transition-[width]"
              style={{ width: `${verificationPercentage}%` }}
            />
          </div>
          {verificationProgress.issues.length > 0 ? (
            <div className="mt-2 max-h-64 space-y-1 overflow-y-auto pr-2">
              {verificationProgress.issues.map((issue) => (
                <p
                  key={issue}
                  className={issue.startsWith('[상품 없음]') ? 'text-red-700' : 'text-amber-700'}
                >
                  {issue}
                </p>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function isCollectorMessage(value: unknown): value is CollectorMessage {
  if (!value || typeof value !== 'object') return false
  const message = value as Partial<CollectorMessage>
  return message.source === EXTENSION_SOURCE && typeof message.type === 'string'
}
