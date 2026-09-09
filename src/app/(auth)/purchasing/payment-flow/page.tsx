import Link from 'next/link'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getLatestCnyKrwReferenceRate } from '@/lib/new-products/cny-cost'
import { getPurchasePaymentFlowSummary } from '@/lib/purchasing/purchase-requests'
import { ProductFlowNav } from '@/components/product-flow-nav'
import { PurchasePaymentFlowSummaryPanel } from './purchase-payment-flow-summary'

export const metadata: Metadata = {
  title: '발주금액',
}

export default async function PurchasePaymentFlowPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const workspaceUserId = await getWorkspaceUserId(user.id)
  const exchangeRateReference = await getLatestCnyKrwReferenceRate()
  const summary = await getPurchasePaymentFlowSummary(workspaceUserId, exchangeRateReference.rate)

  return (
    <div className="space-y-5">
      <ProductFlowNav />
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">발주금액</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            현재 진행 중인 발주 금액과 결제 현황, 미결제 잔액을 확인합니다.
          </p>
        </div>
        <Link
          href="/purchasing/orders"
          className="inline-flex h-8 items-center justify-center rounded-md border border-border bg-background px-3 text-sm font-medium hover:bg-muted"
        >
          발주 목록 보기
        </Link>
      </header>

      <PurchasePaymentFlowSummaryPanel
        summary={summary}
        exchangeRateReference={exchangeRateReference}
      />
    </div>
  )
}
