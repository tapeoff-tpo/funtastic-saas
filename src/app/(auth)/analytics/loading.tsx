export default function AnalyticsLoading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="매출분석 불러오는 중">
      <div className="space-y-2">
        <div className="h-7 w-28 animate-pulse rounded bg-muted" />
        <div className="h-4 w-56 animate-pulse rounded bg-muted" />
      </div>
      <div className="h-11 w-full animate-pulse rounded-lg border bg-muted/50" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="h-28 animate-pulse rounded-lg border bg-muted/50" />
        ))}
      </div>
      <div className="h-[360px] animate-pulse rounded-lg border bg-muted/40" />
    </div>
  )
}
