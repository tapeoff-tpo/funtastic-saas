'use client'

import { useRef, useState, useTransition } from 'react'
import type { ReactNode } from 'react'
import { Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ACTUAL_SHIPPING_COST_CARRIERS, type ActualShippingCostCarrier } from '@/lib/shipping/actual-cost-types'

type UnmatchedRow = {
  rowNumber: number
  trackingNumber: string
  orderNumber: string | null
  actualFee: number
  packageType: string | null
  acceptedAt: string | null
  deliveredAt: string | null
  reason: string
}

type ImportResult = {
  totalRows: number
  imported: number
  matched: number
  shipmentMatched?: number
  orderMatched?: number
  unmatched: number
  relinked?: number
  skipped: number
  errors: Array<{ row: number; reason: string }>
  unmatchedRows?: UnmatchedRow[]
}

type ResultView = 'summary' | 'unmatched'

export function ActualShippingCostUpload() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [carrierId, setCarrierId] = useState<ActualShippingCostCarrier>('CJGLS')
  const [result, setResult] = useState<ImportResult | null>(null)
  const [view, setView] = useState<ResultView>('summary')
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
      setView('summary')
      toast.success(`실제배송비 ${Number(body.imported ?? 0).toLocaleString()}건을 반영했습니다.`)
      if (fileRef.current) fileRef.current.value = ''
    })
  }

  const shipmentMatched = result?.shipmentMatched ?? result?.matched ?? 0
  const orderMatched = result?.orderMatched ?? Math.max((result?.matched ?? 0) - shipmentMatched, 0)
  const unmatchedRows = result?.unmatchedRows ?? []

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">실제배송비 업로드</h2>
        <p className="text-sm text-muted-foreground">
          택배사별 운송요금 파일을 선택하면 운송장번호를 먼저 확인하고, 없으면 주문번호로 보조 매칭합니다.
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
        <div className="space-y-3">
          <div className="grid gap-2 text-sm sm:grid-cols-6">
            <ResultBox label="읽은 행" value={result.totalRows} />
            <ResultBox label="반영" value={result.imported} />
            <ResultBox label="송장매칭" value={shipmentMatched} />
            <ResultBox label="주문매칭" value={orderMatched} />
            <ResultBox
              label="미매칭"
              value={result.unmatched}
              active={view === 'unmatched'}
              tone={result.unmatched > 0 ? 'warn' : 'default'}
              onClick={() => setView(view === 'unmatched' ? 'summary' : 'unmatched')}
            />
            <ResultBox label="제외" value={result.skipped} />
          </div>

          {view === 'unmatched' ? (
            <UnmatchedTable rows={unmatchedRows} />
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function ResultBox({
  label,
  value,
  active = false,
  tone = 'default',
  onClick,
}: {
  label: string
  value: number
  active?: boolean
  tone?: 'default' | 'warn'
  onClick?: () => void
}) {
  const className = [
    'rounded-md border bg-background px-3 py-2 text-left transition',
    onClick ? 'cursor-pointer hover:bg-muted' : '',
    active ? 'border-primary bg-primary text-primary-foreground hover:bg-primary' : '',
    !active && tone === 'warn' ? 'border-amber-200 bg-amber-50 text-amber-900' : '',
  ].filter(Boolean).join(' ')

  const content = (
    <>
      <div className={active ? 'text-xs text-primary-foreground/80' : 'text-xs text-muted-foreground'}>{label}</div>
      <div className="text-lg font-semibold">{value.toLocaleString()}</div>
    </>
  )

  if (!onClick) return <div className={className}>{content}</div>

  return (
    <button type="button" className={className} onClick={onClick}>
      {content}
    </button>
  )
}

function UnmatchedTable({ rows }: { rows: UnmatchedRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-md border bg-muted/30 px-3 py-6 text-center text-sm text-muted-foreground">
        미매칭 행이 없습니다.
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-md border">
      <div className="border-b bg-muted/40 px-3 py-2 text-sm font-medium">
        미매칭 {rows.length.toLocaleString()}건
      </div>
      <div className="max-h-[420px] overflow-auto">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="sticky top-0 bg-muted text-xs text-muted-foreground">
            <tr>
              <Th>행</Th>
              <Th>운송장번호</Th>
              <Th>주문번호</Th>
              <Th align="right">운임</Th>
              <Th>포장</Th>
              <Th>접수일</Th>
              <Th>배송일</Th>
              <Th>사유</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.rowNumber}-${row.trackingNumber}`} className="border-t">
                <Td>{row.rowNumber}</Td>
                <Td>{row.trackingNumber || '-'}</Td>
                <Td>{row.orderNumber || '-'}</Td>
                <Td align="right">{formatWon(row.actualFee)}</Td>
                <Td>{row.packageType || '-'}</Td>
                <Td>{row.acceptedAt || '-'}</Td>
                <Td>{row.deliveredAt || '-'}</Td>
                <Td className="text-amber-700">{row.reason}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Th({ children, align = 'left' }: { children: ReactNode; align?: 'left' | 'right' }) {
  return <th className={`whitespace-nowrap px-3 py-2 font-medium ${align === 'right' ? 'text-right' : 'text-left'}`}>{children}</th>
}

function Td({
  children,
  align = 'left',
  className = '',
}: {
  children: ReactNode
  align?: 'left' | 'right'
  className?: string
}) {
  return <td className={`whitespace-nowrap px-3 py-2 ${align === 'right' ? 'text-right' : 'text-left'} ${className}`}>{children}</td>
}

function formatWon(value: number) {
  return `${Number(value || 0).toLocaleString()}원`
}
