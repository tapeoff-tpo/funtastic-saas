import { redirect } from 'next/navigation'
import { PanelsTopLeft } from 'lucide-react'
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
  const selectedProduct = {
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
      <DetailPageWorkbench selectedProducts={selectedProduct.id && selectedProduct.sku ? [selectedProduct] : []} />
    </div>
  )
}

function single(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
}
