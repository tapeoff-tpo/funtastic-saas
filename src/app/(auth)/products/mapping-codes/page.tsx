/**
 * 매핑코드 마스터 페이지.
 *
 * 일상 매핑 작업은 /products/mapping (OrderRowsBoard) 에서.
 * 이 페이지는 매핑코드(품번/단품 ↔ SKU) 마스터의 생성/편집/삭제/검색만 담당한다.
 */
import { MappingManager } from '../mapping/mapping-manager'

export default function MappingCodesPage() {
  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">매핑코드 마스터</h1>
        <p className="text-sm text-muted-foreground">
          매핑코드(품번/단품 ↔ SKU) 마스터 관리. 일상 매핑 작업은{' '}
          <a href="/products/mapping" className="underline">매핑관리</a> 화면에서.
        </p>
      </header>
      <MappingManager />
    </div>
  )
}
