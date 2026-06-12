type PurchasingPlaceholderPageProps = {
  title: string
  description: string
}

export function PurchasingPlaceholderPage({
  title,
  description,
}: PurchasingPlaceholderPageProps) {
  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </header>

      <section className="rounded-lg border bg-background p-6">
        <div className="space-y-2">
          <h2 className="text-base font-semibold">메뉴 준비 중</h2>
          <p className="text-sm text-muted-foreground">
            이 화면은 발주 업무 흐름에 맞춰 세부 기능을 추가할 수 있도록 생성해두었습니다.
          </p>
        </div>
      </section>
    </div>
  )
}
