'use client'

import { useEffect, useState } from 'react'
import { useQueryStates, parseAsString, parseAsInteger } from 'nuqs'
import { Pagination } from '@/components/ui/pagination'

const MARKETPLACE_LABELS: Record<string, string> = {
  coupang: '쿠팡',
  naver: '네이버',
  gmarket: 'G마켓',
  auction: '옥션',
  '11st': '11번가',
  cafe24: 'Cafe24',
  ohouse: '오늘의집',
  kakao: '카카오',
  ably: '에이블리',
  ssgmall: 'SSG몰',
}

interface CategoryRow {
  marketplaceId: string
  categoryId: string
  categoryName: string | null
  productCount: number
}

export default function MarketplaceCategoriesPage() {
  const [categories, setCategories] = useState<CategoryRow[]>([])
  const [loading, setLoading] = useState(false)
  const [searchInput, setSearchInput] = useState('')

  // 탭 전환 후 복원되도록 URL 쿼리스트링에 저장 (탭바가 마지막 URL 기억).
  const [filters, setFilters] = useQueryStates({
    market: parseAsString.withDefault('all'),
    q: parseAsString.withDefault(''),
    page: parseAsInteger.withDefault(1),
    pageSize: parseAsInteger.withDefault(25),
    // 검색 트리거 sentinel — 이게 켜져야 fetch 한다.
    searched: parseAsString,
  })
  const selectedMarket = filters.market
  const search = filters.q
  const page = filters.page
  const pageSize = filters.pageSize
  const searched = !!filters.searched

  useEffect(() => { setSearchInput(search) }, [search])

  // searched 가 켜졌을 때만 fetch.
  useEffect(() => {
    if (!searched) {
      setCategories([])
      return
    }
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const res = await fetch('/api/products/marketplace-categories/list')
        const data = await res.json()
        if (!cancelled) setCategories(data.categories ?? [])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [searched])

  const submitSearch = () => {
    void setFilters({ q: searchInput, page: 1, searched: '1' })
  }

  const allMarkets = Array.from(new Set(categories.map((c) => c.marketplaceId))).sort()

  const filtered = categories.filter((c) => {
    if (selectedMarket !== 'all' && c.marketplaceId !== selectedMarket) return false
    if (search) {
      const q = search.toLowerCase()
      if (!c.categoryId.toLowerCase().includes(q) && !(c.categoryName?.toLowerCase().includes(q))) return false
    }
    return true
  })

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const paged = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">마켓 카테고리 매핑</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          엑셀 업로드로 수집된 마켓별 카테고리 목록입니다. 중복 없이 고유 카테고리만 표시되며,
          각 카테고리에 연결된 상품 수를 확인할 수 있습니다.
        </p>
      </div>

      {/* Filters — manual submit, 검색 버튼 누르기 전엔 fetch 안 함 */}
      <form
        onSubmit={(e) => { e.preventDefault(); submitSearch() }}
        className="flex flex-wrap items-center gap-2"
      >
        <select
          value={selectedMarket}
          onChange={(e) => void setFilters({ market: e.target.value, page: 1 })}
          className="rounded-md border px-3 py-1.5 text-sm"
        >
          <option value="all">전체 마켓</option>
          {allMarkets.map((m) => (
            <option key={m} value={m}>{MARKETPLACE_LABELS[m] ?? m}</option>
          ))}
        </select>

        <input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="카테고리 ID 또는 이름 검색"
          className="flex-1 max-w-[400px] rounded-md border px-3 py-1.5 text-sm"
        />
        <button
          type="submit"
          className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          검색
        </button>
      </form>

      {!searched ? (
        <div className="rounded-lg border border-dashed py-16 text-center text-sm text-muted-foreground">
          검색 조건을 입력하고 <span className="font-medium text-foreground">검색</span> 버튼을 눌러주세요.
        </div>
      ) : loading ? (
        <div className="py-10 text-center text-sm text-muted-foreground">불러오는 중...</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
          수집된 카테고리가 없습니다. 매핑관리 페이지에서 마켓 엑셀을 업로드하세요.
        </div>
      ) : (
        <div className="space-y-3">
          <div className="text-xs text-muted-foreground">
            총 {filtered.length.toLocaleString('ko-KR')}개 고유 카테고리
          </div>

          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium">마켓</th>
                  <th className="px-4 py-2.5 text-left font-medium">카테고리 ID</th>
                  <th className="px-4 py-2.5 text-left font-medium">카테고리 이름</th>
                  <th className="px-4 py-2.5 text-right font-medium">상품수</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {paged.map((c) => (
                  <tr key={`${c.marketplaceId}:${c.categoryId}`} className="hover:bg-muted/30">
                    <td className="px-4 py-2.5">
                      <span className="inline-block rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium">
                        {MARKETPLACE_LABELS[c.marketplaceId] ?? c.marketplaceId}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs">
                      {c.categoryId}
                    </td>
                    <td className="px-4 py-2.5">
                      {c.categoryName ? (
                        <span>{c.categoryName}</span>
                      ) : (
                        <span className="text-muted-foreground">이름 없음</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {c.productCount.toLocaleString('ko-KR')}개
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination
              page={currentPage}
              pageSize={pageSize}
              total={filtered.length}
              onPageChange={(p) => void setFilters({ page: p })}
              onPageSizeChange={(s) => void setFilters({ pageSize: s, page: 1 })}
            />
          </div>
        </div>
      )}
    </div>
  )
}
