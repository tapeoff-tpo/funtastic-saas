'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { ChevronDown, Search, Settings, X } from 'lucide-react'
import { InvoiceUploadDialog } from './invoice-upload-dialog'
import { ExcelImportDialog } from './excel-import-dialog'
import { LogisticsMessageDialog } from './logistics-message-dialog'
import { GiftRulesDialog } from './gift-rules-dialog'
import { bulkCombineByContactAction } from './combined-actions'
import { forceBulkChangeStatusAction } from './actions'
import type { OrderRow } from './columns'
import type { OrderStage } from '@/lib/orders/types'
import { getIntegrationMethod } from '@/lib/marketplace/integration-methods'
import { usesSkuMappingKey } from '@/lib/orders/mapping-key-marketplaces'
import { stripMappingTextWrapper } from '@/lib/orders/mapping-match'

interface UserTemplate {
  id: string
  name: string
  carrierId: string | null
}

interface ProductSearchResult {
  id: string
  internalSku: string
  name: string
  warehouseLocation: string | null
  basePrice: string | null
  costPrice: string | null
  optionName: string | null
  optionHint: string | null
  availableStock: number | null
}

interface MappingComponentDraft {
  sku: string
  quantity: number
  productName: string
  optionName: string | null
}

interface MappingTarget {
  orderId: string
  marketplaceId: string
  marketplaceOrderId: string
  marketplaceItemId: string
  mappingProductId: string | null
  mappingOptionId: string | null
  sku: string | null
  productName: string
  optionText: string | null
  quantity: number
}

const SELECTED_TEMPLATE_KEY = 'orders.export.selectedTemplateId'
const EXPORT_SCOPE_KEY = 'orders.export.scope'
const EXACT_OPTION_ID = '__exact__'
const RPA_INVOICE_POLL_INTERVAL_MS = 1500
type ExportScope = 'filtered' | 'selected'

interface ShippingActionsProps {
  selectedOrderIds: string[]
  selectedOrders?: OrderRow[]
  /** All orders on the current page — used as fallback when nothing is selected (e.g. 일괄 매핑) */
  allOrders?: OrderRow[]
  stage?: OrderStage
  showMappingAction?: boolean
}

/** Download a file by fetching — allows catching errors from the server */
async function downloadExcel(url: string, filename: string): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const res = await fetch(url)
    if (!res.ok) {
      // Try to parse error message
      const text = await res.text()
      let errMsg = `[${res.status}] `
      try {
        const json = JSON.parse(text)
        errMsg += json.error ?? text.slice(0, 200)
      } catch {
        errMsg += text.slice(0, 200)
      }
      return { success: false, error: errMsg }
    }
    const blob = await res.blob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(a.href)
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

type InvoiceTransmissionStatus = 'waiting' | 'sending' | 'success' | 'failed'

interface InvoiceTransmissionEntry {
  orderId: string
  marketplaceOrderId: string
  trackingNumber: string
  status: InvoiceTransmissionStatus
  jobLogId?: string
  progress?: string | null
  error?: string
}

interface InvoiceTransmissionReport {
  mode: 'API' | 'RPA'
  startedAt: Date
  completedAt?: Date
  entries: InvoiceTransmissionEntry[]
  steps: string[]
}

function reportTime(date: Date): string {
  return new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date)
}

function createInvoiceTransmissionReport(mode: 'API' | 'RPA', selected: OrderRow[]): InvoiceTransmissionReport {
  const startedAt = new Date()
  return {
    mode,
    startedAt,
    entries: selected.map((order) => ({
      orderId: order.id,
      marketplaceOrderId: order.marketplaceOrderId,
      trackingNumber: order.trackingNumber ?? '',
      status: 'waiting',
    })),
    steps: [
      `[준비] 송장송신 대상 ${selected.length}건을 확인했습니다.`,
      '-> Stage I: 송장번호와 주문 연결 정보를 확인 중입니다.',
    ],
  }
}

function appendInvoiceTransmissionStep(report: InvoiceTransmissionReport, message: string): void {
  if (!report.steps.includes(message)) report.steps.push(message)
}

function openInvoiceTransmissionWindow(report: InvoiceTransmissionReport): Window | null {
  const popup = window.open('', '_blank', 'popup=yes,width=820,height=720,scrollbars=yes,resizable=yes')
  if (!popup) return null

  popup.document.open()
  popup.document.write(`<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <title>송장 송신 결과</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 20px; font-family: Arial, "Malgun Gothic", sans-serif; color: #222; background: #fff; font-size: 13px; }
    h1 { margin: 0 0 22px; border: 1px solid #cfcfcf; padding: 10px 12px; font-size: 16px; font-weight: 700; }
    h1::before { content: ""; display: inline-block; width: 5px; height: 17px; margin-right: 9px; vertical-align: -3px; background: #b11e31; }
    .notice { border: 1px solid #d5d5d5; padding: 12px; color: #555; line-height: 1.75; margin-bottom: 20px; }
    .log { white-space: pre-wrap; margin: 0 0 18px; line-height: 1.62; font-weight: 600; color: #7b1c23; }
    .meta { margin-bottom: 10px; font-weight: 700; }
    table { width: 100%; border-collapse: collapse; margin: 12px 0 16px; font-size: 13px; }
    th { padding: 8px 9px; border-top: 1px solid #bbb; border-bottom: 1px solid #bbb; background: #f5f5f5; text-align: left; }
    td { padding: 8px 9px; border-bottom: 1px solid #e3e3e3; vertical-align: top; }
    .status { font-weight: 700; white-space: nowrap; }
    .waiting { color: #6b7280; }
    .sending { color: #2563eb; }
    .success { color: #087443; }
    .failed { color: #bd1e2c; }
    .summary { border-top: 1px dashed #8d8d8d; padding-top: 12px; line-height: 1.7; font-weight: 700; }
    .detail { max-width: 330px; white-space: pre-wrap; color: #555; font-size: 12px; }
  </style>
</head>
<body>
  <h1>송장 송신</h1>
  <div class="notice">▶ 송장송신은 마켓별 통신 상태에 따라 처리 시간이 달라질 수 있습니다.<br />▶ 결과는 주문번호별로 표시되며, 완료되기 전까지 이 창을 닫지 마세요.</div>
  <div id="steps" class="log"></div>
  <div id="start" class="meta"></div>
  <table>
    <thead><tr><th>주문번호</th><th>송장번호</th><th>송신결과</th><th>처리 내용</th></tr></thead>
    <tbody id="results"></tbody>
  </table>
  <div id="summary" class="summary"></div>
</body>
</html>`)
  popup.document.close()
  updateInvoiceTransmissionWindow(popup, report)
  return popup
}

function updateInvoiceTransmissionWindow(popup: Window | null, report: InvoiceTransmissionReport): void {
  if (!popup || popup.closed) return
  const doc = popup.document
  const steps = doc.getElementById('steps')
  const start = doc.getElementById('start')
  const results = doc.getElementById('results')
  const summary = doc.getElementById('summary')
  if (!steps || !start || !results || !summary) return

  steps.textContent = report.steps.join('\n')
  start.textContent = `[시작] ${report.mode} 송장송신 작업을 시작합니다. (${reportTime(report.startedAt)})`
  results.replaceChildren()

  const statusLabels: Record<InvoiceTransmissionStatus, string> = {
    waiting: '대기',
    sending: '송신중',
    success: '성공',
    failed: '실패',
  }
  for (const entry of report.entries) {
    const row = doc.createElement('tr')
    const orderCell = doc.createElement('td')
    const trackingCell = doc.createElement('td')
    const statusCell = doc.createElement('td')
    const detailCell = doc.createElement('td')
    orderCell.textContent = entry.marketplaceOrderId
    trackingCell.textContent = entry.trackingNumber || '-'
    statusCell.className = `status ${entry.status}`
    statusCell.textContent = statusLabels[entry.status]
    detailCell.className = 'detail'
    detailCell.textContent = entry.error ?? entry.progress ?? (entry.status === 'success' ? '송신 완료' : '')
    row.append(orderCell, trackingCell, statusCell, detailCell)
    results.appendChild(row)
  }

  const success = report.entries.filter((entry) => entry.status === 'success').length
  const failed = report.entries.filter((entry) => entry.status === 'failed').length
  const sending = report.entries.filter((entry) => entry.status === 'sending').length
  const waiting = report.entries.filter((entry) => entry.status === 'waiting').length
  const finishedLine = report.completedAt
    ? `[종료] 송장송신 작업이 완료되었습니다. (${reportTime(report.completedAt)})\n`
    : ''
  summary.textContent = `${finishedLine}[송신결과] 전체 ${report.entries.length}건, 성공 ${success}건, 실패 ${failed}건, 진행중 ${sending + waiting}건입니다.`
}

export function ShippingActions({
  selectedOrderIds,
  selectedOrders = [],
  allOrders = [],
  stage,
  showMappingAction = false,
}: ShippingActionsProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [invoiceDialogOpen, setInvoiceDialogOpen] = useState(false)
  const [excelImportOpen, setExcelImportOpen] = useState(false)
  const [logisticsMsgOpen, setLogisticsMsgOpen] = useState(false)
  const [mappingDialogOpen, setMappingDialogOpen] = useState(false)
  const [giftRulesOpen, setGiftRulesOpen] = useState(false)
  const [applyingMappings, setApplyingMappings] = useState(false)
  const [unapplyingMappings, setUnapplyingMappings] = useState(false)
  const [splittingSets, setSplittingSets] = useState(false)
  const [applyingGifts, setApplyingGifts] = useState(false)
  const [confirmingMapped, setConfirmingMapped] = useState(false)
  const [classifying, setClassifying] = useState(false)
  const [combining, setCombining] = useState(false)
  const [uploadingToMarket, setUploadingToMarket] = useState(false)
  const [uploadingRpaInvoice, setUploadingRpaInvoice] = useState(false)
  const [rpaInvoiceFailure, setRpaInvoiceFailure] = useState<{
    title: string
    message: string
    details?: string
  } | null>(null)
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const [userTemplates, setUserTemplates] = useState<UserTemplate[] | null>(null)
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null)
  const [exportScope, setExportScope] = useState<ExportScope>('filtered')
  const exportMenuRef = useRef<HTMLDivElement>(null)
  const rpaInvoicePollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const rpaInvoicePollStartedAtRef = useRef<number | null>(null)

  const stopRpaInvoicePolling = () => {
    if (rpaInvoicePollTimerRef.current) {
      clearInterval(rpaInvoicePollTimerRef.current)
      rpaInvoicePollTimerRef.current = null
    }
    rpaInvoicePollStartedAtRef.current = null
  }

  // localStorage 에서 마지막 선택 양식 복원
  useEffect(() => {
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem(SELECTED_TEMPLATE_KEY) : null
    if (saved) setSelectedTemplateId(saved)
    const savedScope = typeof window !== 'undefined' ? window.localStorage.getItem(EXPORT_SCOPE_KEY) : null
    if (savedScope === 'filtered' || savedScope === 'selected') setExportScope(savedScope)
  }, [])

  // 컴포넌트 mount 시 양식 목록 1회 fetch (메인 버튼 라벨 표시용)
  useEffect(() => {
    if (userTemplates !== null) return
    fetch('/api/shipping/templates')
      .then((r) => r.ok ? r.json() : { templates: [] })
      .then((d: { templates: UserTemplate[] }) => setUserTemplates(d.templates ?? []))
      .catch(() => setUserTemplates([]))
  }, [userTemplates])

  // 드롭다운 외부 클릭 시 닫기
  useEffect(() => {
    if (!exportMenuOpen) return
    const onDocClick = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setExportMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [exportMenuOpen])

  useEffect(() => {
    return () => stopRpaInvoicePolling()
  }, [])

  const hasSelection = selectedOrderIds.length > 0
  const selectedOrderMap = useMemo(() => new Map(selectedOrders.map((order) => [order.id, order])), [selectedOrders])
  const knownSelectedOrders = useMemo(() => {
    return selectedOrderIds
      .map((id) => selectedOrderMap.get(id))
      .filter((order): order is OrderRow => !!order)
  }, [selectedOrderIds, selectedOrderMap])
  const selectedRpaOrders = useMemo(() => {
    return knownSelectedOrders.filter((order) =>
      order.connectionId && getIntegrationMethod(order.marketplaceId) === 'rpa',
    )
  }, [knownSelectedOrders])
  const selectedApiOrders = useMemo(() => {
    return knownSelectedOrders.filter((order) =>
      !order.connectionId || getIntegrationMethod(order.marketplaceId) !== 'rpa',
    )
  }, [knownSelectedOrders])

  const handleMarketplaceInvoiceUpload = async () => {
    if (selectedApiOrders.length === 0 || uploadingToMarket) return

    if (selectedApiOrders.every((order) => !order.trackingNumber)) {
      setInvoiceDialogOpen(true)
      return
    }

    const report = createInvoiceTransmissionReport('API', selectedApiOrders)
    const reportWindow = openInvoiceTransmissionWindow(report)
    report.entries = report.entries.map((entry) => ({ ...entry, status: 'sending' }))
    appendInvoiceTransmissionStep(report, '-> Stage II: 마켓별 송장 송신 요청을 진행하고 있습니다.')
    updateInvoiceTransmissionWindow(reportWindow, report)

    setUploadingToMarket(true)
    let keepUploadingUntilPollFinishes = false
    try {
      if (selectedRpaOrders.length > 0) {
        toast.info(`RPA 주문 ${selectedRpaOrders.length}건은 [RPA 송장 전송] 버튼에서 별도로 전송해주세요.`)
      }
      const res = await fetch('/api/shipping/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderIds: selectedApiOrders.map((order) => order.id) }),
      })
      const data = await res.json().catch(() => ({})) as {
        uploaded?: number
        queued?: number
        failed?: number
        message?: string
        jobLogIds?: string[]
        results?: Array<{
          orderId: string
          marketplaceOrderId: string
          trackingNumber: string
          success: boolean
          queued?: boolean
          jobLogId?: string
          error?: string
        }>
      }

      if (!res.ok) {
        const message = data.message ?? '송장 전송에 실패했습니다.'
        report.entries = report.entries.map((entry) => ({ ...entry, status: 'failed', error: message }))
        report.completedAt = new Date()
        appendInvoiceTransmissionStep(report, '-> Stage III: 송장 송신 요청이 실패했습니다.')
        updateInvoiceTransmissionWindow(reportWindow, report)
        toast.error(message)
        return
      }

      const resultMap = new Map((data.results ?? []).map((result) => [result.orderId, result]))
      report.entries = report.entries.map((entry) => {
        const result = resultMap.get(entry.orderId)
        if (!result) return { ...entry, status: 'failed', error: '송신 대상에서 확인되지 않았습니다.' }
        if (result.queued) {
          return { ...entry, status: 'sending', jobLogId: result.jobLogId, progress: '송신 작업 대기 중' }
        }
        return {
          ...entry,
          trackingNumber: result.trackingNumber || entry.trackingNumber,
          status: result.success ? 'success' : 'failed',
          error: result.success ? undefined : (result.error ?? '송신 실패'),
        }
      })
      appendInvoiceTransmissionStep(report, '-> Stage III: 쇼핑몰 응답 결과를 확인했습니다.')
      updateInvoiceTransmissionWindow(reportWindow, report)

      const uploaded = data.uploaded ?? 0
      const queued = data.queued ?? 0
      const failed = data.failed ?? 0
      if (queued > 0 && data.jobLogIds?.length) {
        keepUploadingUntilPollFinishes = true
        appendInvoiceTransmissionStep(report, '-> Stage IV: 비동기 송신 작업의 완료 여부를 확인하고 있습니다.')
        updateInvoiceTransmissionWindow(reportWindow, report)
        pollRpaInvoiceUpload(data.jobLogIds, report, reportWindow)
        toast.info(`${queued}건 송장 송신 처리 중`)
        router.refresh()
      } else {
        report.completedAt = new Date()
        appendInvoiceTransmissionStep(report, '[종료] 송장송신 결과 집계를 완료했습니다.')
        updateInvoiceTransmissionWindow(reportWindow, report)
      }
      if (queued > 0) {
        return
      } else if (uploaded > 0 && failed === 0) {
        toast.success(`${uploaded}건 송장 전송 완료`)
        router.refresh()
      } else if (uploaded > 0) {
        const firstError = data.results?.find((result) => !result.success)?.error
        toast.warning(`${uploaded}건 성공, ${failed}건 실패${firstError ? `: ${firstError}` : ''}`)
        router.refresh()
      } else {
        const firstError = data.results?.find((result) => !result.success)?.error
        toast.error(firstError ?? data.message ?? '전송할 송장번호가 없습니다.')
        if (!firstError) setInvoiceDialogOpen(true)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '송장 전송에 실패했습니다.'
      report.entries = report.entries.map((entry) => ({ ...entry, status: 'failed', error: message }))
      report.completedAt = new Date()
      appendInvoiceTransmissionStep(report, '-> Stage III: 송장 송신 중 오류가 발생했습니다.')
      updateInvoiceTransmissionWindow(reportWindow, report)
      toast.error(message)
    } finally {
      if (!keepUploadingUntilPollFinishes) setUploadingToMarket(false)
    }
  }

  const handleRpaInvoiceUpload = async () => {
    if (selectedRpaOrders.length === 0 || uploadingRpaInvoice) return
    setRpaInvoiceFailure(null)
    const report = createInvoiceTransmissionReport('RPA', selectedRpaOrders)
    const reportWindow = openInvoiceTransmissionWindow(report)

    const missingTracking = selectedRpaOrders.filter((order) => !order.trackingNumber)
    if (missingTracking.length > 0) {
      const message = '송장번호가 없는 주문이 있어 송신을 시작하지 않았습니다.'
      report.entries = report.entries.map((entry) => ({ ...entry, status: 'failed', error: message }))
      report.completedAt = new Date()
      appendInvoiceTransmissionStep(report, '-> Stage II: 송장번호 유효성 확인에 실패했습니다.')
      updateInvoiceTransmissionWindow(reportWindow, report)
      toast.error(`${missingTracking.length}건은 송장번호가 없습니다. 먼저 송장등록을 해주세요.`)
      setInvoiceDialogOpen(true)
      return
    }

    report.entries = report.entries.map((entry) => ({ ...entry, status: 'sending', progress: '송신 작업 접수 중' }))
    appendInvoiceTransmissionStep(report, '-> Stage II: 판매자센터 송장 송신 작업을 접수하고 있습니다.')
    updateInvoiceTransmissionWindow(reportWindow, report)
    setUploadingRpaInvoice(true)
    let keepUploadingUntilPollFinishes = false
    try {
      const res = await fetch('/api/shipping/upload/rpa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderIds: selectedRpaOrders.map((order) => order.id) }),
      })
      const data = await res.json().catch(() => ({})) as {
        queued?: number
        skipped?: number
        message?: string
        error?: string
        jobLogIds?: string[]
        results?: Array<{
          orderId: string
          marketplaceOrderId: string
          trackingNumber: string
          queued: boolean
          jobLogId?: string
          error?: string
        }>
      }

      if (!res.ok) {
        const message = data.error ?? data.message ?? 'RPA 송장 전송 요청에 실패했습니다.'
        report.entries = report.entries.map((entry) => ({ ...entry, status: 'failed', error: message }))
        report.completedAt = new Date()
        appendInvoiceTransmissionStep(report, '-> Stage III: RPA 송신 요청이 실패했습니다.')
        updateInvoiceTransmissionWindow(reportWindow, report)
        setRpaInvoiceFailure({
          title: 'RPA 송장 전송 요청 실패',
          message,
        })
        toast.error(message)
        return
      }

      const queued = data.queued ?? 0
      const skipped = data.skipped ?? 0
      const resultMap = new Map((data.results ?? []).map((result) => [result.orderId, result]))
      report.entries = report.entries.map((entry) => {
        const result = resultMap.get(entry.orderId)
        if (!result) return { ...entry, status: 'failed', error: '송신 대상에서 확인되지 않았습니다.' }
        if (!result.queued) return { ...entry, status: 'failed', error: result.error ?? '송신 접수 실패' }
        return {
          ...entry,
          trackingNumber: result.trackingNumber || entry.trackingNumber,
          jobLogId: result.jobLogId,
          status: 'sending',
          progress: '송신 작업 대기 중',
        }
      })
      appendInvoiceTransmissionStep(report, '-> Stage III: RPA 송신 작업을 접수했습니다. 처리 결과를 확인하고 있습니다.')
      updateInvoiceTransmissionWindow(reportWindow, report)
      if (queued > 0 && skipped === 0) {
        toast.success(`${queued}건 RPA 송장 전송 시작`)
      } else if (queued > 0) {
        const firstError = data.results?.find((result) => !result.queued)?.error
        toast.warning(`${queued}건 시작, ${skipped}건 제외${firstError ? `: ${firstError}` : ''}`)
      } else {
        const message = data.message ?? data.results?.find((result) => result.error)?.error ?? 'RPA 전송할 송장이 없습니다.'
        setRpaInvoiceFailure({
          title: 'RPA 송장 전송 실패',
          message,
        })
        toast.error(message)
      }
      if (queued > 0 && data.jobLogIds?.length) {
        keepUploadingUntilPollFinishes = true
        router.refresh()
        pollRpaInvoiceUpload(data.jobLogIds, report, reportWindow)
      } else {
        report.completedAt = new Date()
        appendInvoiceTransmissionStep(report, '[종료] 송장송신 결과 집계를 완료했습니다.')
        updateInvoiceTransmissionWindow(reportWindow, report)
        router.refresh()
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'RPA 송장 전송 요청에 실패했습니다.'
      report.entries = report.entries.map((entry) => ({ ...entry, status: 'failed', error: message }))
      report.completedAt = new Date()
      appendInvoiceTransmissionStep(report, '-> Stage III: RPA 송신 요청 중 오류가 발생했습니다.')
      updateInvoiceTransmissionWindow(reportWindow, report)
      setRpaInvoiceFailure({
        title: 'RPA 송장 전송 요청 실패',
        message,
      })
      toast.error(message)
    } finally {
      if (!keepUploadingUntilPollFinishes) {
        setUploadingRpaInvoice(false)
      }
    }
  }

  const pollRpaInvoiceUpload = (
    jobLogIds: string[],
    report: InvoiceTransmissionReport,
    reportWindow: Window | null,
  ) => {
    stopRpaInvoicePolling()
    rpaInvoicePollStartedAtRef.current = Date.now()
    const idsParam = jobLogIds.join(',')
    const orderIdsParam = report.entries.map((entry) => entry.orderId).join(',')

    const finishPolling = () => {
      stopRpaInvoicePolling()
      setUploadingToMarket(false)
      setUploadingRpaInvoice(false)
      router.refresh()
    }

    const poll = async () => {
      try {
        const res = await fetch(`/api/orders/collect/status?ids=${encodeURIComponent(idsParam)}&orderIds=${encodeURIComponent(orderIdsParam)}`)
        if (!res.ok) return

        const data = await res.json() as {
          allDone?: boolean
          logs?: Array<{ id: string; status: string; errorMessage?: string | null; progressMessage?: string | null }>
          shipmentStatuses?: Array<{ orderId: string; uploadStatus: string; errorMessage?: string | null }>
        }
        if (!data.logs) return

        const logsById = new Map(data.logs.map((log) => [log.id, log]))
        const shipmentsByOrderId = new Map((data.shipmentStatuses ?? []).map((shipment) => [shipment.orderId, shipment]))
        report.entries = report.entries.map((entry) => {
          const shipment = shipmentsByOrderId.get(entry.orderId)
          if (shipment?.uploadStatus === 'uploaded') {
            return { ...entry, status: 'success', progress: '송신 완료', error: undefined }
          }
          if (shipment?.uploadStatus === 'failed') {
            return { ...entry, status: 'failed', error: shipment.errorMessage ?? '송신 실패' }
          }
          const log = entry.jobLogId ? logsById.get(entry.jobLogId) : undefined
          if (!log) return entry
          if (log.status === 'completed') return { ...entry, status: 'success', progress: '송신 완료', error: undefined }
          if (log.status === 'failed' || log.status === 'cancelled') {
            return { ...entry, status: 'failed', error: log.errorMessage ?? '송신 실패' }
          }
          return { ...entry, status: 'sending', progress: log.progressMessage ?? '송신 작업 진행 중' }
        })
        for (const progress of data.logs
          .map((log) => log.progressMessage)
          .filter((message): message is string => !!message)) {
          appendInvoiceTransmissionStep(report, `-> ${progress}`)
        }
        updateInvoiceTransmissionWindow(reportWindow, report)
        if (!report.entries.every((entry) => entry.status === 'success' || entry.status === 'failed')) return

        const completed = report.entries.filter((entry) => entry.status === 'success').length
        const failedEntries = report.entries.filter((entry) => entry.status === 'failed')
        const failed = failedEntries.length
        const firstError = failedEntries.find((entry) => entry.error)?.error
        const details = failedEntries
          .map((entry, index) => `${index + 1}. ${entry.marketplaceOrderId}: ${entry.error ?? '송신 실패'}`)
          .join('\n')

        finishPolling()
        report.completedAt = new Date()
        appendInvoiceTransmissionStep(report, '[종료] 송장송신 결과 집계를 완료했습니다.')
        updateInvoiceTransmissionWindow(reportWindow, report)
        if (completed > 0 && failed === 0) {
          toast.success(`${completed}건 ${report.mode} 송장 전송 완료`)
        } else if (completed > 0) {
          setRpaInvoiceFailure({
            title: `${report.mode} 송장 일부 실패`,
            message: `${completed}건 완료, ${failed}건 실패`,
            details: details || firstError || undefined,
          })
          toast.warning(`${completed}건 완료, ${failed}건 실패${firstError ? `: ${firstError}` : ''}`)
        } else {
          const message = firstError ?? `${report.mode} 송장 전송에 실패했습니다.`
          setRpaInvoiceFailure({
            title: `${report.mode} 송장 전송 실패`,
            message,
            details: details || undefined,
          })
          toast.error(message)
        }
      } catch {
        // 네트워크 오류는 다음 폴링에서 다시 확인
      }
    }

    void poll()
    rpaInvoicePollTimerRef.current = setInterval(() => void poll(), RPA_INVOICE_POLL_INTERVAL_MS)
  }

  // 현재 선택된 양식 — localStorage 에 저장된 ID 가 목록에 없으면 첫 번째로 fallback
  const activeTemplate = useMemo<UserTemplate | null>(() => {
    if (!userTemplates || userTemplates.length === 0) return null
    return userTemplates.find((t) => t.id === selectedTemplateId) ?? userTemplates[0]
  }, [userTemplates, selectedTemplateId])

  const pickTemplate = (id: string | null) => {
    setSelectedTemplateId(id)
    if (typeof window === 'undefined') return
    if (id) {
      window.localStorage.setItem(SELECTED_TEMPLATE_KEY, id)
    } else {
      window.localStorage.removeItem(SELECTED_TEMPLATE_KEY)
    }
  }

  const pickExportScope = (scope: ExportScope) => {
    setExportScope(scope)
    if (typeof window !== 'undefined') window.localStorage.setItem(EXPORT_SCOPE_KEY, scope)
  }

  // For 일괄 매핑: 선택된 주문이 있으면 그 중 미매핑만, 없으면 전체 미매핑 카운트
  const ordersForMapping = selectedOrders.length > 0 ? selectedOrders : allOrders
  const existingMappedOrders = useMemo(() => {
    return ordersForMapping.filter((order) => order.mappingStatus === 'mapped')
  }, [ordersForMapping])
  const selectedMappableOrders = useMemo(() => {
    return selectedOrders.filter((order) => order.mappingStatus !== 'unmapped')
  }, [selectedOrders])

  const mappingTargets = useMemo<MappingTarget[]>(() => {
    return ordersForMapping
      .flatMap((order) => order.items
        .filter((item) => item.marketplaceItemId)
        .map((item) => ({
          orderId: order.id,
          marketplaceId: order.marketplaceId,
          marketplaceOrderId: order.marketplaceOrderId,
          marketplaceItemId: item.marketplaceItemId!,
          mappingProductId: item.mappingProductId ?? null,
          mappingOptionId: item.mappingOptionId ?? null,
          sku: item.sku ?? null,
          productName: item.productName,
          optionText: item.optionText,
          quantity: item.quantity,
        })))
  }, [ordersForMapping])

  // 선택된 양식으로 주문 일괄 다운로드 — 단일 Excel 파일
  const handleExport = async (template: UserTemplate) => {
    const selectedScope = selectedOrderIds.length > 0 ? selectedOrderIds : []
    if (exportScope === 'selected' && selectedScope.length === 0) {
      toast.error('선택된 주문이 없습니다.')
      return
    }
    if (exportScope === 'filtered' && allOrders.length === 0) {
      toast.error('다운로드할 검색 결과가 없습니다.')
      return
    }
    setClassifying(true)
    try {
      const p = new URLSearchParams()
      if (exportScope === 'selected') {
        p.set('orderIds', selectedScope.join(','))
      } else {
        p.set('scope', 'filtered')
        searchParams.forEach((value, key) => {
          if (key === 'page' || key === 'pageSize') return
          p.set(key, value)
        })
      }
      p.set('type', 'carrier')
      p.set('templateId', template.id)
      const date = new Date().toISOString().slice(0, 10)
      const filenameScope = exportScope === 'selected' ? '선택자료' : '전체자료'
      const result = await downloadExcel(
        `/api/shipping/export?${p.toString()}`,
        `${template.name}_${filenameScope}_${date}.xlsx`,
      )
      if (result.success) {
        const countText = exportScope === 'selected' ? ` ${selectedScope.length}건` : ''
        toast.success(`${template.name} ${filenameScope}${countText} 다운로드`)
      } else {
        toast.error(`다운로드 실패: ${result.error}`)
      }
    } finally {
      setClassifying(false)
    }
  }

  const handleBulkCombineByContact = async () => {
    if (combining) return
    const scope = selectedOrderIds.length > 0 ? selectedOrderIds : allOrders.map((o) => o.id)
    if (scope.length === 0) {
      toast.error('대상 주문이 없습니다.')
      return
    }
    const confirmMsg = selectedOrderIds.length > 0
      ? `선택한 ${scope.length}건에서 마켓+수취인+주소 동일 주문을 합포장으로 묶습니다. 계속하시겠습니까?`
      : `현재 페이지 ${scope.length}건에서 마켓+수취인+주소 동일 주문을 합포장으로 묶습니다. 계속하시겠습니까?`
    if (!window.confirm(confirmMsg)) return

    setCombining(true)
    try {
      const result = await bulkCombineByContactAction(scope)
      if (result.created === 0) {
        toast.info('합포장 대상이 없습니다 (마켓+수취인+주소 동일 주문이 2건 이상인 경우에만 묶입니다).')
      } else {
        toast.success(`${result.created}개 그룹 생성 (${result.totalOrders}건 포함). /shipping/combined 에서 확인하세요.`)
      }
    } catch (err) {
      toast.error(`합포장 실패: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setCombining(false)
    }
  }

  const handlePrintLabels = () => {
    const params = new URLSearchParams()
    params.set('ids', selectedOrderIds.join(','))
    window.open(`/shipping/print?${params.toString()}`, '_blank')
  }

  const handleApplyExistingMappings = async () => {
    if (ordersForMapping.length === 0) {
      toast.info('매핑할 주문이 없습니다.')
      return
    }

    setApplyingMappings(true)
    try {
      const orderIds = Array.from(new Set(ordersForMapping.map((order) => order.id)))
      const res = await fetch('/api/orders/apply-mappings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orderIds }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast.error(err.error ?? '매핑 처리 실패')
        return
      }
      const data = await res.json() as {
        applied?: number
        failed?: number
        failures?: Array<{ marketplaceOrderId: string; reason: string }>
        error?: string
      }
      if ((data.failed ?? 0) > 0) {
        const firstFailure = data.failures?.[0]
        const suffix = firstFailure ? ` (${firstFailure.marketplaceOrderId}: ${firstFailure.reason})` : ''
        if ((data.applied ?? 0) > 0) {
          toast.warning(`${data.applied}건 매핑 완료, ${data.failed}건 실패${suffix}`, { duration: 8000 })
        } else {
          toast.error(data.error ?? `매핑 실패 ${suffix}`, { duration: 8000 })
        }
      } else {
        toast.success(`${data.applied ?? 0}건 매핑 완료`)
      }
      router.refresh()
    } finally {
      setApplyingMappings(false)
    }
  }

  const handleUnapplyMappings = async () => {
    if (selectedOrderIds.length === 0) {
      toast.info('매핑해제할 주문을 선택하세요.')
      return
    }
    if (selectedMappableOrders.length === 0) {
      toast.info('선택한 주문 중 매핑된 주문이 없습니다.')
      return
    }
    if (!window.confirm(`선택한 ${selectedMappableOrders.length}건의 매핑을 해제할까요?\n\n동일 마켓 상품에 연결된 매핑 규칙도 함께 해제될 수 있습니다.`)) {
      return
    }

    setUnapplyingMappings(true)
    try {
      const orderIds = Array.from(new Set(selectedMappableOrders.map((order) => order.id)))
      const res = await fetch('/api/orders/unapply-mappings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orderIds }),
      })
      const data = await res.json().catch(() => ({})) as {
        unmappedOrders?: number
        error?: string
      }
      if (!res.ok) {
        toast.error(data.error ?? '매핑해제 실패')
        return
      }
      toast.success(`매핑해제 완료: ${data.unmappedOrders ?? 0}건`)
      router.refresh()
    } finally {
      setUnapplyingMappings(false)
    }
  }

  const handleConfirmMappedOrders = async () => {
    if (existingMappedOrders.length === 0) {
      toast.info('확정할 매핑완료 주문이 없습니다.')
      return
    }

    setConfirmingMapped(true)
    try {
      const orderIds = Array.from(new Set(existingMappedOrders.map((order) => order.id)))
      const result = await forceBulkChangeStatusAction(orderIds, 'confirmed')

      if (result.errors.length === 0) {
        toast.success(`${result.updated}건 확인 탭으로 이동`)
      } else {
        toast.warning(`${result.updated}건 이동, ${result.errors.length}건 실패`)
        for (const failure of result.errors.slice(0, 3)) {
          toast.error(failure.error, { duration: 8000 })
        }
      }
      router.refresh()
    } finally {
      setConfirmingMapped(false)
    }
  }

  const handleSplitSetOrders = async () => {
    if (existingMappedOrders.length === 0) {
      toast.info('세트분리할 매핑완료 주문이 없습니다.')
      return
    }

    setSplittingSets(true)
    try {
      const orderIds = Array.from(new Set(existingMappedOrders.map((order) => order.id)))
      const res = await fetch('/api/orders/split-sets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orderIds }),
      })
      const data = await res.json().catch(() => ({})) as {
        splitOrders?: number
        createdCopies?: number
        skipped?: number
        error?: string
      }

      if (!res.ok) {
        toast.error(data.error ?? '세트분리 실패')
        return
      }

      if ((data.splitOrders ?? 0) === 0) {
        toast.info('분리할 세트 주문이 없습니다.')
      } else {
        toast.success(`세트분리 완료: ${data.splitOrders}건 분리, ${data.createdCopies ?? 0}건 추가`)
      }
      router.refresh()
    } finally {
      setSplittingSets(false)
    }
  }

  const handleApplyGifts = async () => {
    const scope = selectedOrderIds.length > 0 ? selectedOrderIds : allOrders.map((order) => order.id)
    if (scope.length === 0) {
      toast.error('사은품을 적용할 주문이 없습니다.')
      return
    }

    setApplyingGifts(true)
    try {
      const res = await fetch('/api/orders/apply-gifts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orderIds: scope }),
      })
      const data = await res.json().catch(() => ({})) as { applied?: number; message?: string; error?: string }
      if (!res.ok) {
        toast.error(data.error ?? '사은품 적용 실패')
        return
      }
      if ((data.applied ?? 0) === 0) {
        toast.info(data.message ?? '적용할 사은품이 없습니다.')
      } else {
        toast.success(`사은품 ${data.applied}건 추가`)
      }
      router.refresh()
    } finally {
      setApplyingGifts(false)
    }
  }

  // Determine which action groups to show based on stage
  const showMapping = showMappingAction || stage === 'mapping'
  const hideFulfillmentActions = showMappingAction
  const showInvoice = !stage || stage === 'invoice' || stage === 'confirm'
  const currentStatus = searchParams.get('status')
  const showMarketplaceInvoiceUpload = currentStatus === 'preparing' || currentStatus === 'ready' || currentStatus === 'shipped'
  const showShipping = !hideFulfillmentActions && showMarketplaceInvoiceUpload
  const showPrint = !hideFulfillmentActions && (!stage || stage === 'shipping' || stage === 'done')

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/30 p-2">
        {showMapping && (
          <>
            <button
              type="button"
              onClick={() => void handleApplyExistingMappings()}
              disabled={applyingMappings || ordersForMapping.length === 0}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
              title={hasSelection ? '선택한 주문을 매핑완료 또는 재매핑 처리' : '현재 페이지 주문을 매핑완료 또는 재매핑 처리'}
            >
              {applyingMappings
                ? '매핑 중...'
                : `매핑${ordersForMapping.length > 0 ? ` (${ordersForMapping.length})` : ''}`}
            </button>
            <button
              type="button"
              onClick={() => {
                if (mappingTargets.length === 0) {
                  toast.info('미매핑 상품이 없습니다.')
                  return
                }
                setMappingDialogOpen(true)
              }}
              className="rounded-md bg-orange-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-orange-600"
            >
              재고매핑 {ordersForMapping.length > 0 ? `(${ordersForMapping.length}건)` : ''}
            </button>
            <Link
              href="/products/mapping"
              className="rounded-md border border-orange-200 bg-white px-3 py-1.5 text-sm font-medium text-orange-700 hover:bg-orange-50"
            >
              매핑관리
            </Link>
            <button
              type="button"
              onClick={() => void handleUnapplyMappings()}
              disabled={unapplyingMappings || selectedMappableOrders.length === 0}
              className="rounded-md border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
              title="선택한 주문의 매핑을 해제"
            >
              {unapplyingMappings
                ? '매핑해제 중...'
                : `매핑해제${selectedMappableOrders.length > 0 ? ` (${selectedMappableOrders.length})` : ''}`}
            </button>
            <button
              type="button"
              onClick={() => void handleSplitSetOrders()}
              disabled={splittingSets || existingMappedOrders.length === 0}
              className="rounded-md border border-sky-200 bg-white px-3 py-1.5 text-sm font-medium text-sky-700 hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-50"
              title={hasSelection ? '선택한 매핑완료 주문 중 세트 구성품을 주문 줄로 분리' : '현재 페이지의 매핑완료 주문 중 세트 구성품을 주문 줄로 분리'}
            >
              {splittingSets ? '분리 중...' : '세트분리'}
            </button>
            <button
              type="button"
              onClick={() => void handleConfirmMappedOrders()}
              disabled={confirmingMapped || existingMappedOrders.length === 0}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              title={hasSelection ? '선택한 매핑완료 주문을 확인 탭으로 이동 (몰 API 호출 없음)' : '현재 페이지의 매핑완료 주문을 확인 탭으로 이동 (몰 API 호출 없음)'}
            >
              {confirmingMapped
                ? '확정 중...'
                : `확정${existingMappedOrders.length > 0 ? ` (${existingMappedOrders.length})` : ''}`}
            </button>
            <div className="inline-flex">
              <button
                type="button"
                onClick={() => void handleApplyGifts()}
                disabled={applyingGifts || allOrders.length === 0}
                className="rounded-l-md border border-pink-200 bg-white px-3 py-1.5 text-sm font-medium text-pink-700 hover:bg-pink-50 disabled:cursor-not-allowed disabled:opacity-50"
                title={hasSelection ? '선택한 신규 주문에 사은품 규칙 적용' : '현재 페이지 신규 주문에 사은품 규칙 적용'}
              >
                {applyingGifts ? '적용 중...' : '사은품세팅'}
              </button>
              <button
                type="button"
                onClick={() => setGiftRulesOpen(true)}
                className="flex items-center justify-center rounded-r-md border border-l-0 border-pink-200 bg-white px-2.5 py-1.5 text-pink-700 hover:bg-pink-50"
                title="사은품 규칙 설정"
                aria-label="사은품 규칙 설정"
              >
                <Settings className="h-4 w-4" />
              </button>
            </div>
          </>
        )}

        {stage === 'confirm' && (
          <button
            type="button"
            onClick={() => void handleBulkCombineByContact()}
            disabled={combining}
            className="rounded-md bg-purple-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50"
            title="마켓, 수취인, 우편번호, 주소가 동일한 주문을 자동으로 합포장 그룹으로 묶습니다"
          >
            {combining
              ? '묶는 중...'
              : hasSelection
                ? `선택 합포장 (${selectedOrderIds.length}건, 주소기준)`
                : '일괄 합포장 (주소기준)'}
          </button>
        )}

        {showInvoice && (
          <>
            {/* 엑셀 다운로드 — 선택된 양식 하나로 단일 파일 출력. 우측 ▼ 으로 양식 변경. */}
            <div ref={exportMenuRef} className="relative inline-flex">
              <button
                type="button"
                onClick={() => activeTemplate && void handleExport(activeTemplate)}
                disabled={classifying || !activeTemplate}
                className="rounded-l-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                title={
                  !activeTemplate
                    ? '먼저 우측 [엑셀양식등록] 에서 양식을 만드세요'
                    : `양식: ${activeTemplate.name} — ${exportScope === 'selected' ? '선택자료' : '검색된 전체자료'}`
                }
              >
                {classifying
                  ? '다운로드 중...'
                  : activeTemplate
                    ? `${activeTemplate.name} 다운로드 · ${exportScope === 'selected' ? `선택자료${hasSelection ? ` (${selectedOrderIds.length}건)` : ''}` : '전체자료'}`
                    : '엑셀 다운로드 (양식 없음)'}
              </button>
              <button
                type="button"
                onClick={() => setExportMenuOpen((v) => !v)}
                disabled={classifying}
                className="flex items-center justify-center rounded-r-md border-l-2 border-blue-800 bg-blue-700 px-2.5 py-1.5 text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="다운로드 양식 변경"
                title="양식 변경"
              >
                <ChevronDown className="h-5 w-5" strokeWidth={2.5} />
              </button>

              {exportMenuOpen && (
                <div className="absolute left-0 top-full z-20 mt-1 w-72 overflow-hidden rounded-md border bg-white shadow-lg">
                  <div className="border-b px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    다운로드 자료 선택
                  </div>
                  <div className="border-b p-2">
                    {[
                      { value: 'filtered' as const, label: '검색된 전체자료', description: '현재 검색/필터 조건 전체' },
                      { value: 'selected' as const, label: '선택자료', description: selectedOrderIds.length > 0 ? `체크한 ${selectedOrderIds.length}건` : '체크한 주문 없음' },
                    ].map((option) => {
                      const active = exportScope === option.value
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => pickExportScope(option.value)}
                          className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted ${active ? 'font-semibold text-blue-700' : ''}`}
                        >
                          <span className="w-3 text-center">{active ? '●' : ''}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate">{option.label}</span>
                            <span className="block truncate text-[11px] font-normal text-muted-foreground">{option.description}</span>
                          </span>
                        </button>
                      )
                    })}
                  </div>
                  <div className="border-b px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    다운로드 양식 선택
                  </div>
                  {userTemplates === null && (
                    <div className="px-3 py-2 text-xs text-muted-foreground">불러오는 중...</div>
                  )}
                  {userTemplates !== null && userTemplates.length === 0 && (
                    <div className="px-3 py-3 text-xs text-muted-foreground">
                      등록된 양식이 없습니다.<br />
                      우측 [엑셀양식등록] 버튼으로 추가하세요.
                    </div>
                  )}
                  {userTemplates !== null && userTemplates.length > 0 && userTemplates.map((t) => {
                    const isActive = activeTemplate?.id === t.id
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => { pickTemplate(t.id); setExportMenuOpen(false) }}
                        className={`flex w-full cursor-pointer items-center gap-2 truncate px-3 py-2 text-left text-sm hover:bg-muted ${isActive ? 'font-semibold text-blue-700' : ''}`}
                        title={t.name}
                      >
                        <span className="w-3 text-center">{isActive ? '●' : ''}</span>
                        <span className="truncate">{t.name}</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            <a
              href="/shipping/templates"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md border bg-white px-3 py-1.5 text-sm font-medium hover:bg-muted"
              title="새 양식 만들기 또는 기존 양식 수정"
            >
              엑셀양식등록
            </a>

            {!hideFulfillmentActions && (
              <button
                type="button"
                onClick={() => setExcelImportOpen(true)}
                className="rounded-md border bg-white px-3 py-1.5 text-sm font-medium hover:bg-muted"
              >
                송장등록
              </button>
            )}
          </>
        )}

        {showShipping && (
          <>
            <button
              type="button"
              onClick={handleMarketplaceInvoiceUpload}
              disabled={selectedApiOrders.length === 0 || uploadingToMarket}
              className="rounded-md border bg-white px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
              title="API 연동 마켓 송장 전송"
            >
              {uploadingToMarket ? 'API 전송 중...' : `API 송장 전송 (${selectedApiOrders.length})`}
            </button>
            {selectedRpaOrders.length > 0 && (
              <button
                type="button"
                onClick={() => void handleRpaInvoiceUpload()}
                disabled={uploadingRpaInvoice}
                className="rounded-md border border-violet-200 bg-violet-50 px-3 py-1.5 text-sm font-medium text-violet-700 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-50"
                title="RPA 연동 마켓은 판매자센터 화면 자동화로 송장을 전송합니다"
              >
                {uploadingRpaInvoice ? 'RPA 전송 중...' : `RPA 송장 전송 (${selectedRpaOrders.length})`}
              </button>
            )}
          </>
        )}

        {showPrint && (
          <button
            type="button"
            onClick={handlePrintLabels}
            disabled={!hasSelection}
            className="rounded-md border bg-white px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            라벨인쇄
          </button>
        )}

        <button
          type="button"
          onClick={() => setLogisticsMsgOpen(true)}
          disabled={!hasSelection}
          className="rounded-md border bg-white px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
        >
          물류메세지 등록
        </button>

        {stage && (
          <span className="ml-auto text-xs text-muted-foreground">
            💡 현재 단계: <strong>{stage === 'mapping' ? '매핑 필요' : stage === 'confirm' ? '확정 대기' : stage === 'invoice' ? '송장 발급' : stage === 'shipping' ? '출고 대기' : '완료'}</strong>
          </span>
        )}
      </div>

      <InvoiceUploadDialog
        open={invoiceDialogOpen}
        onOpenChange={setInvoiceDialogOpen}
        selectedOrderIds={selectedOrderIds}
      />

      <ExcelImportDialog
        open={excelImportOpen}
        onOpenChange={setExcelImportOpen}
      />

      <LogisticsMessageDialog
        open={logisticsMsgOpen}
        onOpenChange={setLogisticsMsgOpen}
        selectedOrderIds={selectedOrderIds}
      />

      <InventoryMappingDialog
        open={mappingDialogOpen}
        onOpenChange={setMappingDialogOpen}
        targets={mappingTargets}
        onSaved={() => router.refresh()}
      />

      <GiftRulesDialog
        open={giftRulesOpen}
        onOpenChange={setGiftRulesOpen}
      />

      {rpaInvoiceFailure && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4">
          <div className="w-full max-w-lg overflow-hidden rounded-lg border bg-white shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
              <div>
                <h2 className="text-base font-semibold text-red-700">{rpaInvoiceFailure.title}</h2>
                <p className="mt-1 text-sm text-muted-foreground">아래 사유를 확인한 뒤 닫아주세요.</p>
              </div>
              <button
                type="button"
                onClick={() => setRpaInvoiceFailure(null)}
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="닫기"
              >
                <X className="size-5" />
              </button>
            </div>
            <div className="space-y-3 px-5 py-4">
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-800">
                {rpaInvoiceFailure.message}
              </div>
              {rpaInvoiceFailure.details && (
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md border bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-700">
                  {rpaInvoiceFailure.details}
                </pre>
              )}
            </div>
            <div className="flex justify-end border-t bg-muted/20 px-5 py-3">
              <button
                type="button"
                onClick={() => setRpaInvoiceFailure(null)}
                className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function splitProductOption(itemId: string): { product: string; option: string } {
  const idx = itemId.indexOf('-')
  if (idx <= 0) return { product: itemId, option: '' }
  return { product: itemId.slice(0, idx), option: itemId.slice(idx + 1) }
}

function shouldUseSkuAsMappingProduct(target: MappingTarget): boolean {
  return usesSkuMappingKey(target.marketplaceId) && Boolean(target.sku?.trim())
}

function ownerclanProductCodeFromItemId(itemId: string): string | null {
  const match = itemId.trim().match(/^20\d{12,}A-(.+)$/)
  return match?.[1]?.trim() || null
}

function getMappingTargetSource(target: MappingTarget): { product: string; option: string } {
  const split = splitProductOption(target.marketplaceItemId)
  if (target.marketplaceId === 'domeggook' && target.mappingProductId?.trim()) {
    const option = stripMappingTextWrapper(target.mappingOptionId || target.optionText)
    return {
      product: target.mappingProductId.trim(),
      option: option || EXACT_OPTION_ID,
    }
  }
  if (shouldUseSkuAsMappingProduct(target)) {
    const option = stripMappingTextWrapper(target.mappingOptionId || target.optionText)
    return {
      product: target.sku!.trim(),
      option: option || EXACT_OPTION_ID,
    }
  }
  if (target.mappingProductId?.trim()) {
    const option = stripMappingTextWrapper(target.mappingOptionId || target.optionText)
    return {
      product: target.mappingProductId.trim(),
      option: option || EXACT_OPTION_ID,
    }
  }
  if (target.marketplaceId === 'ownerclan') {
    const productCode = target.sku?.trim() || ownerclanProductCodeFromItemId(target.marketplaceItemId)
    if (productCode) {
      const option = stripMappingTextWrapper(target.optionText)
      return {
        product: productCode,
        option: option || EXACT_OPTION_ID,
      }
    }
  }
  const option = stripMappingTextWrapper(split.option || target.optionText)
  return {
    product: split.product,
    option: option || EXACT_OPTION_ID,
  }
}

function getMappingTargetKey(target: MappingTarget): string {
  return `${target.orderId}:${target.marketplaceItemId}:${target.optionText ?? ''}`
}

function getMappingTargetSourceKey(target: MappingTarget): string {
  const source = getMappingTargetSource(target)
  return `${target.marketplaceId}:${source.product}:${source.option}`
}

function createManualMappingCode(source: { product: string; option: string }): string {
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase()
  const product = source.product.replace(/[^a-zA-Z0-9]/g, '').slice(-10) || 'P'
  const option = source.option.replace(/[^a-zA-Z0-9]/g, '').slice(-8) || 'O'
  return `M-${product}-${option}-${suffix}`.slice(0, 40)
}

function mappingCodeNameFromComponents(target: MappingTarget, components: MappingComponentDraft[]): string {
  const names = Array.from(new Set(
    components
      .map((component) => component.productName.trim())
      .filter(Boolean),
  ))
  return names.length > 0 ? names.join(' + ') : target.productName
}

function componentQuantityForMapping(totalQuantity: number, orderQuantity: number): number | null {
  const safeOrderQuantity = Math.max(1, orderQuantity || 1)
  if (totalQuantity % safeOrderQuantity !== 0) return null
  return Math.max(1, totalQuantity / safeOrderQuantity)
}

function InventoryMappingDialog({
  open,
  onOpenChange,
  targets,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  targets: MappingTarget[]
  onSaved: () => void
}) {
  const [selectedKey, setSelectedKey] = useState('')
  const [completedSourceKeys, setCompletedSourceKeys] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ProductSearchResult[]>([])
  const [components, setComponents] = useState<MappingComponentDraft[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const activeTargets = useMemo(
    () => targets.filter((target) => !completedSourceKeys.has(getMappingTargetSourceKey(target))),
    [completedSourceKeys, targets],
  )

  const selectedTarget = useMemo(() => {
    return activeTargets.find((target) => getMappingTargetKey(target) === selectedKey) ?? activeTargets[0] ?? null
  }, [activeTargets, selectedKey])

  useEffect(() => {
    if (!open) return
    setCompletedSourceKeys(new Set())
    const first = targets[0]
    setSelectedKey(first ? getMappingTargetKey(first) : '')
    setQuery('')
    setResults([])
    setComponents([])
  }, [open, targets])

  useEffect(() => {
    if (!open) return
    if (selectedTarget && getMappingTargetKey(selectedTarget) === selectedKey) return
    const first = activeTargets[0]
    setSelectedKey(first ? getMappingTargetKey(first) : '')
  }, [activeTargets, open, selectedKey, selectedTarget])

  async function searchProducts(q: string) {
    if (!q.trim()) {
      setResults([])
      return
    }
    setLoading(true)
    try {
      const res = await fetch(`/api/products/search?q=${encodeURIComponent(q)}&mode=option`)
      if (!res.ok) {
        setResults([])
        return
      }
      const data = await res.json() as { results: ProductSearchResult[] }
      setResults(data.results ?? [])
    } finally {
      setLoading(false)
    }
  }

  function handleQueryChange(value: string) {
    setQuery(value)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => void searchProducts(value), 250)
  }

  function selectTarget(target: MappingTarget) {
    setSelectedKey(getMappingTargetKey(target))
    setComponents([])
  }

  function searchByTargetProduct(target: MappingTarget) {
    const nextQuery = target.productName.trim()
    selectTarget(target)
    setQuery(nextQuery)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    void searchProducts(nextQuery)
    requestAnimationFrame(() => {
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
    })
  }

  function addComponent(product: ProductSearchResult) {
    setComponents((prev) => {
      const orderQuantity = Math.max(1, selectedTarget?.quantity ?? 1)
      const existingIdx = prev.findIndex((component) => component.sku === product.internalSku)
      if (existingIdx >= 0) {
        return prev.map((component, idx) => (
          idx === existingIdx ? { ...component, quantity: component.quantity + orderQuantity } : component
        ))
      }
      return [
        ...prev,
        {
          sku: product.internalSku,
          quantity: orderQuantity,
          productName: product.name,
          optionName: product.optionHint ?? product.optionName ?? null,
        },
      ]
    })
  }

  function updateQuantity(idx: number, quantity: number) {
    setComponents((prev) => prev.map((component, componentIdx) => (
      componentIdx === idx
        ? { ...component, quantity: Math.max(1, quantity || 1) }
        : component
    )))
  }

  async function saveMapping() {
    if (!selectedTarget) {
      toast.error('매핑할 상품을 선택하세요.')
      return
    }
    const validComponents = components.filter((component) => component.sku.trim() && component.quantity > 0)
    if (validComponents.length === 0) {
      toast.error('재고관리코드를 1개 이상 추가하세요.')
      return
    }

    const normalizedComponents = validComponents.map((component) => ({
      ...component,
      quantity: componentQuantityForMapping(component.quantity, selectedTarget.quantity),
    }))
    if (normalizedComponents.some((component) => component.quantity == null)) {
      toast.error('출고수량은 주문수량으로 나누어지는 수량으로 입력해주세요.')
      return
    }

    const source = getMappingTargetSource(selectedTarget)
    const code = createManualMappingCode(source)
    const selectedSourceKey = getMappingTargetSourceKey(selectedTarget)
    const codeName = mappingCodeNameFromComponents(selectedTarget, validComponents)

    setSaving(true)
    try {
      const res = await fetch('/api/products/mapping-codes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code,
          name: codeName,
          note: '주문관리 신규 탭에서 생성',
          isActive: true,
          sources: [{
            marketplaceId: selectedTarget.marketplaceId,
            marketplaceProductId: source.product,
            marketplaceOptionId: source.option,
            productNameSnapshot: selectedTarget.productName,
            optionNameSnapshot: selectedTarget.optionText,
          }],
          components: normalizedComponents.map((component) => ({
            sku: component.sku,
            quantity: component.quantity ?? 1,
          })),
        }),
      })
      if (!res.ok) {
        const rawError = await res.text().catch(() => '')
        let err: { error?: string; invalidSkus?: string[] } = {}
        try {
          err = rawError ? JSON.parse(rawError) as typeof err : {}
        } catch {
          err = {}
        }
        const message = err.error || rawError || `HTTP ${res.status}`
        if (!message.includes('이미') && res.status !== 409) {
          const invalidSkuText = err.invalidSkus?.length ? ` (${err.invalidSkus.join(', ')})` : ''
          toast.error(`매핑 저장 실패: ${message}${invalidSkuText}`, { duration: 8000 })
          return
        }
        toast.info('이미 매핑된 상품입니다. 다음 상품으로 넘어갑니다.')
      } else {
        toast.success('재고매핑 저장 완료')
      }
      setCompletedSourceKeys((prev) => new Set(prev).add(selectedSourceKey))
      setComponents([])
      onSaved()
    } catch (error) {
      toast.error(`매핑 저장 실패: ${error instanceof Error ? error.message : String(error)}`, { duration: 8000 })
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => onOpenChange(false)}>
      <div
        className="grid max-h-[88vh] w-full max-w-5xl grid-rows-[auto_1fr_auto] overflow-hidden rounded-lg bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-5 py-3">
          <div>
            <h2 className="text-base font-semibold">신규 주문 재고매핑</h2>
            <p className="text-xs text-muted-foreground">4ea는 수량 4, 세트상품은 재고관리코드를 여러 개 추가하세요.</p>
          </div>
          <button type="button" onClick={() => onOpenChange(false)} className="text-muted-foreground hover:text-foreground" aria-label="닫기">
            <X className="size-4" />
          </button>
        </div>

        <div className="grid min-h-0 grid-cols-1 gap-3 overflow-hidden p-4 lg:grid-cols-[320px_1fr]">
          <div className="min-h-0 rounded-md border">
            <div className="border-b bg-muted/40 px-3 py-2 text-xs font-medium">미매핑 상품</div>
            <div className="max-h-full overflow-auto">
              {activeTargets.map((target) => {
                const key = getMappingTargetKey(target)
                const active = selectedKey === key
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => selectTarget(target)}
                    onDoubleClick={() => searchByTargetProduct(target)}
                    className={`block w-full border-b px-3 py-2 text-left text-xs hover:bg-muted/50 ${active ? 'bg-orange-50' : ''}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px]">{target.marketplaceId}</span>
                      <span className="font-mono text-[10px] text-muted-foreground">{target.marketplaceOrderId}</span>
                    </div>
                    <div className="mt-1 truncate font-medium">{target.productName}</div>
                    {target.optionText && <div className="truncate text-[10px] text-muted-foreground">{target.optionText}</div>}
                    <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                      <span className="truncate font-mono">상품코드 {getMappingTargetSource(target).product}</span>
                      <span className="shrink-0 font-medium">수량 {target.quantity}</span>
                    </div>
                  </button>
                )
              })}
              {activeTargets.length === 0 && (
                <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                  현재 페이지의 미매핑 상품을 모두 처리했습니다.
                </div>
              )}
            </div>
          </div>

          <div className="min-h-0 rounded-md border">
            <form
              className="border-b bg-muted/30 px-3 py-2"
              onSubmit={(event) => {
                event.preventDefault()
                void searchProducts(query)
              }}
            >
              <div className="flex items-center gap-2">
                <input
                  ref={searchInputRef}
                  value={query}
                  onChange={(event) => handleQueryChange(event.target.value)}
                  placeholder="재고관리코드 또는 상품명 검색"
                  className="flex-1 rounded border bg-background px-3 py-1.5 text-sm"
                />
                <button type="submit" className="inline-flex items-center gap-1 rounded border bg-background px-3 py-1.5 text-sm hover:bg-muted">
                  <Search className="size-3.5" />
                  검색
                </button>
              </div>
            </form>

            <div className="border-b bg-amber-50/60 px-3 py-2">
              <div className="mb-1 text-xs font-semibold text-amber-900">매핑할 재고 구성</div>
              {components.length === 0 ? (
                <div className="rounded border border-dashed border-amber-200 bg-white/70 px-3 py-2 text-xs text-amber-800">
                  아래 검색 결과에서 재고관리코드를 추가하세요.
                </div>
              ) : (
                <div className="space-y-1">
                  {components.map((component, idx) => (
                    <div key={`${component.sku}-${idx}`} className="grid grid-cols-[1fr_72px_24px] items-center gap-2 rounded border bg-white px-2 py-1">
                      <div className="min-w-0">
                        <div className="truncate font-mono text-xs">{component.sku}</div>
                        <div className="truncate text-[10px] text-muted-foreground">
                          {component.productName}{component.optionName ? ` · ${component.optionName}` : ''}
                        </div>
                      </div>
                      <input
                        type="number"
                        min={1}
                        value={component.quantity}
                        onChange={(event) => updateQuantity(idx, parseInt(event.target.value, 10))}
                        className="rounded border px-1.5 py-1 text-right text-xs"
                      />
                      <button
                        type="button"
                        onClick={() => setComponents((prev) => prev.filter((_, componentIdx) => componentIdx !== idx))}
                        className="text-muted-foreground hover:text-destructive"
                        aria-label="구성품 제거"
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="max-h-[330px] overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/60">
                  <tr className="border-b">
                    <th className="px-2 py-2 text-left font-medium">재고관리코드</th>
                    <th className="px-2 py-2 text-left font-medium">상품명 / 옵션</th>
                    <th className="px-2 py-2 text-right font-medium">재고</th>
                    <th className="w-16 px-2 py-2 text-center font-medium">추가</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {loading ? (
                    <tr><td colSpan={4} className="py-8 text-center text-muted-foreground">검색 중...</td></tr>
                  ) : results.length === 0 ? (
                    <tr><td colSpan={4} className="py-8 text-center text-muted-foreground">재고관리코드를 검색하세요.</td></tr>
                  ) : results.map((product) => (
                    <tr key={product.id} className="hover:bg-muted/40">
                      <td className="px-2 py-1.5 font-mono">{product.internalSku}</td>
                      <td className="px-2 py-1.5">
                        <div className="truncate">{product.name}</div>
                        {product.optionHint && <div className="truncate text-[10px] text-muted-foreground">{product.optionHint}</div>}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{product.availableStock ?? '-'}</td>
                      <td className="px-2 py-1.5 text-center">
                        <button type="button" onClick={() => addComponent(product)} className="rounded border px-2 py-0.5 hover:bg-blue-50">
                          추가
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between border-t bg-muted/20 px-5 py-3">
          <span className="text-xs text-muted-foreground">저장하면 같은 마켓상품코드는 다음 신규 주문부터 자동 매핑됩니다.</span>
          <div className="flex gap-2">
            <button type="button" onClick={() => onOpenChange(false)} className="rounded border px-3 py-1.5 text-sm hover:bg-muted" disabled={saving}>
              취소
            </button>
            <button type="button" onClick={() => void saveMapping()} className="rounded bg-orange-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50" disabled={saving || components.length === 0}>
              {saving ? '저장 중...' : '재고매핑 저장'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
