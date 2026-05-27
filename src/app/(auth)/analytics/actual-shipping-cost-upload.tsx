'use client'

import { useRef, useState, useTransition } from 'react'
import { Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ACTUAL_SHIPPING_COST_CARRIERS, type ActualShippingCostCarrier } from '@/lib/shipping/actual-cost-types'

type ImportResult = {
  totalRows: number
  imported: number
  matched: number
  unmatched: number
  skipped: number
  errors: Array<{ row: number; reason: string }>
}

export function ActualShippingCostUpload() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [carrierId, setCarrierId] = useState<ActualShippingCostCarrier>('CJGLS')
  const [result, setResult] = useState<ImportResult | null>(null)
  const [isPending, startTransition] = useTransition()

  function upload() {
    const file = fileRef.current?.files?.[0]
    if (!file) {
      toast.error('엑셀 파일을 선택해주세요.')
      return
    }

    startTransition(async () => {
      const form = new FormData()
      form.set('carrierId', carrierId)
      form.set('file', file)

      const response = await fetch('/api/analytics/shipping-costs/import', {
        method: 'POST',
        body: form,
      })
      const body = await response.json()
      if (!response.ok) {
        toast.error(body.error ?? '업로드에 실패했습니다.')
        return
      }

      setResult(body)
      toast.success(`실제배송비 ${body.imported}건을 반영했습니다.`)
      if (fileRef.current) fileRef.current.value = ''
    })
  }

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">실제배송비 업로드</h2>
        <p className="text-sm text-muted-foreground">
          택배사별 엑셀을 선택하면 송장번호로 출고 건과 자동 매칭합니다.
        </p>
      </div>

      <div className="grid gap-2 md:grid-cols-[180px_1fr_auto]">
        <select
          className="h-8 rounded-lg border bg-background px-2 text-sm"
          value={carrierId}
          onChange={(event) => setCarrierId(event.target.value as ActualShippingCostCarrier)}
        >
          {ACTUAL_SHIPPING_COST_CARRIERS.map((carrier) => (
            <option key={carrier.id} value={carrier.id}>{carrier.name}</option>
          ))}
        </select>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls"
          className="h-8 rounded-lg border bg-background px-2 py-1 text-sm"
        />
        <Button type="button" onClick={upload} disabled={isPending}>
          <Upload />
          {isPending ? '업로드 중' : '업로드'}
        </Button>
      </div>

      {result ? (
        <div className="grid gap-2 text-sm sm:grid-cols-5">
          <ResultBox label="읽은 행" value={result.totalRows} />
          <ResultBox label="반영" value={result.imported} />
          <ResultBox label="매칭" value={result.matched} />
          <ResultBox label="미매칭" value={result.unmatched} />
          <ResultBox label="제외" value={result.skipped} />
        </div>
      ) : null}
    </div>
  )
}

function ResultBox({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border bg-background px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value.toLocaleString()}</div>
    </div>
  )
}
