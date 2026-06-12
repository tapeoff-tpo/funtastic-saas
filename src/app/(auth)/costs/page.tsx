export default function CostsPage() {
  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">원가</h1>
        <p className="text-sm text-muted-foreground">
          상품 원가와 발주 기준 원가를 관리하는 메뉴입니다.
        </p>
      </header>

      <section className="rounded-lg border bg-background p-6">
        <div className="space-y-2">
          <h2 className="text-base font-semibold">원가 관리 준비 중</h2>
          <p className="text-sm text-muted-foreground">
            현재 상품별 원가는 상품 관리와 재고관리 화면에 등록된 값을 기준으로 사용합니다.
          </p>
        </div>
      </section>
    </div>
  )
}
