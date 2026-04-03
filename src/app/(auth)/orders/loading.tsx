export default function OrdersLoading() {
  return (
    <div className="space-y-6">
      {/* Header skeleton */}
      <div>
        <div className="h-8 w-32 animate-pulse rounded bg-muted" />
        <div className="mt-2 h-4 w-48 animate-pulse rounded bg-muted" />
      </div>

      {/* Filters skeleton */}
      <div className="flex flex-wrap gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-9 w-36 animate-pulse rounded-md bg-muted" />
        ))}
      </div>

      {/* Table skeleton */}
      <div className="overflow-hidden rounded-md border">
        {/* Header row */}
        <div className="flex gap-4 border-b bg-muted/50 px-3 py-3">
          {Array.from({ length: 7 }).map((_, i) => (
            <div
              key={i}
              className="h-4 animate-pulse rounded bg-muted"
              style={{ width: `${[40, 150, 80, 200, 80, 100, 120, 80][i]}px` }}
            />
          ))}
        </div>
        {/* Data rows */}
        {Array.from({ length: 10 }).map((_, rowIdx) => (
          <div
            key={rowIdx}
            className="flex gap-4 border-b px-3 py-3"
          >
            {Array.from({ length: 7 }).map((_, colIdx) => (
              <div
                key={colIdx}
                className="h-4 animate-pulse rounded bg-muted/70"
                style={{ width: `${[40, 150, 80, 200, 80, 100, 120, 80][colIdx]}px` }}
              />
            ))}
          </div>
        ))}
      </div>

      {/* Pagination skeleton */}
      <div className="flex items-center justify-between">
        <div className="h-4 w-32 animate-pulse rounded bg-muted" />
        <div className="flex gap-2">
          <div className="h-8 w-16 animate-pulse rounded bg-muted" />
          <div className="h-8 w-20 animate-pulse rounded bg-muted" />
          <div className="h-8 w-16 animate-pulse rounded bg-muted" />
        </div>
      </div>
    </div>
  )
}
