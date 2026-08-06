'use client'

import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { ClipboardList, WandSparkles, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { CostsEditableTable, type CostEditableRow } from './costs-editable-table'

const DETAIL_PAGE_SELECTION_KEY = 'funtastic-detail-page-selection'
const PurchasingItemUpload = dynamic(
  () => import('@/components/purchasing-item-upload').then((module) => module.PurchasingItemUpload),
  { ssr: false },
)
const PurchasingUrlCollector = dynamic(
  () => import('@/components/purchasing-url-collector').then((module) => module.PurchasingUrlCollector),
  { ssr: false },
)

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
  const [purchaseOpen, setPurchaseOpen] = useState(false)
  const [quantities, setQuantities] = useState<Record<string, string>>({})
  const [buyerCode, setBuyerCode] = useState('4')
  const [purchaseMemo, setPurchaseMemo] = useState('')
  const [isPurchasing, startPurchasing] = useTransition()

  const codeHeader = headers[0]
  const nameHeader = headers[1]

  function createDetailPageJobs() {
    if (selectedRows.length === 0) return
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
    let pendingProducts: typeof products = []
    try {
      const saved = window.sessionStorage.getItem(DETAIL_PAGE_SELECTION_KEY)
      const parsed = saved ? JSON.parse(saved) : []
      if (Array.isArray(parsed)) {
        pendingProducts = parsed.filter((product): product is (typeof products)[number] => (
          Boolean(product)
          && typeof product === 'object'
          && typeof product.id === 'string'
        ))
      }
    } catch {
      // Replace malformed session data with the new valid selection.
    }
    const mergedProducts = Array.from(
      new Map([...pendingProducts, ...products].map((product) => [product.id, product])).values(),
    )
    window.sessionStorage.setItem(DETAIL_PAGE_SELECTION_KEY, JSON.stringify(mergedProducts))
    router.push('/operations/detail-pages')
  }

  function openPurchaseReview() {
    if (selectedRows.length === 0) return
    setQuantities(Object.fromEntries(selectedRows.map((row) => [row.id, '1'])))
    setPurchaseMemo('')
    setPurchaseOpen(true)
  }

  function createPurchaseReview() {
    const items = selectedRows.map((row) => ({
      sku: row.data[codeHeader] ?? '',
      productName: row.data[nameHeader] ?? '',
      optionName: row.data['규격정보'] ?? null,
      requestedQuantity: Number(quantities[row.id] ?? 0),
      buyerCode,
      memo: purchaseMemo || null,
      createdFrom: 'item_master' as const,
    })).filter((item) => item.sku && item.productName && Number.isInteger(item.requestedQuantity) && item.requestedQuantity > 0)

    if (items.length !== selectedRows.length) {
      toast.error('선택한 모든 품목의 발주 수량을 1개 이상 입력해 주세요.')
      return
    }

    startPurchasing(async () => {
      const response = await fetch('/api/purchasing/purchase-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        toast.error(body.error ?? '발주검토 항목을 추가하지 못했습니다.')
        return
      }
      toast.success(`발주검토 ${body.created ?? items.length}건을 추가했습니다.`)
      router.push('/purchasing/purchases')
    })
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
          <Button type="button" variant="outline" onClick={openPurchaseReview} disabled={selectedRows.length === 0}>
            <ClipboardList />
            발주검토 추가{selectedRows.length > 0 ? ` ${selectedRows.length}` : ''}
          </Button>
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

      {purchaseOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4" role="dialog" aria-modal="true" aria-labelledby="purchase-review-title">
          <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-md border bg-background shadow-xl">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div>
                <h2 id="purchase-review-title" className="text-base font-semibold">발주검토 추가</h2>
                <p className="mt-1 text-xs text-muted-foreground">선택 품목의 수량과 담당자 정보를 확인한 뒤 발주검토에 생성합니다.</p>
              </div>
              <Button type="button" variant="ghost" size="icon-sm" onClick={() => setPurchaseOpen(false)} disabled={isPurchasing} aria-label="닫기"><X /></Button>
            </div>
            <div className="grid gap-3 border-b p-4 sm:grid-cols-[180px_minmax(0,1fr)]">
              <label className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">담당자</span>
                <select value={buyerCode} onChange={(event) => setBuyerCode(event.target.value)} className="h-9 w-full rounded-md border bg-background px-3 text-sm">
                  <option value="1">한상철</option>
                  <option value="2">김기환</option>
                  <option value="3">최종석</option>
                  <option value="4">오지은</option>
                  <option value="5">김소희</option>
                </select>
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">발주 메모</span>
                <input value={purchaseMemo} onChange={(event) => setPurchaseMemo(event.target.value)} maxLength={1000} className="h-9 w-full rounded-md border bg-background px-3 text-sm" placeholder="공통 메모" />
              </label>
            </div>
            <div className="min-h-0 overflow-y-auto p-4">
              <div className="overflow-hidden rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/60 text-xs text-muted-foreground"><tr><th className="px-3 py-2 text-left">품목코드</th><th className="px-3 py-2 text-left">품목명 / 옵션</th><th className="w-28 px-3 py-2 text-right">발주수량</th></tr></thead>
                  <tbody>{selectedRows.map((row) => (
                    <tr key={row.id} className="border-t">
                      <td className="px-3 py-2 font-mono text-xs">{row.data[codeHeader]}</td>
                      <td className="px-3 py-2"><div className="font-medium">{row.data[nameHeader]}</div><div className="text-xs text-muted-foreground">{row.data['규격정보'] || '-'}</div></td>
                      <td className="px-3 py-2"><input type="number" min="1" step="1" value={quantities[row.id] ?? ''} onChange={(event) => setQuantities((current) => ({ ...current, [row.id]: event.target.value }))} className="h-8 w-full rounded-md border bg-background px-2 text-right text-sm" /></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t px-4 py-3">
              <Button type="button" variant="outline" onClick={() => setPurchaseOpen(false)} disabled={isPurchasing}>취소</Button>
              <Button type="button" onClick={createPurchaseReview} disabled={isPurchasing}><ClipboardList />{isPurchasing ? '생성 중...' : '발주검토 생성'}</Button>
            </div>
          </div>
        </div>
      ) : null}

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
