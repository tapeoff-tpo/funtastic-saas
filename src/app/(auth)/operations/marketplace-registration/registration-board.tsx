'use client'

import { useMemo, useState, useTransition } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  ImageIcon,
  PackageCheck,
  RefreshCw,
  Search,
  X,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { RegistrationRow } from '@/lib/operations/marketplace-registration'
import { applyRegistrationAction, syncFuntasticB2bAction } from './actions'

type Filter = 'all' | 'needs_info' | 'ready' | 'selling' | 'paused'

const CHANNEL_LABELS: Record<string, string> = {
  coupang: '쿠팡',
  smartstore: '스마트스토어',
  toss: '토스',
}

function formatPrice(value: number) {
  return `${Math.round(value).toLocaleString('ko-KR')}원`
}

function sourceStatusLabel(status: string | null) {
  if (status === 'SELLING') return '판매중'
  if (status === 'TEMP_OUT') return '일시품절'
  if (status === 'RESTOCKING') return '재입고중'
  return '상태 미확인'
}

function sourceStatusClass(status: string | null) {
  if (status === 'SELLING') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (status === 'TEMP_OUT') return 'border-red-200 bg-red-50 text-red-700'
  return 'border-amber-200 bg-amber-50 text-amber-700'
}

function readiness(row: RegistrationRow) {
  return row.commonCategory ? 'ready' : 'needs_info'
}

function ProductImage({ row, className }: { row: RegistrationRow; className?: string }) {
  const src = row.primaryImageUrl || row.sourceImageUrl
  if (!src) {
    return (
      <div className={cn('flex items-center justify-center bg-muted text-muted-foreground', className)}>
        <ImageIcon className="size-5" />
      </div>
    )
  }
  return <img src={src} alt="" className={cn('object-cover', className)} />
}

function registrationImages(row: RegistrationRow) {
  const primary = row.primaryImageUrl || row.sourceImageUrl
  const additional = (row.imageUrls.length > 0 ? row.imageUrls : row.thumbnailUrls)
    .filter((url) => url && url !== primary)
    .slice(0, 9)

  return { primary, additional }
}

function registrationChecks(row: RegistrationRow) {
  const { primary, additional } = registrationImages(row)
  return [
    { label: '카테고리', complete: Boolean(row.commonCategory) },
    { label: '대표·추가 이미지', complete: Boolean(primary) && additional.length > 0 },
    { label: '상품 상세', complete: Boolean(row.sourceDescription) },
    { label: '제조사·원산지', complete: Boolean(row.manufacturer && row.countryOfOrigin) },
    { label: '옵션·재고', complete: row.options.length > 0 },
    { label: '상품고시', complete: row.productNotice.length > 0 },
  ]
}

export function RegistrationBoard({ rows }: { rows: RegistrationRow[] }) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [selectedCode, setSelectedCode] = useState<string | null>(rows[0]?.productCode ?? null)
  const [syncMessage, setSyncMessage] = useState('')
  const [syncPending, startSyncTransition] = useTransition()
  const selected = rows.find((row) => row.productCode === selectedCode) ?? null
  const selectedImages = selected ? registrationImages(selected) : null
  const selectedChecks = selected ? registrationChecks(selected) : []
  const inventorySku = selected?.inventorySkus[0] ?? null

  const counts = useMemo(() => ({
    all: rows.length,
    needs_info: rows.filter((row) => readiness(row) === 'needs_info').length,
    ready: rows.filter((row) => readiness(row) === 'ready').length,
    selling: rows.filter((row) => row.sourceStatus === 'SELLING').length,
    paused: rows.filter((row) => row.sourceStatus !== 'SELLING').length,
  }), [rows])

  const filteredRows = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase('ko-KR')
    return rows.filter((row) => {
      if (filter === 'needs_info' && readiness(row) !== 'needs_info') return false
      if (filter === 'ready' && readiness(row) !== 'ready') return false
      if (filter === 'selling' && row.sourceStatus !== 'SELLING') return false
      if (filter === 'paused' && row.sourceStatus === 'SELLING') return false
      if (!keyword) return true
      return [
        row.productCode,
        row.productName,
        row.sourceCategoryName,
        ...row.options.map((option) => option.barcode),
      ].some((value) => value?.toLocaleLowerCase('ko-KR').includes(keyword))
    })
  }, [filter, query, rows])

  function syncProducts() {
    setSyncMessage('')
    startSyncTransition(async () => {
      const result = await syncFuntasticB2bAction()
      if ('error' in result) {
        setSyncMessage(result.error || '상품을 가져오지 못했습니다.')
        return
      }
      setSyncMessage(`${result.count.toLocaleString('ko-KR')}개 상품을 동기화했습니다.`)
      router.refresh()
    })
  }

  const filters: Array<{ value: Filter; label: string }> = [
    { value: 'all', label: '전체' },
    { value: 'needs_info', label: '정보 부족' },
    { value: 'ready', label: '등록 준비' },
    { value: 'selling', label: 'B2B 판매중' },
    { value: 'paused', label: '품절·중지' },
  ]

  return (
    <section className="overflow-hidden rounded-md border bg-background">
      <div className="flex flex-col gap-3 border-b bg-muted/20 p-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          {filters.map((item) => (
            <Button
              key={item.value}
              type="button"
              size="sm"
              variant={filter === item.value ? 'default' : 'outline'}
              onClick={() => setFilter(item.value)}
            >
              {item.label}
              <span className="tabular-nums opacity-70">{counts[item.value]}</span>
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="상품명·코드·바코드 검색"
              className="pl-8"
            />
          </div>
          <Button type="button" variant="outline" onClick={syncProducts} disabled={syncPending}>
            <RefreshCw className={cn(syncPending && 'animate-spin')} />
            {syncPending ? '동기화 중' : 'B2B 동기화'}
          </Button>
        </div>
        {syncMessage ? <p className="text-xs text-muted-foreground lg:basis-full lg:text-right">{syncMessage}</p> : null}
      </div>

      <div className="grid min-h-[620px] xl:grid-cols-[minmax(680px,1fr)_430px]">
        <div className="min-w-0 border-b xl:border-b-0 xl:border-r">
          <div className="grid grid-cols-[52px_minmax(240px,1fr)_100px_90px_110px_28px] items-center gap-3 border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
            <span>이미지</span>
            <span>상품</span>
            <span>판매가</span>
            <span>옵션·매칭</span>
            <span>등록 준비</span>
            <span />
          </div>
          <div className="max-h-[720px] overflow-y-auto">
            {filteredRows.map((row) => {
              const isSelected = selected?.productCode === row.productCode
              const isReady = readiness(row) === 'ready'
              return (
                <button
                  key={row.productCode}
                  type="button"
                  onClick={() => setSelectedCode(row.productCode)}
                  className={cn(
                    'grid w-full grid-cols-[52px_minmax(240px,1fr)_100px_90px_110px_28px] items-center gap-3 border-b px-3 py-2 text-left transition-colors hover:bg-muted/40',
                    isSelected && 'bg-blue-50/70 hover:bg-blue-50',
                  )}
                >
                  <ProductImage row={row} className="size-11 rounded border" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{row.productName}</span>
                    <span className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-mono">{row.productCode}</span>
                      <span>{row.sourceCategoryName || '카테고리 없음'}</span>
                    </span>
                  </span>
                  <span className="text-sm font-medium tabular-nums">{formatPrice(row.price)}</span>
                  <span className="text-xs text-muted-foreground">
                    <span className="block">옵션 {row.options.length}개</span>
                    <span className="block">코드 {row.matchedSalesCodes}개</span>
                  </span>
                  <span>
                    <Badge
                      variant="outline"
                      className={isReady
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : 'border-amber-200 bg-amber-50 text-amber-700'}
                    >
                      {isReady ? <CheckCircle2 /> : <AlertCircle />}
                      {isReady ? '준비됨' : '정보 필요'}
                    </Badge>
                  </span>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </button>
              )
            })}
            {filteredRows.length === 0 ? (
              <div className="px-4 py-16 text-center text-sm text-muted-foreground">
                {rows.length === 0 ? 'B2B 동기화를 눌러 기존 상품을 가져오세요.' : '조건에 맞는 상품이 없습니다.'}
              </div>
            ) : null}
          </div>
        </div>

        <aside className="min-w-0 bg-muted/10">
          {selected ? (
            <div>
              <div className="flex items-start gap-3 border-b bg-background p-4">
                <ProductImage row={selected} className="size-20 rounded-md border" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h2 className="truncate text-base font-semibold">{selected.productName}</h2>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        B2B {selected.productCode} · {selected.sourceCategoryName || '카테고리 없음'}
                      </p>
                    </div>
                    <Button type="button" variant="ghost" size="icon-sm" onClick={() => setSelectedCode(null)} title="닫기">
                      <X />
                    </Button>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <Badge variant="outline" className={sourceStatusClass(selected.sourceStatus)}>
                      {sourceStatusLabel(selected.sourceStatus)}
                    </Badge>
                    <Badge variant="outline">B2B 재고 {selected.stock.toLocaleString('ko-KR')}</Badge>
                    {inventorySku ? (
                      <a
                        href={`/inventory?search=${encodeURIComponent(inventorySku)}&searched=1&focusSku=${encodeURIComponent(inventorySku)}`}
                        className="inline-flex h-6 items-center rounded-md border border-blue-200 bg-blue-50 px-2 text-xs font-medium text-blue-700 hover:bg-blue-100"
                      >
                        SaaS 재고 {selected.inventoryAvailableStock.toLocaleString('ko-KR')}
                      </a>
                    ) : null}
                    <Badge variant="outline">배송비 {formatPrice(selected.shippingFee)}</Badge>
                  </div>
                </div>
              </div>

              <form key={selected.productCode} action={applyRegistrationAction}>
                <input type="hidden" name="productCode" value={selected.productCode} />
                <input type="hidden" name="sourceProductUrl" value={selected.sourceProductUrl ?? ''} />
                <div className="space-y-5 p-4">
                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <h3 className="text-sm font-semibold">몰 공통 등록정보</h3>
                      <span className="text-xs text-muted-foreground">사용자 입력값은 동기화해도 유지됩니다</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="col-span-2 space-y-1">
                        <span className="text-xs text-muted-foreground">기본 카테고리</span>
                        <Input name="commonCategory" defaultValue={selected.commonCategory ?? ''} placeholder="네이버 기준 카테고리" />
                      </label>
                      <label className="space-y-1">
                        <span className="text-xs text-muted-foreground">브랜드</span>
                        <Input name="brand" defaultValue={selected.brand ?? ''} placeholder="브랜드" />
                      </label>
                      <label className="space-y-1">
                        <span className="text-xs text-muted-foreground">제조사</span>
                        <Input name="manufacturer" defaultValue={selected.manufacturer ?? ''} placeholder="제조사" />
                      </label>
                      <label className="col-span-2 space-y-1">
                        <span className="text-xs text-muted-foreground">원산지</span>
                        <Input name="countryOfOrigin" defaultValue={selected.countryOfOrigin ?? ''} placeholder="원산지" />
                      </label>
                    </div>
                  </div>

                  <div>
                    <h3 className="mb-2 text-sm font-semibold">등록 점검</h3>
                    <div className="grid grid-cols-2 gap-1.5">
                      {selectedChecks.map((check) => (
                        <div key={check.label} className="flex items-center gap-1.5 rounded border bg-background px-2 py-1.5 text-xs">
                          {check.complete
                            ? <CheckCircle2 className="size-3.5 text-emerald-600" />
                            : <AlertCircle className="size-3.5 text-amber-600" />}
                          <span>{check.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <h3 className="mb-2 text-sm font-semibold">판매 정보</h3>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                      <div><dt className="text-xs text-muted-foreground">B2B 판매가</dt><dd className="font-medium">{formatPrice(selected.price)}</dd></div>
                      <div><dt className="text-xs text-muted-foreground">권장 소비자가</dt><dd className="font-medium">{formatPrice(selected.retailPrice)}</dd></div>
                      <div><dt className="text-xs text-muted-foreground">최소 주문</dt><dd>{selected.minOrderQty}{selected.unit || 'EA'}</dd></div>
                      <div><dt className="text-xs text-muted-foreground">판매코드 매칭</dt><dd>{selected.matchedSalesCodes}개</dd></div>
                    </dl>
                  </div>

                  <div>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold">운영 연결</h3>
                      <span className="text-xs text-muted-foreground">코드를 누르면 해당 화면으로 이동합니다</span>
                    </div>
                    <div className="space-y-2 rounded border bg-background p-2.5 text-xs">
                      <div className="flex items-start justify-between gap-3">
                        <span className="shrink-0 text-muted-foreground">SaaS 재고</span>
                        {inventorySku ? (
                          <a
                            href={`/inventory?search=${encodeURIComponent(inventorySku)}&searched=1&focusSku=${encodeURIComponent(inventorySku)}`}
                            className="min-w-0 text-right font-mono text-blue-700 hover:underline"
                          >
                            {selected.inventorySkus.join(', ')} · {selected.inventoryAvailableStock.toLocaleString('ko-KR')}개
                          </a>
                        ) : <span className="text-right text-muted-foreground">매칭 SKU 없음</span>}
                      </div>
                      <div className="flex items-start justify-between gap-3">
                        <span className="shrink-0 text-muted-foreground">판매가 테이블</span>
                        {selected.matchedSalesCodeList.length ? (
                          <span className="flex min-w-0 flex-wrap justify-end gap-1">
                            {selected.matchedSalesCodeList.map((code) => (
                              <a
                                key={code}
                                href={`/analytics/price-table?sheet=${encodeURIComponent('상품등록')}&q=${encodeURIComponent(code)}`}
                                className="rounded border border-violet-200 bg-violet-50 px-1.5 py-0.5 font-mono text-violet-700 hover:bg-violet-100"
                              >
                                {code}
                              </a>
                            ))}
                          </span>
                        ) : <span className="text-right text-muted-foreground">연결된 판매코드 없음</span>}
                      </div>
                    </div>
                  </div>

                  <div>
                    <h3 className="mb-2 text-sm font-semibold">옵션</h3>
                    <div className="max-h-40 overflow-y-auto rounded border bg-background">
                      {selected.options.length ? selected.options.map((option) => (
                        <div key={option.id} className="grid grid-cols-[1fr_72px_110px] gap-2 border-b px-3 py-2 text-xs last:border-b-0">
                          <span className="truncate">{option.optionName}</span>
                          <span className="text-right tabular-nums">재고 {option.stockQty}</span>
                          <span className="truncate text-right font-mono text-muted-foreground">{option.barcode || '바코드 없음'}</span>
                        </div>
                      )) : <p className="px-3 py-4 text-center text-xs text-muted-foreground">단일 상품</p>}
                    </div>
                  </div>

                  <div>
                    <h3 className="mb-2 text-sm font-semibold">몰별 준비 상태</h3>
                    <div className="grid grid-cols-3 gap-2">
                      {selected.channels.map((channel) => (
                        <div key={channel.marketplaceId} className="border bg-background px-2 py-2 text-center">
                          <p className="text-xs font-medium">{CHANNEL_LABELS[channel.marketplaceId] || channel.marketplaceId}</p>
                          <p className={cn('mt-1 text-[11px]', selected.commonCategory ? 'text-emerald-700' : 'text-amber-700')}>
                            {selected.commonCategory ? '등록 준비' : '카테고리 필요'}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <h3 className="text-sm font-semibold">등록용 이미지</h3>
                      <Badge variant="outline" className="border-sky-200 bg-sky-50 text-sky-700">Cloudflare R2 원본</Badge>
                    </div>
                    <label className="space-y-1">
                      <span className="text-xs text-muted-foreground">대표 이미지 URL</span>
                      <Input name="primaryImageUrl" defaultValue={selected.primaryImageUrl ?? ''} placeholder="비워두면 B2B 대표 이미지를 사용합니다" />
                    </label>
                    <div className="mt-2 rounded border bg-background p-2">
                      <p className="mb-2 text-xs text-muted-foreground">등록에 반영될 추가 이미지 {selectedImages?.additional.length ?? 0}장</p>
                      <div className="grid grid-cols-5 gap-1.5">
                        {selectedImages?.additional.map((url) => <img key={url} src={url} alt="" className="aspect-square w-full rounded border object-cover" />)}
                        {selectedImages?.additional.length === 0 ? <p className="col-span-5 py-2 text-center text-xs text-muted-foreground">B2B 추가 이미지가 없습니다.</p> : null}
                      </div>
                    </div>
                    <label className="mt-2 block space-y-1">
                      <span className="text-xs text-muted-foreground">추가 이미지 URL</span>
                      <textarea
                        name="detailImageUrls"
                        defaultValue={selected.imageUrls.join('\n')}
                        placeholder="비워두면 B2B Cloudflare R2 추가 이미지를 사용합니다. 직접 지정할 때는 한 줄에 하나씩 입력하세요."
                        className="min-h-20 w-full rounded-md border bg-background px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                      />
                    </label>
                    <p className="mt-1 text-xs text-muted-foreground">상세페이지 원본 이미지 {selected.detailImageUrls.length}장 · B2B 원본 이미지는 자동으로 유지됩니다.</p>
                  </div>
                </div>
                <div className="sticky bottom-0 flex items-center justify-between border-t bg-background p-3">
                  <a
                    href={selected.sourceProductUrl ?? '#'}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline"
                  >
                    B2B 상품 보기 <ExternalLink className="size-3" />
                  </a>
                  <Button type="submit">
                    <PackageCheck />
                    등록정보 저장
                  </Button>
                </div>
              </form>
            </div>
          ) : (
            <div className="flex min-h-[420px] items-center justify-center p-8 text-center text-sm text-muted-foreground">
              목록에서 상품을 선택하면 등록정보를 확인할 수 있습니다.
            </div>
          )}
        </aside>
      </div>
    </section>
  )
}
