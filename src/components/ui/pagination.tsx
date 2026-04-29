'use client'

/**
 * 페이지당 조회건수 선택 + 총 건수 표시.
 *
 * Pagination 컴포넌트와 분리되어 있어 테이블 위/아래 어디서든 재사용 가능.
 * `<Pagination hidePageSize />` 와 함께 쓰면 위에 selector, 아래에 페이지 nav 분리 배치.
 */
export function PageSizeSelector({
  pageSize,
  total,
  onPageSizeChange,
  onPageChange,
  pageSizeOptions = [25, 50, 100, 200, 500, 1000],
  className = '',
}: {
  pageSize: number
  total: number
  onPageSizeChange: (s: number) => void
  /** 선택 변경 시 1 페이지로 리셋 — Pagination 과 일관성 유지 */
  onPageChange?: (p: number) => void
  pageSizeOptions?: number[]
  className?: string
}) {
  return (
    <div className={`flex items-center gap-2 text-sm text-muted-foreground ${className}`}>
      <span>페이지당</span>
      <select
        value={pageSize}
        onChange={(e) => {
          onPageSizeChange(Number(e.target.value))
          onPageChange?.(1)
        }}
        className="rounded border px-2 py-1"
      >
        {pageSizeOptions.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
      <span>건</span>
      <span className="ml-2">총 {total.toLocaleString('ko-KR')}건</span>
    </div>
  )
}

/**
 * 공용 페이지네이션 — 최대 10개 페이지 번호 + 화살표로 다음 그룹 이동
 * 페이지당 10/20/50/100 선택 (`hidePageSize` 로 숨길 수 있음)
 */
export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 20, 50, 100],
  hidePageSize = false,
}: {
  page: number
  pageSize: number
  total: number
  onPageChange: (p: number) => void
  onPageSizeChange: (s: number) => void
  pageSizeOptions?: number[]
  /** 페이지당 selector 를 숨김 — 상단에 별도 PageSizeSelector 를 배치할 때 사용 */
  hidePageSize?: boolean
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
    <div className={`flex items-center gap-4 py-2 text-sm ${hidePageSize ? 'justify-end' : 'justify-between'}`}>
      {!hidePageSize && (
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
      )}

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onPageChange(Math.max(1, windowStart - 1))}
          disabled={!hasPrev}
          className="cursor-pointer rounded border px-2 py-1 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-30"
          aria-label="이전 10페이지"
        >
          ‹
        </button>
        {pages.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onPageChange(p)}
            className={`min-w-[32px] cursor-pointer rounded border px-2 py-1 ${
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
          className="cursor-pointer rounded border px-2 py-1 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-30"
          aria-label="다음 10페이지"
        >
          ›
        </button>
      </div>
    </div>
  )
}
