'use client'

import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, Search } from 'lucide-react'
import type { ShortMeetingRow } from '@/lib/analytics/short-meeting'

type SortKey = 'sku' | 'productName' | 'todayOutbound' | 'currentStock' | 'stockAfterOutbound' | 'averageDailyOutbound' | 'monthOutbound' | 'outOfStock' | 'chinaStock' | 'chinaShipmentDate' | 'chinaOrderStatus' | 'chinaOrderDate'
type SortDirection = 'ascending' | 'descending'
const collator = new Intl.Collator('ko-KR', { numeric: true, sensitivity: 'base' })
const SORT_OPTIONS: Array<{ key: SortKey; label: string }> = [
  { key: 'sku', label: '품목코드' }, { key: 'productName', label: '상품명 / 옵션' },
  { key: 'todayOutbound', label: '기준일 출고수량' }, { key: 'currentStock', label: '국내 현재고' },
  { key: 'stockAfterOutbound', label: '출고 후 재고' }, { key: 'averageDailyOutbound', label: '평균 출고수량' },
  { key: 'monthOutbound', label: '당월 출고수량' }, { key: 'outOfStock', label: '품절리스트' },
  { key: 'chinaStock', label: '중국재고' }, { key: 'chinaShipmentDate', label: '중국출고날짜' },
  { key: 'chinaOrderStatus', label: '발주 상태' }, { key: 'chinaOrderDate', label: '발주날짜' },
]

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
    return <th aria-sort={direction} className={`min-w-0 px-0.5 py-2 font-medium sm:px-1 ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <button type="button" onClick={() => changeSort(key)} title={key === 'chinaShipmentDate' || key === 'chinaOrderDate' ? '여러 날짜가 있으면 가장 최근 날짜로 정렬' : '클릭하여 정렬 방향 변경'} className={`inline-flex w-full min-w-0 items-start gap-0.5 rounded-sm hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 ${align === 'right' ? 'justify-end text-right' : 'text-left'}`}>
        <span className="min-w-0 break-words [overflow-wrap:anywhere]">{label}</span><Icon aria-hidden="true" className="mt-0.5 size-3 shrink-0" />
      </button>
    </th>
  }

  return (
    <section className="w-full min-w-0 rounded-lg border bg-card">
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
      <div className="px-4 py-2 text-xs text-muted-foreground">{filtered.length.toLocaleString('ko-KR')}개 상품 표시 · 품절 여부는 <a className="underline underline-offset-2" href="https://docs.google.com/spreadsheets/d/1j5nkny_EUFZlZxRKGDd_myVsRL2DNyhNosQMgneESBs/edit?gid=30673467#gid=30673467" target="_blank" rel="noreferrer">품절리스트</a> 기준 · <span className="hidden xl:inline">열 제목을 눌러 정렬</span><span className="xl:hidden">정렬 기준을 선택</span> · 여러 날짜는 가장 최근 날짜 기준</div>
      <div className="space-y-3 px-3 pb-3 xl:hidden">
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid min-w-0 flex-1 gap-1 text-xs">정렬 기준
            <select value={sort?.key ?? ''} onChange={(event) => setSort(event.target.value ? { key: event.target.value as SortKey, direction: sort?.direction ?? 'ascending' } : null)} className="min-w-0 rounded-md border bg-background px-2 py-2 text-sm">
              <option value="">기본순</option>
              {SORT_OPTIONS.map(({ key, label }) => <option key={key} value={key}>{label}</option>)}
            </select>
          </label>
          <button type="button" disabled={!sort} onClick={() => setSort((previous) => previous ? { ...previous, direction: previous.direction === 'ascending' ? 'descending' : 'ascending' } : null)} className="rounded-md border px-3 py-2 text-sm disabled:opacity-50" aria-label="정렬 방향">{sort?.direction === 'descending' ? '내림차순' : '오름차순'}</button>
        </div>
        {filtered.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">{rows.length ? '검색 조건에 맞는 상품이 없습니다.' : '반영된 주문서에 표시할 상품이 없습니다.'}</p> : filtered.map((row) => (
          <article className="min-w-0 rounded-md border p-3" key={row.sku}>
            <div data-no-translate className="break-words text-sm font-semibold [overflow-wrap:anywhere]">{row.productName}</div>
            <div data-no-translate className="mt-0.5 break-words text-xs text-muted-foreground [overflow-wrap:anywhere]">{row.optionName} · {row.sku}</div>
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
              <MobileField label="기준일 출고수량">{formatQuantity(row.todayOutbound)}</MobileField>
              <MobileField label="국내 현재고">{formatQuantity(row.currentStock)}</MobileField>
              <MobileField label="출고 후 재고" className={row.stockAfterOutbound <= 0 ? 'font-semibold text-red-600' : ''}>{formatQuantity(row.stockAfterOutbound)}</MobileField>
              <MobileField label="평균 출고수량 (월평균)">{formatQuantity(row.averageDailyOutbound)}</MobileField>
              <MobileField label="당월 출고수량">{formatQuantity(row.monthOutbound)}</MobileField>
              <MobileField label="품절리스트">{sheetStatus === 'unavailable' ? <span className="text-amber-700">확인 불가</span> : row.outOfStock ? <span className="font-medium text-red-700">{row.outOfStock}</span> : null}</MobileField>
              <MobileField label="중국재고">{row.chinaStock == null ? '자료 없음' : formatQuantity(row.chinaStock)}</MobileField>
              <MobileField label="중국출고날짜">{row.chinaShipmentDate || '-'}</MobileField>
              <MobileField label="발주 상태">{row.chinaOrderStatus || '-'}</MobileField>
              <MobileField label="발주날짜">{row.chinaOrderDate || '-'}</MobileField>
            </dl>
          </article>
        ))}
      </div>
      <div className="hidden w-full min-w-0 xl:block">
        <table className="w-full table-fixed text-xs">
          <colgroup>
            <col className="w-[8%]" /><col className="w-[17%]" /><col className="w-[6%]" /><col className="w-[6%]" /><col className="w-[7%]" /><col className="w-[7%]" /><col className="w-[7%]" /><col className="w-[10%]" /><col className="w-[6%]" /><col className="w-[10%]" /><col className="w-[8%]" /><col className="w-[8%]" />
          </colgroup>
          <thead className="bg-muted/50 text-muted-foreground"><tr>
            {sortable('sku', '품목코드')}{sortable('productName', '상품명 / 옵션')}{sortable('todayOutbound', '기준일 출고수량', 'right')}{sortable('currentStock', '국내 현재고', 'right')}{sortable('stockAfterOutbound', '출고 후 재고', 'right')}{sortable('averageDailyOutbound', <>평균 출고수량<br />(월평균)</>, 'right')}{sortable('monthOutbound', '당월 출고수량', 'right')}{sortable('outOfStock', '품절리스트')}{sortable('chinaStock', '중국재고', 'right')}{sortable('chinaShipmentDate', '중국출고날짜')}{sortable('chinaOrderStatus', '발주 상태')}{sortable('chinaOrderDate', '발주날짜')}
          </tr></thead>
          <tbody>
            {filtered.length === 0 ? <tr><td className="px-3 py-12 text-center text-muted-foreground" colSpan={12}>{rows.length ? '검색 조건에 맞는 상품이 없습니다.' : '반영된 주문서에 표시할 상품이 없습니다.'}</td></tr> : filtered.map((row) => (
              <tr className="border-t" key={row.sku}>
                <td data-no-translate className="break-words px-0.5 py-2 font-mono text-xs font-medium [overflow-wrap:anywhere] sm:px-1">{row.sku}</td>
                <td className="break-words px-0.5 py-2 [overflow-wrap:anywhere] sm:px-1"><div data-no-translate className="font-medium">{row.productName}</div><div data-no-translate className="text-xs text-muted-foreground">{row.optionName}</div></td>
                <Td>{formatQuantity(row.todayOutbound)}</Td><Td>{formatQuantity(row.currentStock)}</Td><Td className={row.stockAfterOutbound <= 0 ? 'font-semibold text-red-600' : ''}>{formatQuantity(row.stockAfterOutbound)}</Td><Td>{formatQuantity(row.averageDailyOutbound)}</Td><Td>{formatQuantity(row.monthOutbound)}</Td>
                <td className="whitespace-pre-line break-words px-0.5 py-2 [overflow-wrap:anywhere] sm:px-1">{sheetStatus === 'unavailable' ? <span className="text-amber-700">확인 불가</span> : row.outOfStock ? <span className="font-medium text-red-700">{row.outOfStock}</span> : null}</td>
                <Td>{row.chinaStock == null ? '자료 없음' : formatQuantity(row.chinaStock)}</Td>
                <td className="whitespace-pre-line break-words px-0.5 py-2 [overflow-wrap:anywhere] sm:px-1">{row.chinaShipmentDate || '-'}</td><td className="whitespace-pre-line break-words px-0.5 py-2 [overflow-wrap:anywhere] sm:px-1">{row.chinaOrderStatus || '-'}</td><td className="whitespace-pre-line break-words px-0.5 py-2 [overflow-wrap:anywhere] sm:px-1">{row.chinaOrderDate || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`break-words px-0.5 py-2 text-right tabular-nums [overflow-wrap:anywhere] sm:px-1 ${className}`}>{children}</td>
}

function MobileField({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return <div className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className={`mt-0.5 min-h-5 whitespace-pre-line break-words tabular-nums [overflow-wrap:anywhere] ${className}`}>{children}</dd></div>
}

function formatQuantity(value: number): string {
  const rounded = value < 0 ? -Math.round(-value) : Math.round(value)
  return `${(rounded === 0 ? 0 : rounded).toLocaleString('ko-KR')}개`
}
