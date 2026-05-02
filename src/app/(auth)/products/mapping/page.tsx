/**
 * 매핑관리 — 주문 수집상품을 재고관리코드 구성으로 연결.
 *
 * 상단 dense 필터 + 툴바 + 2그룹 헤더 테이블. 행 단위로 [+ 품번매핑]/[+ 단품매핑] 인라인 매핑.
 */
import Link from 'next/link'
import { OrderRowsBoard } from './order-rows-board'

export default function MappingPage() {
  return (
    <div className="space-y-3">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">매핑관리</h1>
        <p className="text-sm text-muted-foreground">
          신규 주문의 미매핑 상품을 재고관리코드와 수량으로 연결합니다. 세트상품은 재고관리코드를 여러 개 추가하세요.
          기존 매핑 전체 관리는{' '}
          <Link href="/products/mapping-codes" className="underline">재고 매핑 목록</Link> 에서 볼 수 있습니다.
        </p>
      </header>
      <OrderRowsBoard />
    </div>
  )
}
