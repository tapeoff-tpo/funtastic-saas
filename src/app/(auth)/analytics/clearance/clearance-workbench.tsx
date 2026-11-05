'use client'

import { useActionState, useEffect, useMemo, useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { toast } from 'sonner'
import type { ClearanceCandidate, ClearanceDecision, ClearanceSettings } from '@/lib/analytics/clearance'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { saveClearanceDecision, saveClearanceSettings } from './actions'

const currency = new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 })

type Filter = 'ready' | 'all' | 'candidate' | 'approved' | 'dismissed' | 'review'

export function ClearanceWorkbench({ settings, candidates, decisions }: { settings: ClearanceSettings; candidates: ClearanceCandidate[]; decisions: ClearanceDecision[] }) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [pageSize, setPageSize] = useState(20)
  const [page, setPage] = useState(1)
  const decisionMap = useMemo(() => new Map(decisions.map((item) => [item.sku, item])), [decisions])
  const readyCount = candidates.filter((row) => row.dataStatus === 'ready').length
  const reviewCount = candidates.length - readyCount
  const activeCount = candidates.filter((row) => (decisionMap.get(row.sku)?.status ?? 'candidate') !== 'dismissed').length
  const visible = candidates.filter((row) => {
    const decision = decisionMap.get(row.sku)
    const status = decision?.status ?? 'candidate'
    const matchesSearch = !query || `${row.sku} ${row.productName}`.toLowerCase().includes(query.toLowerCase())
    if (!matchesSearch) return false
    if (filter === 'ready') return row.dataStatus === 'ready'
    if (filter === 'review') return row.dataStatus !== 'ready'
    if (filter === 'all') return status !== 'dismissed'
    return status === filter
  })
  const totalPages = Math.max(1, Math.ceil(visible.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const pageRows = visible.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  return <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_21rem] xl:items-start">
    <section className="min-w-0 space-y-3">
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="font-semibold">재고정리 운영표</p>
          <p className="mt-1 text-sm text-muted-foreground">행마다 검토 후 실행안만 저장합니다. 저장해도 판매가가 바로 바뀌지 않습니다.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} placeholder="상품명 또는 SKU 검색" className="w-full sm:w-52" />
          <select value={filter} onChange={(event) => { setFilter(event.target.value as Filter); setPage(1) }} className="h-9 rounded-md border bg-background px-2 text-sm">
            <option value="all">검토 목록 {activeCount}건</option>
            <option value="ready">판정 가능 {readyCount}건</option>
            <option value="review">데이터 확인 필요 {reviewCount}건</option>
            <option value="candidate">후보 유지</option>
            <option value="approved">승인 대기</option>
            <option value="dismissed">제외</option>
          </select>
          <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1) }} className="h-9 rounded-md border bg-background px-2 text-sm" aria-label="페이지당 상품 수">
            <option value="10">10개씩</option><option value="20">20개씩</option><option value="50">50개씩</option>
          </select>
        </div>
      </div>

      <div className="min-w-0 overflow-hidden rounded-xl border bg-card">
        <div className="min-w-0 overflow-x-auto">
          <table className="w-full min-w-[1100px] text-sm">
            <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="w-[260px] px-4 py-3 font-medium">상품</th>
                <th className="px-3 py-3 font-medium">현재고</th>
                <th className="px-3 py-3 font-medium">입고 후 경과</th>
                <th className="px-3 py-3 font-medium">입고 후 출고</th>
                <th className="px-3 py-3 font-medium">현재가</th>
                <th className="px-3 py-3 font-medium">최저 허용가</th>
                <th className="w-[126px] px-3 py-3 font-medium">제안가 / 할인율</th>
                <th className="w-[132px] px-3 py-3 font-medium">실행안</th>
                <th className="w-[118px] px-3 py-3 font-medium">상태</th>
                <th className="w-[88px] px-3 py-3 font-medium">저장</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {pageRows.map((candidate) => <CandidateRow key={candidate.sku} candidate={candidate} decision={decisionMap.get(candidate.sku)} settings={settings} />)}
            </tbody>
          </table>
        </div>
        {visible.length === 0 && <div className="py-14 text-center text-sm text-muted-foreground">현재 필터에 맞는 상품이 없습니다. 기준이나 검색어를 조정해주세요.</div>}
      </div>
      {visible.length > 0 && <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground"><p>{visible.length.toLocaleString('ko-KR')}건 중 {((currentPage - 1) * pageSize + 1).toLocaleString('ko-KR')}–{Math.min(currentPage * pageSize, visible.length).toLocaleString('ko-KR')}건 표시</p><div className="flex items-center gap-2"><Button type="button" variant="outline" size="sm" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={currentPage === 1}>이전</Button><span>{currentPage} / {totalPages}</span><Button type="button" variant="outline" size="sm" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={currentPage === totalPages}>다음</Button></div></div>}
    </section>
    <SettingsPanel settings={settings} />
  </div>
}

function SettingsPanel({ settings }: { settings: ClearanceSettings }) {
  const [state, action, pending] = useActionState(saveClearanceSettings, null)
  useEffect(() => { if (state?.success) toast.success(state.message); if (state?.error) toast.error(state.error) }, [state])
  return <aside className="rounded-xl border bg-card xl:sticky xl:top-4">
    <div className="border-b p-4">
      <div className="flex items-center gap-2 font-semibold"><SlidersHorizontal className="size-4 text-primary" />일괄 판정·가격 기준</div>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">최저 허용가는 원가와 아래 비용·마진 기준으로 계산합니다. 저장 후 표를 다시 계산하지만 고객몰 판매가는 변경되지 않습니다.</p>
    </div>
    <form action={action} className="space-y-3 p-4">
      <div className="grid grid-cols-2 gap-3"><Field label="최소 재고" name="minimum_stock" value={settings.minimumStock} /><Field label="입고 후 경과일" name="stale_days" value={settings.staleDays} /><Field label="최대 소진율(%)" name="maximum_sell_through_percent" value={settings.maximumSellThroughPercent} /><Field label="최소 마진율(%)" name="minimum_margin_percent" value={settings.minimumMarginPercent} /><Field label="판매수수료(%)" name="marketplace_fee_percent" value={settings.marketplaceFeePercent} /><Field label="포장비" name="packing_cost" value={settings.packingCost} /><Field label="배송비 부담" name="shipping_cost" value={settings.shippingCost} /><Field label="기본 할인율(%)" name="default_discount_percent" value={settings.defaultDiscountPercent} /><Field label="최대 할인율(%)" name="maximum_discount_percent" value={settings.maximumDiscountPercent} /><Field label="가격 단위" name="rounding_unit" value={settings.roundingUnit} /></div>
      <div className="rounded-md bg-muted/60 p-3 text-xs leading-5 text-muted-foreground"><p className="font-medium text-foreground">판정 순서</p><ol className="mt-1 list-decimal space-y-1 pl-4"><li>최소 재고 이상인지 확인</li><li>입고 후 경과일과 소진율로 후보 판정</li><li>원가·수수료·포장비·배송비로 최저 허용가 계산</li><li>기본 할인율을 적용한 제안가를 가격 단위에 맞춰 반올림</li></ol><p className="mt-2">입고일이나 현재가가 없으면 할인 후보가 아니라 데이터 확인 대상으로 분리됩니다.</p></div>
      <Button type="submit" className="w-full" disabled={pending}>{pending ? '저장 중...' : '일괄 기준 저장'}</Button>
    </form>
  </aside>
}

function Field({ label, name, value }: { label: string; name: string; value: number }) {
  return <div className="space-y-1"><Label htmlFor={name} className="text-xs">{label}</Label><Input id={name} name={name} type="number" min="0" step="0.01" defaultValue={value} className="h-8" /></div>
}

function CandidateRow({ candidate, decision, settings }: { candidate: ClearanceCandidate; decision?: ClearanceDecision; settings: ClearanceSettings }) {
  const [state, action, pending] = useActionState(saveClearanceDecision, null)
  const formId = `clearance-${candidate.sku}`
  const isReady = candidate.dataStatus === 'ready'
  const defaultPrice = decision?.proposedPrice ?? candidate.suggestedPrice ?? candidate.basePrice
  useEffect(() => { if (state?.success) toast.success(state.message); if (state?.error) toast.error(state.error) }, [state])
  return <tr className={isReady ? 'hover:bg-muted/30' : 'bg-amber-50/35 hover:bg-amber-50/60'}>
    <td className="px-4 py-3 align-top"><div className="max-w-[245px]"><p className="line-clamp-2 font-medium leading-5">{candidate.productName}</p><p className="mt-1 font-mono text-xs text-muted-foreground">{candidate.sku}</p><p className={`mt-2 inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${isReady ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'}`}>{isReady ? '판정 가능' : candidate.dataStatus === 'incoming_missing' ? '입고 이력 확인' : '현재가 확인'}</p><p className="mt-2 text-xs leading-5 text-muted-foreground">{candidate.reason}</p></div></td>
    <td className="px-3 py-3 align-top tabular-nums">{candidate.currentStock.toLocaleString('ko-KR')}개</td>
    <td className="px-3 py-3 align-top tabular-nums">{candidate.daysSinceIncoming == null ? '-' : `${candidate.daysSinceIncoming}일`}</td>
    <td className="px-3 py-3 align-top tabular-nums">{candidate.soldSinceIncoming.toLocaleString('ko-KR')}개</td>
    <td className="px-3 py-3 align-top font-medium tabular-nums">{candidate.basePrice == null ? <span className="text-muted-foreground">미등록</span> : currency.format(candidate.basePrice)}</td>
    <td className="px-3 py-3 align-top tabular-nums">{candidate.minimumPrice == null ? <span className="text-muted-foreground">원가 확인</span> : currency.format(candidate.minimumPrice)}</td>
    <td className="px-3 py-3 align-top"><Input form={formId} name="proposed_price" type="number" min="1" disabled={!isReady} defaultValue={defaultPrice ?? ''} placeholder="직접 입력" className="h-8 min-w-0" /><Input form={formId} name="discount_percent" type="number" min="0" max="100" step="0.1" disabled={!isReady} defaultValue={decision?.discountPercent ?? settings.defaultDiscountPercent} className="mt-2 h-8 min-w-0" aria-label="할인율" /></td>
    <td className="px-3 py-3 align-top"><select form={formId} name="action_type" defaultValue={decision?.actionType ?? 'price_drop'} className="h-8 w-full rounded-md border bg-background px-2 text-xs" disabled={!isReady}><option value="price_drop">가격 인하</option><option value="bundle">묶음 구성</option><option value="gift">사은품</option><option value="review">수동 검토</option></select></td>
    <td className="px-3 py-3 align-top"><select form={formId} name="status" defaultValue={decision?.status ?? 'candidate'} className="h-8 w-full rounded-md border bg-background px-2 text-xs"><option value="candidate">검토중</option><option value="approved">실행 대기</option><option value="dismissed">제외</option></select></td>
    <td className="px-3 py-3 align-top"><form id={formId} action={action}><input type="hidden" name="sku" value={candidate.sku} /><input type="hidden" name="note" value="" /><Button type="submit" size="sm" variant="outline" disabled={pending}>{pending ? '...' : '저장'}</Button></form></td>
  </tr>
}
