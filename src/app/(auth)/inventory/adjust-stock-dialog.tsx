'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { setStockAction, adjustStockAction } from './actions'
import {
  ADJUSTMENT_REASON_LABELS,
  type AdjustmentReason,
} from '@/lib/inventory/types'

/** Manual adjustment reasons only (exclude system-triggered reasons) */
const MANUAL_REASONS: AdjustmentReason[] = [
  'incoming',
  'defective',
  'physical_count',
  'return',
  'other',
]

interface AdjustStockDialogProps {
  mode: 'set' | 'adjust'
  sku?: string
  productName?: string
  currentStock?: number
  onClose: () => void
}

export function AdjustStockDialog({
  mode,
  sku: initialSku,
  productName: initialProductName,
  currentStock,
  onClose,
}: AdjustStockDialogProps) {
  const [isPending, startTransition] = useTransition()

  // Set mode fields
  const [sku, setSku] = useState(initialSku ?? '')
  const [productName, setProductName] = useState(initialProductName ?? '')
  const [totalStock, setTotalStock] = useState('')
  const [warehouseZone, setWarehouseZone] = useState('')
  const [sectorCode, setSectorCode] = useState('')

  // Adjust mode fields
  const [delta, setDelta] = useState('')
  const [reason, setReason] = useState<AdjustmentReason | ''>('')
  const [note, setNote] = useState('')

  const handleSubmit = () => {
    const formData = new FormData()

    if (mode === 'set') {
      formData.set('sku', sku)
      formData.set('productName', productName)
      formData.set('totalStock', totalStock)
      if (warehouseZone.trim()) formData.set('warehouseZone', warehouseZone.trim())
      if (sectorCode.trim()) formData.set('sectorCode', sectorCode.trim())

      startTransition(async () => {
        const result = await setStockAction(formData)
        if (result.success) {
          toast.success('재고가 등록되었습니다.')
          onClose()
        } else {
          toast.error(result.error ?? '재고 등록에 실패했습니다.')
        }
      })
    } else {
      formData.set('sku', initialSku ?? '')
      formData.set('delta', delta)
      formData.set('reason', reason)
      if (note.trim()) formData.set('note', note.trim())

      startTransition(async () => {
        const result = await adjustStockAction(formData)
        if (result.success) {
          toast.success('재고가 조정되었습니다.')
          onClose()
        } else {
          toast.error(result.error ?? '재고 조정에 실패했습니다.')
        }
      })
    }
  }

  const isSetValid = sku.trim() && productName.trim() && totalStock && !isNaN(Number(totalStock))
  const isAdjustValid = delta && !isNaN(Number(delta)) && Number(delta) !== 0 && reason

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <h3 className="text-lg font-semibold">
          {mode === 'set' ? '재고 등록' : '재고 조정'}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {mode === 'set'
            ? '새로운 재고 항목을 등록합니다.'
            : `${initialSku} - 현재 재고: ${currentStock?.toLocaleString('ko-KR') ?? 0}`}
        </p>

        <div className="mt-4 space-y-3">
          {mode === 'set' ? (
            <>
              <div className="flex flex-col gap-1">
                <label htmlFor="set-sku" className="text-xs font-medium text-muted-foreground">
                  상품코드
                </label>
                <input
                  id="set-sku"
                  type="text"
                  value={sku}
                  onChange={(e) => setSku(e.target.value)}
                  placeholder="상품코드 입력"
                  className="rounded-md border px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  autoFocus
                />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="set-product" className="text-xs font-medium text-muted-foreground">
                  상품명
                </label>
                <input
                  id="set-product"
                  type="text"
                  value={productName}
                  onChange={(e) => setProductName(e.target.value)}
                  placeholder="상품명 입력"
                  className="rounded-md border px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="set-stock" className="text-xs font-medium text-muted-foreground">
                  수량
                </label>
                <input
                  id="set-stock"
                  type="number"
                  value={totalStock}
                  onChange={(e) => setTotalStock(e.target.value)}
                  placeholder="초기 재고 수량"
                  min={0}
                  className="rounded-md border px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="set-warehouse" className="text-xs font-medium text-muted-foreground">
                  창고
                </label>
                <input
                  id="set-warehouse"
                  type="text"
                  value={warehouseZone}
                  onChange={(e) => setWarehouseZone(e.target.value)}
                  placeholder="예: 1창고, 쿠팡전용창고"
                  className="rounded-md border px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="set-sector" className="text-xs font-medium text-muted-foreground">
                  피킹위치
                </label>
                <input
                  id="set-sector"
                  type="text"
                  value={sectorCode}
                  onChange={(e) => setSectorCode(e.target.value)}
                  placeholder="예: A-01-03"
                  className="rounded-md border px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-col gap-1">
                <label htmlFor="adjust-delta" className="text-xs font-medium text-muted-foreground">
                  변동 수량 (양수: 입고, 음수: 출고)
                </label>
                <input
                  id="adjust-delta"
                  type="number"
                  value={delta}
                  onChange={(e) => setDelta(e.target.value)}
                  placeholder="예: +10 또는 -5"
                  className="rounded-md border px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  autoFocus
                />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="adjust-reason" className="text-xs font-medium text-muted-foreground">
                  사유
                </label>
                <select
                  id="adjust-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value as AdjustmentReason)}
                  className="rounded-md border px-3 py-2 text-sm"
                >
                  <option value="">사유 선택</option>
                  {MANUAL_REASONS.map((r) => (
                    <option key={r} value={r}>
                      {ADJUSTMENT_REASON_LABELS[r]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="adjust-note" className="text-xs font-medium text-muted-foreground">
                  메모 (선택)
                </label>
                <textarea
                  id="adjust-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="추가 메모를 입력하세요..."
                  rows={2}
                  className="rounded-md border px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            </>
          )}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border px-4 py-2 text-sm hover:bg-muted"
          >
            취소
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isPending || (mode === 'set' ? !isSetValid : !isAdjustValid)}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {isPending ? '처리중...' : mode === 'set' ? '등록' : '조정'}
          </button>
        </div>
      </div>
    </div>
  )
}
