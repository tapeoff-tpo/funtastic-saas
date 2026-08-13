'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Save } from 'lucide-react'
import type { OutboundReflectionLine } from '@/lib/outbound-reflection'

export function OutboundReflectionLineEdit({ line }: { line: OutboundReflectionLine }) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function handleSubmit(formData: FormData) {
    setSaving(true)
    setMessage(null)
    try {
      const response = await fetch(`/api/outbound-reflection/lines/${line.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sku: String(formData.get('sku') ?? ''),
          productName: String(formData.get('productName') ?? ''),
          optionText: String(formData.get('optionText') ?? ''),
          quantity: String(formData.get('quantity') ?? ''),
          salesAmount: String(formData.get('salesAmount') ?? ''),
        }),
      })
      const json = await response.json().catch(() => ({})) as { error?: string; reflectionStatus?: string; issueMessages?: string[] }
      if (!response.ok) throw new Error(json.error ?? '저장에 실패했습니다.')
      setMessage(json.reflectionStatus === 'ready' ? '반영 대기로 변경되었습니다.' : (json.issueMessages ?? ['확인 필요 사유가 갱신되었습니다.']).join(' '))
      router.refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '저장에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }

  if (line.reflectionStatus === 'applied') return null
  return (
    <form action={handleSubmit} className="grid min-w-[760px] gap-2 rounded-md border bg-muted/20 p-2 lg:grid-cols-[120px_170px_130px_90px_110px_auto]">
      <input name="sku" defaultValue={line.sku ?? ''} placeholder="SKU" className="h-8 rounded border bg-background px-2 font-mono text-xs" aria-label="SKU" />
      <input name="productName" defaultValue={line.productName ?? ''} placeholder="상품명" className="h-8 rounded border bg-background px-2 text-xs" aria-label="상품명" />
      <input name="optionText" defaultValue={line.optionText ?? ''} placeholder="옵션" className="h-8 rounded border bg-background px-2 text-xs" aria-label="옵션" />
      <input name="quantity" type="number" min="1" defaultValue={line.quantity} className="h-8 rounded border bg-background px-2 text-right text-xs" aria-label="수량" />
      <input name="salesAmount" type="number" min="0" defaultValue={line.salesAmount} className="h-8 rounded border bg-background px-2 text-right text-xs" aria-label="매출" />
      <button type="submit" disabled={saving} className="inline-flex h-8 items-center justify-center gap-1 rounded bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
        {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
        {saving ? '저장 중' : '저장'}
      </button>
      {message ? <div className="text-xs text-muted-foreground lg:col-span-6">{message}</div> : null}
    </form>
  )
}
