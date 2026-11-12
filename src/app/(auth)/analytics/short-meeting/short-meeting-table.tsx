'use client'

import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import type { ShortMeetingRow } from '@/lib/analytics/short-meeting'

export function ShortMeetingTable({ rows, sheetStatus }: { rows: ShortMeetingRow[]; sheetStatus: 'available' | 'unavailable' }) {
  const [search, setSearch] = useState('')
  const [riskOnly, setRiskOnly] = useState(false)
  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase()
    return rows.filter((row) => (!riskOnly || row.stockStatus !== 'normal') && (!term || [row.sku, row.productName, row.optionName].some((value) => value.toLocaleLowerCase().includes(term))))
  }, [rows, search, riskOnly])

  return (
    <section className="rounded-lg border bg-card">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b px-4 py-3">
        <div>
          <h2 className="text-base font-semibold">오늘 상품별 출고 현황</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">주문일 기준 당일 주문을 품목별로 합산합니다. 평균 출고수량은 발주 화면과 같은 최근 3개월 월평균 기준입니다.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={riskOnly} onChange={(event) => setRiskOnly(event.target.checked)} /> 재고 위험만 보기</label>
          <label className="flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm"><Search className="size-4 text-muted-foreground" /><span className="sr-only">상품 검색</span><input className="w-48 bg-transparent outline-none" placeholder="품목코드, 상품명, 옵션 검색" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        </div>
      </div>
      <div className="px-4 py-2 text-xs text-muted-foreground">{filtered.length.toLocaleString('ko-KR')}개 상품 표시 · 품절 여부는 <a className="underline underline-offset-2" href="https://docs.google.com/spreadsheets/d/1j5nkny_EUFZlZxRKGDd_myVsRL2DNyhNosQMgneESBs/edit?gid=30673467#gid=30673467" target="_blank" rel="noreferrer">품절리스트</a> 기준</div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1800px] text-sm">
          <thead className="bg-muted/50 text-muted-foreground"><tr>
            <Th>품목코드</Th><Th>상품명 / 옵션</Th><Th align="right">당일 출고수량</Th><Th align="right">국내 현재고</Th><Th align="right">출고 후 재고</Th><Th align="right">평균 출고수량<br />(월평균)</Th><Th align="right">당월 출고수량</Th><Th>품절리스트</Th><Th align="right">중국재고</Th><Th>중국출고날짜</Th><Th>발주 상태</Th><Th>발주날짜</Th><Th>로케이션</Th>
          </tr></thead>
          <tbody>
            {filtered.length === 0 ? <tr><td className="px-3 py-12 text-center text-muted-foreground" colSpan={13}>{rows.length ? '검색 조건에 맞는 상품이 없습니다.' : '오늘 주문에서 품목코드가 확정된 상품이 없습니다.'}</td></tr> : filtered.map((row) => (
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

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return <th className={`whitespace-nowrap px-3 py-2 font-medium ${align === 'right' ? 'text-right' : 'text-left'}`}>{children}</th>
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${className}`}>{children}</td>
}

function formatQuantity(value: number): string {
  return `${value.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}개`
}
