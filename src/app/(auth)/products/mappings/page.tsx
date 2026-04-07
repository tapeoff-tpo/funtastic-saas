import type { Metadata } from 'next'
import { MappingManager } from './mapping-manager'

export const metadata: Metadata = {
  title: '상품명 매핑',
}

export default function MappingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">상품명 매핑</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          각 마켓의 상품명을 내부 상품명(송장 출력용)으로 매핑합니다.
          주문 수집 후 아래 미매핑 목록에서 빠르게 등록하세요.
        </p>
      </div>
      <MappingManager />
    </div>
  )
}
