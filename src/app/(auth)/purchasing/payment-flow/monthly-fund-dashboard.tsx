'use client'

import { useState } from 'react'
import type { PurchaseFundLedgerData } from '@/lib/purchasing/purchase-fund-ledger'

type Month = PurchaseFundLedgerData['monthly'][number]

function money(value: number | null) {
  return value === null ? '금액 확인 필요' : `${value.toLocaleString('ko-KR', { maximumFractionDigits: 2 })} 元`
}

export function MonthlyFundDashboard({ monthly }: { monthly: Month[] }) {
  const current = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' }).format(new Date())
  const [selected, setSelected] = useState(monthly[0]?.month ?? current)
  const selectedData = monthly.find((item) => item.month === selected)
  return (
    <section className="space-y-4" aria-label="월별 입금과 발주 차감">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h2 className="text-lg font-semibold">월별 자금 흐름</h2><p className="mt-1 text-xs text-muted-foreground">입금일과 발주 차감 장부에 기록된 날짜를 기준으로 집계합니다.</p></div>
        <label className="text-xs text-muted-foreground">조회 월 <input aria-label="조회 월" type="month" value={selected} onChange={(event) => setSelected(event.target.value)} className="ml-2 rounded-md border bg-background px-3 py-2 text-sm text-foreground" /></label>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border bg-background p-4">
          <h3 className="font-semibold">월별 입금 · 발주 차감</h3>
          <p className="mt-1 text-xs text-muted-foreground">기초잔액은 입금에 포함됩니다.</p>
          <div className="mt-4 overflow-x-auto"><table className="w-full text-sm"><thead className="text-xs text-muted-foreground"><tr><th className="pb-2 text-left font-medium">월</th><th className="pb-2 text-right font-medium">입금</th><th className="pb-2 text-right font-medium">발주 차감</th></tr></thead><tbody>
            {monthly.length === 0 ? <tr><td colSpan={3} className="py-6 text-center text-muted-foreground">집계할 내역이 없습니다.</td></tr> : monthly.map((item) => <tr key={item.month} className={item.month === selected ? 'border-t bg-blue-50/50' : 'border-t'}><td className="py-3"><button type="button" onClick={() => setSelected(item.month)} className="font-medium text-blue-700 hover:underline">{item.month}</button></td><td className="py-3 text-right tabular-nums">{money(item.depositedCny)}</td><td className="py-3 text-right tabular-nums">{money(item.debitedCny)}</td></tr>)}
          </tbody></table></div>
        </div>
        <div className="rounded-xl border bg-background p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold">{selected.replace('-', '년 ')}월 주문 금액 TOP 10</h3><p className="mt-1 text-xs text-muted-foreground">발주 차감 장부에 기록된 상품별 금액 기준</p></div><span className="rounded-full bg-blue-50 px-2 py-1 text-xs text-blue-700">위안</span></div>
          {selectedData?.products.length ? <ol className="mt-3 divide-y">{selectedData.products.map((product, index) => <li key={product.sku || product.name} className="flex items-center gap-3 py-2.5"><span className="w-6 text-center text-xs font-semibold text-blue-600">{String(index + 1).padStart(2, '0')}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{product.name}</span><span className="block text-xs text-muted-foreground">{product.sku}</span></span><span className="whitespace-nowrap text-sm font-semibold tabular-nums">{money(product.amountCny)}</span></li>)}</ol> : <p className="py-10 text-center text-sm text-muted-foreground">선택한 월의 상품별 차감 자료가 없습니다.</p>}
          {selectedData?.debitedCny === null ? <p className="mt-3 text-xs text-amber-700">원가 또는 중복 확인이 필요한 발주가 있습니다. 확인된 상품 금액만 순위에 표시됩니다.</p> : null}
        </div>
      </div>
    </section>
  )
}

