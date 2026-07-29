'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Boxes, CircleDollarSign, ExternalLink, Store } from 'lucide-react'
import type { ProductOperationsSummary } from '@/lib/products/operations-summary'

export function ProductOperationsOverview({ productId }: { productId: string }) {
  const [summary, setSummary] = useState<ProductOperationsSummary | null>(null)

  useEffect(() => {
    let cancelled = false
    void import('@/lib/products/ui-actions').then(({ getProductOperationsSummaryAction }) => (
      getProductOperationsSummaryAction(productId)
    )).then((data) => {
      if (!cancelled) setSummary(data)
    })
    return () => { cancelled = true }
  }, [productId])

  if (!summary) return <div className="h-24 animate-pulse rounded-md border bg-muted/20" />

  return (
    <section className="overflow-hidden rounded-md border bg-card">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">운영 요약</h2>
          <p className="mt-0.5 font-mono text-xs text-muted-foreground">{summary.sku}</p>
        </div>
        <span className="text-xs text-muted-foreground">원가 · 재고 · 판매가 · 등록 몰</span>
      </div>
      <div className="grid divide-y sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <OverviewLink href={`/products?search=${encodeURIComponent(summary.sku)}&searched=1`} icon={<CircleDollarSign className="size-4" />} label="원가" value={money(summary.worksCost)} detail="Works 신규 원가 우선" />
        <OverviewLink href={`/inventory?search=${encodeURIComponent(summary.sku)}&searched=1&focusSku=${encodeURIComponent(summary.sku)}`} icon={<Boxes className="size-4" />} label="실재고" value={`${summary.availableStock.toLocaleString('ko-KR')}개`} detail={summary.warehouseStock.map((item) => `${item.warehouse} ${item.quantity}`).join(' · ') || '재고 미등록'} />
        <OverviewLink href={`/analytics/price-table?q=${encodeURIComponent(summary.sku)}&view=products`} icon={<Store className="size-4" />} label="등록 몰" value={`${summary.marketplaces.length}개`} detail="판매가 테이블 기준" />
      </div>
      <div className="grid gap-px border-t bg-border lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="bg-card px-4 py-3">
          <p className="mb-2 text-xs font-medium text-muted-foreground">최근 입출고</p>
          {summary.recentHistory.length ? <div className="space-y-1.5 text-xs">{summary.recentHistory.map((item) => <div key={`${item.createdAt}-${item.reason}`} className="flex justify-between gap-3"><span className="truncate text-muted-foreground">{item.reason}{item.note ? ` · ${item.note}` : ''}</span><span className={item.delta >= 0 ? 'font-medium text-emerald-700' : 'font-medium text-red-600'}>{item.delta >= 0 ? '+' : ''}{item.delta}</span></div>)}</div> : <p className="text-xs text-muted-foreground">입출고 이력이 없습니다.</p>}
        </div>
        <div className="bg-card px-4 py-3">
          <p className="mb-2 text-xs font-medium text-muted-foreground">판매가 테이블 등록</p>
          {summary.marketplaces.length ? <div className="flex flex-wrap gap-1.5">{summary.marketplaces.slice(0, 8).map((item) => <span key={`${item.marketplace}-${item.productId ?? item.price}`} className="rounded bg-muted px-2 py-1 text-xs"><b>{item.marketplace}</b>{item.price ? ` ${moneyText(item.price)}` : ''}</span>)}{summary.marketplaces.length > 8 ? <span className="px-1 py-1 text-xs text-muted-foreground">+{summary.marketplaces.length - 8}</span> : null}</div> : <p className="text-xs text-muted-foreground">판매가 테이블 등록 정보가 없습니다.</p>}
        </div>
      </div>
    </section>
  )
}

function OverviewLink({ href, icon, label, value, detail }: { href: string; icon: React.ReactNode; label: string; value: string; detail: string }) {
  return <Link href={href} className="group px-4 py-3 hover:bg-muted/40"><div className="flex items-center gap-1.5 text-xs text-muted-foreground">{icon}{label}<ExternalLink className="ml-auto size-3 opacity-0 transition-opacity group-hover:opacity-100" /></div><div className="mt-1 text-lg font-semibold tabular-nums">{value}</div><div className="mt-0.5 truncate text-xs text-muted-foreground">{detail}</div></Link>
}

function money(value: number | null) { return value == null ? '미등록' : `${Math.round(value).toLocaleString('ko-KR')}원` }
function moneyText(value: string) { const parsed = Number(value.replace(/,/g, '')); return Number.isFinite(parsed) ? `${parsed.toLocaleString('ko-KR')}원` : value }
