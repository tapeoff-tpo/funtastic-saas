'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { InvoiceUploadDialog } from './invoice-upload-dialog'
import { ExcelImportDialog } from './excel-import-dialog'

const CARRIER_LABELS: Record<string, string> = {
  cj: 'CJ',
  kyungdong: '경동',
  daesin: '대신',
}

interface ShippingActionsProps {
  selectedOrderIds: string[]
}

/**
 * Shipping action toolbar buttons for the order dashboard.
 * Renders below the table filters, providing shipping workflow actions.
 */
export function ShippingActions({ selectedOrderIds }: ShippingActionsProps) {
  const [invoiceDialogOpen, setInvoiceDialogOpen] = useState(false)
  const [excelImportOpen, setExcelImportOpen] = useState(false)
  const [classifying, setClassifying] = useState(false)

  const hasSelection = selectedOrderIds.length > 0

  const handleCarrierAutoExport = async () => {
    setClassifying(true)
    try {
      const params = new URLSearchParams()
      params.set('orderIds', selectedOrderIds.join(','))
      const res = await fetch(`/api/shipping/classify?${params.toString()}`)
      const data = await res.json() as Record<string, string[]>
      if (!res.ok) {
        toast.error('분류 실패')
        return
      }

      const carriers = ['cj', 'kyungdong', 'daesin'] as const
      const summary: string[] = []
      let exported = 0

      for (const carrier of carriers) {
        const ids = data[carrier] ?? []
        if (ids.length > 0) {
          const p = new URLSearchParams()
          p.set('orderIds', ids.join(','))
          window.open(`/api/shipping/${carrier}/export?${p.toString()}`, '_blank')
          summary.push(`${CARRIER_LABELS[carrier]} ${ids.length}건`)
          exported += ids.length
        }
      }

      const unassigned = data.unassigned ?? []
      if (exported === 0) {
        toast.error('택배사가 지정된 주문이 없습니다. 상품 페이지에서 택배사를 설정하세요.')
      } else {
        const msg = summary.join(', ')
        const note = unassigned.length > 0 ? ` (${unassigned.length}건 미지정)` : ''
        toast.success(`${msg}${note} 내보냈습니다`)
      }
    } catch {
      toast.error('내보내기 실패')
    } finally {
      setClassifying(false)
    }
  }

  const handleExcelExport = () => {
    const params = new URLSearchParams()
    params.set('orderIds', selectedOrderIds.join(','))
    params.set('type', 'carrier')
    window.open(`/api/shipping/export?${params.toString()}`, '_blank')
  }

  const handleOrderListExport = () => {
    const params = new URLSearchParams()
    params.set('orderIds', selectedOrderIds.join(','))
    params.set('type', 'order-list')
    window.open(`/api/shipping/export?${params.toString()}`, '_blank')
  }

  const handlePrintLabels = () => {
    const params = new URLSearchParams()
    params.set('ids', selectedOrderIds.join(','))
    window.open(`/shipping/print?${params.toString()}`, '_blank')
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setInvoiceDialogOpen(true)}
          disabled={!hasSelection}
          className="rounded-md border bg-white px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
        >
          송장업로드
        </button>

        <button
          type="button"
          onClick={() => setExcelImportOpen(true)}
          className="rounded-md border bg-white px-3 py-1.5 text-sm font-medium hover:bg-muted"
        >
          엑셀 송장등록
        </button>

        <button
          type="button"
          onClick={() => void handleCarrierAutoExport()}
          disabled={!hasSelection || classifying}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {classifying ? '분류 중...' : '택배사별 자동 내보내기'}
        </button>

        <button
          type="button"
          onClick={handleExcelExport}
          disabled={!hasSelection}
          className="rounded-md border bg-white px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
        >
          엑셀 내보내기 (택배사)
        </button>

        <button
          type="button"
          onClick={handleOrderListExport}
          disabled={!hasSelection}
          className="rounded-md border bg-white px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
        >
          엑셀 내보내기 (주문목록)
        </button>

        <a
          href="/shipping/combined"
          className="inline-flex items-center rounded-md border bg-white px-3 py-1.5 text-sm font-medium hover:bg-muted"
        >
          합포장
        </a>

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
    </>
  )
}
