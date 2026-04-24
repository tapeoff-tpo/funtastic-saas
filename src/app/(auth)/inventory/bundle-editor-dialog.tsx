'use client'

import { useState, useEffect } from 'react'
import { toast } from 'sonner'

interface BundleItem {
  componentSku: string
  quantity: number
}

interface BundleEditorDialogProps {
  sku: string
  productName: string
  onClose: () => void
}

export function BundleEditorDialog({ sku, productName, onClose }: BundleEditorDialogProps) {
  const [items, setItems] = useState<BundleItem[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch(`/api/products/bundles/${encodeURIComponent(sku)}`)
      .then((r) => r.json())
      .then((d) => setItems(d.items ?? []))
      .catch(() => toast.error('세트 구성 로드 실패'))
      .finally(() => setLoading(false))
  }, [sku])

  const addItem = () => setItems((prev) => [...prev, { componentSku: '', quantity: 1 }])

  const updateItem = (idx: number, field: keyof BundleItem, value: string | number) => {
    setItems((prev) => prev.map((item, i) => (i === idx ? { ...item, [field]: value } : item)))
  }

  const removeItem = (idx: number) => setItems((prev) => prev.filter((_, i) => i !== idx))

  const handleSave = async () => {
    setSaving(true)
    try {
      const valid = items.filter((i) => i.componentSku.trim() && i.quantity > 0)
      const res = await fetch(`/api/products/bundles/${encodeURIComponent(sku)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(valid),
      })
      if (res.ok) {
        toast.success(valid.length > 0 ? `세트 구성 저장 (${valid.length}개 구성품)` : '세트 구성 해제')
        onClose()
      } else {
        toast.error('저장 실패')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-lg bg-white shadow-xl flex flex-col">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div>
            <h3 className="text-base font-semibold">세트 구성</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              <span className="font-mono">{sku}</span> — {productName}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground text-lg leading-none"
          >
            ✕
          </button>
        </div>

        <div className="p-5 space-y-3">
          {loading ? (
            <p className="text-sm text-muted-foreground text-center py-4">로딩 중...</p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                출고 시 아래 구성품 재고가 각각 차감됩니다. 비워두면 단일 상품으로 처리됩니다.
              </p>

              {items.length === 0 ? (
                <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
                  구성품 없음 — 단일 상품
                </p>
              ) : (
                <div className="space-y-2">
                  <div className="grid grid-cols-[1fr_64px_20px] gap-2 text-xs text-muted-foreground px-1">
                    <span>구성품 SKU</span>
                    <span className="text-center">수량</span>
                    <span />
                  </div>
                  {items.map((item, idx) => (
                    <div key={idx} className="grid grid-cols-[1fr_64px_20px] gap-2 items-center">
                      <input
                        type="text"
                        value={item.componentSku}
                        onChange={(e) => updateItem(idx, 'componentSku', e.target.value)}
                        placeholder="예: 102436-0001"
                        className="rounded border px-2 py-1 text-sm font-mono"
                      />
                      <input
                        type="number"
                        min={1}
                        value={item.quantity}
                        onChange={(e) => updateItem(idx, 'quantity', Number(e.target.value))}
                        className="rounded border px-2 py-1 text-sm text-center"
                      />
                      <button
                        type="button"
                        onClick={() => removeItem(idx)}
                        className="text-red-400 hover:text-red-600 text-sm leading-none"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <button
                type="button"
                onClick={addItem}
                className="w-full rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground hover:bg-muted"
              >
                + 구성품 추가
              </button>
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border px-4 py-2 text-sm hover:bg-muted"
          >
            취소
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || loading}
            className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {saving ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>
    </div>
  )
}
