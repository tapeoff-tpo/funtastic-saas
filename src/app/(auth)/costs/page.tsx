import { ProductCostUpload } from '@/components/product-cost-upload'

export default function CostsPage() {
  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">원가</h1>
        <p className="text-sm text-muted-foreground">
          상품 원가와 발주 기준 원가를 관리하는 메뉴입니다.
        </p>
      </header>

      <ProductCostUpload />
    </div>
  )
}
