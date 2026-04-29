'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { ChevronDown } from 'lucide-react'
import { InvoiceUploadDialog } from './invoice-upload-dialog'
import { ExcelImportDialog } from './excel-import-dialog'
import { BulkMappingDialog } from './bulk-mapping-dialog'
import { LogisticsMessageDialog } from './logistics-message-dialog'
import { bulkCombineByContactAction } from './combined-actions'
import type { OrderRow } from './columns'
import type { OrderStage } from '@/lib/orders/types'

interface UserTemplate {
  id: string
  name: string
  carrierId: string | null
}

const SELECTED_TEMPLATE_KEY = 'orders.export.selectedTemplateId'

interface ShippingActionsProps {
  selectedOrderIds: string[]
  selectedOrders?: OrderRow[]
  /** All orders on the current page — used as fallback when nothing is selected (e.g. 일괄 매핑) */
  allOrders?: OrderRow[]
  stage?: OrderStage
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

export function ShippingActions({ selectedOrderIds, selectedOrders = [], allOrders = [], stage }: ShippingActionsProps) {
  const [invoiceDialogOpen, setInvoiceDialogOpen] = useState(false)
  const [excelImportOpen, setExcelImportOpen] = useState(false)
  const [bulkMappingOpen, setBulkMappingOpen] = useState(false)
  const [logisticsMsgOpen, setLogisticsMsgOpen] = useState(false)
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

  // Determine which action groups to show based on stage
  const showMapping = !stage || stage === 'mapping' || unmappedOrderCount > 0
  const showInvoice = !stage || stage === 'invoice' || stage === 'confirm'
  const showShipping = !stage || stage === 'shipping' || stage === 'invoice'
  const showPrint = !stage || stage === 'shipping' || stage === 'done'

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/30 p-2">
        {stage === 'mapping' && (
          <button
            type="button"
            onClick={() => setBulkMappingOpen(true)}
            className="rounded-md bg-orange-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-orange-600"
          >
            일괄 매핑 {unmappedOrderCount > 0 ? `(${unmappedOrderCount}건 미매핑)` : ''}
          </button>
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

            <button
              type="button"
              onClick={() => setExcelImportOpen(true)}
              className="rounded-md border bg-white px-3 py-1.5 text-sm font-medium hover:bg-muted"
            >
              송장등록
            </button>
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

      <BulkMappingDialog
        open={bulkMappingOpen}
        orders={ordersForMapping}
        onClose={() => setBulkMappingOpen(false)}
        onSaved={() => { window.location.reload() }}
      />

      <LogisticsMessageDialog
        open={logisticsMsgOpen}
        onOpenChange={setLogisticsMsgOpen}
        selectedOrderIds={selectedOrderIds}
      />
    </>
  )
}
