'use client'

/**
 * 공용 페이지네이션 — 최대 10개 페이지 번호 + 화살표로 다음 그룹 이동
 * 페이지당 10/20/50/100 선택
 */
export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 20, 50, 100],
}: {
  page: number
  pageSize: number
  total: number
  onPageChange: (p: number) => void
  onPageSizeChange: (s: number) => void
  pageSizeOptions?: number[]
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const windowSize = 10
  const currentWindow = Math.floor((page - 1) / windowSize)
  const windowStart = currentWindow * windowSize + 1
  const windowEnd = Math.min(windowStart + windowSize - 1, totalPages)
  const hasPrev = windowStart > 1
  const hasNext = windowEnd < totalPages

  const pages: number[] = []
  for (let i = windowStart; i <= windowEnd; i++) pages.push(i)

  return (
    <div className="flex items-center justify-between gap-4 py-2 text-sm">
      <div className="flex items-center gap-2 text-muted-foreground">
        <span>페이지당</span>
        <select
          value={pageSize}
          onChange={(e) => { onPageSizeChange(Number(e.target.value)); onPageChange(1) }}
          className="rounded border px-2 py-1"
        >
          {pageSizeOptions.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <span>건</span>
        <span className="ml-2">총 {total.toLocaleString('ko-KR')}건</span>
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onPageChange(Math.max(1, windowStart - 1))}
          disabled={!hasPrev}
          className="rounded border px-2 py-1 hover:bg-muted disabled:opacity-30"
          aria-label="이전 10페이지"
        >
          ‹
        </button>
        {pages.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onPageChange(p)}
            className={`min-w-[32px] rounded border px-2 py-1 ${
              p === page ? 'bg-black text-white border-black' : 'hover:bg-muted'
            }`}
          >
            {p}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onPageChange(Math.min(totalPages, windowEnd + 1))}
          disabled={!hasNext}
          className="rounded border px-2 py-1 hover:bg-muted disabled:opacity-30"
          aria-label="다음 10페이지"
        >
          ›
        </button>
      </div>
    </div>
  )
}
