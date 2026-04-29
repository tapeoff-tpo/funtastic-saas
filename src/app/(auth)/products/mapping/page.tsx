/**
 * 매핑관리 — 사방넷 주문서확정관리 스타일.
 *
 * 상단 dense 필터 + 툴바 + 2그룹 헤더 테이블. 행 단위로 [+ 품번매핑]/[+ 단품매핑] 인라인 매핑.
 * 매핑코드 마스터(생성/편집/삭제/검색) 는 /products/mapping-codes 에서.
 */
import { OrderRowsBoard } from './order-rows-board'

export default function MappingPage() {
  return (
    <div className="space-y-3">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">매핑관리</h1>
        <p className="text-sm text-muted-foreground">
          쇼핑몰 수집 주문을 품번/단품 단위로 매핑합니다. 매핑코드 마스터는{' '}
          <a href="/products/mapping-codes" className="underline">매핑코드 마스터</a> 에서.
        </p>
      </header>
      <OrderRowsBoard />
    </div>
  )
}
