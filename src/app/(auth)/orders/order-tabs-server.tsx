import { getOrderStats } from '@/lib/orders/queries'
import { OrderTabs } from './order-tabs'

/**
 * Phase 8 perf — stats 쿼리(5개 병렬 COUNT)는 검색/필터와 무관하게 항상 동일하므로
 * Suspense 로 분리해서 DataTable 렌더를 막지 않게 한다.
 *
 * page.tsx 의 메인 await 체인에서 빠지면 테이블이 즉시 표시되고,
 * 탭 카운트는 도착하는 대로 채워진다.
 */
export async function OrderTabsServer({ userId }: { userId: string }) {
  const stats = await getOrderStats(userId)

  const counts = {
    all: stats.total ?? 0,
    new: stats.new,
    confirmed: stats.confirmed,
    preparing: stats.preparing,
    ready: stats.ready,
    shipped: stats.shipped,
    delivering: stats.delivering,
    delivered: stats.delivered,
    cancelled: stats.cancelTabCount,
    exchange: stats.claimExchange,
    return: stats.claimReturn,
  }

  return <OrderTabs counts={counts} />
}

/**
 * Skeleton — stats 가 도착하기 전까지 표시되는 11개 탭 placeholder.
 * 레이아웃 시프트를 막기 위해 OrderTabs 와 동일한 높이/폭 패턴을 사용한다.
 */
export function OrderTabsSkeleton() {
  const labels = [
    '전체', '신규', '확인', '출고대기', '출고준비', '출고완료',
    '배송중', '배송완료', '취소', '교환', '반품',
  ]
  return (
    <div className="flex flex-wrap gap-1 border-b">
      {labels.map((label) => (
        <div
          key={label}
          className="inline-flex items-center gap-1.5 border-b-2 border-transparent px-4 py-2 text-sm font-medium text-muted-foreground"
        >
          {label}
          <span className="inline-block h-4 w-6 animate-pulse rounded-full bg-muted" />
        </div>
      ))}
    </div>
  )
}
