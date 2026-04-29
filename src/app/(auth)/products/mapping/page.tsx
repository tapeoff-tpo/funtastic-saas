/**
 * 매핑관리 — Phase A 단계 placeholder.
 *
 * 구 product_name_mappings / product_option_mappings / product_bundle_items
 * 3개 테이블이 모두 drop 됐고, 신규 매핑코드(사방넷 방식) 시스템은
 * Phase B(스키마 추가) → Phase C(UI/연동) 단계에서 도입 예정이다.
 */
export default function MappingPage() {
  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">매핑관리</h1>
        <p className="text-sm text-muted-foreground">
          마켓 상품 ↔ 내부 SKU 매핑을 한 곳에서 관리합니다.
        </p>
      </header>

      <div className="rounded-lg border border-dashed p-8 text-center">
        <h2 className="text-lg font-medium">신규 매핑 시스템 준비 중</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          기존 상품명/옵션/세트 매핑 시스템을 통합 매핑코드 방식으로 재설계 중입니다.
          <br />
          매핑코드 1개에 여러 마켓 상품과 다중 SKU 구성품을 묶어서 관리할 수 있게 될 예정입니다.
        </p>
      </div>
    </div>
  )
}
