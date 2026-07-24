'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { WandSparkles } from 'lucide-react'
import { PurchasingItemUpload } from '@/components/purchasing-item-upload'
import { PurchasingUrlCollector } from '@/components/purchasing-url-collector'
import { Button } from '@/components/ui/button'
import { CostsEditableTable, type CostEditableRow } from './costs-editable-table'

const DETAIL_PAGE_SELECTION_KEY = 'funtastic-detail-page-selection'

export function CostsPageClient({
  headers,
  rows,
  total,
  page,
  pageCount,
  search,
}: {
  headers: readonly string[]
  rows: CostEditableRow[]
  total: number
  page: number
  pageCount: number
  search?: string
}) {
  const router = useRouter()
  const [selectedRows, setSelectedRows] = useState<CostEditableRow[]>([])

  function createDetailPageJobs() {
    if (selectedRows.length === 0) return
    const [codeHeader, nameHeader] = headers
    const products = selectedRows.map((row) => ({
      id: row.id,
      sku: row.data[codeHeader] ?? '',
      name: row.data[nameHeader] ?? '',
      option: row.data['규격정보'] ?? '',
      purchaseUrl: row.data['구매 URL'] ?? '',
      material: row.data['재질'] ?? '',
      size: row.data['제품크기'] ?? '',
      manufacturer: row.data['제조사'] ?? '',
      weight: row.data['무게'] ?? '',
      country: row.data['제조국'] ?? '',
      capacity: row.data['용량'] ?? '',
    }))
    window.sessionStorage.setItem(DETAIL_PAGE_SELECTION_KEY, JSON.stringify(products))
    router.push('/operations/detail-pages')
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">품목</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            ESA009M 전체 항목 · {total.toLocaleString('ko-KR')}개 품목
          </p>
        </div>
        <div className="flex flex-wrap items-start justify-end gap-2">
          <PurchasingUrlCollector />
          <Button type="button" onClick={createDetailPageJobs} disabled={selectedRows.length === 0}>
            <WandSparkles />
            상세페이지 제작{selectedRows.length > 0 ? ` ${selectedRows.length}` : ''}
          </Button>
          <PurchasingItemUpload />
        </div>
      </div>

      <form className="flex max-w-xl gap-2">
        <input
          name="search"
          defaultValue={search}
          placeholder="품목코드, 품목명, 영문명, HS CODE 검색 (쉼표로 여러 개)"
          className="h-9 flex-1 rounded-md border bg-background px-3 text-sm"
        />
        <button className="h-9 rounded-md border bg-background px-4 text-sm font-medium hover:bg-muted">
          검색
        </button>
      </form>

      <CostsEditableTable headers={headers} rows={rows} onSelectionChange={setSelectedRows} />

      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{page} / {pageCount} 페이지</span>
        <div className="flex gap-2">
          <PageLink disabled={page <= 1} href={pageHref(page - 1, search)}>이전</PageLink>
          <PageLink disabled={page >= pageCount} href={pageHref(page + 1, search)}>다음</PageLink>
        </div>
      </div>
    </>
  )
}

function PageLink({ href, disabled, children }: { href: string; disabled: boolean; children: React.ReactNode }) {
  if (disabled) return <span className="rounded-md border px-3 py-1.5 text-muted-foreground opacity-50">{children}</span>
  return <Link href={href} className="rounded-md border px-3 py-1.5 hover:bg-muted">{children}</Link>
}

function pageHref(page: number, search?: string) {
  const params = new URLSearchParams({ page: String(page) })
  if (search) params.set('search', search)
  return `/costs?${params}`
}
