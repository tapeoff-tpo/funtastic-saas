'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Save } from 'lucide-react'
import type { SabangnetReviewLine } from '@/lib/analytics/sabangnet-review'

type MarketplaceOption = {
  id: string
  label: string
}

export function SabangnetReviewLineEdit({
  line,
  marketplaces,
}: {
  line: SabangnetReviewLine
  marketplaces: MarketplaceOption[]
}) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function handleSubmit(formData: FormData) {
    setSaving(true)
    setMessage(null)
    try {
      const payload = {
        orderNumber: String(formData.get('orderNumber') ?? ''),
        marketplaceId: String(formData.get('marketplaceId') ?? ''),
        marketplaceName: String(formData.get('marketplaceName') ?? ''),
        sku: String(formData.get('sku') ?? ''),
        productName: String(formData.get('productName') ?? ''),
        optionText: String(formData.get('optionText') ?? ''),
        quantity: String(formData.get('quantity') ?? ''),
        totalAmount: String(formData.get('totalAmount') ?? ''),
        shippingFee: String(formData.get('shippingFee') ?? ''),
      }
      const res = await fetch(`/api/analytics/sabangnet-review/lines/${line.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? '저장에 실패했습니다.')
      setMessage(json.reviewStatus === 'ready' ? '정상으로 재검수되었습니다.' : '보류 사유가 갱신되었습니다.')
      router.refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '저장에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }

  if (line.reviewStatus === 'confirmed') return null

  return (
    <form action={handleSubmit} className="grid min-w-[760px] gap-2 rounded-md border bg-muted/20 p-2 lg:grid-cols-[120px_150px_150px_120px_160px_120px_90px_110px_90px_auto]">
      <input name="orderNumber" defaultValue={line.sabangnetOrderNumber || line.orderNumber} className="h-8 rounded border bg-background px-2 text-xs" aria-label="사방넷 주문번호" />
      <select name="marketplaceId" defaultValue={line.marketplaceId ?? ''} className="h-8 rounded border bg-background px-2 text-xs" aria-label="마켓 ID">
        <option value="">마켓 선택</option>
        {marketplaces.map((marketplace) => (
          <option key={marketplace.id} value={marketplace.id}>{marketplace.label}</option>
        ))}
      </select>
      <input name="marketplaceName" defaultValue={line.marketplaceName ?? ''} placeholder="마켓명" className="h-8 rounded border bg-background px-2 text-xs" aria-label="마켓명" />
      <input name="sku" defaultValue={line.sku ?? ''} placeholder="SKU" className="h-8 rounded border bg-background px-2 font-mono text-xs" aria-label="SKU" />
      <input name="productName" defaultValue={line.productName ?? ''} placeholder="상품명" className="h-8 rounded border bg-background px-2 text-xs" aria-label="상품명" />
      <input name="optionText" defaultValue={line.optionText ?? ''} placeholder="옵션" className="h-8 rounded border bg-background px-2 text-xs" aria-label="옵션" />
      <input name="quantity" type="number" min="1" defaultValue={line.quantity} className="h-8 rounded border bg-background px-2 text-right text-xs" aria-label="수량" />
      <input name="totalAmount" type="number" min="0" defaultValue={line.totalAmount} className="h-8 rounded border bg-background px-2 text-right text-xs" aria-label="금액" />
      <input name="shippingFee" type="number" min="0" defaultValue={line.shippingFee ?? ''} className="h-8 rounded border bg-background px-2 text-right text-xs" aria-label="배송비" />
      <button
        type="submit"
        disabled={saving}
        className="inline-flex h-8 items-center justify-center gap-1 rounded bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
      >
        <Save className="size-3.5" />
        {saving ? '저장 중' : '저장'}
      </button>
      {message ? <div className="text-xs text-muted-foreground lg:col-span-10">{message}</div> : null}
    </form>
  )
}
