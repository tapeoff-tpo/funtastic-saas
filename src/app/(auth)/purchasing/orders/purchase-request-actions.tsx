'use client'

import {
  createContext,
  useEffect,
  useContext,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { Dialog } from '@base-ui/react/dialog'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Check, ChevronDown, Download, ExternalLink, Loader2, Plus, Save, Search, Sparkles, Trash2, Upload, WalletCards } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PURCHASE_ARRIVAL_WAREHOUSES } from '@/lib/purchasing/purchase-arrival-warehouse'
import {
  PURCHASE_PAYMENT_STATUSES,
  PURCHASE_PAYMENT_STATUS_LABELS,
  PURCHASE_REQUEST_STATUS_LABELS,
  type PurchasePaymentStatus,
  type PurchaseRequestStatus,
} from '@/lib/purchasing/purchase-request-status'
import {
  PURCHASE_DELAY_REASON_LABELS,
  PURCHASE_DELAY_REASONS,
  PURCHASING_ITEM_STATUS_LABELS,
  type PurchaseDelayReason,
} from '@/lib/purchasing/purchase-delay'
import type { PurchaseReviewListStatus } from '@/lib/purchasing/purchase-requests'

const PAGE_SOURCE = 'funtastic-saas'
const EXTENSION_SOURCE = 'funtastic-1688-extension'
const TRACKING_LOOKUP_START = 'FUNTASTIC_1688_TRACKING_START'
const TRACKING_LOOKUP_ACK = 'FUNTASTIC_1688_TRACKING_ACK'
const TRACKING_LOOKUP_RESULT = 'FUNTASTIC_1688_TRACKING_RESULT'
const TRACKING_LOOKUP_ERROR = 'FUNTASTIC_1688_TRACKING_ERROR'
const TRACKING_LOOKUP_COMPLETE = 'FUNTASTIC_1688_TRACKING_COMPLETE'
const EXACT_WAYBILL_EVIDENCE = { label: '运单号码', extractionVersion: 2 } as const
const TRACKING_LOOKUP_RESULT_TIMEOUT_MS = 120_000
const TRACKING_LOOKUP_SAVE_TIMEOUT_MS = 20_000
const TRACKING_LOOKUP_MAX_CONCURRENCY = 3
const TRACKING_LOOKUP_HANDOFF_RETRY_DELAY_MS = 750
const TRACKING_LOOKUP_HANDOFF_MAX_ATTEMPTS = 4
const TRACKING_POPUP_ROUTE = '/purchasing/orders/1688-tracking-run'
export const PURCHASE_1688_TRACKING_POPUP_STORAGE_PREFIX = 'funtastic-1688-tracking-popup:'
const TRACKING_POPUP_PAYLOAD_MAX_AGE_MS = 30 * 60 * 1_000

export type Purchase1688TrackingLookupCandidate = {
  id: string
  sku: string
  productName: string
  optionName: string | null
  supplierOrderNumber: string | null
  trackingNumber: string | null
  lookupBlocked?: boolean
}

type Purchase1688TrackingMode = 'initial' | 'recollect'

type Purchase1688TrackingPopupPayload = {
  createdAt: number
  mode: Purchase1688TrackingMode
  candidates: Purchase1688TrackingLookupCandidate[]
  scope?: 'all'
}

type Purchase1688TrackingLookupJob = {
  orderNumber: string
  ids: string[]
}

type Purchase1688TrackingBatch = {
  id: string
  jobs: Purchase1688TrackingLookupJob[]
  totalItems: number
  skippedItems: number
}

type Purchase1688TrackingProgress = {
  totalItems: number
  totalOrders: number
  skippedItems: number
  succeededItems: number
  failedItems: number
  currentOrder: number
  currentOrderNumber: string | null
  completedOrders: number
  activeOrders: number
  concurrency: number
  message: string
  stopping?: boolean
  complete?: boolean
}

type Purchase1688TrackingRowStatus = 'queued' | 'querying' | 'saving' | 'success' | 'failed' | 'skipped'

type Purchase1688TrackingLookupRow = {
  id: string
  sku: string
  productName: string
  optionName: string | null
  orderNumber: string
  status: Purchase1688TrackingRowStatus
  message: string
  trackingNumbers: string[]
}

function valid1688OrderNumber(value: string | null | undefined) {
  return /^\d{10,40}$/.test(value?.trim() ?? '')
}

export function purchase1688TrackingPopupStorageKey(runId: string) {
  return `${PURCHASE_1688_TRACKING_POPUP_STORAGE_PREFIX}${runId}`
}

function isPurchase1688TrackingCandidate(value: unknown): value is Purchase1688TrackingLookupCandidate {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.id === 'string'
    && typeof candidate.sku === 'string'
    && typeof candidate.productName === 'string'
    && (typeof candidate.optionName === 'string' || candidate.optionName === null)
    && (typeof candidate.supplierOrderNumber === 'string' || candidate.supplierOrderNumber === null)
    && (typeof candidate.trackingNumber === 'string' || candidate.trackingNumber === null)
    && (candidate.lookupBlocked === undefined || typeof candidate.lookupBlocked === 'boolean')
}

function parsePurchase1688TrackingPopupPayload(value: string | null): Purchase1688TrackingPopupPayload | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>
    if (parsed.mode !== 'initial' && parsed.mode !== 'recollect') return null
    if (typeof parsed.createdAt !== 'number' || !Number.isFinite(parsed.createdAt)) return null
    if (!Array.isArray(parsed.candidates) || !parsed.candidates.every(isPurchase1688TrackingCandidate)) return null
    if (parsed.scope !== undefined && parsed.scope !== 'all') return null
    return {
      createdAt: parsed.createdAt,
      mode: parsed.mode,
      candidates: parsed.candidates,
      ...(parsed.scope === 'all' ? { scope: 'all' } : {}),
    }
  } catch {
    return null
  }
}

function normalize1688TrackingNumbers(value: unknown) {
  const numbers = new Map<string, string>()
  for (const item of Array.isArray(value) ? value : []) {
    if (typeof item !== 'string') continue
    const number = item.trim()
    if (!number) continue
    const key = number.toUpperCase()
    if (!numbers.has(key)) numbers.set(key, number)
  }
  return Array.from(numbers.values())
}

function hasExact1688WaybillEvidence(value: unknown) {
  if (!value || typeof value !== 'object') return false
  const evidence = value as { label?: unknown; extractionVersion?: unknown }
  return evidence.label === EXACT_WAYBILL_EVIDENCE.label
    && evidence.extractionVersion === EXACT_WAYBILL_EVIDENCE.extractionVersion
}

function stops1688TrackingBatch(message: string) {
  const normalized = message.trim()
  return normalized.startsWith('1688 로그인이 필요합니다.')
    || normalized.startsWith('1688 보안 확인이 필요합니다.')
    || normalized.startsWith('1688 확장프로그램 연결을 확인해주세요.')
    || normalized.startsWith('운송장번호 추출 확장프로그램을')
    || normalized.startsWith('1688 송장 조회 시간이 초과되었습니다.')
    || normalized.startsWith('SaaS 발주 화면에서 시작해주세요.')
    || normalized.startsWith('SaaS 화면에 송장 조회 결과를 전달하지 못했습니다:')
    || is1688TrackingLookupHandoffInProgress(normalized)
}

function is1688TrackingLookupHandoffInProgress(message: string) {
  return /다른\s*1688\s*작업이\s*진행\s*중/i.test(message)
}

const PURCHASE_REVIEW_STATUS_OPTIONS: Array<{ value: PurchaseReviewListStatus; label: string }> = [
  { value: 'review', label: '발주검토' },
  { value: 'not_required', label: '발주불필요' },
]

type BulkSelectionContextValue = {
  ids: string[]
  selectedIds: Set<string>
  nextStatus: PurchaseRequestStatus | null
  toggle: (id: string) => void
  toggleAll: () => void
  clear: () => void
}

const BulkSelectionContext = createContext<BulkSelectionContextValue | null>(null)

export function PurchaseBulkSelectionProvider({
  ids,
  nextStatus,
  children,
}: {
  ids: string[]
  nextStatus: PurchaseRequestStatus | null
  children: ReactNode
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())

  function toggle(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    setSelectedIds((current) => (
      ids.length > 0 && ids.every((id) => current.has(id))
        ? new Set()
        : new Set(ids)
    ))
  }

  function clear() {
    setSelectedIds(new Set())
  }

  return (
    <BulkSelectionContext.Provider value={{
      ids,
      selectedIds,
      nextStatus,
      toggle,
      toggleAll,
      clear,
    }}>
      {children}
    </BulkSelectionContext.Provider>
  )
}

export function PurchaseSelectAllCheckbox() {
  const context = useBulkSelection()
  const checked = context.ids.length > 0 && context.ids.every((id) => context.selectedIds.has(id))
  const indeterminate = context.selectedIds.size > 0 && !checked

  return (
    <input
      type="checkbox"
      aria-label="현재 목록 전체 선택"
      checked={checked}
      ref={(node) => {
        if (node) node.indeterminate = indeterminate
      }}
      onChange={context.toggleAll}
      className="h-4 w-4"
    />
  )
}

export function PurchaseRowCheckbox({ id }: { id: string }) {
  const context = useBulkSelection()

  return (
    <input
      type="checkbox"
      aria-label="발주 항목 선택"
      checked={context.selectedIds.has(id)}
      onChange={() => context.toggle(id)}
      className="h-4 w-4"
    />
  )
}

export function PurchaseBulkStatusButton() {
  const router = useRouter()
  const context = useBulkSelection()
  const [message, setMessage] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const selectedCount = context.selectedIds.size

  if (!context.nextStatus) return null

  function moveSelected() {
    const ids = Array.from(context.selectedIds)
    if (ids.length === 0) return
    setMessage(null)

    startTransition(async () => {
      const response = await fetch('/api/purchasing/purchase-requests/status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, status: context.nextStatus }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok || (Array.isArray(body.failed) && body.failed.length > 0)) {
        setMessage(body.error ?? '선택 항목 이동에 실패했습니다.')
        router.refresh()
        return
      }

      context.clear()
      setMessage(`${body.updatedCount.toLocaleString('ko-KR')}건 이동 완료`)
      router.refresh()
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={moveSelected}
        disabled={isPending || selectedCount === 0}
      >
        {isPending ? <Loader2 className="animate-spin" /> : <Check />}
        선택 {selectedCount.toLocaleString('ko-KR')}건 {PURCHASE_REQUEST_STATUS_LABELS[context.nextStatus]}로 이동
      </Button>
      {message ? <span className="text-xs text-muted-foreground">{message}</span> : null}
    </div>
  )
}

/**
 * Owns a tracking run in the dedicated same-origin popup. Keeping the queue,
 * extension listener, and saving work in this window lets the user leave the
 * originating purchase list without cancelling an in-progress batch.
 */
function Purchase1688TrackingProgressRunner({
  candidates,
  mode,
  runId,
  storageKey,
}: {
  candidates: Purchase1688TrackingLookupCandidate[]
  mode: Purchase1688TrackingMode
  runId: string
  storageKey: string
}) {
  const stopRequestedRef = useRef(false)
  const batchActiveRef = useRef(false)
  const startedRef = useRef(false)
  const [batch, setBatch] = useState<Purchase1688TrackingBatch | null>(null)
  const [progress, setProgress] = useState<Purchase1688TrackingProgress | null>(null)
  const [lookupRows, setLookupRows] = useState<Purchase1688TrackingLookupRow[]>([])
  const isRecollectBatch = mode === 'recollect'

  useEffect(() => {
    batchActiveRef.current = Boolean(batch)
  }, [batch])

  useEffect(() => () => {
    batchActiveRef.current = false
    try {
      window.localStorage.removeItem(storageKey)
    } catch {
      // Closing the work window must never block a later retry.
    }
  }, [storageKey])

  const eligibleCandidates = candidates.filter((candidate) => (
    !candidate.lookupBlocked && valid1688OrderNumber(candidate.supplierOrderNumber)
      && (isRecollectBatch ? /^LP/i.test(candidate.trackingNumber?.trim() ?? '') : !candidate.trackingNumber?.trim())
  ))
  const skippedCandidateCount = candidates.length - eligibleCandidates.length

  useEffect(() => {
    if (!batch) return

    type ActiveLookup = {
      index: number
      job: Purchase1688TrackingLookupJob
      runId: string
      attempt: number
      phase: 'querying' | 'saving' | 'retrying'
      acknowledged: boolean
      timeout: number | null
    }
    let disposed = false
    let finished = false
    let pumping = false
    let nextIndex = 0
    let completedOrders = 0
    let succeededItems = 0
    let failedItems = 0
    // Expand only after a capability-bearing ACK; older extensions stay serial.
    let concurrency = 1
    let haltReason: string | null = null
    const active = new Map<number, ActiveLookup>()
    const startedRuns = new Map<string, string>()
    const timers = new Set<number>()
    const saveControllers = new Set<AbortController>()

    const schedule = (callback: () => void, delayMs: number) => {
      const timer = window.setTimeout(() => { timers.delete(timer); callback() }, delayMs)
      timers.add(timer)
      return timer
    }
    const clearLookupTimeout = (lookup: ActiveLookup) => {
      if (lookup.timeout === null) return
      window.clearTimeout(lookup.timeout)
      timers.delete(lookup.timeout)
      lookup.timeout = null
    }
    const clearTimers = () => {
      for (const timer of timers) window.clearTimeout(timer)
      timers.clear()
    }
    const updateLookupRows = (ids: string[], status: Purchase1688TrackingRowStatus, message: string, trackingNumbers: string[] = []) => {
      const idSet = new Set(ids)
      setLookupRows((rows) => rows.map((row) => idSet.has(row.id) ? { ...row, status, message, trackingNumbers } : row))
    }
    const updateProgress = (message: string, overrides: Partial<Purchase1688TrackingProgress> = {}) => {
      if (disposed) return
      const drainingMessage = haltReason
        ? `${haltReason} · 진행 중인 ${active.size}개 주문의 조회·저장이 끝나면 중지합니다.`
        : `진행 중인 ${active.size}개 주문의 조회·저장이 끝나면 중지합니다.`
      setProgress({
        totalItems: batch.totalItems, totalOrders: batch.jobs.length, skippedItems: batch.skippedItems,
        succeededItems, failedItems, currentOrder: completedOrders,
        currentOrderNumber: active.size === 1 ? active.values().next().value?.job.orderNumber ?? null : null,
        completedOrders, activeOrders: active.size, concurrency,
        stopping: stopRequestedRef.current || Boolean(haltReason),
        message: !overrides.complete && (stopRequestedRef.current || haltReason) ? drainingMessage : message,
        ...overrides,
      })
    }
    const finish = (message: string) => {
      if (disposed || finished) return
      finished = true
      clearTimers()
      batchActiveRef.current = false
      setBatch(null)
      updateProgress(message, { currentOrderNumber: null, activeOrders: 0, complete: true })
      if (succeededItems > 0) {
        try {
          window.opener?.postMessage({ source: PAGE_SOURCE, type: TRACKING_LOOKUP_COMPLETE }, window.location.origin)
        } catch { /* The originating tab may have been closed or navigated away. */ }
      }
      try { window.localStorage.removeItem(storageKey) } catch { /* Keep the completed summary visible. */ }
      if (stopRequestedRef.current || haltReason) {
        setLookupRows((rows) => rows.map((row) => row.status === 'queued' || row.status === 'querying'
          ? { ...row, status: 'skipped', message: '남은 항목은 조회하지 않았습니다.', trackingNumbers: [] } : row))
      }
      if (succeededItems > 0 && failedItems === 0 && !stopRequestedRef.current && !haltReason) {
        toast.success(isRecollectBatch
          ? `1688 송장 ${succeededItems.toLocaleString('ko-KR')}건을 다시 수집했습니다.`
          : `1688 송장 ${succeededItems.toLocaleString('ko-KR')}건을 등록하고 검수로 이동했습니다.`)
      } else if (succeededItems > 0) {
        toast.warning(isRecollectBatch
          ? `1688 송장 ${succeededItems.toLocaleString('ko-KR')}건 다시 수집 · ${failedItems.toLocaleString('ko-KR')}건 미처리`
          : `1688 송장 ${succeededItems.toLocaleString('ko-KR')}건 등록 · ${failedItems.toLocaleString('ko-KR')}건 미처리`)
      } else if (failedItems > 0) {
        toast.error(isRecollectBatch ? '1688 송장 다시 수집에서 저장된 항목이 없습니다.' : '1688 송장 일괄조회에서 저장된 항목이 없습니다.')
      }
    }
    const finishIfDrained = () => {
      if (active.size > 0) return
      if (haltReason) finish(`${haltReason} · 남은 항목은 확인 후 다시 일괄조회해주세요.`)
      else if (stopRequestedRef.current) finish(`진행 중이던 주문까지 처리했습니다. 성공 ${succeededItems.toLocaleString('ko-KR')}건 · 미처리 ${failedItems.toLocaleString('ko-KR')}건`)
      else if (nextIndex >= batch.jobs.length) finish(`일괄조회 완료 · 성공 ${succeededItems.toLocaleString('ko-KR')}건 · 미처리 ${failedItems.toLocaleString('ko-KR')}건`)
    }
    const release = (lookup: ActiveLookup, processed = true) => {
      clearLookupTimeout(lookup)
      active.delete(lookup.index)
      if (processed) completedOrders += 1
    }
    const isActive = (lookup: ActiveLookup) => !disposed && !finished && active.get(lookup.index) === lookup
    const pump = () => {
      if (disposed || finished || pumping) return
      pumping = true
      while (!stopRequestedRef.current && !haltReason && active.size < concurrency && nextIndex < batch.jobs.length) {
        const index = nextIndex++
        const lookup: ActiveLookup = { index, job: batch.jobs[index], runId: '', attempt: 0, phase: 'querying', acknowledged: false, timeout: null }
        active.set(index, lookup)
        startAttempt(lookup)
      }
      pumping = false
      finishIfDrained()
    }
    const failLookup = (lookup: ActiveLookup, message: string) => {
      if (!isActive(lookup) || lookup.phase === 'saving') return
      clearLookupTimeout(lookup)
      if (is1688TrackingLookupHandoffInProgress(message) && lookup.attempt < TRACKING_LOOKUP_HANDOFF_MAX_ATTEMPTS
        && !stopRequestedRef.current && !haltReason) {
        lookup.phase = 'retrying'
        updateLookupRows(lookup.job.ids, 'querying', '이전 1688 조회를 정리한 뒤 재시도 중')
        updateProgress('이전 1688 조회를 정리한 뒤 같은 주문을 다시 시도합니다.')
        schedule(() => {
          if (!isActive(lookup)) return
          if (stopRequestedRef.current || haltReason) {
            release(lookup, false)
            updateLookupRows(lookup.job.ids, 'skipped', '남은 항목은 조회하지 않았습니다.')
            updateProgress('재시도 대기 중인 주문을 건너뛰었습니다.')
            pump()
            return
          }
          startAttempt(lookup)
        }, TRACKING_LOOKUP_HANDOFF_RETRY_DELAY_MS)
        return
      }
      failedItems += lookup.job.ids.length
      release(lookup)
      updateLookupRows(lookup.job.ids, 'failed', message)
      if (stops1688TrackingBatch(message)) haltReason ??= message
      updateProgress(message)
      pump()
    }
    function startAttempt(lookup: ActiveLookup) {
      if (!isActive(lookup)) return
      lookup.attempt += 1
      lookup.runId = `${batch!.id}-${lookup.index}-${lookup.attempt}`
      lookup.phase = 'querying'
      lookup.acknowledged = false
      const attemptRunId = lookup.runId
      startedRuns.set(attemptRunId, lookup.job.orderNumber)
      updateLookupRows(lookup.job.ids, 'querying', '1688 주문서번호 조회 중')
      updateProgress(`1688 주문 ${lookup.index + 1}/${batch!.jobs.length} 조회 중`)
      lookup.timeout = schedule(() => {
        if (!isActive(lookup) || lookup.runId !== attemptRunId || lookup.phase !== 'querying') return
        failLookup(lookup, '1688 확장프로그램 연결을 확인해주세요.')
      }, 5_000)
      window.postMessage({
        source: PAGE_SOURCE, type: TRACKING_LOOKUP_START, runId: attemptRunId, batchId: batch!.id, parallelVersion: 1,
        orderNumber: lookup.job.orderNumber, background: true,
      }, window.location.origin)
    }
    const saveLookup = async (lookup: ActiveLookup, trackingNumbers: string[]) => {
      const savedIds: string[] = [], failedIds: string[] = []
      let lastError = ''
      for (const id of lookup.job.ids) {
        if (!isActive(lookup)) return
        const controller = new AbortController()
        saveControllers.add(controller)
        let saveTimer: number | null = null
        try {
          await Promise.race([
            (async () => {
              const response = await fetch(`/api/purchasing/purchase-requests/${id}/1688-tracking`, {
                method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  orderNumber: lookup.job.orderNumber, trackingNumbers, trackingSource: 'waybill_number',
                  trackingEvidence: EXACT_WAYBILL_EVIDENCE, replaceUninspectedInspection: isRecollectBatch,
                }),
              })
              const body = await response.json().catch(() => ({}))
              if (!response.ok) throw new Error(body.error ?? '1688 송장번호를 저장하지 못했습니다.')
            })(),
            new Promise<never>((_, reject) => {
              saveTimer = schedule(() => {
                reject(new Error('송장 저장 응답이 지연되었습니다. 저장 여부를 확인한 뒤 다시 조회해주세요.'))
                controller.abort()
              }, TRACKING_LOOKUP_SAVE_TIMEOUT_MS)
            }),
          ])
          if (!isActive(lookup)) return
          succeededItems += 1
          savedIds.push(id)
          updateLookupRows([id], 'success', `송장 ${trackingNumbers.join(', ')} 저장 완료`, trackingNumbers)
        } catch (error) {
          if (!isActive(lookup)) return
          failedItems += 1
          failedIds.push(id)
          lastError = error instanceof Error ? error.message : '1688 송장번호를 저장하지 못했습니다.'
          updateLookupRows([id], 'failed', lastError)
        } finally {
          saveControllers.delete(controller)
          if (saveTimer !== null) { window.clearTimeout(saveTimer); timers.delete(saveTimer) }
        }
        updateProgress(`주문 ${lookup.index + 1}/${batch.jobs.length} 송장 저장 중 · ${savedIds.length}/${lookup.job.ids.length}개 상품 저장`)
      }
      if (!isActive(lookup)) return
      release(lookup)
      if (savedIds.length > 0) updateLookupRows(savedIds, 'success', isRecollectBatch ? `송장 ${trackingNumbers.join(', ')} 다시 수집 완료` : `송장 ${trackingNumbers.join(', ')} 등록 완료`, trackingNumbers)
      if (failedIds.length > 0) updateLookupRows(failedIds, 'failed', lastError)
      updateProgress(lastError || (isRecollectBatch
        ? `송장 ${savedIds.length.toLocaleString('ko-KR')}건 실제 운송장으로 다시 수집됨`
        : `송장 ${savedIds.length.toLocaleString('ko-KR')}건 등록됨 · 검수로 이동`))
      pump()
    }
    const onMessage = (event: MessageEvent<unknown>) => {
      if (disposed || finished || event.source !== window || event.origin !== window.location.origin) return
      const message = event.data
      if (!message || typeof message !== 'object') return
      const data = message as {
        source?: unknown; type?: unknown; runId?: unknown; orderNumber?: unknown; trackingNumbers?: unknown;
        trackingSource?: unknown; trackingEvidence?: unknown; parallelVersion?: unknown; maxConcurrency?: unknown; message?: unknown
      }
      if (data.source !== EXTENSION_SOURCE || typeof data.type !== 'string' || typeof data.runId !== 'string') return
      const knownOrder = startedRuns.get(data.runId)
      if (!knownOrder || (data.orderNumber !== undefined && data.orderNumber !== knownOrder)) return
      const lookup = [...active.values()].find((entry) => entry.runId === data.runId)
      if (data.type === TRACKING_LOOKUP_ACK) {
        // Late capabilities may unlock the pool, but cannot restart a finished watchdog.
        if (data.parallelVersion === 1 && typeof data.maxConcurrency === 'number' && Number.isFinite(data.maxConcurrency)) {
          concurrency = Math.max(concurrency, Math.min(TRACKING_LOOKUP_MAX_CONCURRENCY, Math.max(1, Math.floor(data.maxConcurrency))))
        }
        if (lookup?.phase === 'querying' && !lookup.acknowledged) {
          lookup.acknowledged = true
          clearLookupTimeout(lookup)
          const acknowledgedRunId = lookup.runId
          lookup.timeout = schedule(() => {
            if (!isActive(lookup) || lookup.runId !== acknowledgedRunId || lookup.phase !== 'querying') return
            failLookup(lookup, '1688 송장 조회 시간이 초과되었습니다. 1688 화면을 확인한 뒤 다시 조회해주세요.')
          }, TRACKING_LOOKUP_RESULT_TIMEOUT_MS)
        }
        updateProgress('1688 주문 조회 중')
        pump()
        return
      }
      if (!lookup || lookup.phase !== 'querying') return
      if (data.type === TRACKING_LOOKUP_ERROR) {
        failLookup(lookup, typeof data.message === 'string' ? data.message : '1688 송장 조회에 실패했습니다.')
        return
      }
      if (data.type !== TRACKING_LOOKUP_RESULT || data.orderNumber !== lookup.job.orderNumber) return
      if (data.trackingSource !== 'waybill_number' || !hasExact1688WaybillEvidence(data.trackingEvidence)) {
        failLookup(lookup, '운송장번호 추출 확장프로그램을 1.10.1 이상으로 업데이트해주세요. 运单号码만 저장합니다.')
        return
      }
      const trackingNumbers = normalize1688TrackingNumbers(data.trackingNumbers)
      if (trackingNumbers.length === 0) { failLookup(lookup, '1688에서 유효한 송장번호를 찾지 못했습니다.'); return }
      clearLookupTimeout(lookup)
      lookup.phase = 'saving'
      updateLookupRows(lookup.job.ids, 'saving', '송장번호 저장 중', trackingNumbers)
      updateProgress(`주문 ${lookup.index + 1}/${batch.jobs.length} 송장 저장 중`)
      void saveLookup(lookup, trackingNumbers)
    }
    window.addEventListener('message', onMessage)
    updateProgress(`${isRecollectBatch ? '1688 송장 다시 수집' : '1688 송장 일괄조회'} 준비 · ${batch.jobs.length.toLocaleString('ko-KR')}개 주문`)
    schedule(pump, 150)
    return () => {
      disposed = true
      clearTimers()
      for (const controller of saveControllers) controller.abort()
      window.removeEventListener('message', onMessage)
    }
  }, [batch, isRecollectBatch, storageKey])

  function startBatch() {
    if (batch || eligibleCandidates.length === 0) {
      if (eligibleCandidates.length === 0) {
        setProgress({
          totalItems: 0,
          totalOrders: 0,
          skippedItems: skippedCandidateCount,
          succeededItems: 0,
          failedItems: 0,
          currentOrder: 0,
          currentOrderNumber: null,
          completedOrders: 0,
          activeOrders: 0,
          concurrency: 1,
          message: isRecollectBatch
            ? '검수 전체에서 다시 수집할 LP로 시작하는 기존 물류번호를 찾지 못했습니다. 실제 운송장번호가 저장된 항목은 건너뜁니다.'
            : '이 작업 창에서 조회할 주문서번호가 있는 항목을 찾지 못했습니다. 원래 발주 화면에서 다시 시작해주세요.',
          complete: true,
        })
      }
      return
    }
    const grouped = new Map<string, string[]>()
    for (const candidate of eligibleCandidates) {
      const orderNumber = candidate.supplierOrderNumber?.trim()
      if (!orderNumber) continue
      const ids = grouped.get(orderNumber) ?? []
      ids.push(candidate.id)
      grouped.set(orderNumber, ids)
    }
    const jobs = Array.from(grouped, ([orderNumber, ids]) => ({ orderNumber, ids }))
    const skippedItems = skippedCandidateCount
    setLookupRows(eligibleCandidates.map((candidate) => ({
      id: candidate.id,
      sku: candidate.sku,
      productName: candidate.productName,
      optionName: candidate.optionName,
      orderNumber: candidate.supplierOrderNumber?.trim() ?? '',
      status: 'queued',
      message: '조회 대기',
      trackingNumbers: [],
    })))
    stopRequestedRef.current = false
    batchActiveRef.current = true
    setProgress({
      totalItems: eligibleCandidates.length,
      totalOrders: jobs.length,
      skippedItems,
      succeededItems: 0,
      failedItems: 0,
      currentOrder: 0,
      currentOrderNumber: null,
      completedOrders: 0,
      activeOrders: 0,
      concurrency: 1,
      message: isRecollectBatch ? '1688 송장 다시 수집 시작' : '1688 송장 일괄조회 시작',
    })
    setBatch({
      id: runId,
      jobs,
      totalItems: eligibleCandidates.length,
      skippedItems,
    })
  }

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    startBatch()
  // The popup payload is immutable for the lifetime of this dedicated window.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function stopAfterCurrent() {
    if (!batch) return
    stopRequestedRef.current = true
    setProgress((current) => current ? {
      ...current,
      stopping: true,
      message: `진행 중인 ${current.activeOrders}개 주문의 조회·저장이 끝나면 중지합니다.`,
    } : current)
  }

  return (
    <main className="flex h-dvh min-w-[680px] flex-col overflow-hidden bg-background p-5">
      <h1 className="text-base font-semibold">{isRecollectBatch ? '1688 송장 다시 수집' : '1688 송장 일괄조회'}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {isRecollectBatch
          ? `검수 전체 ${candidates.length.toLocaleString('ko-KR')}개 상품 중 기존 물류번호(LP)로 저장된 ${(progress?.totalItems ?? eligibleCandidates.length).toLocaleString('ko-KR')}개 상품을 조회해 실제 운송장으로 교체합니다. 박스·수량 검수가 시작된 항목은 바꾸지 않습니다.`
          : `구매완료 전체 ${candidates.length.toLocaleString('ko-KR')}개 상품 중 주문서번호가 있고 송장이 비어 있는 ${(progress?.totalItems ?? eligibleCandidates.length).toLocaleString('ko-KR')}개 상품을 조회합니다.${(progress?.skippedItems ?? skippedCandidateCount) > 0 ? ` 기존 송장·검수 기록이 있거나 주문서번호가 없는 ${(progress?.skippedItems ?? skippedCandidateCount).toLocaleString('ko-KR')}건은 자동으로 건너뜁니다.` : ''}`}
        {' '}같은 주문서번호의 상품은 묶어서 한 번만 조회합니다.
        {' '}최대 3개 주문을 동시에 조회하며, 완료된 주문부터 저장합니다.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border bg-muted/30 px-3 py-2 text-sm" aria-live="polite">
        <span>{progress?.message ?? '조회 준비'}</span>
        {progress && <span className="text-muted-foreground">조회 대상 상품 {progress.totalItems.toLocaleString('ko-KR')}개 · 1688 주문 {progress.totalOrders.toLocaleString('ko-KR')}건</span>}
        {progress && <span className="text-muted-foreground">완료 주문 {progress.completedOrders.toLocaleString('ko-KR')}/{progress.totalOrders.toLocaleString('ko-KR')}건 · 동시 조회·저장 {progress.activeOrders}/{progress.concurrency}건</span>}
        <span className="text-muted-foreground">성공 {(progress?.succeededItems ?? 0).toLocaleString('ko-KR')}건</span>
        <span className="text-muted-foreground">미처리 {(progress?.failedItems ?? 0).toLocaleString('ko-KR')}건</span>
        {progress?.skippedItems ? <span className="text-muted-foreground">건너뜀 {progress.skippedItems.toLocaleString('ko-KR')}건</span> : null}
      </div>

      <div className="mt-3 min-h-0 flex-1 overflow-y-auto rounded-md border">
        {lookupRows.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">조회할 주문서번호가 있는 항목이 없습니다.</p>
        ) : (
          <div className="divide-y">
            {lookupRows.map((row) => {
              const statusClassName = row.status === 'success'
                ? 'bg-emerald-100 text-emerald-800'
                : row.status === 'failed'
                  ? 'bg-red-100 text-red-800'
                  : row.status === 'saving'
                    ? 'bg-blue-100 text-blue-800'
                    : row.status === 'querying'
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-muted text-muted-foreground'
              const statusLabel = row.status === 'success'
                ? '성공'
                : row.status === 'failed'
                  ? '미처리'
                  : row.status === 'saving'
                    ? '저장 중'
                    : row.status === 'querying'
                      ? '조회 중'
                      : row.status === 'skipped'
                        ? '건너뜀'
                        : '대기'
              return (
                <div key={row.id} className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p data-no-translate className="break-words text-sm font-medium">
                      <span className="mr-1 text-muted-foreground">{row.sku}</span>
                      {row.productName}{row.optionName ? ` · ${row.optionName}` : ''}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">주문서번호 <span data-no-translate>{row.orderNumber}</span></p>
                    <p className="mt-1 text-xs text-muted-foreground">{row.message}</p>
                    {row.trackingNumbers.length > 0 ? <p data-no-translate className="mt-1 break-all text-xs text-emerald-700">{row.trackingNumbers.join(', ')}</p> : null}
                  </div>
                  <span className={`inline-flex shrink-0 rounded-full px-2 py-1 text-xs font-medium ${statusClassName}`}>{statusLabel}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="mt-4 flex justify-end gap-2">
        {batch ? (
          <Button type="button" variant="outline" onClick={stopAfterCurrent} disabled={progress?.stopping}>
            중지(진행 중인 주문 이후)
          </Button>
        ) : (
          <Button type="button" variant="outline" onClick={() => window.close()}>닫기</Button>
        )}
      </div>
    </main>
  )
}

export function PurchaseBulk1688TrackingLookup({
  candidates = [],
  mode = 'initial',
  scope = 'provided',
}: {
  candidates?: Purchase1688TrackingLookupCandidate[]
  mode?: Purchase1688TrackingMode
  scope?: 'all' | 'provided'
}) {
  const router = useRouter()
  const progressPopupRef = useRef<Window | null>(null)
  const isRecollectBatch = mode === 'recollect'

  useEffect(() => {
    const refreshOriginatingList = (event: MessageEvent<unknown>) => {
      if (event.origin !== window.location.origin) return
      const message = event.data
      if (!message || typeof message !== 'object') return
      const data = message as { source?: unknown; type?: unknown }
      if (data.source === PAGE_SOURCE && data.type === TRACKING_LOOKUP_COMPLETE) {
        router.refresh()
      }
    }
    window.addEventListener('message', refreshOriginatingList)
    return () => window.removeEventListener('message', refreshOriginatingList)
  }, [router])

  function startBatch() {
    const existingPopup = progressPopupRef.current
    if (existingPopup && !existingPopup.closed) {
      existingPopup.focus()
      toast.info('이미 송장 재수집 작업 창이 열려 있습니다.')
      return
    }

    const runId = crypto.randomUUID()
    const storageKey = purchase1688TrackingPopupStorageKey(runId)
    const payload: Purchase1688TrackingPopupPayload = {
      createdAt: Date.now(),
      mode,
      candidates,
      ...(scope === 'all' ? { scope: 'all' } : {}),
    }

    try {
      window.localStorage.setItem(storageKey, JSON.stringify(payload))
    } catch {
      toast.error('작업 목록을 준비하지 못했습니다. 브라우저 저장공간을 확인한 뒤 다시 시도해주세요.')
      return
    }

    const popupUrl = new URL(TRACKING_POPUP_ROUTE, window.location.origin)
    popupUrl.searchParams.set('runId', runId)
    const popup = window.open(
      popupUrl.toString(),
      'funtastic-1688-tracking-progress',
      'popup=yes,width=980,height=860,resizable=yes,scrollbars=yes',
    )

    if (!popup) {
      try {
        window.localStorage.removeItem(storageKey)
      } catch {
        // The missing popup is the actionable error; stale handoff data expires safely.
      }
      toast.error('일괄조회 작업 창을 열 수 없습니다. 브라우저 팝업 차단을 해제한 뒤 다시 시도해주세요.')
      return
    }

    progressPopupRef.current = popup
    popup.focus()
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={startBatch}
      title={isRecollectBatch
        ? '검수 전체에서 LP로 시작하는 기존 물류번호를 실제 运单号码로 다시 수집합니다. 검수 수량·박스 정보가 있는 항목은 건너뜁니다.'
        : '페이지 수와 관계없이 구매완료 전체를 조회합니다. 주문번호가 없거나 송장이 이미 있는 항목은 자동으로 건너뜁니다.'}
    >
      <Search />
      {isRecollectBatch ? '1688 송장 다시 수집' : '1688 송장 일괄조회'}
    </Button>
  )
}

export function Purchase1688TrackingProgressWindow({ runId }: { runId: string | null }) {
  const normalizedRunId = runId?.trim() ?? ''
  const storageKey = purchase1688TrackingPopupStorageKey(normalizedRunId)
  const [handoff, setHandoff] = useState<{
    payload: Purchase1688TrackingPopupPayload | null
    error: string | null
  } | undefined>(undefined)

  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => { void (async () => {
      if (!normalizedRunId) {
        setHandoff({
          payload: null,
          error: '작업 식별자가 없습니다. 원래 발주 화면에서 다시 시작해주세요.',
        })
        return
      }

      let payload: Purchase1688TrackingPopupPayload | null
      try {
        payload = parsePurchase1688TrackingPopupPayload(window.localStorage.getItem(storageKey))
      } catch {
        setHandoff({
          payload: null,
          error: '작업 정보를 읽지 못했습니다. 브라우저 저장공간을 확인한 뒤 원래 발주 화면에서 다시 시작해주세요.',
        })
        return
      }
      if (!payload) {
        setHandoff({
          payload: null,
          error: '작업 정보를 찾지 못했습니다. 원래 발주 화면에서 다시 시작해주세요.',
        })
        return
      }
      if (Date.now() - payload.createdAt > TRACKING_POPUP_PAYLOAD_MAX_AGE_MS) {
        try {
          window.localStorage.removeItem(storageKey)
        } catch {
          // Expiry only prevents an accidental stale rerun; the error below remains actionable.
        }
        setHandoff({
          payload: null,
          error: '작업 준비 시간이 만료되었습니다. 원래 발주 화면에서 다시 시작해주세요.',
        })
        return
      }
      if (payload.scope === 'all') {
        try {
          const response = await fetch(`/api/purchasing/purchase-requests/1688-tracking-candidates?mode=${payload.mode}`, {
            cache: 'no-store', signal: controller.signal,
          })
          const body = await response.json().catch(() => ({}))
          if (!response.ok) throw new Error(body.error ?? '전체 송장 조회 대상을 불러오지 못했습니다.')
          if (!Array.isArray(body.candidates) || !body.candidates.every(isPurchase1688TrackingCandidate)) {
            throw new Error('전체 송장 조회 대상이 올바르지 않습니다. 다시 시작해주세요.')
          }
          payload = { ...payload, candidates: body.candidates }
        } catch (failure) {
          if (!controller.signal.aborted) setHandoff({ payload: null, error: failure instanceof Error ? failure.message : '전체 송장 조회 대상을 불러오지 못했습니다.' })
          return
        }
      }
      if (!controller.signal.aborted) setHandoff({ payload, error: null })
    })() }, 0)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [normalizedRunId, storageKey])

  if (handoff === undefined) {
    return (
      <main className="flex h-dvh items-center justify-center bg-background p-5 text-sm text-muted-foreground">
        1688 송장 조회 작업을 준비하고 있습니다.
      </main>
    )
  }

  if (!handoff.payload) {
    return (
      <main className="flex h-dvh min-w-[560px] flex-col items-center justify-center gap-4 bg-background p-8 text-center">
        <p className="text-sm text-muted-foreground">{handoff.error ?? '작업 정보를 불러오지 못했습니다.'}</p>
        <Button type="button" variant="outline" onClick={() => window.close()}>닫기</Button>
      </main>
    )
  }

  return (
    <Purchase1688TrackingProgressRunner
      candidates={handoff.payload.candidates}
      mode={handoff.payload.mode}
      runId={normalizedRunId}
      storageKey={storageKey}
    />
  )
}

export function PurchaseBulkInventoryReflectedButton() {
  const router = useRouter()
  const context = useBulkSelection()
  const [message, setMessage] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const selectedCount = context.selectedIds.size

  function reflectSelected() {
    const ids = Array.from(context.selectedIds)
    if (ids.length === 0) return
    if (!window.confirm(`선택한 ${ids.length.toLocaleString('ko-KR')}건이 국내재고에 반영됐습니까?\n처리 후 중국출고완료 목록과 발주 계산에서 제외됩니다.`)) return

    setMessage(null)
    startTransition(async () => {
      const response = await fetch('/api/purchasing/purchase-requests/reflected-outbound', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        setMessage(body.error ?? '재고 반영 완료 처리에 실패했습니다.')
        return
      }
      context.clear()
      setMessage(`${body.reflectedCount.toLocaleString('ko-KR')}건 · ${body.reflectedQuantity.toLocaleString('ko-KR')}개 재고 반영 완료`)
      router.refresh()
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" variant="outline" onClick={reflectSelected} disabled={isPending || selectedCount === 0}>
        {isPending ? <Loader2 className="animate-spin" /> : <Check />}
        선택 {selectedCount.toLocaleString('ko-KR')}건 재고 반영 완료
      </Button>
      {message ? <span className="text-xs text-muted-foreground">{message}</span> : null}
    </div>
  )
}

export function CompletedOutboundDateFilter({
  dates,
  selectedDates,
}: {
  dates: Array<{ date: string; count: number }>
  selectedDates: string[]
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const menuRef = useRef<HTMLDetailsElement>(null)
  const [draftDates, setDraftDates] = useState<string[]>(selectedDates)
  const selectedDateSet = new Set(selectedDates)
  const selectedCount = dates
    .filter((item) => selectedDateSet.has(item.date))
    .reduce((total, item) => total + item.count, 0)
  const selectedLabel = selectedDates.length === 0
    ? '출고날짜 전체'
    : selectedDates.length === 1
      ? (() => {
        const selected = dates.find((item) => item.date === selectedDates[0])
        return selected ? `${selected.date} (${selected.count.toLocaleString('ko-KR')}건)` : selectedDates[0]
      })()
      : `출고날짜 ${selectedDates.length.toLocaleString('ko-KR')}개 선택`

  useEffect(() => {
    setDraftDates(selectedDates)
  }, [selectedDates])

  function applyDates(nextDates: string[]) {
    const params = new URLSearchParams(window.location.search)
    params.delete('outboundDate')
    nextDates.forEach((date) => params.append('outboundDate', date))
    params.delete('page')
    const query = params.toString()
    router.push(query ? `${window.location.pathname}?${query}` : window.location.pathname)
    menuRef.current?.removeAttribute('open')
  }

  function toggleDate(date: string) {
    setDraftDates((current) => (
      current.includes(date)
        ? current.filter((item) => item !== date)
        : [...current, date]
    ))
  }

  function reflectDates() {
    if (selectedDates.length === 0) return
    const selectedDateText = selectedDates.length === 1 ? selectedDates[0] : `${selectedDates.length.toLocaleString('ko-KR')}개 날짜`
    if (!window.confirm(`${selectedDateText} 출고완료 ${selectedCount.toLocaleString('ko-KR')}건을 목록에서 삭제하시겠습니까?`)) return
    if (!window.confirm('정말 삭제하시겠습니까? 국내재고 반영이 완료된 경우에만 진행해주세요.')) return

    startTransition(async () => {
      const response = await fetch('/api/purchasing/purchase-requests/reflected-outbound', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outboundDates: selectedDates }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        toast.error(body.error ?? '출고완료 삭제에 실패했습니다.')
        return
      }
      toast.success(`${body.reflectedCount.toLocaleString('ko-KR')}건 · ${body.reflectedQuantity.toLocaleString('ko-KR')}개 삭제 완료`)
      const params = new URLSearchParams(window.location.search)
      params.delete('outboundDate')
      params.delete('page')
      const query = params.toString()
      router.push(query ? `${window.location.pathname}?${query}` : window.location.pathname)
      router.refresh()
    })
  }

  return (
    <div className="flex max-w-full flex-wrap items-center gap-2">
      <details ref={menuRef} className="relative">
        <summary className="flex h-8 cursor-pointer list-none items-center gap-1 rounded-md border border-input bg-background px-2 text-xs marker:content-none hover:bg-muted">
          <span className="max-w-44 truncate">{selectedLabel}</span>
          <ChevronDown className="size-3 text-muted-foreground" />
        </summary>
        <div className="absolute right-0 z-30 mt-1 w-64 rounded-md border bg-popover p-2 shadow-lg">
          <div className="mb-2 flex items-center justify-between gap-2 border-b pb-2">
            <span className="text-xs font-medium">출고날짜 선택</span>
            <button
              type="button"
              onClick={() => setDraftDates([])}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              전체 선택 해제
            </button>
          </div>
          <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
            {dates.map((item) => (
              <label key={item.date} className="flex cursor-pointer items-center justify-between gap-2 rounded px-1.5 py-1 text-xs hover:bg-muted">
                <span className="flex min-w-0 items-center gap-2">
                  <input
                    type="checkbox"
                    checked={draftDates.includes(item.date)}
                    onChange={() => toggleDate(item.date)}
                    className="size-3.5"
                  />
                  <span>{item.date}</span>
                </span>
                <span className="shrink-0 text-muted-foreground">{item.count.toLocaleString('ko-KR')}건</span>
              </label>
            ))}
          </div>
          <div className="mt-2 flex justify-end border-t pt-2">
            <Button type="button" size="sm" onClick={() => applyDates(draftDates)}>
              {draftDates.length === 0 ? '전체 적용' : `${draftDates.length.toLocaleString('ko-KR')}개 날짜 적용`}
            </Button>
          </div>
        </div>
      </details>
      <Button type="button" size="sm" variant="destructive" disabled={selectedDates.length === 0 || isPending} onClick={reflectDates}>
        {isPending ? <Loader2 className="animate-spin" /> : <Trash2 />}
        선택 날짜 전체 삭제
      </Button>
    </div>
  )
}

export function PurchaseBulkPaymentDialog() {
  const router = useRouter()
  const context = useBulkSelection()
  const [open, setOpen] = useState(false)
  const [dueDate, setDueDate] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const selectedCount = context.selectedIds.size

  function applyBulkPayment(nextPending: boolean) {
    const ids = Array.from(context.selectedIds)
    if (ids.length === 0) return

    setError(null)
    startTransition(async () => {
      const response = await fetch('/api/purchasing/purchase-requests/bulk-update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ids,
          bulkPaymentPending: nextPending,
          bulkPaymentDueDate: nextPending ? dueDate || null : null,
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(body.error ?? '대량결제대기 일괄 저장에 실패했습니다.')
        return
      }

      const updatedCount = Number(body.updatedCount ?? 0)
      const ignoredCount = Number(body.ignoredCount ?? 0)
      context.clear()
      setOpen(false)
      setDueDate('')
      toast.success(
        nextPending
          ? `${updatedCount.toLocaleString('ko-KR')}건을 대량결제대기로 지정했습니다.`
          : `${updatedCount.toLocaleString('ko-KR')}건의 대량결제대기를 해제했습니다.`,
        ignoredCount > 0
          ? { description: `현재 작업공간에서 찾지 못한 ${ignoredCount.toLocaleString('ko-KR')}건은 제외했습니다.` }
          : undefined,
      )
      router.refresh()
    })
  }

  function markBulkPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    applyBulkPayment(true)
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (nextOpen) {
          setDueDate('')
          setError(null)
        }
      }}
    >
      <Dialog.Trigger
        render={(props) => (
          <Button
            {...props}
            type="button"
            size="sm"
            variant="outline"
            disabled={selectedCount === 0}
          >
            <WalletCards />
            선택 대량결제 {selectedCount.toLocaleString('ko-KR')}
          </Button>
        )}
      />
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 w-[min(460px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-background p-5 shadow-xl">
          <Dialog.Title className="text-base font-semibold">대량결제대기 일괄 설정</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted-foreground">
            선택한 {selectedCount.toLocaleString('ko-KR')}개 발주 상품을 한 번에 지정하거나 해제합니다.
          </Dialog.Description>
          <form onSubmit={markBulkPayment} className="mt-4 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="bulk-payment-due-date">대량결제 예정일 (선택)</Label>
              <Input
                id="bulk-payment-due-date"
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
                disabled={isPending}
              />
              <p className="text-xs text-muted-foreground">날짜를 비워두면 예정일 없이 대량결제대기로 표시합니다.</p>
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <div className="flex flex-wrap justify-end gap-2">
              <Dialog.Close
                render={(props) => (
                  <Button {...props} type="button" variant="outline" disabled={isPending}>취소</Button>
                )}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => applyBulkPayment(false)}
                disabled={isPending}
              >
                {isPending ? <Loader2 className="animate-spin" /> : null}
                선택 항목 지정 해제
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? <Loader2 className="animate-spin" /> : <Check />}
                대량결제대기 지정
              </Button>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

type ManualPurchaseCandidate = {
  sku: string
  productName: string
  optionName: string | null
  lastPurchaseDate: string | null
  lastPurchaseQuantity: number | null
  lastPurchaseThreeMonthAverageOutgoing: number | null
  purchaseInProgressQuantity: number
  chinaOutboundScheduledQuantity: number
  domesticCurrentStock: number
  chinaCurrentStock: number
  currentStock: number
  currentMonthOutgoing: number
  threeMonthAverageOutgoing: number
  targetStockQuantity: number
}

type ManualPurchaseDraft = {
  sku: string
  productName: string
  optionName: string
  requestedQuantity: string
}

export function PurchaseRequestCreateDialog({ targetStockMonths }: { targetStockMonths: number }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const initialSku = searchParams.get('purchaseSku') ?? ''
  const initialName = searchParams.get('purchaseName') ?? ''
  const initialOption = searchParams.get('purchaseOption') ?? ''
  const initialDialogKey = initialSku && initialName ? `${initialSku}\u0000${initialName}\u0000${initialOption}` : ''
  const [dismissedInitialDialogKey, setDismissedInitialDialogKey] = useState('')
  const shouldOpenFromSearch = Boolean(initialDialogKey && dismissedInitialDialogKey !== initialDialogKey)
  const [draft, setDraft] = useState<ManualPurchaseDraft>(() => ({
    sku: initialSku,
    productName: initialName,
    optionName: initialOption,
    requestedQuantity: '1',
  }))
  const [candidateQuery, setCandidateQuery] = useState(initialSku || initialName)
  const [candidates, setCandidates] = useState<ManualPurchaseCandidate[]>([])
  const [selectedCandidate, setSelectedCandidate] = useState<ManualPurchaseCandidate | null>(null)
  const [candidateError, setCandidateError] = useState<string | null>(null)
  const [hasSearched, setHasSearched] = useState(false)
  const [isSearching, setIsSearching] = useState(false)
  const candidateRequestRef = useRef(0)

  function updateDraft(field: keyof ManualPurchaseDraft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }))
  }

  async function searchCandidates() {
    const query = candidateQuery.trim()
    if (!query) {
      setCandidateError('품목코드 또는 상품명을 입력해주세요.')
      setCandidates([])
      setHasSearched(false)
      return
    }

    const requestId = candidateRequestRef.current + 1
    candidateRequestRef.current = requestId
    setCandidateError(null)
    setIsSearching(true)
    setHasSearched(true)
    try {
      const params = new URLSearchParams({
        query,
        targetStockMonths: String(targetStockMonths),
      })
      const response = await fetch(`/api/purchasing/purchase-requests/manual-candidates?${params.toString()}`)
      const body = await response.json().catch(() => ({})) as {
        error?: string
        items?: ManualPurchaseCandidate[]
      }
      if (candidateRequestRef.current !== requestId) return
      if (!response.ok) {
        setCandidateError(body.error ?? '품목을 검색하지 못했습니다.')
        setCandidates([])
        return
      }
      setCandidates(Array.isArray(body.items) ? body.items : [])
    } catch {
      if (candidateRequestRef.current === requestId) {
        setCandidateError('품목을 검색하지 못했습니다.')
        setCandidates([])
      }
    } finally {
      if (candidateRequestRef.current === requestId) setIsSearching(false)
    }
  }

  function selectCandidate(candidate: ManualPurchaseCandidate) {
    setSelectedCandidate(candidate)
    setDraft((current) => ({
      ...current,
      sku: candidate.sku,
      productName: candidate.productName,
      optionName: candidate.optionName ?? '',
    }))
    setError(null)
  }

  function addPurchaseRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const requestedQuantity = Number(draft.requestedQuantity)
    if (!Number.isInteger(requestedQuantity) || requestedQuantity < 1 || requestedQuantity > 1_000_000) {
      setError('수량은 1 이상 1,000,000 이하의 정수로 입력해주세요.')
      return
    }

    setError(null)
    startTransition(async () => {
      const response = await fetch('/api/purchasing/purchase-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sku: draft.sku.trim(),
          productName: draft.productName.trim(),
          optionName: draft.optionName.trim() || null,
          requestedQuantity,
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(body.error ?? '발주 항목을 추가하지 못했습니다.')
        return
      }

      setDraft({ sku: '', productName: '', optionName: '', requestedQuantity: '1' })
      setSelectedCandidate(null)
      setOpen(false)
      toast.success('발주검토에 항목을 추가했습니다.')
      router.refresh()
    })
  }

  return (
    <Dialog.Root
      open={open || shouldOpenFromSearch}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen && initialDialogKey) setDismissedInitialDialogKey(initialDialogKey)
        if (nextOpen) setError(null)
      }}
    >
      <Dialog.Trigger
        render={(props) => (
          <Button {...props} type="button" size="sm" variant="outline">
            <Plus />
            수동 추가
          </Button>
        )}
      />
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 max-h-[calc(100vh-2rem)] w-[min(1120px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border bg-background p-5 shadow-xl">
          <Dialog.Title className="text-base font-semibold">발주 항목 수동 추가</Dialog.Title>
          <Dialog.Description className="sr-only">
            품목을 검색한 뒤 상품코드, 상품명, 옵션, 수량을 확인해 발주검토에 추가합니다.
          </Dialog.Description>
          <div className="mt-4 rounded-md border bg-muted/20 p-3">
            <div className="flex flex-col gap-2 md:flex-row md:items-end">
              <div className="min-w-0 flex-1 space-y-1.5">
                <Label htmlFor="manual-purchase-candidate-search">품목 검색</Label>
                <Input
                  id="manual-purchase-candidate-search"
                  value={candidateQuery}
                  onChange={(event) => setCandidateQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return
                    event.preventDefault()
                    void searchCandidates()
                  }}
                  placeholder="상품코드, 상품명, 옵션 검색"
                  autoFocus
                />
              </div>
              <Button type="button" variant="outline" onClick={() => void searchCandidates()} disabled={isSearching}>
                {isSearching ? <Loader2 className="animate-spin" /> : <Search />}
                검색
              </Button>
            </div>
            {candidateError ? <p className="mt-2 text-sm text-destructive">{candidateError}</p> : null}
            {hasSearched && !candidateError && candidates.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">일치하는 품목이 없습니다. 아래 입력칸에 직접 추가할 수 있습니다.</p>
            ) : null}
            {candidates.length > 0 ? (
              <div className="mt-3 max-h-80 space-y-2 overflow-y-auto pr-1">
                {candidates.map((candidate) => {
                  const selected = selectedCandidate?.sku === candidate.sku
                  return (
                    <button
                      key={candidate.sku}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => selectCandidate(candidate)}
                      className={`w-full rounded-md border p-3 text-left transition-colors ${
                        selected ? 'border-primary bg-primary/5' : 'bg-background hover:bg-muted/60'
                      }`}
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        <div className="min-w-0">
                          <span data-no-translate className="font-medium text-foreground">{candidate.productName}</span>
                          <span data-no-translate className="ml-2 text-xs text-muted-foreground">{candidate.sku}</span>
                          {candidate.optionName ? <span data-no-translate className="ml-2 text-xs text-muted-foreground">· {candidate.optionName}</span> : null}
                        </div>
                        <span className="text-xs font-medium text-primary">{selected ? '선택됨' : '선택'}</span>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs tabular-nums sm:grid-cols-3 xl:grid-cols-9">
                        <ManualPurchaseMetric label="최근 발주수량" value={formatManualPurchaseNumber(candidate.lastPurchaseQuantity)} />
                        <ManualPurchaseMetric label="진행 구매수량" value={formatManualPurchaseNumber(candidate.purchaseInProgressQuantity)} />
                        <ManualPurchaseMetric label="중국출고 예정수량" value={formatManualPurchaseNumber(candidate.chinaOutboundScheduledQuantity)} />
                        <ManualPurchaseMetric label="국내재고" value={formatManualPurchaseNumber(candidate.domesticCurrentStock)} />
                        <ManualPurchaseMetric label="중국재고" value={formatManualPurchaseNumber(candidate.chinaCurrentStock)} />
                        <ManualPurchaseMetric label="총 현재고" value={formatManualPurchaseNumber(candidate.currentStock)} />
                        <ManualPurchaseMetric label="당월출고" value={formatManualPurchaseNumber(candidate.currentMonthOutgoing)} />
                        <ManualPurchaseMetric label="3개월평균" value={formatManualPurchaseNumber(candidate.threeMonthAverageOutgoing)} />
                        <ManualPurchaseMetric label="목표수량" value={formatManualPurchaseNumber(candidate.targetStockQuantity)} />
                      </div>
                    </button>
                  )
                })}
              </div>
            ) : null}
          </div>
          <form onSubmit={addPurchaseRequest} className="mt-4">
            <div className="grid gap-3 md:grid-cols-[1.1fr_1.8fr_1.2fr_100px]">
              <div className="space-y-1.5">
                <Label htmlFor="manual-purchase-sku">상품코드</Label>
                <Input
                  id="manual-purchase-sku"
                  name="sku"
                  maxLength={100}
                  required
                  value={draft.sku}
                  onChange={(event) => updateDraft('sku', event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="manual-purchase-product-name">상품명</Label>
                <Input
                  id="manual-purchase-product-name"
                  name="productName"
                  maxLength={500}
                  required
                  value={draft.productName}
                  onChange={(event) => updateDraft('productName', event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="manual-purchase-option-name">옵션</Label>
                <Input
                  id="manual-purchase-option-name"
                  name="optionName"
                  maxLength={200}
                  value={draft.optionName}
                  onChange={(event) => updateDraft('optionName', event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="manual-purchase-quantity">수량</Label>
                <Input
                  id="manual-purchase-quantity"
                  name="requestedQuantity"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={1_000_000}
                  step={1}
                  value={draft.requestedQuantity}
                  onChange={(event) => updateDraft('requestedQuantity', event.target.value)}
                  required
                />
              </div>
            </div>
            {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
            <div className="mt-5 flex justify-end gap-2">
              <Dialog.Close
                render={(props) => (
                  <Button {...props} type="button" variant="outline" disabled={isPending}>취소</Button>
                )}
              />
              <Button type="submit" disabled={isPending}>
                {isPending ? <Loader2 className="animate-spin" /> : <Plus />}
                추가
              </Button>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function ManualPurchaseMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="ml-1 font-medium text-foreground">{value}</span>
    </div>
  )
}

function formatManualPurchaseNumber(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '-'
  return value.toLocaleString('ko-KR', { maximumFractionDigits: 1 })
}

export function PurchaseRequestExcelActions({
  exportHref,
  defaultStatus,
}: {
  exportHref: string
  defaultStatus: PurchaseRequestStatus
}) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function upload() {
    const file = inputRef.current?.files?.[0]
    if (!file) {
      setError('업로드할 엑셀 파일을 선택해주세요.')
      return
    }
    setMessage(null)
    setError(null)
    startTransition(async () => {
      const form = new FormData()
      form.set('file', file)
      const response = await fetch(`/api/purchasing/purchase-requests/import?defaultStatus=${defaultStatus}`, {
        method: 'POST',
        body: form,
      })
      const body = await response.json().catch(() => ({})) as Partial<PurchaseRequestExcelResult> & { error?: string }
      if (!response.ok) {
        setError(body.error ?? '발주 엑셀 업로드에 실패했습니다.')
        return
      }
      if (body.duplicate) {
        setMessage('이미 반영된 동일 파일입니다.')
        if (inputRef.current) inputRef.current.value = ''
        return
      }
      const skippedText = body.skipped ? ` · 제외 ${body.skipped.toLocaleString('ko-KR')}건` : ''
      setMessage(
        `생성 ${(body.created ?? 0).toLocaleString('ko-KR')}건 · 수정 ${(body.updated ?? 0).toLocaleString('ko-KR')}건${skippedText}`,
      )
      if (body.errors?.length) {
        const firstError = body.errors[0]
        setError(`${firstError.row.toLocaleString('ko-KR')}행: ${firstError.message}`)
      }
      if (inputRef.current) inputRef.current.value = ''
      router.refresh()
    })
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <a
        href={exportHref}
        className="inline-flex h-7 items-center justify-center gap-1 rounded-md border border-border bg-background px-2.5 text-[0.8rem] font-medium whitespace-nowrap hover:bg-muted"
      >
        <Download />
        엑셀 다운로드
      </a>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls"
        className="h-7 max-w-52 rounded-md border border-input bg-background px-2 py-0.5 text-xs"
      />
      <Button type="button" size="sm" variant="outline" onClick={upload} disabled={isPending}>
        {isPending ? <Loader2 className="animate-spin" /> : <Upload />}
        엑셀 업로드
      </Button>
      {message ? <span className="text-xs text-muted-foreground">{message}</span> : null}
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </div>
  )
}

export function PurchaseReviewStatusFilter({
  selectedStatuses,
  statusCounts,
}: {
  selectedStatuses: readonly PurchaseReviewListStatus[]
  statusCounts: Record<PurchaseReviewListStatus, number>
}) {
  return (
    <PurchaseReviewStatusFilterControl
      key={selectedStatuses.join('|')}
      selectedStatuses={selectedStatuses}
      statusCounts={statusCounts}
    />
  )
}

function PurchaseReviewStatusFilterControl({
  selectedStatuses,
  statusCounts,
}: {
  selectedStatuses: readonly PurchaseReviewListStatus[]
  statusCounts: Record<PurchaseReviewListStatus, number>
}) {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [optimisticStatuses, setOptimisticStatuses] = useState<PurchaseReviewListStatus[]>([...selectedStatuses])
  const [isPending, startTransition] = useTransition()

  const selected = new Set(optimisticStatuses)

  function toggle(status: PurchaseReviewListStatus) {
    const next = new Set(selected)
    if (next.has(status)) {
      if (next.size === 1) return
      next.delete(status)
    } else {
      next.add(status)
    }

    const nextStatuses = PURCHASE_REVIEW_STATUS_OPTIONS
      .filter((option) => next.has(option.value))
      .map((option) => option.value)
    setOptimisticStatuses(nextStatuses)

    const params = new URLSearchParams(searchParams.toString())
    params.delete('reviewStatus')
    PURCHASE_REVIEW_STATUS_OPTIONS.forEach((option) => {
      if (next.has(option.value)) params.append('reviewStatus', option.value)
    })
    params.delete('page')
    const query = params.toString()
    startTransition(() => {
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
    })
  }

  return (
    <fieldset aria-busy={isPending} className="flex h-7 items-center gap-2 rounded-md border border-border bg-background px-2 text-xs">
      <legend className="sr-only">발주상태 필터</legend>
      <span className="whitespace-nowrap text-muted-foreground">발주상태</span>
      {PURCHASE_REVIEW_STATUS_OPTIONS.map((option) => {
        const checked = selected.has(option.value)
        return (
          <label key={option.value} className="flex cursor-pointer items-center gap-1 whitespace-nowrap text-foreground">
            <input
              type="checkbox"
              checked={checked}
              disabled={checked && selected.size === 1}
              onChange={() => toggle(option.value)}
              className="h-3.5 w-3.5"
            />
            {option.label} {statusCounts[option.value].toLocaleString('ko-KR')}
          </label>
        )
      })}
      {isPending ? <Loader2 className="size-3 animate-spin text-muted-foreground" aria-label="발주상태 적용 중" /> : null}
    </fieldset>
  )
}

export function PurchasePaginationControls({
  basePath,
  status,
  search,
  outboundDates,
  showCosts,
  showRecommendationBasis,
  sort,
  order,
  page,
  pageSize,
  totalPages,
  reviewStatuses,
  idSuffix = 'default',
}: {
  basePath: string
  status: PurchaseRequestStatus | undefined
  search: string | undefined
  outboundDates: string[]
  showCosts: boolean
  showRecommendationBasis: boolean
  sort: string | undefined
  order: 'asc' | 'desc'
  page: number
  pageSize: number
  totalPages: number
  reviewStatuses?: readonly PurchaseReviewListStatus[]
  idSuffix?: string
}) {
  const router = useRouter()
  const [pageInput, setPageInput] = useState(String(page))

  function href(nextPage: number, nextPageSize: number) {
    const params = new URLSearchParams()
    if (status) params.set('status', status)
    if (search) params.set('search', search)
    outboundDates.forEach((date) => params.append('outboundDate', date))
    if (showCosts) params.set('showCosts', '1')
    params.set('showRecommendationBasis', showRecommendationBasis ? '1' : '0')
    if (sort) params.set('sort', sort)
    if (order) params.set('order', order)
    reviewStatuses?.forEach((status) => params.append('reviewStatus', status))
    if (nextPage > 1) params.set('page', String(nextPage))
    if (nextPageSize !== 50) params.set('pageSize', String(nextPageSize))
    const query = params.toString()
    return query ? `${basePath}?${query}` : basePath
  }

  function moveToPage(nextPage: number) {
    const clampedPage = Math.min(totalPages, Math.max(1, nextPage))
    router.push(href(clampedPage, pageSize))
  }

  function submitPage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const requestedPage = Number.parseInt(pageInput, 10)
    moveToPage(Number.isFinite(requestedPage) ? requestedPage : page)
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span>목록 보기</span>
        <select
          value={pageSize}
          onChange={(event) => router.push(href(1, Number(event.target.value)))}
          className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground"
          aria-label="목록 보기 개수"
        >
          {[10, 50, 100, 200].map((size) => (
            <option key={size} value={size}>{size}개</option>
          ))}
        </select>
      </label>
      <form onSubmit={submitPage} className="flex items-center gap-1.5">
        <label htmlFor={`purchase-page-jump-${idSuffix}`} className="sr-only">이동할 페이지</label>
        <input
          id={`purchase-page-jump-${idSuffix}`}
          type="number"
          inputMode="numeric"
          min={1}
          max={totalPages}
          value={pageInput}
          onChange={(event) => setPageInput(event.target.value)}
          className="h-8 w-16 rounded-md border border-input bg-background px-2 text-center text-sm tabular-nums"
        />
        <span className="whitespace-nowrap text-xs text-muted-foreground">/ {totalPages.toLocaleString('ko-KR')}</span>
        <Button type="submit" variant="outline" size="sm">이동</Button>
      </form>
    </div>
  )
}


export function PurchaseBulkDeleteButton() {
  const router = useRouter()
  const context = useBulkSelection()
  const [message, setMessage] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const selectedCount = context.selectedIds.size

  function removeSelected() {
    const ids = Array.from(context.selectedIds)
    if (ids.length === 0) return
    if (!window.confirm(`선택한 ${ids.length.toLocaleString('ko-KR')}건을 삭제할까요?`)) return
    setMessage(null)
    startTransition(async () => {
      let deletedCount = 0
      const failedMessages: string[] = []
      for (const id of ids) {
        const response = await fetch(`/api/purchasing/purchase-requests/${id}`, {
          method: 'DELETE',
        })
        if (response.ok) {
          deletedCount += 1
        } else {
          const body = await response.json().catch(() => ({}))
          failedMessages.push(typeof body.error === 'string' ? body.error : '삭제하지 못한 항목이 있습니다.')
        }
      }
      context.clear()
      if (failedMessages.length > 0) {
        const firstReason = failedMessages[0]
        setMessage(`${deletedCount.toLocaleString('ko-KR')}건 삭제 · ${failedMessages.length.toLocaleString('ko-KR')}건 제외: ${firstReason}`)
      } else {
        setMessage(`${deletedCount.toLocaleString('ko-KR')}건 삭제`)
      }
      router.refresh()
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" variant="destructive" onClick={removeSelected} disabled={isPending || selectedCount === 0}>
        {isPending ? <Loader2 className="animate-spin" /> : <Trash2 />}
        선택 삭제 {selectedCount.toLocaleString('ko-KR')}
      </Button>
      {message ? <span className="text-xs text-muted-foreground">{message}</span> : null}
    </div>
  )
}

export function PurchasePaymentFlowBulkActions() {
  const router = useRouter()
  const context = useBulkSelection()
  const [pendingAction, setPendingAction] = useState<'complete' | 'delete' | null>(null)
  const selectedCount = context.selectedIds.size

  async function completeSelected() {
    const ids = Array.from(context.selectedIds)
    if (ids.length === 0) return
    if (!window.confirm(
      `선택한 ${ids.length.toLocaleString('ko-KR')}건을 완료 처리할까요?\n이미 국내 입고 및 재고 반영이 끝난 건만 완료하세요.\n국내재고는 바뀌지 않으며, 연결된 중국재고는 출고 완료로 정리됩니다.`,
    )) return

    setPendingAction('complete')
    try {
      const response = await fetch('/api/purchasing/purchase-requests/bulk-complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      })
      const body = await response.json().catch(() => ({}))
      const completedCount = Number(body.completedCount ?? 0)
      const ineligibleCount = Number(body.ineligibleCount ?? 0)
      const missingCount = Number(body.missingCount ?? 0)
      if (!response.ok) {
        toast.error(body.error ?? '선택 항목 완료 처리에 실패했습니다.')
        return
      }

      context.clear()
      if (completedCount > 0) {
        toast.success(`${completedCount.toLocaleString('ko-KR')}건을 완료 처리했습니다.`, ineligibleCount > 0
          ? { description: `이미 완료됐거나 결제 대기 항목이 아닌 ${ineligibleCount.toLocaleString('ko-KR')}건은 제외했습니다.` }
          : missingCount > 0
            ? { description: `이미 없어진 ${missingCount.toLocaleString('ko-KR')}건은 제외했습니다.` }
            : undefined)
      } else {
        toast.info('완료 처리할 결제 대기 항목을 찾지 못했습니다.')
      }
      router.refresh()
    } catch {
      toast.error('선택 항목 완료 처리 중 연결 오류가 발생했습니다.')
    } finally {
      setPendingAction(null)
    }
  }

  async function deleteSelected() {
    const ids = Array.from(context.selectedIds)
    if (ids.length === 0) return
    if (!window.confirm(`선택한 ${ids.length.toLocaleString('ko-KR')}건을 정말 삭제할까요?\n삭제한 발주 항목은 복구할 수 없습니다.`)) return

    setPendingAction('delete')
    try {
      const response = await fetch('/api/purchasing/purchase-requests/bulk-delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        toast.error(body.error ?? '선택 항목 삭제에 실패했습니다.')
        return
      }

      const deletedCount = Number(body.deletedCount ?? 0)
      const inventoryLinkedCount = Number(body.inventoryLinkedCount ?? 0)
      const ineligibleCount = Number(body.ineligibleCount ?? 0)
      const missingCount = Number(body.missingCount ?? 0)
      context.clear()
      if (deletedCount > 0) {
        toast.success(`${deletedCount.toLocaleString('ko-KR')}건을 삭제했습니다.`, inventoryLinkedCount > 0
          ? { description: `중국재고 이동이 연결된 ${inventoryLinkedCount.toLocaleString('ko-KR')}건은 보호했습니다. 해당 건은 완료 처리해주세요.` }
          : ineligibleCount > 0
            ? { description: `결제 대기 항목이 아닌 ${ineligibleCount.toLocaleString('ko-KR')}건은 제외했습니다.` }
          : missingCount > 0
            ? { description: `이미 없어진 ${missingCount.toLocaleString('ko-KR')}건은 제외했습니다.` }
            : undefined)
      } else if (inventoryLinkedCount > 0) {
        toast.warning('중국재고 이동이 연결된 항목은 삭제할 수 없습니다.', {
          description: `${inventoryLinkedCount.toLocaleString('ko-KR')}건을 완료 처리해주세요.`,
        })
      } else {
        toast.info('삭제할 항목을 찾지 못했습니다.')
      }
      router.refresh()
    } catch {
      toast.error('선택 항목 삭제 중 연결 오류가 발생했습니다.')
    } finally {
      setPendingAction(null)
    }
  }

  return (
    <div className="flex max-w-full flex-wrap items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={completeSelected}
        disabled={pendingAction !== null || selectedCount === 0}
      >
        {pendingAction === 'complete' ? <Loader2 className="animate-spin" /> : <Check />}
        선택 {selectedCount.toLocaleString('ko-KR')}건 완료
      </Button>
      <Button
        type="button"
        size="sm"
        variant="destructive"
        onClick={deleteSelected}
        disabled={pendingAction !== null || selectedCount === 0}
      >
        {pendingAction === 'delete' ? <Loader2 className="animate-spin" /> : <Trash2 />}
        선택 {selectedCount.toLocaleString('ko-KR')}건 삭제
      </Button>
    </div>
  )
}

/** Payment-only completion for the bulk-payment balance list. */
export function PurchaseBulkPaymentCompletionActions() {
  const router = useRouter()
  const context = useBulkSelection()
  const [isPending, startTransition] = useTransition()
  const selectedCount = context.selectedIds.size

  function completeSelectedBulkPayment() {
    const ids = Array.from(context.selectedIds)
    if (ids.length === 0) return
    if (!window.confirm(
      `선택한 ${ids.length.toLocaleString('ko-KR')}건을 결제 완료 처리할까요?\n발주 단계·재고·선금 내역은 바뀌지 않고, 결제 대기 목록에서만 제외됩니다.`,
    )) return

    startTransition(async () => {
      try {
        const response = await fetch('/api/purchasing/purchase-requests/bulk-payment-complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids }),
        })
        const body = await response.json().catch(() => ({}))
        const completedCount = Number(body.completedCount ?? 0)
        const ineligibleCount = Number(body.ineligibleCount ?? 0)
        const missingCount = Number(body.missingCount ?? 0)
        if (!response.ok) {
          toast.error(body.error ?? '대량결제 결제 완료 처리에 실패했습니다.')
          return
        }

        context.clear()
        if (completedCount > 0) {
          toast.success(`${completedCount.toLocaleString('ko-KR')}건을 결제 완료 처리했습니다.`, ineligibleCount > 0
            ? { description: `이미 완료됐거나 대량결제대기 상태가 아닌 ${ineligibleCount.toLocaleString('ko-KR')}건은 제외했습니다.` }
            : missingCount > 0
              ? { description: `이미 없어진 ${missingCount.toLocaleString('ko-KR')}건은 제외했습니다.` }
              : { description: '발주 단계·재고·선금 내역은 유지하고 결제 대기 목록에서만 제외했습니다.' })
        } else {
          toast.info('결제 완료 처리할 대량결제 항목을 찾지 못했습니다.')
        }
        router.refresh()
      } catch {
        toast.error('대량결제 결제 완료 처리 중 연결 오류가 발생했습니다.')
      }
    })
  }

  return (
    <Button
      type="button"
      size="sm"
      onClick={completeSelectedBulkPayment}
      disabled={isPending || selectedCount === 0}
    >
      {isPending ? <Loader2 className="animate-spin" /> : <Check />}
      선택 {selectedCount.toLocaleString('ko-KR')}건 결제 완료
    </Button>
  )
}

function useBulkSelection() {
  const context = useContext(BulkSelectionContext)
  if (!context) throw new Error('Purchase bulk selection context is missing.')
  return context
}

const TARGET_STOCK_MONTHS_STORAGE_KEY = 'purchase-recommendation-target-stock-months'

export function PurchaseRecommendationGenerator({
  initialTargetStockMonths = 1.2,
}: {
  initialTargetStockMonths?: number
}) {
  const [targetStockMonths, setTargetStockMonths] = useState(String(initialTargetStockMonths))
  const [budgetKrw, setBudgetKrw] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeJobId, setActiveJobId] = useState<string | null>(null)
  const [isDownloadingComparison, setIsDownloadingComparison] = useState(false)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    const storedTargetStockMonths = localStorage.getItem(TARGET_STOCK_MONTHS_STORAGE_KEY)
    if (!storedTargetStockMonths) return
    const months = Number(storedTargetStockMonths)
    if (Number.isFinite(months) && months >= 0.1 && months <= 12) {
      setTargetStockMonths(storedTargetStockMonths)
    }
  }, [])

  useEffect(() => {
    const storedJobId = sessionStorage.getItem('purchase-recommendation-job-id')
    if (storedJobId) setActiveJobId(storedJobId)
  }, [])

  useEffect(() => {
    if (!activeJobId) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    async function poll() {
      try {
        const response = await fetch(
          `/api/purchasing/purchase-requests/recommendations/status?id=${encodeURIComponent(activeJobId!)}`,
          { cache: 'no-store' },
        )
        const body = await response.json().catch(() => ({}))
        if (!response.ok) {
          const statusError = body.error ?? '추천 작업 상태를 확인하지 못했습니다.'
          if (response.status === 400 || response.status === 404) {
            sessionStorage.removeItem('purchase-recommendation-job-id')
            setActiveJobId(null)
            setError(statusError)
            return
          }
          throw new Error(statusError)
        }
        if (cancelled) return

        const job = body.job as {
          status: string
          progressMessage: string | null
          errorMessage: string | null
        }
        if (job.status === 'completed') {
          setMessage(job.progressMessage ?? '추천 계산이 완료되었습니다.')
          setError(null)
          sessionStorage.removeItem('purchase-recommendation-job-id')
          setActiveJobId(null)
          window.location.reload()
          return
        }
        if (job.status === 'failed' || job.status === 'cancelled') {
          setMessage(null)
          setError(job.errorMessage ?? '추천 계산에 실패했습니다.')
          sessionStorage.removeItem('purchase-recommendation-job-id')
          setActiveJobId(null)
          return
        }

        setMessage(job.progressMessage ?? '추천 계산 중입니다.')
        setError(null)
        timer = setTimeout(poll, 1500)
      } catch (pollError) {
        if (cancelled) return
        setError(pollError instanceof Error ? pollError.message : '추천 작업 상태를 확인하지 못했습니다.')
        timer = setTimeout(poll, 3000)
      }
    }

    void poll()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [activeJobId])

  function generate() {
    const months = Number(targetStockMonths)
    if (!Number.isFinite(months) || months < 0.1 || months > 12) {
      setError('목표 보유개월은 0.1~12 사이로 입력해주세요.')
      return
    }
    const budget = budgetKrw.trim() === '' ? null : Number(budgetKrw)
    if (budget !== null && (!Number.isFinite(budget) || budget <= 0 || budget > 10_000_000_000)) {
      setError('구매예산은 1원~100억원 사이로 입력해주세요.')
      return
    }

    setMessage(null)
    setError(null)
    localStorage.setItem(TARGET_STOCK_MONTHS_STORAGE_KEY, String(months))
    startTransition(async () => {
      try {
        const response = await fetch('/api/purchasing/purchase-requests/recommendations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetStockMonths: months, budgetKrw: budget }),
        })
        const body = await response.json().catch(() => ({}))
        if (!response.ok) {
          setError(body.error ?? '자동 발주 추천 생성에 실패했습니다.')
          return
        }
        if (!body.accepted || typeof body.jobId !== 'string') {
          setError('추천 작업 ID를 받지 못했습니다.')
          return
        }

        sessionStorage.setItem('purchase-recommendation-job-id', body.jobId)
        setActiveJobId(body.jobId)
        setMessage('추천 계산 대기 중')
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : '자동 발주 추천 생성에 실패했습니다.')
      }
    })
  }

  async function downloadBudgetComparison() {
    setError(null)
    setIsDownloadingComparison(true)
    try {
      const response = await fetch('/api/purchasing/purchase-requests/budget-comparison', { cache: 'no-store' })
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error ?? '예산 비교 엑셀을 다운로드하지 못했습니다.')
      }
      const blob = await response.blob()
      const objectUrl = URL.createObjectURL(blob)
      const encodedName = response.headers.get('content-disposition')?.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = encodedName ? decodeURIComponent(encodedName) : '발주_예산비교.xlsx'
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : '예산 비교 엑셀을 다운로드하지 못했습니다.')
    } finally {
      setIsDownloadingComparison(false)
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border bg-background p-3 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-medium">자동 발주 추천</p>
        <p className="text-xs text-muted-foreground">
          기존 자동 검토행은 유지한 채 판매 추세·재고·진행 발주를 다시 계산합니다. 발주요청으로 넘긴 건은 바꾸지 않습니다.
        </p>
        {message && <p className="mt-1 text-xs text-emerald-700">{message}</p>}
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        <label className="text-xs text-muted-foreground" htmlFor="target-stock-months">
          목표 보유개월
        </label>
        <Input
          id="target-stock-months"
          type="number"
          min="0.1"
          max="12"
          step="0.1"
          value={targetStockMonths}
          onChange={(event) => {
            const value = event.target.value
            setTargetStockMonths(value)
            const months = Number(value)
            if (Number.isFinite(months) && months >= 0.1 && months <= 12) {
              localStorage.setItem(TARGET_STOCK_MONTHS_STORAGE_KEY, value)
            }
          }}
          className="h-9 w-24"
        />
        <label className="text-xs text-muted-foreground" htmlFor="purchase-budget-krw">
          구매예산
        </label>
        <div className="relative">
          <WalletCards className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="purchase-budget-krw"
            type="text"
            inputMode="numeric"
            placeholder="원화 예산"
            value={formatBudgetKrwInput(budgetKrw)}
            onChange={(event) => setBudgetKrw(event.target.value.replace(/\D/g, '').slice(0, 11))}
            className="h-9 w-36 pl-8"
          />
        </div>
        <Button type="button" onClick={generate} disabled={isPending || activeJobId !== null}>
          {isPending || activeJobId !== null ? <Loader2 className="animate-spin" /> : <Sparkles />}
          {activeJobId ? '계산 중' : '추천 계산'}
        </Button>
        <Button type="button" variant="outline" title="가장 최근에 예산을 적용한 계산의 비교 결과" onClick={downloadBudgetComparison} disabled={isDownloadingComparison || isPending || activeJobId !== null}>
          {isDownloadingComparison ? <Loader2 className="animate-spin" /> : <Download />}
          예산 비교 엑셀
        </Button>
      </div>
    </div>
  )
}

export function PurchaseStatusButton({
  id,
  nextStatus,
  saasChinaMode = false,
  arrivalInventoryId,
  canOpenChinaShipments = true,
}: {
  id: string
  nextStatus: PurchaseRequestStatus | null
  saasChinaMode?: boolean
  arrivalInventoryId?: string | null
  canOpenChinaShipments?: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  if (!nextStatus) return null

  if (saasChinaMode && (nextStatus === 'outbound_requested' || nextStatus === 'completed')) {
    if (!canOpenChinaShipments) return null
    const href = nextStatus === 'outbound_requested' && arrivalInventoryId
      ? `/purchasing/china-shipments?create=1&inventoryId=${encodeURIComponent(arrivalInventoryId)}`
      : '/purchasing/china-shipments'
    return (
        <Link
          href={href}
          className="inline-flex h-7 items-center justify-center rounded-[min(var(--radius-md),12px)] border border-border bg-background px-2.5 text-[0.8rem] font-medium whitespace-nowrap hover:bg-muted"
        >
          {nextStatus === 'outbound_requested' && arrivalInventoryId ? '중국출고요청' : '중국출고에서 작업'}
        </Link>
    )
  }

  function moveStatus() {
    startTransition(async () => {
      const response = await fetch(`/api/purchasing/purchase-requests/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      })
      if (response.ok) {
        router.refresh()
        return
      }
      const body = await response.json().catch(() => ({}))
      window.alert(body.error ?? '진행상태 변경에 실패했습니다.')
    })
  }

  return (
    <Button type="button" size="sm" variant="outline" onClick={moveStatus} disabled={isPending}>
      {isPending ? <Loader2 className="animate-spin" /> : <Check />}
      {PURCHASE_REQUEST_STATUS_LABELS[nextStatus]}로 이동
    </Button>
  )
}

export function PurchaseArrivalWarehouseField({ id, warehouse }: { id: string; warehouse?: string }) {
  const router = useRouter()
  const [selected, setSelected] = useState(warehouse ?? '')
  const [pending, startTransition] = useTransition()

  return <select aria-label="입고 창고" value={selected} disabled={pending}
    className="h-7 min-w-32 whitespace-nowrap rounded-md border border-input bg-background pl-2 pr-7 text-xs"
    onChange={(event) => {
      const next = event.target.value
      const previous = selected
      setSelected(next)
      startTransition(async () => {
        try {
          const response = await fetch(`/api/purchasing/purchase-requests/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ arrivalWarehouseCode: next }),
          })
          if (!response.ok) {
            const body = await response.json().catch(() => ({}))
            throw new Error(body.error ?? '입고 창고를 저장하지 못했습니다.')
          }
          router.refresh()
        } catch (error) {
          setSelected(previous)
          toast.error(error instanceof Error ? error.message : '입고 창고를 저장하지 못했습니다.')
        }
      })
    }}>
    <option value="" disabled>창고 선택</option>
    {warehouse && !PURCHASE_ARRIVAL_WAREHOUSES.some((option) => option === warehouse) ? <option value={warehouse} disabled data-no-translate>{warehouse}</option> : null}
    {PURCHASE_ARRIVAL_WAREHOUSES.map((option) => <option key={option} value={option}>{option}</option>)}
  </select>
}

export function PurchasePaymentStatusField({
  id,
  paymentStatus,
  paidAt,
  enabled,
  bulkPaymentPending,
  bulkPaymentDueDate,
}: {
  id: string
  paymentStatus: string | null
  paidAt: string | Date | null
  enabled: boolean
  bulkPaymentPending: boolean
  bulkPaymentDueDate: string | null
}) {
  const router = useRouter()
  const initialValue = isPurchasePaymentStatus(paymentStatus) ? paymentStatus : 'pending'
  const [value, setValue] = useState<PurchasePaymentStatus>(initialValue)
  const [isBulkPending, setIsBulkPending] = useState(bulkPaymentPending)
  const [dueDate, setDueDate] = useState(bulkPaymentDueDate ?? '')
  const [isPending, startTransition] = useTransition()

  function savePaymentStatus(nextValue: PurchasePaymentStatus) {
    const previousValue = value
    setValue(nextValue)
    startTransition(async () => {
      const response = await fetch(`/api/purchasing/purchase-requests/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentStatus: nextValue }),
      })
      if (response.ok) {
        router.refresh()
        return
      }
      setValue(previousValue)
      window.alert('결제 상태 저장에 실패했습니다.')
    })
  }

  function saveBulkPayment(nextPending: boolean, nextDueDate = dueDate) {
    const previousPending = isBulkPending
    const previousDueDate = dueDate
    setIsBulkPending(nextPending)
    setDueDate(nextPending ? nextDueDate : '')
    startTransition(async () => {
      const response = await fetch(`/api/purchasing/purchase-requests/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bulkPaymentPending: nextPending,
          bulkPaymentDueDate: nextPending ? nextDueDate || null : null,
        }),
      })
      if (response.ok) {
        router.refresh()
        return
      }
      setIsBulkPending(previousPending)
      setDueDate(previousDueDate)
      window.alert('대량결제대기 저장에 실패했습니다.')
    })
  }

  return (
    <div className="flex flex-col items-center text-center">
      {enabled ? (
        <select
          value={value}
          onChange={(event) => savePaymentStatus(event.target.value as PurchasePaymentStatus)}
          disabled={isPending}
          aria-label="결제 상태"
          className="h-7 min-w-[104px] rounded-md border border-input bg-background px-2 text-xs"
        >
          {PURCHASE_PAYMENT_STATUSES.map((status) => (
            <option key={status} value={status}>{PURCHASE_PAYMENT_STATUS_LABELS[status]}</option>
          ))}
        </select>
      ) : (
        <div className="whitespace-nowrap text-xs font-medium text-muted-foreground">구매 전</div>
      )}
      <label className="mt-1 flex items-center justify-center gap-1 whitespace-nowrap text-[11px] font-medium text-amber-700">
        <input
          type="checkbox"
          checked={isBulkPending}
          disabled={isPending}
          onChange={(event) => saveBulkPayment(event.target.checked)}
        />
        대량결제대기
      </label>
      {isBulkPending ? (
        <input
          type="date"
          value={dueDate}
          disabled={isPending}
          aria-label="대량결제 예정일"
          onChange={(event) => saveBulkPayment(true, event.target.value)}
          className="mt-1 h-7 w-[128px] rounded-md border border-input bg-background px-1.5 text-xs"
        />
      ) : null}
      {value === 'paid' && paidAt ? (
        <div className="mt-1 whitespace-nowrap text-[11px] text-muted-foreground">{formatDateInput(paidAt)} 결제</div>
      ) : null}
    </div>
  )
}

export function PurchaseQuantityField({
  id,
  field,
  quantity,
  stockLimit,
  costSummary,
}: {
  id: string
  field: 'requestedQuantity' | 'actualPurchaseQuantity' | 'chinaReceivedQuantity' | 'outboundRequestedQuantity'
  quantity: number
  stockLimit?: number | null
  costSummary?: {
    unitCostYuan: number | null
    unitCostKrw: number | null
  }
}) {
  const router = useRouter()
  const [value, setValue] = useState(String(quantity))
  const [savedValue, setSavedValue] = useState(String(quantity))
  const [message, setMessage] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const previewQuantity = parseQuantityPreview(value, quantity)
  const totalCostYuan = costSummary?.unitCostYuan === null || costSummary?.unitCostYuan === undefined
    ? null
    : costSummary.unitCostYuan * previewQuantity
  const totalCostKrw = costSummary?.unitCostKrw === null || costSummary?.unitCostKrw === undefined
    ? null
    : costSummary.unitCostKrw * previewQuantity

  function save() {
    const nextQuantity = Number(value)
    const minimum = field === 'requestedQuantity' ? 1 : 0
    if (!Number.isInteger(nextQuantity) || nextQuantity < minimum) {
      setMessage(field === 'requestedQuantity' ? '1 이상 정수' : '0 이상 정수')
      return
    }
    if (String(nextQuantity) === savedValue) {
      setMessage(null)
      return
    }

    setMessage('저장 중')
    startTransition(async () => {
      const response = await fetch(`/api/purchasing/purchase-requests/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: nextQuantity }),
      })
      if (response.ok) {
        const nextValue = String(nextQuantity)
        setSavedValue(nextValue)
        setValue(nextValue)
        setMessage(null)
        router.refresh()
        return
      }
      setMessage('저장 실패')
    })
  }

  function saveOnEnter(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return
    event.preventDefault()
    event.currentTarget.blur()
  }

  return (
    <div className="mx-auto w-max min-w-28">
      <div className="flex items-center justify-center gap-1">
        <Input
          type="number"
          min={field === 'requestedQuantity' ? 1 : 0}
          step={1}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onBlur={save}
          onKeyDown={saveOnEnter}
          disabled={isPending}
          aria-label="수량"
          className="h-7 w-24 shrink-0 px-2 text-center text-xs tabular-nums"
        />
        {stockLimit !== undefined && stockLimit !== null ? (
          <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground tabular-nums">
            /{stockLimit.toLocaleString('ko-KR')}
          </span>
        ) : null}
      </div>
      {costSummary ? (
        <div className="mt-1 space-y-0.5 text-center text-[11px] leading-tight tabular-nums">
          <div className="whitespace-nowrap font-semibold text-foreground">
            총 元 {formatCostValue(totalCostYuan, 2)} / ₩ {formatCostValue(totalCostKrw, 0)}
          </div>
          <div className="whitespace-nowrap text-muted-foreground">
            개당 元 {formatCostValue(costSummary.unitCostYuan, 2)} / ₩ {formatCostValue(costSummary.unitCostKrw, 0)}
          </div>
        </div>
      ) : null}
      {message ? (
        <div className={message === '저장 중' ? 'sr-only' : 'mt-1 text-center text-[11px] text-destructive'}>
          {message}
        </div>
      ) : null}
    </div>
  )
}

export function PurchaseDeleteButton({
  id,
  productName,
}: {
  id: string
  productName: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  function remove() {
    if (!window.confirm(`${productName} 발주 항목을 삭제할까요?`)) return
    startTransition(async () => {
      const response = await fetch(`/api/purchasing/purchase-requests/${id}`, {
        method: 'DELETE',
      })
      if (response.ok) router.refresh()
      else {
        const body = await response.json().catch(() => ({}))
        window.alert(body.error ?? '삭제에 실패했습니다.')
      }
    })
  }

  return (
    <Button type="button" size="sm" variant="destructive" onClick={remove} disabled={isPending}>
      {isPending ? <Loader2 className="animate-spin" /> : <Trash2 />}
      삭제
    </Button>
  )
}

export function PurchasePlanFieldsV2({
  id,
  supplierOrderNumber,
  trackingNumber,
  showTrackingNumber,
  dateValue,
  dateField,
  dateLabel,
  dateColumn,
  afterFields,
  trackingSaveMode = 'plan',
  fitWidth = false,
  compact = false,
}: {
  id: string
  supplierOrderNumber: string | null
  trackingNumber: string | null
  showTrackingNumber: boolean
  dateValue: string | Date | null
  dateField: 'requestDate' | 'outboundExpectedDate'
  dateLabel: string
  dateColumn?: string
  afterFields?: ReactNode
  /** Inspection rows update their primary parcel through the inspection API. */
  trackingSaveMode?: 'plan' | 'inspection'
  /** Wrap the controls inside a viewport-fitting list without changing their values. */
  fitWidth?: boolean
  /** Keep editable values on one compact table row. */
  compact?: boolean
}) {
  const router = useRouter()
  const [message, setMessage] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [savedSupplierOrderNumber, setSavedSupplierOrderNumber] = useState(() => supplierOrderNumber?.trim() ?? '')
  const [savedTrackingNumber, setSavedTrackingNumber] = useState(() => trackingNumber?.trim() ?? '')
  const [savedDateValue, setSavedDateValue] = useState(() => formatDateInput(dateValue))

  async function saveInspectionTrackingNumber(nextTrackingNumber: string) {
    if (!nextTrackingNumber) {
      throw new Error('검수 단계의 운송장번호는 비워둘 수 없습니다. 삭제는 송장·검수에서 처리해주세요.')
    }
    const detailResponse = await fetch(`/api/purchasing/purchase-requests/${id}/inspection`, { cache: 'no-store' })
    const detail = await detailResponse.json().catch(() => ({}))
    if (!detailResponse.ok) throw new Error(detail.error ?? '검수 정보를 불러오지 못했습니다.')
    const inspection = detail.inspection as {
      revision?: unknown
      parcels?: Array<{ trackingNumber?: unknown; [key: string]: unknown }>
      resolutionNote?: unknown
    } | undefined
    if (!inspection || !Number.isInteger(inspection.revision) || !Array.isArray(inspection.parcels) || inspection.parcels.length === 0) {
      throw new Error('검수 운송장번호를 준비하지 못했습니다. 송장·검수에서 다시 확인해주세요.')
    }

    const parcels = inspection.parcels.map((parcel, index) => index === 0
      ? { ...parcel, trackingNumber: nextTrackingNumber }
      : parcel)
    const response = await fetch(`/api/purchasing/purchase-requests/${id}/inspection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        revision: inspection.revision,
        parcels,
        complete: false,
        acknowledgeMismatch: false,
        resolutionNote: typeof inspection.resolutionNote === 'string' ? inspection.resolutionNote : '',
      }),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(body.error ?? '검수 운송장번호를 저장하지 못했습니다.')
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const nextSupplierOrderNumber = String(formData.get('supplierOrderNumber') ?? '').trim()
    const nextTrackingNumber = String(formData.get('trackingNumber') ?? '').trim()
    const nextDateValue = String(formData.get(dateField) ?? '')
    const values: Record<string, string | null> = {}
    const trackingChanged = showTrackingNumber && nextTrackingNumber !== savedTrackingNumber

    if (nextSupplierOrderNumber !== savedSupplierOrderNumber) {
      values.supplierOrderNumber = nextSupplierOrderNumber || null
    }
    if (trackingChanged && trackingSaveMode === 'plan') {
      values.trackingNumber = nextTrackingNumber || null
    }
    if (nextDateValue !== savedDateValue) {
      values[dateField] = nextDateValue || null
    }
    if (Object.keys(values).length === 0 && !trackingChanged) {
      setMessage('변경사항 없음')
      return
    }
    if (trackingChanged && trackingSaveMode === 'inspection' && !nextTrackingNumber) {
      setMessage('검수 단계의 운송장번호는 비워둘 수 없습니다. 삭제는 송장·검수에서 처리해주세요.')
      return
    }

    setMessage(null)
    startTransition(async () => {
      if (Object.keys(values).length > 0) {
        const response = await fetch(`/api/purchasing/purchase-requests/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(values),
        })
        if (!response.ok) {
          const body = await response.json().catch(() => ({}))
          setMessage(body.error ?? '저장 실패')
          return
        }
      }
      if (trackingChanged && trackingSaveMode === 'inspection') {
        try {
          await saveInspectionTrackingNumber(nextTrackingNumber)
        } catch (error) {
          setMessage(error instanceof Error ? error.message : '검수 운송장번호를 저장하지 못했습니다.')
          return
        }
      }

      setSavedSupplierOrderNumber(nextSupplierOrderNumber)
      setSavedTrackingNumber(nextTrackingNumber)
      setSavedDateValue(nextDateValue)
      setMessage('저장됨')
      if (trackingChanged) router.refresh()
    })
  }

  return (
    <form
      onSubmit={save}
      onChange={compact ? () => setMessage(null) : undefined}
      data-purchase-plan-fit={fitWidth || undefined}
      data-purchase-plan-compact={compact || undefined}
      className={compact ? 'relative min-w-0' : fitWidth ? 'w-full min-w-0' : 'min-w-max'}
    >
      <div className={compact ? 'flex min-w-0 flex-nowrap items-center gap-1' : fitWidth ? 'flex min-w-0 flex-wrap items-end gap-1.5' : 'flex flex-nowrap items-end gap-1.5'}>
        <label className={compact ? 'w-[172px] shrink-0' : fitWidth ? 'w-48 min-w-0 max-w-full shrink-0 space-y-1' : 'w-48 shrink-0 space-y-1'}>
          <span className={compact ? 'sr-only' : 'flex h-5 items-center whitespace-nowrap text-[11px] font-medium text-muted-foreground'}>주문서번호</span>
          <Input
            name="supplierOrderNumber"
            defaultValue={supplierOrderNumber ?? ''}
            placeholder="주문서번호"
            className={compact ? 'h-7 px-2 text-xs md:text-xs' : 'h-7 text-xs'}
          />
        </label>
        {showTrackingNumber ? (
          <div className={compact ? 'relative w-[148px] shrink-0' : fitWidth ? 'w-44 min-w-0 max-w-full shrink-0 space-y-1' : 'w-44 shrink-0 space-y-1'}>
            <div className={compact ? 'contents' : 'flex h-5 items-center gap-1 whitespace-nowrap'}>
              <label htmlFor={`purchase-tracking-${id}`} className={compact ? 'sr-only' : 'text-[11px] font-medium text-muted-foreground'}>운송장번호</label>
              {savedTrackingNumber ? (
                <a
                  href={`https://www.baidu.com/s?wd=${encodeURIComponent(savedTrackingNumber)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="바이두에서 송장번호 조회"
                  aria-label="바이두에서 송장번호 조회"
                  className={compact ? 'absolute right-1 top-1 inline-flex size-5 items-center justify-center rounded text-blue-700 hover:bg-blue-50 hover:text-blue-800' : 'inline-flex size-5 items-center justify-center rounded border border-blue-200 text-blue-700 hover:bg-blue-50 hover:text-blue-800'}
                >
                  <ExternalLink className="size-3" />
                </a>
              ) : null}
            </div>
            <Input
              id={`purchase-tracking-${id}`}
              name="trackingNumber"
              defaultValue={trackingNumber ?? ''}
              placeholder="운송장번호"
              className={compact ? `h-7 px-2 text-xs md:text-xs ${savedTrackingNumber ? 'pr-7' : ''}` : 'h-7 text-xs'}
            />
          </div>
        ) : null}
        <label data-purchase-column={dateColumn} className={compact ? 'w-28 shrink-0' : fitWidth ? 'w-32 min-w-0 max-w-full shrink-0 space-y-1' : 'w-32 shrink-0 space-y-1'}>
          <span className={compact ? 'sr-only' : 'flex h-5 items-center whitespace-nowrap text-[11px] font-medium text-muted-foreground'}>{dateLabel}</span>
          <Input
            name={dateField}
            type="date"
            defaultValue={formatDateInput(dateValue)}
            className={compact ? 'h-7 px-1 text-xs md:text-xs' : 'h-7 text-xs'}
          />
        </label>
        <div className="flex shrink-0 items-center gap-1">
          <Button type="submit" size="sm" variant="outline" disabled={isPending} aria-label={compact ? '저장' : undefined} title={compact ? '저장' : undefined} className={compact ? 'size-7 shrink-0 p-0' : 'px-2'}>
            {isPending ? <Loader2 className="animate-spin" /> : <Save />}
            {compact ? null : '저장'}
          </Button>
        </div>
        {afterFields}
      </div>
      {message ? (
        <div className={compact ? 'absolute right-0 top-full z-20 mt-1 w-max max-w-sm rounded-md border bg-background px-2 py-1 text-[11px] text-muted-foreground shadow-md' : 'mt-1 max-w-lg whitespace-normal text-[11px] text-muted-foreground'} aria-live="polite">
          {message}
        </div>
      ) : null}
    </form>
  )
}

export function PurchaseDelayReasonField({
  id,
  delayReason,
  delayNote,
  purchasingStatus,
  purchasingStatusNote,
}: {
  id: string
  delayReason: string | null
  delayNote: string | null
  purchasingStatus: string | null
  purchasingStatusNote: string | null
}) {
  const router = useRouter()
  const [reason, setReason] = useState(delayReason ?? '')
  const [note, setNote] = useState(delayNote ?? '')
  const [applyToItem, setApplyToItem] = useState(true)
  const [message, setMessage] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const statusLabel = purchasingStatus && purchasingStatus in PURCHASING_ITEM_STATUS_LABELS
    ? PURCHASING_ITEM_STATUS_LABELS[purchasingStatus as keyof typeof PURCHASING_ITEM_STATUS_LABELS]
    : null

  function save() {
    const nextReason = reason ? reason as PurchaseDelayReason : null
    setMessage(null)
    startTransition(async () => {
      const response = await fetch(`/api/purchasing/purchase-requests/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          delayReason: nextReason,
          delayNote: note.trim() || null,
          applyDelayReasonToItem: Boolean(nextReason) && applyToItem,
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        setMessage(body.error ?? '지연 사유 저장에 실패했습니다.')
        return
      }

      const excludedCount = Number(body.excludedRecommendationCount ?? 0)
      setMessage(nextReason === 'discontinued' && excludedCount > 0
        ? `저장됨 · 발주검토 ${excludedCount.toLocaleString('ko-KR')}건 제외`
        : applyToItem && nextReason
          ? '저장됨 · 품목 반영'
          : '저장됨')
      router.refresh()
    })
  }

  return (
    <div className="min-w-[330px] space-y-1.5">
      <div className="grid grid-cols-[132px_minmax(0,1fr)] gap-1.5">
        <select
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          disabled={isPending}
          aria-label="지연 사유"
          className="h-7 rounded-md border border-input bg-background px-2 text-xs"
        >
          <option value="">사유 선택</option>
          {PURCHASE_DELAY_REASONS.map((item) => (
            <option key={item} value={item}>{PURCHASE_DELAY_REASON_LABELS[item]}</option>
          ))}
        </select>
        <Input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          disabled={isPending}
          maxLength={2_000}
          placeholder="상세 사유 / 새 구매처"
          aria-label="지연 상세 사유"
          className="h-7 text-xs"
        />
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <input
            type="checkbox"
            checked={applyToItem}
            onChange={(event) => setApplyToItem(event.target.checked)}
            disabled={isPending || !reason}
            className="size-3.5"
          />
          품목에 반영
        </label>
        <Button type="button" size="sm" variant="outline" onClick={save} disabled={isPending} className="h-6 px-2 text-[11px]">
          {isPending ? <Loader2 className="animate-spin" /> : <Save />}
          저장
        </Button>
        {statusLabel ? (
          <span className={purchasingStatus === 'discontinued'
            ? 'text-[11px] font-medium text-destructive'
            : 'text-[11px] text-muted-foreground'}>
            품목: {statusLabel}{purchasingStatusNote ? ` · ${purchasingStatusNote}` : ''}
          </span>
        ) : null}
      </div>
      {message ? <div className={message === '저장됨' || message.startsWith('저장됨') ? 'text-[11px] text-emerald-700' : 'text-[11px] text-destructive'}>{message}</div> : null}
    </div>
  )
}

type PurchaseRequestExcelResult = {
  total: number
  created: number
  updated: number
  skipped: number
  duplicate?: boolean
  errors?: Array<{ row: number; message: string }>
}

function parseQuantityPreview(value: string, fallback: number) {
  const next = Number(value)
  if (!Number.isFinite(next) || next < 0) return fallback
  return next
}

function isPurchasePaymentStatus(value: string | null): value is PurchasePaymentStatus {
  return PURCHASE_PAYMENT_STATUSES.includes(value as PurchasePaymentStatus)
}

function formatCostValue(value: number | null, maximumFractionDigits: number) {
  if (value === null) return '-'
  return value.toLocaleString('ko-KR', {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  })
}

function formatBudgetKrwInput(value: string) {
  if (!value) return ''
  const number = Number(value)
  if (!Number.isFinite(number)) return ''
  return `${number.toLocaleString('ko-KR')}원`
}

function formatDateInput(value: string | Date | null) {
  if (!value) return ''
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return value.slice(0, 10)
}
