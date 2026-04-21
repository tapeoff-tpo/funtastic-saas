'use client'

import { useState, useMemo } from 'react'
import { toast } from 'sonner'
import { InvoiceUploadDialog } from './invoice-upload-dialog'
import { ExcelImportDialog } from './excel-import-dialog'
import { BulkMappingDialog } from './bulk-mapping-dialog'
import type { OrderRow } from './columns'

const CARRIER_LABELS: Record<string, string> = {
  cj: 'CJ',
  kyungdong: '경동',
  daesin: '대신',
}

interface ShippingActionsProps {
  selectedOrderIds: string[]
  selectedOrders?: OrderRow[]
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

export function ShippingActions({ selectedOrderIds, selectedOrders = [] }: ShippingActionsProps) {
  const [invoiceDialogOpen, setInvoiceDialogOpen] = useState(false)
  const [excelImportOpen, setExcelImportOpen] = useState(false)
  const [bulkMappingOpen, setBulkMappingOpen] = useState(false)
  const [classifying, setClassifying] = useState(false)

  const hasSelection = selectedOrderIds.length > 0

  const unmappedOrderCount = useMemo(() => {
    return selectedOrders.filter((o) => o.mappingStatus !== 'mapped').length
  }, [selectedOrders])

  const handleCarrierAutoExport = async () => {
    setClassifying(true)
    try {
      const params = new URLSearchParams()
      params.set('orderIds', selectedOrderIds.join(','))
      const classifyRes = await fetch(`/api/shipping/classify?${params.toString()}`)
      if (!classifyRes.ok) {
        const text = await classifyRes.text()
        toast.error(`분류 실패 [${classifyRes.status}]: ${text.slice(0, 200)}`)
        return
      }
      const data = await classifyRes.json() as Record<string, string[]>

      const carriers = ['cj', 'kyungdong', 'daesin'] as const
      const summary: string[] = []
      const failures: string[] = []
      const date = new Date().toISOString().slice(0, 10)

      for (const carrier of carriers) {
        const ids = data[carrier] ?? []
        if (ids.length === 0) continue

        const p = new URLSearchParams()
        p.set('orderIds', ids.join(','))
        const label = CARRIER_LABELS[carrier]
        const result = await downloadExcel(
          `/api/shipping/${carrier}/export?${p.toString()}`,
          `${label}_${date}.xlsx`,
        )
        if (result.success) {
          summary.push(`${label} ${ids.length}건`)
        } else {
          failures.push(`${label}: ${result.error}`)
        }
      }

      const unassigned = data.unassigned ?? []
      if (failures.length > 0) {
        toast.error(`내보내기 실패:\n${failures.join('\n')}`, { duration: 10000 })
      }
      if (summary.length > 0) {
        const note = unassigned.length > 0 ? ` (${unassigned.length}건 미지정)` : ''
        toast.success(`${summary.join(', ')}${note} 다운로드`)
      } else if (failures.length === 0) {
        toast.error('택배사가 지정된 주문이 없습니다. 상품 페이지에서 택배사를 설정하세요.')
      }
    } catch (err) {
      toast.error(`내보내기 실패: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setClassifying(false)
    }
  }

  const handlePrintLabels = () => {
    const params = new URLSearchParams()
    params.set('ids', selectedOrderIds.join(','))
    window.open(`/shipping/print?${params.toString()}`, '_blank')
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/30 p-2">
        {/* Group 1: 매핑 준비 */}
        {unmappedOrderCount > 0 && (
          <button
            type="button"
            onClick={() => setBulkMappingOpen(true)}
            className="rounded-md bg-orange-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-orange-600"
          >
            일괄 매핑 ({unmappedOrderCount}건 미매핑)
          </button>
        )}

        <a
          href="/shipping/combined"
          className="inline-flex items-center rounded-md border bg-white px-3 py-1.5 text-sm font-medium hover:bg-muted"
        >
          합포장
        </a>

        <span className="mx-1 h-5 w-px bg-border" />

        {/* Group 2: 송장 처리 */}
        <button
          type="button"
          onClick={() => void handleCarrierAutoExport()}
          disabled={!hasSelection || classifying}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {classifying ? '분류 중...' : '택배사별 엑셀 다운로드'}
        </button>

        <button
          type="button"
          onClick={() => setExcelImportOpen(true)}
          className="rounded-md border bg-white px-3 py-1.5 text-sm font-medium hover:bg-muted"
        >
          송장번호 업로드
        </button>

        <button
          type="button"
          onClick={() => setInvoiceDialogOpen(true)}
          disabled={!hasSelection}
          className="rounded-md border bg-white px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
        >
          몰에 송장 전송
        </button>

        <span className="mx-1 h-5 w-px bg-border" />

        {/* Group 3: 출력 */}
        <button
          type="button"
          onClick={handlePrintLabels}
          disabled={!hasSelection}
          className="rounded-md border bg-white px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
        >
          라벨인쇄
        </button>
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
        orders={selectedOrders}
        onClose={() => setBulkMappingOpen(false)}
        onSaved={() => { window.location.reload() }}
      />
    </>
  )
}
