/**
 * 매핑코드 마스터 페이지.
 *
 * 일상 매핑 작업은 /products/mapping (OrderRowsBoard) 에서.
 * 이 페이지는 매핑코드(품번/단품 ↔ SKU) 마스터의 생성/편집/삭제/검색만 담당한다.
 */
import Link from 'next/link'
import { MappingManager } from '../mapping/mapping-manager'

export default function MappingCodesPage() {
  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">매핑코드 마스터</h1>
        <Link href="/products/mapping" className="text-sm underline">매핑관리</Link>
      </header>
      <MappingManager />
    </div>
  )
}
