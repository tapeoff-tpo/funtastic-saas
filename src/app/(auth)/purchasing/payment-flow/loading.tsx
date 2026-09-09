function Placeholder({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-muted ${className}`} />
}

export default function PurchasePaymentFlowLoading() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="발주금액 불러오는 중">
      <div className="space-y-2">
        <Placeholder className="h-7 w-28" />
        <Placeholder className="h-4 w-80 max-w-full" />
      </div>

      <section className="space-y-4" aria-hidden="true">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="space-y-3 rounded-md border p-3">
              <Placeholder className="h-4 w-24" />
              <Placeholder className="h-6 w-32" />
              <Placeholder className="h-3 w-20" />
            </div>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="space-y-2 rounded-md border p-3">
              <Placeholder className="h-4 w-20" />
              <Placeholder className="h-5 w-28" />
            </div>
          ))}
        </div>
      </section>

      <section className="overflow-hidden rounded-md border bg-background" aria-hidden="true">
        <div className="flex items-center justify-between border-b px-3 py-3">
          <div className="space-y-2">
            <Placeholder className="h-5 w-44" />
            <Placeholder className="h-3 w-28" />
          </div>
          <Placeholder className="h-8 w-40" />
        </div>
        <div className="space-y-3 p-3">
          {Array.from({ length: 8 }, (_, index) => <Placeholder key={index} className="h-9 w-full" />)}
        </div>
      </section>
    </div>
  )
}
