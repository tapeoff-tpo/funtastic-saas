import Link from 'next/link'
import type { Metadata } from 'next'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getLatestCnyKrwReferenceRate } from '@/lib/new-products/cny-cost'
import {
  ensurePurchaseFundDebitBackfill,
  getPurchaseFundLedgerData,
} from '@/lib/purchasing/purchase-fund-ledger'
import { PurchaseFundLedgerPanel } from './purchase-fund-ledger-panel'
import { PurchaseOrderRetentionCleanup } from '../purchase-order-retention-cleanup'

export const metadata: Metadata = {
  title: '발주금액',
}

export default async function PurchasePaymentFlowPage() {
  const user = await getCurrentUser()
  if (!user) return null

  const [workspaceUserId, exchangeRateReference] = await Promise.all([
    getWorkspaceUserId(user.id),
    getLatestCnyKrwReferenceRate(),
  ])
  await ensurePurchaseFundDebitBackfill({
    userId: workspaceUserId,
    fallbackExchangeRateKrw: exchangeRateReference.rate,
  })
  const fundLedger = await getPurchaseFundLedgerData(workspaceUserId, 100, exchangeRateReference.rate)

  return (
    <div className="space-y-5">
      <PurchaseOrderRetentionCleanup />
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">발주금액</h1>
        </div>
        <Link
          href="/purchasing/orders"
          className="inline-flex h-8 items-center justify-center rounded-md border border-border bg-background px-3 text-sm font-medium hover:bg-muted"
        >
          발주 목록 보기
        </Link>
      </header>

      <PurchaseFundLedgerPanel data={fundLedger} exchangeRateReference={exchangeRateReference} />
    </div>
  )
}



