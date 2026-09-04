import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { ProductFlowNav } from '@/components/product-flow-nav'
import { db } from '@/lib/db'
import { inventory } from '@/lib/db/schema'
import { eq, max } from 'drizzle-orm'
import { getStoredEcountRawFileState } from '@/lib/purchasing/ecount-raw-files'
import { getPurchasingDataFreshness } from '@/lib/purchasing/data-freshness'
import { getStoredDiscontinuedProductRawFile } from '@/lib/purchasing/discontinued-products'
import { PurchasingRawDataUpload } from './raw-data-upload'

export const metadata: Metadata = { title: '발주 로우데이터' }

export default async function PurchasingRawDataPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const workspaceUserId = await getWorkspaceUserId(user.id)
  const [[inventoryState], storedEcountFiles, storedDiscontinuedFile, dataFreshness] = await Promise.all([
    db.select({ lastUpdatedAt: max(inventory.updatedAt) }).from(inventory).where(eq(inventory.userId, workspaceUserId)),
    getStoredEcountRawFileState(workspaceUserId),
    getStoredDiscontinuedProductRawFile(workspaceUserId),
    getPurchasingDataFreshness(workspaceUserId),
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
        <p className="mt-1 text-sm text-muted-foreground">Ecount 원본과 국내재고, 단종상품 파일을 검증한 뒤 발주·중국재고 진행 현황에 반영합니다.</p>
      </header>
      <PurchasingRawDataUpload
        today={today}
        inventoryUpdatedDate={inventoryUpdatedDate}
        initialStoredFiles={{
          ...storedEcountFiles,
          ...(storedDiscontinuedFile ? { discontinuedProducts: storedDiscontinuedFile } : {}),
        }}
        dataFreshness={dataFreshness}
      />
    </div>
  )
}
