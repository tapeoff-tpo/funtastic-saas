'use client'

import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, Search } from 'lucide-react'
import type { ShortMeetingRow } from '@/lib/analytics/short-meeting'

type SortKey = 'sku' | 'productName' | 'todayOutbound' | 'currentStock' | 'stockAfterOutbound' | 'averageDailyOutbound' | 'monthOutbound' | 'outOfStock' | 'chinaStock' | 'chinaShipmentDate' | 'chinaOrderStatus' | 'chinaOrderDate' | 'location'
type SortDirection = 'ascending' | 'descending'
const collator = new Intl.Collator('ko-KR', { numeric: true, sensitivity: 'base' })

function sortValue(row: ShortMeetingRow, key: SortKey, sheetStatus: 'available' | 'unavailable'): string | number | null {
  if (key === 'productName') return `${row.productName} ${row.optionName}`
  if (key === 'outOfStock' && sheetStatus === 'unavailable') return null
  const value = row[key]
  if (typeof value === 'string' && (!value.trim() || value.trim() === '-')) return null
  if ((key === 'chinaShipmentDate' || key === 'chinaOrderDate') && typeof value === 'string') {
    const dates = value.match(/\d{4}-\d{2}-\d{2}/g)
    if (dates?.length) return dates.reduce((latest, date) => date > latest ? date : latest)
  }
  return value
}

export function ShortMeetingTable({ rows, sheetStatus }: { rows: ShortMeetingRow[]; sheetStatus: 'available' | 'unavailable' }) {
  const [search, setSearch] = useState('')
  const [riskOnly, setRiskOnly] = useState(false)
  const [sort, setSort] = useState<{ key: SortKey; direction: SortDirection } | null>(null)
  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase()
    const result = rows.filter((row) => (!riskOnly || row.stockStatus !== 'normal') && (!term || [row.sku, row.productName, row.optionName].some((value) => value.toLocaleLowerCase().includes(term))))
    if (!sort) return result
    return result.sort((a, b) => {
      const left = sortValue(a, sort.key, sheetStatus)
      const right = sortValue(b, sort.key, sheetStatus)
      if (left == null) return right == null ? 0 : 1
      if (right == null) return -1
      const compared = typeof left === 'number' && typeof right === 'number' ? left - right : collator.compare(String(left), String(right))
      return sort.direction === 'ascending' ? compared : -compared
    })
  }, [rows, search, riskOnly, sort, sheetStatus])

  function changeSort(key: SortKey) {
    setSort((previous) => ({ key, direction: previous?.key === key && previous.direction === 'ascending' ? 'descending' : 'ascending' }))
  }

  function sortable(key: SortKey, label: React.ReactNode, align: 'left' | 'right' = 'left') {
    const direction = sort?.key === key ? sort.direction : undefined
    const Icon = direction === 'ascending' ? ArrowUp : direction === 'descending' ? ArrowDown : ArrowUpDown
    return <th aria-sort={direction} className={`whitespace-nowrap px-3 py-2 font-medium ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <button type="button" onClick={() => changeSort(key)} title={key === 'chinaShipmentDate' || key === 'chinaOrderDate' ? '여러 날짜가 있으면 가장 최근 날짜로 정렬' : '클릭하여 정렬 방향 변경'} className={`inline-flex items-center gap-1 rounded-sm hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 ${align === 'right' ? 'justify-end' : ''}`}>
        <span>{label}</span><Icon aria-hidden="true" className="size-3.5 shrink-0" />
      </button>
    </th>
  }

  return (
    <section className="rounded-lg border bg-card">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b px-4 py-3">
        <div>
          <h2 className="text-base font-semibold">기준일 상품별 출고 현황</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">반영한 주문서 전체를 품목별로 합산합니다. 평균 출고수량은 발주 화면과 같은 최근 3개월 월평균 기준입니다.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={riskOnly} onChange={(event) => setRiskOnly(event.target.checked)} /> 재고 위험만 보기</label>
          <label className="flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm"><Search className="size-4 text-muted-foreground" /><span className="sr-only">상품 검색</span><input className="w-48 bg-transparent outline-none" placeholder="품목코드, 상품명, 옵션 검색" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        </div>
      </div>
      <div className="px-4 py-2 text-xs text-muted-foreground">{filtered.length.toLocaleString('ko-KR')}개 상품 표시 · 품절 여부는 <a className="underline underline-offset-2" href="https://docs.google.com/spreadsheets/d/1j5nkny_EUFZlZxRKGDd_myVsRL2DNyhNosQMgneESBs/edit?gid=30673467#gid=30673467" target="_blank" rel="noreferrer">품절리스트</a> 기준 · 열 제목을 눌러 정렬 · 여러 날짜는 가장 최근 날짜 기준</div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1800px] text-sm">
          <thead className="bg-muted/50 text-muted-foreground"><tr>
            {sortable('sku', '품목코드')}{sortable('productName', '상품명 / 옵션')}{sortable('todayOutbound', '기준일 출고수량', 'right')}{sortable('currentStock', '국내 현재고', 'right')}{sortable('stockAfterOutbound', '출고 후 재고', 'right')}{sortable('averageDailyOutbound', <>평균 출고수량<br />(월평균)</>, 'right')}{sortable('monthOutbound', '당월 출고수량', 'right')}{sortable('outOfStock', '품절리스트')}{sortable('chinaStock', '중국재고', 'right')}{sortable('chinaShipmentDate', '중국출고날짜')}{sortable('chinaOrderStatus', '발주 상태')}{sortable('chinaOrderDate', '발주날짜')}{sortable('location', '로케이션')}
          </tr></thead>
          <tbody>
            {filtered.length === 0 ? <tr><td className="px-3 py-12 text-center text-muted-foreground" colSpan={13}>{rows.length ? '검색 조건에 맞는 상품이 없습니다.' : '반영된 주문서에 표시할 상품이 없습니다.'}</td></tr> : filtered.map((row) => (
              <tr className="border-t" key={row.sku}>
                <td data-no-translate className="whitespace-nowrap px-3 py-2 font-mono text-xs font-medium">{row.sku}</td>
                <td className="min-w-[220px] max-w-[320px] px-3 py-2"><div data-no-translate className="font-medium">{row.productName}</div><div data-no-translate className="text-xs text-muted-foreground">{row.optionName}</div></td>
                <Td>{formatQuantity(row.todayOutbound)}</Td><Td>{formatQuantity(row.currentStock)}</Td><Td className={row.stockAfterOutbound <= 0 ? 'font-semibold text-red-600' : ''}>{formatQuantity(row.stockAfterOutbound)}</Td><Td>{formatQuantity(row.averageDailyOutbound)}</Td><Td>{formatQuantity(row.monthOutbound)}</Td>
                <td className="whitespace-pre-line px-3 py-2">{sheetStatus === 'unavailable' ? <span className="text-amber-700">확인 불가</span> : row.outOfStock ? <span className="font-medium text-red-700">{row.outOfStock}</span> : <span className="text-muted-foreground">미등록</span>}</td>
                <Td>{row.chinaStock == null ? '자료 없음' : formatQuantity(row.chinaStock)}</Td>
                <td className="whitespace-pre-line px-3 py-2">{row.chinaShipmentDate || '-'}</td><td className="whitespace-pre-line px-3 py-2">{row.chinaOrderStatus || '-'}</td><td className="whitespace-pre-line px-3 py-2">{row.chinaOrderDate || '-'}</td><td className="px-3 py-2">{row.location}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${className}`}>{children}</td>
}

function formatQuantity(value: number): string {
  return `${value.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}개`
}
