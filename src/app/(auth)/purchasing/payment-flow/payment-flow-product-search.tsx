'use client'

import { useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { LoaderCircle, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { PurchasePaymentFlowSort, PurchasePaymentFlowView } from '@/lib/purchasing/purchase-requests'

export function PaymentFlowProductSearch({
  view,
  search,
  pageSize,
  sort,
  order,
}: {
  view: PurchasePaymentFlowView
  search: string
  pageSize: number
  sort: PurchasePaymentFlowSort | null
  order: 'asc' | 'desc'
}) {
  const router = useRouter()
  const [query, setQuery] = useState(search)
  const [isPending, startTransition] = useTransition()

  function navigate(targetView: PurchasePaymentFlowView, term = query) {
    const params = new URLSearchParams({ view: targetView })
    const normalized = term.trim().slice(0, 120)
    if (normalized) params.set('search', normalized)
    if (pageSize !== 50) params.set('pageSize', String(pageSize))
    if (sort) {
      params.set('sort', sort)
      params.set('order', order)
    }

    startTransition(() => {
      router.push(`/purchasing/payment-flow?${params.toString()}`, { scroll: false })
    })
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    navigate(view)
  }

  return (
    <div className="border-b bg-muted/20 px-3 py-3">
      <form onSubmit={submit} role="search" aria-label="발주 상품 검색" className="flex flex-wrap items-center gap-2">
        <label htmlFor="payment-flow-product-search" className="sr-only">상품 검색</label>
        <Input
          id="payment-flow-product-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="상품명 · 품목코드 · 옵션명 검색"
          maxLength={120}
          className="min-w-[220px] flex-1"
        />
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? <LoaderCircle className="animate-spin" /> : <Search />}
          {view === 'total' ? '검색' : '현재 항목 검색'}
        </Button>
        {view !== 'total' ? (
          <Button type="button" size="sm" variant="outline" onClick={() => navigate('total')} disabled={isPending}>
            전체 검색
          </Button>
        ) : null}
        {search ? (
          <Button type="button" size="sm" variant="ghost" onClick={() => { setQuery(''); navigate(view, '') }} disabled={isPending}>
            <X />
            검색 지우기
          </Button>
        ) : null}
      </form>
      <p className="mt-1.5 text-xs text-muted-foreground">
        상품명·품목코드·옵션명·구입관리코드·주문서번호로 검색합니다. 대량결제 지정은 현재 검색 결과 화면에서 체크한 상품에만 적용됩니다.
      </p>
    </div>
  )
}
