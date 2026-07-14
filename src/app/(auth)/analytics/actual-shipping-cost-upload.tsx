'use client'

import { useRef, useState, useTransition } from 'react'
import type { ReactNode } from 'react'
import { Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ACTUAL_SHIPPING_COST_CARRIERS, type ActualShippingCostCarrier } from '@/lib/shipping/actual-cost-types'

type ResultRow = {
  rowNumber: number
  trackingNumber: string
  orderNumber: string | null
  actualFee: number
  packageType: string | null
  acceptedAt: string | null
  deliveredAt: string | null
  reason: string
}

type ErrorRow = {
  row: number
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
  errors: ErrorRow[]
  shipmentMatchedRows?: ResultRow[]
  orderMatchedRows?: ResultRow[]
  unmatchedRows?: ResultRow[]
}

type ResultView = 'summary' | 'imported' | 'shipment' | 'order' | 'unmatched' | 'skipped'

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
  const shipmentRows = result?.shipmentMatchedRows ?? []
  const orderRows = result?.orderMatchedRows ?? []
  const unmatchedRows = result?.unmatchedRows ?? []
  const importedRows = [...shipmentRows, ...orderRows, ...unmatchedRows].sort((a, b) => a.rowNumber - b.rowNumber)

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">실제배송비 업로드</h2>
        <p className="text-sm text-muted-foreground">
          운송장번호를 먼저 확인하고, 없으면 주문번호로 보조 매칭합니다.
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
            <ResultBox label="읽은 행" value={result.totalRows} active={view === 'summary'} onClick={() => setView('summary')} />
            <ResultBox label="반영" value={result.imported} active={view === 'imported'} onClick={() => setView('imported')} />
            <ResultBox label="송장매칭" value={shipmentMatched} active={view === 'shipment'} onClick={() => setView('shipment')} />
            <ResultBox label="주문매칭" value={orderMatched} active={view === 'order'} onClick={() => setView('order')} />
            <ResultBox
              label="미매칭"
              value={result.unmatched}
              active={view === 'unmatched'}
              tone={result.unmatched > 0 ? 'warn' : 'default'}
              onClick={() => setView('unmatched')}
            />
            <ResultBox
              label="제외"
              value={result.skipped}
              active={view === 'skipped'}
              tone={result.skipped > 0 ? 'warn' : 'default'}
              onClick={() => setView('skipped')}
            />
          </div>

          {view === 'summary' ? <SummaryPanel result={result} /> : null}
          {view === 'imported' ? <ResultTable title="반영 행" rows={importedRows} /> : null}
          {view === 'shipment' ? <ResultTable title="송장매칭 행" rows={shipmentRows} /> : null}
          {view === 'order' ? <ResultTable title="주문매칭 행" rows={orderRows} /> : null}
          {view === 'unmatched' ? <ResultTable title="미매칭 행" rows={unmatchedRows} warn /> : null}
          {view === 'skipped' ? <ErrorTable rows={result.errors} /> : null}
        </div>
      ) : null}
    </div>
  )
}

function SummaryPanel({ result }: { result: ImportResult }) {
  return (
    <div className="rounded-md border bg-muted/30 px-3 py-3 text-sm text-muted-foreground">
      카드들을 클릭하면 해당 행만 필터링해서 볼 수 있습니다.
      {result.relinked ? <span className="ml-2">기존 업로드 재연결 {result.relinked.toLocaleString()}건</span> : null}
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
  onClick: () => void
}) {
  const className = [
    'rounded-md border px-3 py-2 text-left transition',
    'cursor-pointer hover:bg-muted',
    active ? 'border-primary bg-primary text-primary-foreground hover:bg-primary' : 'bg-background',
    !active && tone === 'warn' ? 'border-amber-200 bg-amber-50 text-amber-900' : '',
  ].filter(Boolean).join(' ')

  return (
    <button type="button" className={className} onClick={onClick}>
      <div className={active ? 'text-xs text-primary-foreground/80' : 'text-xs text-muted-foreground'}>{label}</div>
      <div className="text-lg font-semibold">{value.toLocaleString()}</div>
    </button>
  )
}

function ResultTable({ title, rows, warn = false }: { title: string; rows: ResultRow[]; warn?: boolean }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-md border bg-muted/30 px-3 py-6 text-center text-sm text-muted-foreground">
        표시할 행이 없습니다.
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-md border">
      <div className="border-b bg-muted/40 px-3 py-2 text-sm font-medium">
        {title} {rows.length.toLocaleString()}건
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
              <Th>상태</Th>
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
                <Td className={warn ? 'text-amber-700' : 'text-emerald-700'}>{row.reason}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ErrorTable({ rows }: { rows: ErrorRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-md border bg-muted/30 px-3 py-6 text-center text-sm text-muted-foreground">
        제외된 행이 없습니다.
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-md border">
      <div className="border-b bg-muted/40 px-3 py-2 text-sm font-medium">
        제외 {rows.length.toLocaleString()}건
      </div>
      <div className="max-h-[420px] overflow-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead className="sticky top-0 bg-muted text-xs text-muted-foreground">
            <tr>
              <Th>행</Th>
              <Th>사유</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.row}-${row.reason}`} className="border-t">
                <Td>{row.row}</Td>
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
