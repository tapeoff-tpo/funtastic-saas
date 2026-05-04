'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
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
  productName: string
  optionText: string | null
  quantity: number
}

const SELECTED_TEMPLATE_KEY = 'orders.export.selectedTemplateId'
const EXACT_OPTION_ID = '__exact__'

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

export function ShippingActions({
  selectedOrderIds,
  selectedOrders = [],
  allOrders = [],
  stage,
  showMappingAction = false,
}: ShippingActionsProps) {
  const router = useRouter()
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
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const [userTemplates, setUserTemplates] = useState<UserTemplate[] | null>(null)
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null)
  const exportMenuRef = useRef<HTMLDivElement>(null)

  // localStorage 에서 마지막 선택 양식 복원
  useEffect(() => {
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem(SELECTED_TEMPLATE_KEY) : null
    if (saved) setSelectedTemplateId(saved)
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

  const hasSelection = selectedOrderIds.length > 0

  // 현재 선택된 양식 — localStorage 에 저장된 ID 가 목록에 없으면 첫 번째로 fallback
  const activeTemplate = useMemo<UserTemplate | null>(() => {
    if (!userTemplates || userTemplates.length === 0) return null
    return userTemplates.find((t) => t.id === selectedTemplateId) ?? userTemplates[0]
  }, [userTemplates, selectedTemplateId])

  const pickTemplate = (id: string) => {
    setSelectedTemplateId(id)
    if (typeof window !== 'undefined') window.localStorage.setItem(SELECTED_TEMPLATE_KEY, id)
  }

  // For 일괄 매핑: 선택된 주문이 있으면 그 중 미매핑만, 없으면 전체 미매핑 카운트
  const ordersForMapping = selectedOrders.length > 0 ? selectedOrders : allOrders
  const unmappedOrderCount = useMemo(() => {
    return ordersForMapping.filter((o) => o.mappingStatus !== 'mapped').length
  }, [ordersForMapping])
  const existingMappedOrders = useMemo(() => {
    return ordersForMapping.filter((order) => order.mappingStatus === 'mapped')
  }, [ordersForMapping])
  const selectedMappableOrders = useMemo(() => {
    return selectedOrders.filter((order) => order.mappingStatus !== 'unmapped')
  }, [selectedOrders])

  const mappingTargets = useMemo<MappingTarget[]>(() => {
    return ordersForMapping
      .filter((order) => order.mappingStatus !== 'mapped')
      .flatMap((order) => order.items
        .filter((item) => item.marketplaceItemId)
        .map((item) => ({
          orderId: order.id,
          marketplaceId: order.marketplaceId,
          marketplaceOrderId: order.marketplaceOrderId,
          marketplaceItemId: item.marketplaceItemId!,
          productName: item.productName,
          optionText: item.optionText,
          quantity: item.quantity,
        })))
  }, [ordersForMapping])

  // 선택된 양식으로 주문 일괄 다운로드 — 단일 Excel 파일
  const handleExport = async (template: UserTemplate) => {
    const scope = selectedOrderIds.length > 0 ? selectedOrderIds : allOrders.map((o) => o.id)
    if (scope.length === 0) {
      toast.error('대상 주문이 없습니다.')
      return
    }
    setClassifying(true)
    try {
      const p = new URLSearchParams()
      p.set('orderIds', scope.join(','))
      p.set('type', 'carrier')
      p.set('templateId', template.id)
      const date = new Date().toISOString().slice(0, 10)
      const result = await downloadExcel(
        `/api/shipping/export?${p.toString()}`,
        `${template.name}_${date}.xlsx`,
      )
      if (result.success) {
        toast.success(`${template.name} ${scope.length}건 다운로드`)
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
      ? `선택한 ${scope.length}건에서 이름+연락처 동일 주문을 합포장으로 묶습니다. 계속하시겠습니까?`
      : `현재 페이지 ${scope.length}건에서 이름+연락처 동일 주문을 합포장으로 묶습니다. 계속하시겠습니까?`
    if (!window.confirm(confirmMsg)) return

    setCombining(true)
    try {
      const result = await bulkCombineByContactAction(scope)
      if (result.created === 0) {
        toast.info('합포장 대상이 없습니다 (이름+연락처 동일 주문이 2건 이상인 경우에만 묶입니다).')
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
    if (existingMappedOrders.length === 0) {
      toast.info('기존 매핑이 적용된 주문이 없습니다.')
      return
    }

    setApplyingMappings(true)
    try {
      const orderIds = Array.from(new Set(existingMappedOrders.map((order) => order.id)))
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
      const data = await res.json() as { applied: number }
      toast.success(`${data.applied}건 매핑 완료`)
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
  const showShipping = !hideFulfillmentActions && (!stage || stage === 'shipping' || stage === 'invoice')
  const showPrint = !hideFulfillmentActions && (!stage || stage === 'shipping' || stage === 'done')

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/30 p-2">
        {showMapping && (
          <>
            <button
              type="button"
              onClick={() => void handleApplyExistingMappings()}
              disabled={applyingMappings || existingMappedOrders.length === 0}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
              title={hasSelection ? '선택한 주문 중 기존 매핑이 있는 주문을 매핑완료 처리' : '현재 페이지에서 기존 매핑이 있는 주문을 매핑완료 처리'}
            >
              {applyingMappings
                ? '매핑 중...'
                : `매핑${existingMappedOrders.length > 0 ? ` (${existingMappedOrders.length})` : ''}`}
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
              재고매핑 {unmappedOrderCount > 0 ? `(${unmappedOrderCount}건 미매핑)` : ''}
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
            title="이름+연락처가 동일한 주문을 자동으로 합포장 그룹으로 묶습니다"
          >
            {combining
              ? '묶는 중...'
              : hasSelection
                ? `선택 합포장 (${selectedOrderIds.length}건, 이름+연락처)`
                : '일괄 합포장 (이름+연락처)'}
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
                    : `양식: ${activeTemplate.name} — ${hasSelection ? '선택한 주문만' : '현재 페이지 전체'}`
                }
              >
                {classifying
                  ? '다운로드 중...'
                  : activeTemplate
                    ? `${activeTemplate.name} 다운로드${hasSelection ? ` (${selectedOrderIds.length}건)` : ''}`
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
                <div className="absolute left-0 top-full z-20 mt-1 w-64 overflow-hidden rounded-md border bg-white shadow-lg">
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
          <button
            type="button"
            onClick={() => setInvoiceDialogOpen(true)}
            disabled={!hasSelection}
            className="rounded-md border bg-white px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            몰에 송장 전송
          </button>
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
    </>
  )
}

function splitProductOption(itemId: string): { product: string; option: string } {
  const idx = itemId.indexOf('-')
  if (idx <= 0) return { product: itemId, option: '' }
  return { product: itemId.slice(0, idx), option: itemId.slice(idx + 1) }
}

function getMappingTargetSource(target: MappingTarget): { product: string; option: string } {
  const split = splitProductOption(target.marketplaceItemId)
  return {
    product: split.product,
    option: split.option || target.optionText?.trim() || EXACT_OPTION_ID,
  }
}

function getMappingTargetKey(target: MappingTarget): string {
  return `${target.orderId}:${target.marketplaceItemId}:${target.optionText ?? ''}`
}

function getMappingTargetSourceKey(target: MappingTarget): string {
  const source = getMappingTargetSource(target)
  return `${target.marketplaceId}:${source.product}:${source.option}`
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
      const existingIdx = prev.findIndex((component) => component.sku === product.internalSku)
      if (existingIdx >= 0) {
        return prev.map((component, idx) => (
          idx === existingIdx ? { ...component, quantity: component.quantity + 1 } : component
        ))
      }
      return [
        ...prev,
        {
          sku: product.internalSku,
          quantity: 1,
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

    const source = getMappingTargetSource(selectedTarget)
    const sourceKey = `${selectedTarget.marketplaceId}-${source.product}-${source.option}`
    const code = `${validComponents[0].sku}-${sourceKey}`.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 100)
    const selectedSourceKey = getMappingTargetSourceKey(selectedTarget)

    setSaving(true)
    try {
      const res = await fetch('/api/products/mapping-codes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code,
          name: selectedTarget.productName,
          note: '주문관리 신규 탭에서 생성',
          isActive: true,
          sources: [{
            marketplaceId: selectedTarget.marketplaceId,
            marketplaceProductId: source.product,
            marketplaceOptionId: source.option,
            productNameSnapshot: selectedTarget.productName,
            optionNameSnapshot: selectedTarget.optionText,
          }],
          components: validComponents.map((component) => ({
            sku: component.sku,
            quantity: component.quantity,
          })),
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        const message = String(err.error ?? '')
        if (!message.includes('이미') && res.status !== 409) {
          toast.error(err.error ?? '매핑 저장 실패')
          return
        }
        toast.info('이미 매핑된 상품입니다. 다음 상품으로 넘어갑니다.')
      } else {
        toast.success('재고매핑 저장 완료')
      }
      setCompletedSourceKeys((prev) => new Set(prev).add(selectedSourceKey))
      setComponents([])
      onSaved()
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
                      <span className="truncate font-mono">상품코드 {target.marketplaceItemId}</span>
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
