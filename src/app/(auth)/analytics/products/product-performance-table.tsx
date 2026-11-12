'use client'

import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { Input } from '@/components/ui/input'

export type ProductPerformanceRow = {
  sku: string
  productName: string
  units: number
  sales: number
  previousSales: number
  costPrice: number | null
  productCost: number | null
  grossProfit: number | null
}

type SortKey = 'units' | 'sales' | 'change' | 'costPrice' | 'productCost' | 'grossProfit'
type Filter = 'all' | 'rise' | 'drop' | 'cost_issue'

const currency = new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 })
const integer = new Intl.NumberFormat('ko-KR')

export function ProductPerformanceTable({ rows }: { rows: ProductPerformanceRow[] }) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [sortKey, setSortKey] = useState<SortKey>('sales')
  const [direction, setDirection] = useState<'asc' | 'desc'>('desc')
  const costIssueCount = rows.filter((row) => row.costPrice == null || row.costPrice <= 0).length
  const visibleRows = useMemo(() => rows
    .filter((row) => {
      const matchesQuery = !query || `${row.sku} ${row.productName}`.toLowerCase().includes(query.toLowerCase())
      if (!matchesQuery) return false
      const change = row.sales - row.previousSales
      if (filter === 'rise') return change > 0
      if (filter === 'drop') return change < 0
      if (filter === 'cost_issue') return row.costPrice == null || row.costPrice <= 0
      return true
    })
    .sort((a, b) => {
      const value = (row: ProductPerformanceRow) => {
        if (sortKey === 'change') return row.sales - row.previousSales
        if (sortKey === 'costPrice') return row.costPrice ?? -1
        if (sortKey === 'productCost') return row.productCost ?? -1
        if (sortKey === 'grossProfit') return row.grossProfit ?? -1
        return row[sortKey]
      }
      return (value(a) - value(b)) * (direction === 'asc' ? 1 : -1)
    }), [rows, query, filter, sortKey, direction])

  function changeSort(next: SortKey) {
    if (next === sortKey) setDirection((current) => current === 'desc' ? 'asc' : 'desc')
    else { setSortKey(next); setDirection('desc') }
  }

  const headers: Array<{ key: SortKey; label: string }> = [
    { key: 'units', label: '판매수량' }, { key: 'sales', label: '매출' }, { key: 'change', label: '증감액' },
    { key: 'costPrice', label: '웍스 원가' }, { key: 'productCost', label: '상품원가' }, { key: 'grossProfit', label: '매출총이익' },
  ]

  return <section className="rounded-xl border bg-card">
    <div className="flex flex-col gap-3 border-b p-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-wrap gap-2"><FilterButton active={filter === 'all'} onClick={() => setFilter('all')}>전체 {rows.length}개</FilterButton><FilterButton active={filter === 'rise'} onClick={() => setFilter('rise')}>상승</FilterButton><FilterButton active={filter === 'drop'} onClick={() => setFilter('drop')}>하락</FilterButton><FilterButton active={filter === 'cost_issue'} onClick={() => setFilter('cost_issue')} tone="warning">원가 미입력·0원 {costIssueCount}개</FilterButton></div>
      <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="상품명 또는 SKU 검색" className="w-full lg:w-56" />
    </div>
    <div className="overflow-x-auto"><table className="w-full min-w-[1120px] text-sm"><thead className="border-b bg-muted/40 text-left text-muted-foreground"><tr><th className="px-4 py-3 font-medium">SKU</th><th className="min-w-64 px-3 py-3 font-medium">상품</th>{headers.map(({ key, label }) => <th key={key} className="px-3 py-3 text-right font-medium"><button type="button" onClick={() => changeSort(key)} className="inline-flex items-center gap-1 hover:text-foreground">{label}<SortIcon active={sortKey === key} direction={direction} /></button></th>)}<th className="px-3 py-3 text-right font-medium">원가 상태</th></tr></thead><tbody className="divide-y">{visibleRows.map((row) => { const change = row.sales - row.previousSales; const costIssue = row.costPrice == null || row.costPrice <= 0; return <tr key={row.sku} className={costIssue ? 'bg-amber-50/60' : 'hover:bg-muted/30'}><td className="px-4 py-3 font-mono text-xs text-muted-foreground">{row.sku}</td><td className="max-w-80 truncate px-3 py-3 font-medium" title={row.productName}>{row.productName}</td><td className="px-3 py-3 text-right tabular-nums">{integer.format(row.units)}</td><td className="px-3 py-3 text-right font-medium tabular-nums">{currency.format(row.sales)}</td><td className={`px-3 py-3 text-right font-medium tabular-nums ${change < 0 ? 'text-rose-700' : change > 0 ? 'text-emerald-700' : 'text-muted-foreground'}`}>{change === 0 ? '–' : `${change > 0 ? '+' : ''}${currency.format(change)}`}</td><td className="px-3 py-3 text-right tabular-nums">{costIssue ? <span className="font-medium text-amber-800">{row.costPrice === 0 ? '0원' : '미입력'}</span> : currency.format(row.costPrice!)}</td><td className="px-3 py-3 text-right tabular-nums">{row.productCost == null ? '–' : currency.format(row.productCost)}</td><td className="px-3 py-3 text-right font-medium tabular-nums">{row.grossProfit == null ? '–' : currency.format(row.grossProfit)}</td><td className="px-3 py-3 text-right">{costIssue ? <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-900">원가 확인</span> : <span className="text-xs text-muted-foreground">연결됨</span>}</td></tr> })}{visibleRows.length === 0 && <tr><td colSpan={10} className="px-3 py-14 text-center text-muted-foreground">조건에 맞는 상품이 없습니다.</td></tr>}</tbody></table></div>
  </section>
}

function FilterButton({ active, tone, onClick, children }: { active: boolean; tone?: 'warning'; onClick: () => void; children: React.ReactNode }) { return <button type="button" onClick={onClick} className={`rounded-md border px-3 py-1.5 text-sm font-medium ${active ? tone === 'warning' ? 'border-amber-500 bg-amber-100 text-amber-950' : 'border-primary bg-primary text-primary-foreground' : 'bg-background hover:bg-muted'}`}>{children}</button> }
function SortIcon({ active, direction }: { active: boolean; direction: 'asc' | 'desc' }) { return active ? direction === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" /> : <ArrowUpDown className="size-3 opacity-50" /> }
