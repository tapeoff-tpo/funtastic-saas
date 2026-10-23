function Placeholder({ className }: { className: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded bg-muted ${className}`} />
}

export default function AuthLoading() {
  return (
    <div aria-busy="true" aria-live="polite" className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-2">
          <Placeholder className="h-6 w-36" />
          <Placeholder className="h-4 w-56" />
        </div>
        <Placeholder className="h-9 w-24" />
      </div>

      <section className="overflow-hidden rounded-lg border bg-card">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <Placeholder className="h-5 w-28" />
          <Placeholder className="h-8 w-36" />
        </div>
        <div className="divide-y">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)] items-center gap-4 px-4 py-4">
              <Placeholder className="h-4 w-3/4" />
              <Placeholder className="h-4 w-2/3" />
              <Placeholder className="h-4 w-1/2 justify-self-end" />
            </div>
          ))}
        </div>
      </section>
      <span className="sr-only">화면을 불러오는 중입니다.</span>
    </div>
  )
}
