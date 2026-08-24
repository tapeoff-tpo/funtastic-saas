import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getEcountPurchasingSyncState } from '@/lib/purchasing/ecount-purchasing-sync'
import { ProductFlowNav } from '@/components/product-flow-nav'
import { db } from '@/lib/db'
import { inventory } from '@/lib/db/schema'
import { eq, max } from 'drizzle-orm'
import { PurchasingRawDataUpload } from './raw-data-upload'

export const metadata: Metadata = { title: '발주 로우데이터' }

export default async function PurchasingRawDataPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const workspaceUserId = await getWorkspaceUserId(user.id)
  const [currentState, [inventoryState]] = await Promise.all([
    getEcountPurchasingSyncState(workspaceUserId),
    db.select({ lastUpdatedAt: max(inventory.updatedAt) }).from(inventory).where(eq(inventory.userId, workspaceUserId)),
  ])
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const inventoryUpdatedDate = inventoryState?.lastUpdatedAt
    ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(inventoryState.lastUpdatedAt)
    : today

  return (
    <div className="space-y-4">
      <ProductFlowNav />
      <header>
        <h1 className="text-2xl font-semibold">발주 로우데이터</h1>
        <p className="mt-1 text-sm text-muted-foreground">Ecount 원본 5개 파일을 검증한 뒤 발주·중국재고 진행 현황에 반영합니다.</p>
      </header>
      <PurchasingRawDataUpload initialState={currentState} today={today} inventoryUpdatedDate={inventoryUpdatedDate} />
    </div>
  )
}
