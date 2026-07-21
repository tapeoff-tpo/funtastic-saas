'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Link2,
  LoaderCircle,
  Square,
} from 'lucide-react'
import { toast } from 'sonner'

const PAGE_SOURCE = 'funtastic-saas'
const EXTENSION_SOURCE = 'funtastic-1688-extension'
const EXTENSION_DOWNLOAD = '/downloads/funtastic-1688-url-collector-1.2.1.zip'

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
  error?: string
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

export function PurchasingUrlCollector() {
  const router = useRouter()
  const [extensionReady, setExtensionReady] = useState(false)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<Progress>(EMPTY_PROGRESS)
  const [verificationRunning, setVerificationRunning] = useState(false)
  const [verificationProgress, setVerificationProgress] = useState<VerificationProgress>(EMPTY_VERIFICATION_PROGRESS)
  const runIdRef = useRef<string | null>(null)
  const verificationRunIdRef = useRef<string | null>(null)
  const pendingSavesRef = useRef(0)
  const extensionFinishedRef = useRef(false)
  const finalizedRef = useRef(false)

  const finalizeVerification = useCallback(() => {
    setVerificationRunning(false)
    setVerificationProgress((current) => ({
      ...current,
      message: '1688 구매 URL 검증이 완료되었습니다.',
    }))
    toast.success('1688 구매 URL 검증을 완료했습니다.')
  }, [])

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

  const acknowledgeVerificationResult = useCallback((message: CollectorMessage) => {
    if (!message.url || !message.status) return

    setVerificationProgress((current) => {
      const items = message.items ?? []
      const skuLabel = items.map((item) => item.sku).slice(0, 4).join(', ')
      const issues = [...current.issues]
      let open = current.open
      let unavailable = current.unavailable
      let unknown = current.unknown

      if (message.status === 'open') open += 1
      if (message.status === 'unavailable') {
        unavailable += 1
        issues.unshift(`${skuLabel || message.url}: 1688 상품 없음 또는 판매중지`)
      }
      if (message.status === 'unknown') {
        unknown += 1
        issues.unshift(`${skuLabel || message.url}: ${message.message || '정상 열림 여부 확인 필요'}`)
      }

      return {
        ...current,
        processed: Math.min(current.total, current.processed + 1),
        open,
        unavailable,
        unknown,
        message: skuLabel ? `${skuLabel} 검증 완료` : '구매 URL 검증 완료',
        issues: issues.slice(0, 12),
      }
    })

    window.postMessage({
      source: PAGE_SOURCE,
      type: 'FUNTASTIC_1688_VERIFY_RESULT_SAVED',
      runId: message.runId,
      url: message.url,
      ok: true,
    }, window.location.origin)
  }, [])

  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>) => {
      if (event.source !== window || event.origin !== window.location.origin) return
      if (!isCollectorMessage(event.data)) return
      const message = event.data

      if (message.type === 'FUNTASTIC_1688_PONG') {
        setExtensionReady(true)
        if (message.mode === 'verification') {
          if (message.running && message.runId) {
            verificationRunIdRef.current = message.runId
            setVerificationRunning(true)
            setVerificationProgress((current) => ({
              ...current,
              total: message.total ?? current.total,
              processed: message.summary?.processed ?? message.index ?? current.processed,
              open: message.summary?.open ?? current.open,
              unavailable: message.summary?.unavailable ?? current.unavailable,
              unknown: message.summary?.unknown ?? current.unknown,
              message: '진행 중인 1688 URL 검증에 다시 연결했습니다.',
              issues: message.summary?.recentIssues?.slice(0, 12) ?? current.issues,
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
        if (message.verificationCheckpoint?.total) {
          const checkpoint = message.verificationCheckpoint
          const processed = Math.min(checkpoint.nextIndex, checkpoint.total)
          setVerificationRunning(false)
          setVerificationProgress({
            total: checkpoint.total,
            processed,
            open: checkpoint.summary?.open ?? 0,
            unavailable: checkpoint.summary?.unavailable ?? 0,
            unknown: checkpoint.summary?.unknown ?? 0,
            message: checkpoint.completedAt
              ? '최근 1688 구매 URL 검증이 완료되었습니다.'
              : `최근 검증이 ${processed.toLocaleString('ko-KR')}건 처리 후 중단되었습니다. 다시 시작하면 이어집니다.`,
            issues: checkpoint.summary?.recentIssues?.slice(0, 12) ?? [],
          })
        }
        return
      }
      if (message.runId && message.runId === verificationRunIdRef.current) {
        if (message.type === 'FUNTASTIC_1688_VERIFY_ACK') {
          setVerificationProgress((current) => ({
            ...current,
            total: message.total ?? current.total,
            message: '1688 구매 URL 검증을 시작했습니다.',
          }))
          return
        }
        if (message.type === 'FUNTASTIC_1688_VERIFY_RESULT') {
          acknowledgeVerificationResult(message)
          return
        }
        if (message.type === 'FUNTASTIC_1688_VERIFY_COMPLETE') {
          finalizeVerification()
          return
        }
        if (message.type === 'FUNTASTIC_1688_VERIFY_CANCELLED') {
          setVerificationRunning(false)
          setVerificationProgress((current) => ({ ...current, message: 'URL 검증을 중단했습니다.' }))
          toast.info('1688 구매 URL 검증을 중단했습니다.')
          return
        }
        if (message.type === 'FUNTASTIC_1688_VERIFY_ERROR') {
          setVerificationRunning(false)
          setVerificationProgress((current) => ({
            ...current,
            message: message.message ?? '1688 URL 검증 중 오류가 발생했습니다.',
          }))
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
  }, [acknowledgeVerificationResult, finalizeRun, finalizeVerification, saveResult])

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

  const startVerification = async () => {
    if (!extensionReady) {
      toast.error('1688 수집 확장프로그램을 먼저 설치해주세요.')
      return
    }

    setVerificationRunning(true)
    setVerificationProgress({ ...EMPTY_VERIFICATION_PROGRESS, message: '검증할 구매 URL을 확인하고 있습니다.' })
    try {
      const response = await fetch('/api/purchasing/purchase-url-verification?limit=2000', {
        cache: 'no-store',
      })
      const body = await response.json() as VerificationQueueResponse
      if (!response.ok) throw new Error(body.error ?? '구매 URL 검증 목록을 불러오지 못했습니다.')
      if (body.links.length === 0) throw new Error('검증할 1688 구매 URL이 없습니다.')

      const runId = crypto.randomUUID()
      verificationRunIdRef.current = runId
      setVerificationProgress({
        ...EMPTY_VERIFICATION_PROGRESS,
        total: body.links.length,
        message: body.hasMore
          ? `먼저 ${body.links.length.toLocaleString('ko-KR')}개 링크를 검증합니다.`
          : `${body.links.length.toLocaleString('ko-KR')}개 링크를 검증합니다.`,
        issues: body.skippedInvalid > 0
          ? [`1688 상품 주소 형식이 맞지 않는 URL ${body.skippedInvalid.toLocaleString('ko-KR')}개는 제외했습니다.`]
          : [],
      })
      window.postMessage({
        source: PAGE_SOURCE,
        type: 'FUNTASTIC_1688_VERIFY_START',
        runId,
        links: body.links,
      }, window.location.origin)
    } catch (error) {
      setVerificationRunning(false)
      setVerificationProgress(EMPTY_VERIFICATION_PROGRESS)
      toast.error(error instanceof Error ? error.message : '구매 URL 검증을 시작하지 못했습니다.')
    }
  }

  const cancelVerification = () => {
    if (!verificationRunIdRef.current) return
    window.postMessage({
      source: PAGE_SOURCE,
      type: 'FUNTASTIC_1688_VERIFY_CANCEL',
      runId: verificationRunIdRef.current,
    }, window.location.origin)
  }

  const percentage = progress.total > 0
    ? Math.round((progress.processed / progress.total) * 100)
    : 0
  const verificationPercentage = verificationProgress.total > 0
    ? Math.round((verificationProgress.processed / verificationProgress.total) * 100)
    : 0

  return (
    <div className="flex max-w-2xl flex-col items-end gap-2">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <a
          href={EXTENSION_DOWNLOAD}
          download
          className="inline-flex h-9 items-center gap-2 rounded-md border bg-background px-3 text-sm font-medium hover:bg-muted"
        >
          <Download className="size-4" aria-hidden="true" />
          확장프로그램
        </a>
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
        <button
          type="button"
          onClick={() => void startVerification()}
          disabled={running || verificationRunning}
          className="inline-flex h-9 items-center gap-2 rounded-md border bg-background px-3 text-sm font-semibold hover:bg-muted disabled:cursor-not-allowed disabled:opacity-55"
        >
          {verificationRunning
            ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
            : <CheckCircle2 className="size-4" aria-hidden="true" />}
          {verificationRunning
            ? `${verificationProgress.processed}/${verificationProgress.total} 검증 중`
            : 'URL 검증'}
        </button>
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

      {progress.total > 0 ? (
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

      {verificationProgress.total > 0 ? (
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
            <div className="mt-2 space-y-1 text-red-700">
              {verificationProgress.issues.map((issue) => <p key={issue}>{issue}</p>)}
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
