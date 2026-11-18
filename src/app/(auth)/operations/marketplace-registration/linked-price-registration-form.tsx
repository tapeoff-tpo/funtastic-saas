'use client'

import { useRouter } from 'next/navigation'
import { useFormStatus } from 'react-dom'
import { useState } from 'react'
import { toast } from 'sonner'
import { saveLinkedPriceRegistration } from '../../analytics/price-table/price-registration-actions'
import { priceRegistrationHref, type PriceTableNavigation } from '../../analytics/price-table/price-table-navigation'
import { priceAmount, type getRegistrationMargin } from '@/lib/analytics/price-registration-values'

export function LinkedPriceRegistrationForm({ rowId, updatedAt, navigation, mall, targets, commonPrice, number, amounts, fee, defaultShipping }: {
  rowId: string
  updatedAt: string
  navigation: PriceTableNavigation
  mall: string
  targets: Array<{ id: string; label: string }>
  commonPrice: number | null
  number?: string
  amounts: ReturnType<typeof getRegistrationMargin>
  fee?: number
  defaultShipping?: number | null
}) {
  const router = useRouter()
  const [common, setCommon] = useState(String(commonPrice ?? ''))
  const [override, setOverride] = useState(String(amounts.override ?? ''))
  const [shipping, setShipping] = useState(String(amounts.shipping ?? ''))
  const applied = priceAmount(override) ?? priceAmount(common)
  const appliedShipping = priceAmount(shipping) ?? defaultShipping
  const margin = applied !== null && amounts.cost !== null && fee !== undefined
    ? Math.round(applied * (1 - fee / 100) - amounts.cost) - (appliedShipping ?? 0)
    : null
  return (
    <form action={async (form) => {
      try {
        await saveLinkedPriceRegistration(form)
        toast.success('상품등록 정보를 저장했습니다.')
        router.refresh()
      } catch {
        toast.error('저장하지 못했습니다. 입력값과 메뉴 권한을 확인해주세요.')
      }
    }} className="space-y-4 rounded-md border bg-card p-4">
      <input type="hidden" name="rowId" value={rowId} />
      <input type="hidden" name="mall" value={mall} />
      <input type="hidden" name="updatedAt" value={updatedAt} />
      <input type="hidden" name="view" value={navigation.view} />
      <input type="hidden" name="search" value={navigation.search} />
      <input type="hidden" name="malls" value={navigation.malls?.join(',')} />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">대상 몰
          <select className="rounded border bg-background p-2" value={mall} onChange={(event) =>
            router.push(priceRegistrationHref(rowId, event.target.value, navigation))
          }>
            {targets.map((target) => <option key={target.id} value={target.id}>{target.label}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm">상품등록번호
          <input name="number" className="rounded border bg-background p-2" maxLength={200} defaultValue={number} />
        </label>
        <label className="grid gap-1 text-sm">B2B·B2C 공통 판매가
          <input name="commonPrice" inputMode="decimal" pattern="([0-9]{1,10}([.][0-9]{1,2})?)?" value={common} onChange={(e) => setCommon(e.target.value)} className="rounded border bg-background p-2" />
        </label>
        <label className="grid gap-1 text-sm">이 몰의 예외 가격
          <input name="override" inputMode="decimal" pattern="([0-9]{1,10}([.][0-9]{1,2})?)?" value={override} onChange={(e) => setOverride(e.target.value)} placeholder="비워두면 공통 판매가 적용" className="rounded border bg-background p-2" />
        </label>
        <label className="grid gap-1 text-sm">우리 부담 배송비
          <input name="shipping" inputMode="decimal" pattern="([0-9]{1,10}([.][0-9]{1,2})?)?" value={shipping} placeholder={defaultShipping == null ? undefined : `품목 배송비 ${defaultShipping.toLocaleString('ko-KR')}원`} onChange={(e) => setShipping(e.target.value)} className="rounded border bg-background p-2" />
        </label>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <span>적용 가격 {applied === null ? '미설정' : `${applied.toLocaleString('ko-KR')}원`}</span>
        <span>수수료 {fee === undefined ? '미설정' : `${fee}%`}</span>
        <span>원가 {amounts.cost === null ? '미입력' : `${amounts.cost.toLocaleString('ko-KR')}원`}</span>
        {margin !== null && <span className={margin <= 0 ? 'font-medium text-red-600' : ''}>
          {margin < 0 ? '예상 적자' : margin === 0 ? '마진 없음' : '예상 마진'} {margin.toLocaleString('ko-KR')}원{appliedShipping == null ? ' (배송비 제외)' : ''}
        </span>}
      </div>
      <SaveButton />
    </form>
  )
}


function SaveButton() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending} className="rounded bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50">
      {pending ? '저장 중…' : '판매가 테이블에 저장'}
    </button>
  )
}
