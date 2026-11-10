import { redirect } from 'next/navigation'
import { PanelsTopLeft } from 'lucide-react'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getNewProductItem } from '@/lib/new-products/workflow'
import { getUserMenuAccess } from '@/lib/auth/menu-access'
import { canAccessPage } from '@/lib/auth/menu-permissions'
import { DetailUpload } from '@/components/product-linking/detail-upload'
import { getCurrentUser } from '@/lib/auth/current-user'
import { DetailPageWorkbench } from './detail-page-workbench'

export const dynamic = 'force-dynamic'

export default async function DetailPagesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const params = await searchParams
  const workflowId = single(params.workflowItem)
  const access = workflowId ? await getUserMenuAccess(user.id) : null
  const linkedItem = access && canAccessPage(access, '/new-products') && /^[0-9a-f-]{36}$/i.test(workflowId)
    ? await getNewProductItem({ userId: await getWorkspaceUserId(user.id), itemId: workflowId })
    : null
  const selectedProduct = linkedItem ? {
    id: linkedItem.id,
    sku: linkedItem.sabangnetCode ?? '',
    name: linkedItem.registeredProductName || linkedItem.productName,
    option: linkedItem.productOption ?? '',
    purchaseUrl: linkedItem.sourceUrl ?? '',
    material: linkedItem.noticeMaterial ?? '',
    size: linkedItem.noticeSize ?? '',
    manufacturer: linkedItem.noticeManufacturer ?? '',
    weight: linkedItem.noticeWeight ?? '',
    country: linkedItem.noticeCountry ?? '',
    capacity: linkedItem.noticeCapacity ?? '',
  } : {
    id: single(params.itemId),
    sku: single(params.sku),
    name: single(params.name),
    option: single(params.option),
    purchaseUrl: single(params.purchaseUrl),
    material: single(params.material),
    size: single(params.size),
    manufacturer: single(params.manufacturer),
    weight: single(params.weight),
    country: single(params.country),
    capacity: single(params.capacity),
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold"><PanelsTopLeft className="size-5" />상세페이지 제작</h1>
        </div>
      </header>
      {linkedItem && <DetailUpload itemId={linkedItem.id} />}
      <DetailPageWorkbench selectedProducts={selectedProduct.id && selectedProduct.sku ? [selectedProduct] : []} />
    </div>
  )
}

function single(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
}
