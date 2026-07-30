'use client'

import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Pencil, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { SettlementRow } from '@/lib/analytics/settlement-calendar'

function won(value: number) { return `${Math.round(value).toLocaleString('ko-KR')}원` }
function dateKey(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` }

export function SettlementCalendar({ initialMonth, rows }: { initialMonth: string; rows: SettlementRow[] }) {
  const [month, setMonth] = useState(initialMonth)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const [year, monthValue] = month.split('-').map(Number)
  const byDate = useMemo(() => rows.reduce<Record<string, SettlementRow[]>>((all, row) => { (all[row.date] ||= []).push(row); return all }, {}), [rows])
  const selected = selectedDate ? byDate[selectedDate] ?? [] : []
  const days = useMemo(() => {
    const first = new Date(year, monthValue - 1, 1); const offset = (first.getDay() + 6) % 7
    const start = new Date(year, monthValue - 1, 1 - offset)
    return Array.from({ length: 42 }, (_, index) => { const day = new Date(start); day.setDate(start.getDate() + index); return day })
  }, [year, monthValue])
  const totals = rows.reduce((all, row) => ({ expected: all.expected + row.expectedAmount, actual: all.actual + (row.actualAmount ?? 0), count: all.count + row.orderCount }), { expected: 0, actual: 0, count: 0 })
  function change(delta: number) { const next = new Date(year, monthValue - 1 + delta, 1); window.location.href = `/analytics/settlements?month=${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}` }
  async function save(type: 'confirmation' | 'rule', body: Record<string, unknown>) {
    setSaving(true); setNotice('')
    const response = await fetch('/api/analytics/settlements', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type, ...body }) })
    setSaving(false); setNotice(response.ok ? '저장했습니다. 새로고침하면 계산값에 반영됩니다.' : (await response.json().catch(() => ({ error: '저장하지 못했습니다.' }))).error)
  }
  return <section className="overflow-hidden rounded-md border bg-background">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 text-sm"><div className="flex flex-wrap gap-4"><span>예상 정산 <b>{won(totals.expected)}</b></span><span>확정 입금 <b>{won(totals.actual)}</b></span><span>대상 주문 <b>{totals.count.toLocaleString()}건</b></span></div><span className="text-muted-foreground">예상액 = 판매금액 - 채널 수수료</span></div>
    <div className="grid lg:grid-cols-[minmax(0,1fr)_360px]"><div className="min-w-0 p-4"><div className="mb-3 flex items-center justify-between"><div className="flex items-center gap-1"><Button variant="outline" size="icon" onClick={() => change(-1)} title="이전 달"><ChevronLeft className="h-4 w-4" /></Button><b className="px-2">{year}년 {monthValue}월</b><Button variant="outline" size="icon" onClick={() => change(1)} title="다음 달"><ChevronRight className="h-4 w-4" /></Button></div></div><div className="grid grid-cols-7 border-l border-t text-xs">{['월','화','수','목','금','토','일'].map((label) => <div key={label} className="border-b border-r bg-muted/50 p-2 text-center text-muted-foreground">{label}</div>)}{days.map((day) => { const key = dateKey(day); const entries = byDate[key] ?? []; const expected = entries.reduce((sum, entry) => sum + entry.expectedAmount, 0); const isCurrent = day.getMonth() === monthValue - 1; return <button type="button" key={key} onClick={() => entries.length && setSelectedDate(key)} className={`min-h-24 border-b border-r p-2 text-left hover:bg-muted/40 ${!isCurrent ? 'bg-muted/20 text-muted-foreground' : ''} ${selectedDate === key ? 'ring-2 ring-inset ring-primary' : ''}`}><div className="mb-1 font-medium">{day.getDate()}</div>{entries.length > 0 && <><div className="font-semibold text-primary">{won(expected)}</div><div className="mt-1 text-muted-foreground">{entries.length}개 마켓 · {entries.reduce((sum, entry) => sum + entry.orderCount, 0)}건</div>{entries.some((entry) => entry.actualAmount != null) && <div className="mt-1 text-emerald-700">입금 확인</div>}</>}</button> })}</div></div>
      <aside className="border-t p-4 lg:border-l lg:border-t-0"><h2 className="font-semibold">{selectedDate ? `${selectedDate} 정산 내역` : '날짜를 선택하세요'}</h2><p className="mt-1 text-xs text-muted-foreground">기본 정산일은 주문일 + 14일입니다. 마켓별 실제 정산 주기에 맞게 조정하세요.</p>{selected.map((row) => <SettlementEditor key={`${row.date}-${row.marketplaceId}`} row={row} saving={saving} onSave={save} />)}{notice && <p className="mt-3 text-sm text-primary">{notice}</p>}</aside></div>
  </section>
}

function SettlementEditor({ row, saving, onSave }: { row: SettlementRow; saving: boolean; onSave: (type: 'confirmation' | 'rule', body: Record<string, unknown>) => Promise<void> }) {
  const [actual, setActual] = useState(row.actualAmount?.toString() ?? '')
  const [memo, setMemo] = useState(row.memo ?? '')
  const [delay, setDelay] = useState(row.payoutDelayDays.toString())
  const [commission, setCommission] = useState(row.commissionRate.toString())
  const difference = row.actualAmount == null ? null : row.actualAmount - row.expectedAmount
  return <div className="mt-4 space-y-3 rounded border p-3 text-sm"><div className="flex items-center justify-between gap-2"><b>{row.marketplaceName}</b><span className="text-muted-foreground">{row.orderCount}건</span></div><div className="grid grid-cols-2 gap-2 text-xs"><div>판매금액 <b className="block text-sm">{won(row.grossSales)}</b></div><div>수수료 {row.commissionRate}% <b className="block text-sm">-{won(row.commissionAmount)}</b></div><div>예상 정산 <b className="block text-sm text-primary">{won(row.expectedAmount)}</b></div>{difference != null && <div>차이 <b className={`block text-sm ${difference === 0 ? 'text-emerald-700' : 'text-red-600'}`}>{difference > 0 ? '+' : ''}{won(difference)}</b></div>}</div><div className="grid grid-cols-2 gap-2"><label className="text-xs">정산 주기(일)<Input value={delay} type="number" min="0" onChange={(event) => setDelay(event.target.value)} /></label><label className="text-xs">수수료율(%)<Input value={commission} type="number" min="0" step="0.1" onChange={(event) => setCommission(event.target.value)} /></label></div><Button className="w-full" variant="outline" size="sm" disabled={saving} onClick={() => onSave('rule', { marketplaceId: row.marketplaceId, payoutDelayDays: Number(delay), commissionRate: commission === '' ? null : Number(commission) })}><Pencil className="h-3.5 w-3.5" />정산 규칙 저장</Button><label className="block text-xs">실제 입금액<Input value={actual} type="number" min="0" placeholder="입금 확인 후 입력" onChange={(event) => setActual(event.target.value)} /></label><label className="block text-xs">메모<Input value={memo} placeholder="입금일, 차이 사유" onChange={(event) => setMemo(event.target.value)} /></label><Button className="w-full" size="sm" disabled={saving || actual === ''} onClick={() => onSave('confirmation', { marketplaceId: row.marketplaceId, date: row.date, actualAmount: Number(actual), memo: memo || null })}><Save className="h-3.5 w-3.5" />실제 입금 저장</Button></div>
}
