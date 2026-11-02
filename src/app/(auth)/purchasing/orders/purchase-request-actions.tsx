'use client'

import {
  createContext,
  useCallback,
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
const MAX_1688_TRACKING_BATCH_ORDERS = 50
const MAX_1688_TRACKING_BATCH_ITEMS = 100
const TRACKING_LOOKUP_HANDOFF_RETRY_DELAY_MS = 750
const TRACKING_LOOKUP_HANDOFF_MAX_ATTEMPTS = 4

export type Purchase1688TrackingLookupCandidate = {
  id: string
  sku: string
  productName: string
  optionName: string | null
  supplierOrderNumber: string | null
  trackingNumber: string | null
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

function stops1688TrackingBatch(message: string) {
  const normalized = message.trim()
  return normalized.startsWith('1688 로그인이 필요합니다.')
    || normalized.startsWith('1688 보안 확인이 필요합니다.')
    || normalized.startsWith('1688 확장프로그램 연결을 확인해주세요.')
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
 * Runs every eligible purchase-completed row on the current page through the
 * existing one-at-a-time extension message. Keeping the queue in the page
 * means an already-loaded extension never has to hold purchase ids or write
 * SaaS data itself.
 */
export function PurchaseBulk1688TrackingLookup({
  candidates,
}: {
  candidates: Purchase1688TrackingLookupCandidate[]
}) {
  const router = useRouter()
  const routerRefreshRef = useRef(router.refresh)
  const stopRequestedRef = useRef(false)
  const [batch, setBatch] = useState<Purchase1688TrackingBatch | null>(null)
  const [progress, setProgress] = useState<Purchase1688TrackingProgress | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [lookupRows, setLookupRows] = useState<Purchase1688TrackingLookupRow[]>([])

  useEffect(() => {
    routerRefreshRef.current = router.refresh
  }, [router.refresh])

  const eligibleCandidates = candidates.filter((candidate) => (
    valid1688OrderNumber(candidate.supplierOrderNumber) && !candidate.trackingNumber?.trim()
  ))
  const skippedCandidateCount = candidates.length - eligibleCandidates.length

  useEffect(() => {
    if (!batch) return

    let disposed = false
    let bridgeTimeout: number | null = null
    let nextJobTimer: number | null = null
    let index = 0
    let succeededItems = 0
    let failedItems = 0
    let currentStartAttempts = 0
    let current: { runId: string; job: Purchase1688TrackingLookupJob; saving: boolean } | null = null

    const updateLookupRows = (
      ids: string[],
      status: Purchase1688TrackingRowStatus,
      message: string,
      trackingNumbers: string[] = [],
    ) => {
      const idSet = new Set(ids)
      setLookupRows((rows) => rows.map((row) => idSet.has(row.id)
        ? { ...row, status, message, trackingNumbers }
        : row))
    }

    const clearTimers = () => {
      if (bridgeTimeout !== null) window.clearTimeout(bridgeTimeout)
      if (nextJobTimer !== null) window.clearTimeout(nextJobTimer)
      bridgeTimeout = null
      nextJobTimer = null
    }

    const updateProgress = (message: string, overrides: Partial<Purchase1688TrackingProgress> = {}) => {
      setProgress({
        totalItems: batch.totalItems,
        totalOrders: batch.jobs.length,
        skippedItems: batch.skippedItems,
        succeededItems,
        failedItems,
        currentOrder: Math.min(index + (current ? 1 : 0), batch.jobs.length),
        currentOrderNumber: current?.job.orderNumber ?? null,
        message,
        ...overrides,
      })
    }

    const finish = (message: string) => {
      if (disposed) return
      clearTimers()
      const didSaveAny = succeededItems > 0
      current = null
      setBatch(null)
      updateProgress(message, {
        currentOrder: index,
        currentOrderNumber: null,
        complete: true,
      })
      if (didSaveAny) {
        routerRefreshRef.current()
      }
      if (stopRequestedRef.current || stops1688TrackingBatch(message)) {
        setLookupRows((rows) => rows.map((row) => (
          row.status === 'queued' || row.status === 'querying'
            ? { ...row, status: 'skipped', message: '남은 항목은 조회하지 않았습니다.', trackingNumbers: [] }
            : row
        )))
      }
      if (succeededItems > 0 && failedItems === 0 && !stopRequestedRef.current) {
        toast.success(`1688 송장 ${succeededItems.toLocaleString('ko-KR')}건을 등록하고 검수로 이동했습니다.`)
      } else if (succeededItems > 0) {
        toast.warning(`1688 송장 ${succeededItems.toLocaleString('ko-KR')}건 등록 · ${failedItems.toLocaleString('ko-KR')}건 미처리`)
      } else if (failedItems > 0) {
        toast.error('1688 송장 일괄조회에서 저장된 항목이 없습니다.')
      }
    }

    const scheduleNextJob = (delayMs = 150) => {
      nextJobTimer = window.setTimeout(() => {
        if (disposed) return
        if (stopRequestedRef.current) {
          finish(`현재 건까지 처리했습니다. 성공 ${succeededItems.toLocaleString('ko-KR')}건 · 미처리 ${failedItems.toLocaleString('ko-KR')}건`)
          return
        }
        if (index >= batch.jobs.length) {
          finish(`일괄조회 완료 · 성공 ${succeededItems.toLocaleString('ko-KR')}건 · 미처리 ${failedItems.toLocaleString('ko-KR')}건`)
          return
        }

        const job = batch.jobs[index]
        currentStartAttempts += 1
        const runId = `${batch.id}-${index}-${currentStartAttempts}`
        current = { runId, job, saving: false }
        updateLookupRows(job.ids, 'querying', '1688 주문서번호 조회 중')
        updateProgress(`1688 주문 ${index + 1}/${batch.jobs.length} 조회 중`)
        bridgeTimeout = window.setTimeout(() => {
          if (disposed || current?.runId !== runId) return
          current = null
          failedItems += job.ids.length
          index += 1
          const message = '1688 확장프로그램 연결을 확인해주세요.'
          updateLookupRows(job.ids, 'failed', message)
          finish(message)
        }, 5_000)
        window.postMessage({
          source: PAGE_SOURCE,
          type: TRACKING_LOOKUP_START,
          runId,
          orderNumber: job.orderNumber,
        }, window.location.origin)
      }, delayMs)
    }

    const failCurrentJob = (message: string) => {
      if (!current) return
      const failedJob = current.job
      current = null
      if (bridgeTimeout !== null) window.clearTimeout(bridgeTimeout)
      bridgeTimeout = null
      if (is1688TrackingLookupHandoffInProgress(message) && currentStartAttempts < TRACKING_LOOKUP_HANDOFF_MAX_ATTEMPTS) {
        updateLookupRows(failedJob.ids, 'querying', '이전 1688 조회를 정리한 뒤 재시도 중')
        updateProgress('이전 1688 조회를 정리한 뒤 같은 주문을 다시 시도합니다.', {
          currentOrder: index + 1,
          currentOrderNumber: failedJob.orderNumber,
        })
        scheduleNextJob(TRACKING_LOOKUP_HANDOFF_RETRY_DELAY_MS)
        return
      }
      failedItems += failedJob.ids.length
      index += 1
      currentStartAttempts = 0
      updateLookupRows(failedJob.ids, 'failed', message)
      updateProgress(message)
      if (stops1688TrackingBatch(message)) {
        finish(`${message} · 남은 항목은 확인 후 다시 일괄조회해주세요.`)
        return
      }
      scheduleNextJob()
    }

    const saveCurrentJob = async (runId: string, trackingNumbers: string[]) => {
      if (!current || current.runId !== runId) return
      const job = current.job
      let savedForJob = 0
      let failedForJob = 0
      let lastError = ''
      const savedIds: string[] = []
      const failedIds: string[] = []

      for (const id of job.ids) {
        try {
          const response = await fetch(`/api/purchasing/purchase-requests/${id}/1688-tracking`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderNumber: job.orderNumber, trackingNumbers }),
          })
          const body = await response.json().catch(() => ({}))
          if (!response.ok) throw new Error(body.error ?? '1688 송장번호를 저장하지 못했습니다.')
          savedForJob += 1
          savedIds.push(id)
        } catch (error) {
          failedForJob += 1
          failedIds.push(id)
          lastError = error instanceof Error ? error.message : '1688 송장번호를 저장하지 못했습니다.'
        }
      }

      if (disposed || current?.runId !== runId) return
      succeededItems += savedForJob
      failedItems += failedForJob
      current = null
      index += 1
      currentStartAttempts = 0
      if (savedIds.length > 0) updateLookupRows(savedIds, 'success', `송장 ${trackingNumbers.join(', ')} 등록 완료`, trackingNumbers)
      if (failedIds.length > 0) updateLookupRows(failedIds, 'failed', lastError)
      updateProgress(lastError || `송장 ${savedForJob.toLocaleString('ko-KR')}건 등록됨 · 검수로 이동`)
      scheduleNextJob()
    }

    const onMessage = (event: MessageEvent<unknown>) => {
      if (event.source !== window || event.origin !== window.location.origin) return
      const message = event.data
      if (!message || typeof message !== 'object') return
      const data = message as {
        source?: unknown
        type?: unknown
        runId?: unknown
        orderNumber?: unknown
        trackingNumbers?: unknown
        message?: unknown
      }
      if (data.source !== EXTENSION_SOURCE || typeof data.type !== 'string') return
      if (!current || data.runId !== current.runId) return

      if (data.type === TRACKING_LOOKUP_ACK) {
        if (bridgeTimeout !== null) window.clearTimeout(bridgeTimeout)
        bridgeTimeout = null
        return
      }

      if (data.type === TRACKING_LOOKUP_ERROR) {
        failCurrentJob(typeof data.message === 'string' ? data.message : '1688 송장 조회에 실패했습니다.')
        return
      }

      if (data.type !== TRACKING_LOOKUP_RESULT || data.orderNumber !== current.job.orderNumber || current.saving) return

      const trackingNumbers = normalize1688TrackingNumbers(data.trackingNumbers)
      if (bridgeTimeout !== null) window.clearTimeout(bridgeTimeout)
      bridgeTimeout = null
      if (trackingNumbers.length === 0) {
        failCurrentJob('1688에서 유효한 송장번호를 찾지 못했습니다.')
        return
      }

      current.saving = true
      updateLookupRows(current.job.ids, 'saving', '송장번호 저장 중', trackingNumbers)
      updateProgress(`주문 ${index + 1}/${batch.jobs.length} 송장 저장 중`)
      void saveCurrentJob(current.runId, trackingNumbers)
    }

    window.addEventListener('message', onMessage)
    updateProgress(`1688 송장 일괄조회 준비 · ${batch.jobs.length.toLocaleString('ko-KR')}개 주문`)
    scheduleNextJob()

    return () => {
      disposed = true
      clearTimers()
      window.removeEventListener('message', onMessage)
    }
  }, [batch])

  function startBatch() {
    if (batch || eligibleCandidates.length === 0) return
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
    setDialogOpen(true)
    if (eligibleCandidates.length > MAX_1688_TRACKING_BATCH_ITEMS || jobs.length > MAX_1688_TRACKING_BATCH_ORDERS) {
      setProgress({
        totalItems: eligibleCandidates.length,
        totalOrders: jobs.length,
        skippedItems,
        succeededItems: 0,
        failedItems: 0,
        currentOrder: 0,
        currentOrderNumber: null,
        message: `한 번에 최대 ${MAX_1688_TRACKING_BATCH_ORDERS.toLocaleString('ko-KR')}개 1688 주문 또는 ${MAX_1688_TRACKING_BATCH_ITEMS.toLocaleString('ko-KR')}개 발주 항목만 조회할 수 있습니다. 현재 페이지 표시 수를 줄인 뒤 다시 조회해주세요.`,
        complete: true,
      })
      setLookupRows((rows) => rows.map((row) => ({
        ...row,
        status: 'skipped',
        message: '한 번에 처리할 수 있는 건수를 초과했습니다.',
      })))
      return
    }

    stopRequestedRef.current = false
    setProgress({
      totalItems: eligibleCandidates.length,
      totalOrders: jobs.length,
      skippedItems,
      succeededItems: 0,
      failedItems: 0,
      currentOrder: 0,
      currentOrderNumber: null,
      message: '1688 송장 일괄조회 시작',
    })
    setBatch({
      id: crypto.randomUUID(),
      jobs,
      totalItems: eligibleCandidates.length,
      skippedItems,
    })
  }

  function stopAfterCurrent() {
    if (!batch) return
    stopRequestedRef.current = true
    setProgress((current) => current ? {
      ...current,
      stopping: true,
      message: '현재 조회·저장이 끝나면 중지합니다.',
    } : current)
  }

  return (
    <Dialog.Root
      open={dialogOpen}
      onOpenChange={(nextOpen) => {
        if (batch && !nextOpen) return
        setDialogOpen(nextOpen)
      }}
    >
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={startBatch}
        disabled={Boolean(batch) || eligibleCandidates.length === 0}
        title="현재 페이지의 구매완료 항목을 순차 조회합니다. 주문번호가 없거나 송장이 이미 있는 항목은 자동으로 건너뜁니다."
      >
        {batch ? <Loader2 className="animate-spin" /> : <Search />}
        1688 송장 일괄조회
      </Button>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100vh-2rem)] w-[min(920px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border bg-background p-5 shadow-xl">
          <Dialog.Title className="text-base font-semibold">1688 송장 일괄조회</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted-foreground">
            현재 페이지의 구매완료 항목 중 주문서번호가 있고 송장이 비어 있는 {(progress?.totalItems ?? eligibleCandidates.length).toLocaleString('ko-KR')}건을 순차 조회합니다.
            {(progress?.skippedItems ?? skippedCandidateCount) > 0 ? ` 기존 송장 또는 주문서번호가 없는 ${(progress?.skippedItems ?? skippedCandidateCount).toLocaleString('ko-KR')}건은 자동으로 건너뜁니다.` : ''}
          </Dialog.Description>

          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border bg-muted/30 px-3 py-2 text-sm" aria-live="polite">
            <span>{progress?.message ?? '조회 준비'}</span>
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
                중지(현재 건 이후)
              </Button>
            ) : (
              <Dialog.Close render={(props) => <Button {...props} type="button" variant="outline">닫기</Button>} />
            )}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
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

const PURCHASE_BUYERS = [
  { code: '1', name: '한상철' },
  { code: '2', name: '김기환' },
  { code: '3', name: '최종석' },
  { code: '4', name: '오지은' },
  { code: '5', name: '김소희' },
]

export function PurchaseBulkBuyerApply() {
  const router = useRouter()
  const context = useBulkSelection()
  const [buyerCode, setBuyerCode] = useState('4')
  const [message, setMessage] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const selectedCount = context.selectedIds.size
  const targetCount = selectedCount || context.ids.length

  function apply() {
    const ids = selectedCount ? Array.from(context.selectedIds) : context.ids
    if (ids.length === 0) return
    setMessage(null)
    startTransition(async () => {
      const response = await fetch('/api/purchasing/purchase-requests/bulk-update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, buyerCode }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        setMessage(body.error ?? '담당자 적용 실패')
        return
      }
      setMessage(`${body.updatedCount.toLocaleString('ko-KR')}건 적용`)
      router.refresh()
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={buyerCode}
        onChange={(event) => setBuyerCode(event.target.value)}
        className="h-7 rounded-md border border-input bg-background px-2 text-xs"
      >
        {PURCHASE_BUYERS.map((buyer) => (
          <option key={buyer.code} value={buyer.code}>{buyer.name}</option>
        ))}
      </select>
      <Button type="button" size="sm" variant="outline" onClick={apply} disabled={isPending || targetCount === 0}>
        {isPending ? <Loader2 className="animate-spin" /> : <Check />}
        담당자 전체적용
      </Button>
      {message ? <span className="text-xs text-muted-foreground">{message}</span> : null}
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
}: {
  id: string
  nextStatus: PurchaseRequestStatus | null
  saasChinaMode?: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  if (!nextStatus) return null

  if (saasChinaMode && (nextStatus === 'outbound_requested' || nextStatus === 'completed')) {
    return (
      <div className="space-y-1">
        <Link
          href="/purchasing/china-shipments"
          className="inline-flex h-7 items-center justify-center rounded-[min(var(--radius-md),12px)] border border-border bg-background px-2.5 text-[0.8rem] font-medium whitespace-nowrap hover:bg-muted"
        >
          중국출고에서 작업
        </Link>
        <p className="text-[11px] leading-tight text-muted-foreground">기존 중국출고 작업에서 처리</p>
      </div>
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
    <div className="space-y-1 text-center">
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
      <label className="flex items-center justify-center gap-1 whitespace-nowrap text-[11px] font-medium text-amber-700">
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
          className="h-7 w-[128px] rounded-md border border-input bg-background px-1.5 text-xs"
        />
      ) : null}
      {value === 'paid' && paidAt ? (
        <div className="whitespace-nowrap text-[11px] text-muted-foreground">{formatDateInput(paidAt)} 결제</div>
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
    <div className="mx-auto w-[112px]">
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
          className="h-7 w-16 px-2 text-center text-xs tabular-nums"
        />
        {stockLimit !== undefined && stockLimit !== null ? (
          <span className="text-xs text-muted-foreground tabular-nums">
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
  purchaseMethod,
  allow1688TrackingLookup = false,
}: {
  id: string
  supplierOrderNumber: string | null
  trackingNumber: string | null
  showTrackingNumber: boolean
  dateValue: string | Date | null
  dateField: 'requestDate' | 'outboundExpectedDate'
  dateLabel: string
  purchaseMethod: string | null
  allow1688TrackingLookup?: boolean
}) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const initialMethod = purchaseMethod === '개인' || purchaseMethod === '법인' ? purchaseMethod : purchaseMethod ? '직접입력' : '개인'
  const [methodMode, setMethodMode] = useState(initialMethod)
  const [customMethod, setCustomMethod] = useState(initialMethod === '직접입력' ? purchaseMethod ?? '' : '')
  const [purchaseMethodDirty, setPurchaseMethodDirty] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [savedSupplierOrderNumber, setSavedSupplierOrderNumber] = useState(() => supplierOrderNumber?.trim() ?? '')
  const [savedTrackingNumber, setSavedTrackingNumber] = useState(() => trackingNumber?.trim() ?? '')
  const [savedDateValue, setSavedDateValue] = useState(() => formatDateInput(dateValue))
  const [savedPurchaseMethod, setSavedPurchaseMethod] = useState(() => purchaseMethod?.trim() ?? '')
  const [is1688TrackingLookupPending, setIs1688TrackingLookupPending] = useState(false)
  const trackingLookupRef = useRef<{ runId: string; orderNumber: string } | null>(null)
  const trackingLookupTimeoutRef = useRef<number | null>(null)
  const baiduTrackingHref = savedTrackingNumber
    ? `https://www.baidu.com/s?wd=${encodeURIComponent(`${savedTrackingNumber} 快递查询`)}`
    : null

  const clearTrackingLookupTimeout = useCallback(() => {
    if (trackingLookupTimeoutRef.current === null) return
    window.clearTimeout(trackingLookupTimeoutRef.current)
    trackingLookupTimeoutRef.current = null
  }, [])

  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>) => {
      if (event.source !== window || event.origin !== window.location.origin) return
      const message = event.data
      if (!message || typeof message !== 'object') return
      const data = message as {
        source?: unknown
        type?: unknown
        runId?: unknown
        orderNumber?: unknown
        trackingNumbers?: unknown
        message?: unknown
      }
      if (data.source !== EXTENSION_SOURCE || typeof data.type !== 'string') return

      const lookup = trackingLookupRef.current
      if (!lookup || data.runId !== lookup.runId) return

      if (data.type === TRACKING_LOOKUP_ACK) {
        clearTrackingLookupTimeout()
        return
      }

      if (data.type === TRACKING_LOOKUP_ERROR) {
        clearTrackingLookupTimeout()
        trackingLookupRef.current = null
        setIs1688TrackingLookupPending(false)
        setMessage(typeof data.message === 'string' ? data.message : '1688 송장 조회에 실패했습니다.')
        return
      }

      if (data.type !== TRACKING_LOOKUP_RESULT || data.orderNumber !== lookup.orderNumber) return

      const trackingNumbers = Array.from(new Set(
        (Array.isArray(data.trackingNumbers) ? data.trackingNumbers : [])
          .filter((value): value is string => typeof value === 'string')
          .map((value) => value.trim())
          .filter(Boolean),
      ))
      clearTrackingLookupTimeout()
      if (trackingNumbers.length === 0) {
        trackingLookupRef.current = null
        setIs1688TrackingLookupPending(false)
        setMessage('1688에서 유효한 송장번호를 찾지 못했습니다.')
        return
      }

      setMessage('1688 송장번호 저장 중')
      void (async () => {
        try {
          const response = await fetch(`/api/purchasing/purchase-requests/${id}/1688-tracking`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderNumber: lookup.orderNumber, trackingNumbers }),
          })
          const body = await response.json().catch(() => ({}))
          if (!response.ok) throw new Error(body.error ?? '1688 송장번호를 저장하지 못했습니다.')

          setSavedTrackingNumber(trackingNumbers.join('\n'))
          setMessage(`송장 ${trackingNumbers.length.toLocaleString('ko-KR')}건 등록됨 · 검수로 이동`)
          toast.success(`1688 송장 ${trackingNumbers.length.toLocaleString('ko-KR')}건을 등록하고 검수로 이동했습니다.`)
          router.refresh()
        } catch (error) {
          setMessage(error instanceof Error ? error.message : '1688 송장번호를 저장하지 못했습니다.')
        } finally {
          trackingLookupRef.current = null
          setIs1688TrackingLookupPending(false)
        }
      })()
    }

    window.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener('message', onMessage)
      clearTrackingLookupTimeout()
    }
  }, [clearTrackingLookupTimeout, id, router])

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const nextSupplierOrderNumber = String(formData.get('supplierOrderNumber') ?? '').trim()
    const nextTrackingNumber = String(formData.get('trackingNumber') ?? '').trim()
    const nextDateValue = String(formData.get(dateField) ?? '')
    const nextPurchaseMethod = (methodMode === '직접입력' ? customMethod : methodMode).trim()
    const values: Record<string, string | null> = {}

    if (nextSupplierOrderNumber !== savedSupplierOrderNumber) {
      values.supplierOrderNumber = nextSupplierOrderNumber || null
    }
    if (showTrackingNumber && nextTrackingNumber !== savedTrackingNumber) {
      values.trackingNumber = nextTrackingNumber || null
    }
    if (nextDateValue !== savedDateValue) {
      values[dateField] = nextDateValue || null
    }
    if (purchaseMethodDirty && nextPurchaseMethod !== savedPurchaseMethod) {
      values.purchaseMethod = nextPurchaseMethod || null
    }
    if (Object.keys(values).length === 0) {
      setMessage('변경사항 없음')
      return
    }

    setMessage(null)
    startTransition(async () => {
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

      setSavedSupplierOrderNumber(nextSupplierOrderNumber)
      setSavedTrackingNumber(nextTrackingNumber)
      setSavedDateValue(nextDateValue)
      setSavedPurchaseMethod(nextPurchaseMethod)
      setPurchaseMethodDirty(false)
      setMessage('저장됨')
    })
  }

  async function saveAndLookup1688Tracking() {
    if (!allow1688TrackingLookup || is1688TrackingLookupPending || savedTrackingNumber) return
    const form = formRef.current
    if (!form) return

    const nextSupplierOrderNumber = String(new FormData(form).get('supplierOrderNumber') ?? '').trim()
    if (!/^\d{10,40}$/.test(nextSupplierOrderNumber)) {
      setMessage('1688 주문번호는 숫자 10~40자리로 입력해주세요.')
      return
    }

    setMessage(null)
    if (nextSupplierOrderNumber !== savedSupplierOrderNumber) {
      setMessage('주문서번호 저장 중')
      try {
        const response = await fetch(`/api/purchasing/purchase-requests/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ supplierOrderNumber: nextSupplierOrderNumber }),
        })
        const body = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(body.error ?? '주문서번호를 저장하지 못했습니다.')
        setSavedSupplierOrderNumber(nextSupplierOrderNumber)
      } catch (error) {
        setMessage(error instanceof Error ? error.message : '주문서번호를 저장하지 못했습니다.')
        return
      }
    }

    const runId = crypto.randomUUID()
    trackingLookupRef.current = { runId, orderNumber: nextSupplierOrderNumber }
    setIs1688TrackingLookupPending(true)
    setMessage('1688에서 송장번호 조회 중')
    trackingLookupTimeoutRef.current = window.setTimeout(() => {
      if (trackingLookupRef.current?.runId !== runId) return
      trackingLookupRef.current = null
      setIs1688TrackingLookupPending(false)
      setMessage('1688 확장프로그램 연결을 확인해주세요.')
    }, 5_000)
    window.postMessage({
      source: PAGE_SOURCE,
      type: TRACKING_LOOKUP_START,
      runId,
      orderNumber: nextSupplierOrderNumber,
    }, window.location.origin)
  }

  return (
    <form
      ref={formRef}
      onSubmit={save}
      className={`grid min-w-0 items-end gap-1.5 ${showTrackingNumber
        ? 'grid-cols-[minmax(120px,1fr)_minmax(120px,1fr)_126px_148px_64px]'
        : allow1688TrackingLookup
          ? 'grid-cols-[minmax(120px,1fr)_126px_148px_minmax(146px,max-content)]'
          : 'grid-cols-[minmax(120px,1fr)_126px_148px_64px]'}`}
    >
      <label className="space-y-1">
        <span className="block text-[11px] font-medium text-muted-foreground">주문서번호</span>
        <Input
          name="supplierOrderNumber"
          defaultValue={supplierOrderNumber ?? ''}
          placeholder="주문서번호"
          className="h-7 text-xs"
        />
      </label>
      {showTrackingNumber ? (
        <label className="space-y-1">
          <span className="block text-[11px] font-medium text-muted-foreground">송장번호</span>
          <Input
            name="trackingNumber"
            defaultValue={trackingNumber ?? ''}
            placeholder="송장번호"
            className="h-7 text-xs"
          />
          {baiduTrackingHref ? (
            <a
              href={baiduTrackingHref}
              target="_blank"
              rel="noreferrer"
              title="바이두에서 송장번호 조회"
              className="inline-flex max-w-full items-center gap-1 truncate text-[11px] text-blue-700 hover:underline"
            >
              <span className="truncate">{savedTrackingNumber}</span>
              <ExternalLink className="size-3 shrink-0" />
            </a>
          ) : null}
        </label>
      ) : null}
      <label className="space-y-1">
        <span className="block text-[11px] font-medium text-muted-foreground">{dateLabel}</span>
        <Input
          name={dateField}
          type="date"
          defaultValue={formatDateInput(dateValue)}
          className="h-7 text-xs"
        />
      </label>
      <label className="space-y-1">
        <span className="block text-[11px] font-medium text-muted-foreground">구매방법</span>
        <div className="flex items-center gap-1">
          <select
            value={methodMode}
            onChange={(event) => {
              setMethodMode(event.target.value)
              setPurchaseMethodDirty(true)
            }}
            className="h-7 w-full rounded-md border border-input bg-background px-2 text-xs"
          >
            <option value="개인">개인</option>
            <option value="법인">법인</option>
            <option value="직접입력">직접입력</option>
          </select>
          {methodMode === '직접입력' ? (
            <Input
              value={customMethod}
              onChange={(event) => {
                setCustomMethod(event.target.value)
                setPurchaseMethodDirty(true)
              }}
              placeholder="직접입력"
              className="h-7 w-20 text-xs"
            />
          ) : null}
        </div>
      </label>
      <div className="flex items-center gap-1">
        <Button type="submit" size="sm" variant="outline" disabled={isPending || is1688TrackingLookupPending} className="px-2">
          {isPending ? <Loader2 className="animate-spin" /> : <Save />}
          저장
        </Button>
        {allow1688TrackingLookup ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isPending || is1688TrackingLookupPending || Boolean(savedTrackingNumber)}
            onClick={() => void saveAndLookup1688Tracking()}
            title="1688 주문서번호를 저장하고 로그인된 1688에서 송장번호를 조회합니다. 조회되면 검수 단계로 이동합니다."
            className="px-2"
          >
            {is1688TrackingLookupPending ? <Loader2 className="animate-spin" /> : <Search />}
            1688 송장조회
          </Button>
        ) : null}
      </div>
      {message ? (
        <div className="col-span-full text-[11px] text-muted-foreground" aria-live="polite">
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

export function PurchaseBuyerField({
  id,
  buyerCode,
}: {
  id: string
  buyerCode: string | null
}) {
  const router = useRouter()
  const [value, setValue] = useState(
    buyerCode && PURCHASE_BUYERS.some((buyer) => buyer.code === buyerCode) ? buyerCode : '4',
  )
  const [isPending, startTransition] = useTransition()

  function save(nextValue: string) {
    setValue(nextValue)
    startTransition(async () => {
      const response = await fetch(`/api/purchasing/purchase-requests/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ buyerCode: nextValue }),
      })
      if (response.ok) router.refresh()
    })
  }

  return (
    <select
      value={value}
      onChange={(event) => save(event.target.value)}
      disabled={isPending}
      className="h-7 w-full min-w-[92px] rounded-md border border-input bg-background px-2 text-xs"
    >
      {PURCHASE_BUYERS.map((buyer) => (
        <option key={buyer.code} value={buyer.code}>{buyer.name}</option>
      ))}
    </select>
  )
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
