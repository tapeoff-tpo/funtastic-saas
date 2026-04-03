'use client'

import { useState } from 'react'
import { InvoiceUploadDialog } from './invoice-upload-dialog'
import { ExcelImportDialog } from './excel-import-dialog'

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

  const hasSelection = selectedOrderIds.length > 0

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
