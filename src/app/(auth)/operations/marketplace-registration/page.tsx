import { redirect } from 'next/navigation'
import { ClipboardPenLine } from 'lucide-react'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getCurrentUser } from '@/lib/auth/current-user'
import { listMarketplaceRegistrationProducts } from '@/lib/operations/marketplace-registration'
import { applyRegistrationAction } from './actions'

export const dynamic = 'force-dynamic'

export default async function MarketplaceRegistrationPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const rows = await listMarketplaceRegistrationProducts(await getWorkspaceUserId(user.id))

  return (
    <div className="space-y-4">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <ClipboardPenLine className="size-6" />
          상품 등록 관리
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          네이버 카테고리를 기본으로 잡고, 쿠팡·스마트스토어·토스 등록값에 우선 적용합니다. Cloudflare 이미지 URL을 그대로 등록용 자산으로 사용합니다.
        </p>
      </header>
      <div className="overflow-auto rounded-md border bg-card">
        <table className="w-full min-w-[1200px] text-sm">
          <thead className="bg-muted text-left text-xs text-muted-foreground">
            <tr><th className="p-3">판매코드</th><th className="p-3">상품</th><th className="p-3">재고</th><th className="p-3">등록 정보</th></tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.productCode} className="border-t align-top">
                <td className="p-3 font-mono text-xs">{row.productCode}</td>
                <td className="max-w-[260px] p-3">{row.productName}</td>
                <td className="p-3 tabular-nums">{row.stock}</td>
                <td className="p-2">
                  <form action={applyRegistrationAction} className="grid grid-cols-[minmax(180px,1fr)_120px_250px_80px] gap-2">
                    <input type="hidden" name="productCode" value={row.productCode} />
                    <input name="commonCategory" defaultValue={row.commonCategory ?? ''} placeholder="네이버 기본 카테고리" className="h-9 rounded-md border bg-background px-2" />
                    <input name="brand" defaultValue={row.brand ?? ''} placeholder="브랜드" className="h-9 rounded-md border bg-background px-2" />
                    <div className="grid grid-cols-2 gap-2">
                      <input name="manufacturer" defaultValue={row.manufacturer ?? ''} placeholder="제조사" className="h-9 rounded-md border bg-background px-2" />
                      <input name="countryOfOrigin" defaultValue={row.countryOfOrigin ?? ''} placeholder="원산지" className="h-9 rounded-md border bg-background px-2" />
                    </div>
                    <button className="h-9 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground">적용</button>
                    <input name="sourceProductUrl" defaultValue={row.sourceProductUrl ?? ''} placeholder="펀타스틱 B2B 상품 URL" className="col-span-2 h-9 rounded-md border bg-background px-2" />
                    <input name="primaryImageUrl" defaultValue={row.primaryImageUrl ?? ''} placeholder="Cloudflare 대표 이미지 URL" className="col-span-2 h-9 rounded-md border bg-background px-2" />
                    <textarea name="detailImageUrls" defaultValue={row.imageUrls.join('\n')} placeholder="Cloudflare 상세 이미지 URL (한 줄에 하나씩)" className="col-span-2 min-h-20 rounded-md border bg-background px-2 py-2" />
                  </form>
                  {row.commonCategory ? <p className="mt-1 text-xs text-emerald-700">쿠팡 · 스마트스토어 · 토스 등록값 준비됨</p> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
