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
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">매핑관리</h1>
        <Link href="/products/mapping-codes" className="text-sm underline">재고 매핑 목록</Link>
      </header>
      <OrderRowsBoard />
    </div>
  )
}
