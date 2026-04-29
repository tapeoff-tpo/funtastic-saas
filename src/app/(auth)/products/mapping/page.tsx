/**
 * 매핑관리 — Phase C 매핑코드 시스템.
 *
 * 사방넷 방식: 1 매핑코드 = N 마켓상품(sources) + N SKU(components).
 * 미매핑 마켓상품은 우측 패널에서 자동 추출 → 클릭으로 매핑코드에 추가.
 */
import { MappingManager } from './mapping-manager'

export default function MappingPage() {
  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">매핑관리</h1>
        <p className="text-sm text-muted-foreground">
          마켓 상품 ↔ 내부 SKU 매핑을 매핑코드 단위로 관리합니다. 1 매핑코드 = N 마켓상품 + N SKU 구성품.
        </p>
      </header>
      <MappingManager />
    </div>
  )
}
