'use client'

import { useMemo, useRef, useState, useTransition, type FormEvent, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import {
  CheckCircle2,
  ExternalLink,
  ImageIcon,
  Loader2,
  PackagePlus,
  Plus,
  Save,
  Search,
  UploadCloud,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { calculateCnyCostKrw, type CnyKrwReferenceRate } from '@/lib/new-products/cny-cost'
import type { NewProductOperator, NewProductViewer } from '@/lib/new-products/workflow'
import type { ManualSourcingItem } from '@/lib/operations/sourcing'
import {
  createManualSourcingAction,
  passManualSourcingAction,
  updateManualSourcingAction,
} from './actions'

type Props = {
  items: ManualSourcingItem[]
  operators: NewProductOperator[]
  viewer: NewProductViewer
  exchangeRate: CnyKrwReferenceRate
}

type SourcingValues = {
  productName: string
  productOption: string
  chinaPurchaseUrl: string
  chinaUnitPriceCny: string
  unitShippingCny: string
  exchangeRateKrw: string
  domesticSaleUrl: string
  domesticSalePrice: string
  detailPageUrl: string
  memo1: string
  memo2: string
  ownerOperatorId: string | null
}

const statusClass: Record<string, string> = {
  draft: 'bg-amber-50 text-amber-800 ring-amber-200',
  passed: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  hold: 'bg-slate-100 text-slate-700 ring-slate-200',
}

export function SourcingBoard({ items, operators, viewer, exchangeRate }: Props) {
  const router = useRouter()
  const [selectedId, setSelectedId] = useState<string | null>(items[0]?.id ?? null)
  const [query, setQuery] = useState('')
  const selected = items.find((item) => item.id === selectedId) ?? items[0] ?? null
  const filteredItems = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase('ko')
    if (!keyword) return items
    return items.filter((item) => [item.productName, item.productOption, item.ownerName]
      .some((value) => value?.toLocaleLowerCase('ko').includes(keyword)))
  }, [items, query])

  const draftCount = items.filter((item) => item.status !== 'passed').length
  const passedCount = items.filter((item) => item.status === 'passed').length

  return (
    <div className="space-y-4">
      <section className="grid gap-3 sm:grid-cols-3">
        <Metric label="전체 소싱" value={items.length} />
        <Metric label="검토 중" value={draftCount} />
        <Metric label="1차 통과" value={passedCount} />
      </section>

      <section className="rounded-lg border bg-card">
        <div className="flex flex-col gap-3 border-b p-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-sm font-semibold">수동 소싱 상품 등록</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              자동 수집은 중지되어 있습니다. 1차 통과를 누르면 신상품 진행관리의 첫 단계에 바로 등록됩니다.
            </p>
          </div>
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-right">
            <p className="text-xs text-muted-foreground">CNY 기준환율</p>
            <p className="text-sm font-semibold">1 ¥ = {exchangeRate.rate.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}원</p>
            <p className="text-[11px] text-muted-foreground">
              {exchangeRate.date ? exchangeRate.date + ' 기준' : '조회 실패 시 기본값'}
            </p>
          </div>
        </div>
        <CreateSourcingForm
          operators={operators}
          viewer={viewer}
          exchangeRate={exchangeRate.rate}
          onCreated={(id) => {
            setSelectedId(id)
            router.refresh()
          }}
        />
      </section>

      <section className="overflow-hidden rounded-lg border bg-card">
        <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold">소싱 목록</h2>
            <p className="mt-1 text-xs text-muted-foreground">담당 등록자별 데이터는 서로 덮어쓸 수 없습니다.</p>
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} className="h-8 pl-8" placeholder="상품명 또는 등록자 검색" />
          </div>
        </div>

        <div className="grid min-h-[600px] xl:grid-cols-[minmax(620px,1fr)_560px]">
          <div className="min-w-0 overflow-x-auto">
            <div className="min-w-[760px]">
              <div className="grid grid-cols-[64px_minmax(190px,1fr)_120px_110px_110px_100px] gap-3 border-b bg-muted/30 px-4 py-2 text-xs font-medium text-muted-foreground">
                <span>사진</span>
                <span>상품</span>
                <span>중국 원가</span>
                <span>한국원화</span>
                <span>등록자</span>
                <span>상태</span>
              </div>
              {filteredItems.map((item) => {
                const active = item.id === selected?.id
                const imageSrc = imageSource(item)
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedId(item.id)}
                    className={'grid w-full grid-cols-[64px_minmax(190px,1fr)_120px_110px_110px_100px] items-center gap-3 border-b px-4 py-3 text-left text-sm hover:bg-muted/40 ' + (active ? 'bg-muted/60' : '')}
                  >
                    <span className="grid size-12 place-items-center overflow-hidden rounded border bg-muted/30">
                      {imageSrc ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={imageSrc} alt="" className="h-full w-full object-cover" />
                      ) : <ImageIcon className="h-5 w-5 text-muted-foreground" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{item.productName}</span>
                      <span className="mt-1 block truncate text-xs text-muted-foreground">{item.productOption || '옵션 없음'}</span>
                    </span>
                    <span>¥ {money(item.chinaUnitPriceCny)}<span className="block text-xs text-muted-foreground">배송 ¥ {money(item.unitShippingCny)}</span></span>
                    <span>{won(item.calculatedCostKrw)}</span>
                    <span className="truncate">{item.ownerName || '미지정'}</span>
                    <StatusBadge status={item.status} />
                  </button>
                )
              })}
              {filteredItems.length === 0 && (
                <div className="px-4 py-20 text-center text-sm text-muted-foreground">표시할 소싱 상품이 없습니다.</div>
              )}
            </div>
          </div>

          <aside className="border-t xl:border-l xl:border-t-0">
            {selected ? (
              <SourcingDetail
                key={selected.id + ':' + selected.updatedAt}
                item={selected}
                operators={operators}
                viewer={viewer}
                exchangeRate={exchangeRate.rate}
                onChanged={() => router.refresh()}
              />
            ) : (
              <div className="grid h-full min-h-[320px] place-items-center p-8 text-sm text-muted-foreground">소싱 상품을 선택해 주세요.</div>
            )}
          </aside>
        </div>
      </section>
    </div>
  )
}

function CreateSourcingForm({ operators, viewer, exchangeRate, onCreated }: {
  operators: NewProductOperator[]
  viewer: NewProductViewer
  exchangeRate: number
  onCreated: (id: string) => void
}) {
  const [values, setValues] = useState<SourcingValues>(() => emptyValues(exchangeRate, viewer.operatorId))
  const [photo, setPhoto] = useState<File | null>(null)
  const [pending, startTransition] = useTransition()

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    startTransition(async () => {
      const result = await createManualSourcingAction(values)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      if (photo) {
        const uploaded = await uploadPhoto(result.id, photo)
        if (!uploaded.success) {
          toast.error(uploaded.error)
          return
        }
      }
      toast.success('소싱 상품을 등록했습니다.')
      setValues(emptyValues(exchangeRate, viewer.operatorId))
      setPhoto(null)
      onCreated(result.id)
    })
  }

  return (
    <form onSubmit={submit} className="space-y-3 p-4">
      <SourcingFields values={values} onChange={setValues} operators={operators} viewer={viewer} />
      <div className="flex flex-col gap-2 border-t pt-3 sm:flex-row sm:items-center sm:justify-between">
        <PhotoInput file={photo} onChange={setPhoto} />
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <Plus />}
          {pending ? '등록 중...' : '수동 소싱 등록'}
        </Button>
      </div>
    </form>
  )
}

function SourcingDetail({ item, operators, viewer, exchangeRate, onChanged }: {
  item: ManualSourcingItem
  operators: NewProductOperator[]
  viewer: NewProductViewer
  exchangeRate: number
  onChanged: () => void
}) {
  const [values, setValues] = useState<SourcingValues>(() => itemValues(item, exchangeRate))
  const [photo, setPhoto] = useState<File | null>(null)
  const [pending, startTransition] = useTransition()

  function save() {
    startTransition(async () => {
      const result = await updateManualSourcingAction({ itemId: item.id, values })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      if (photo) {
        const uploaded = await uploadPhoto(item.id, photo)
        if (!uploaded.success) {
          toast.error(uploaded.error)
          return
        }
      }
      toast.success('소싱 정보를 저장했습니다.')
      onChanged()
    })
  }

  function pass() {
    startTransition(async () => {
      const saved = await updateManualSourcingAction({ itemId: item.id, values })
      if (!saved.success) {
        toast.error(saved.error)
        return
      }
      if (photo) {
        const uploaded = await uploadPhoto(item.id, photo)
        if (!uploaded.success) {
          toast.error(uploaded.error)
          return
        }
      }
      const result = await passManualSourcingAction(item.id)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(result.existing ? '이미 신상품 진행관리에 등록된 상품입니다.' : '신상품 진행관리 1단계에 등록했습니다.')
      onChanged()
    })
  }

  const imageSrc = imageSource(item)

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-start justify-between gap-3 border-b pb-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold">{item.productName}</h2>
          <p className="mt-1 text-xs text-muted-foreground">최근 수정 {dateText(item.updatedAt)}</p>
        </div>
        <StatusBadge status={item.status} />
      </div>

      <div className="grid gap-3 sm:grid-cols-[100px_minmax(0,1fr)]">
        <div className="grid aspect-square place-items-center overflow-hidden rounded-lg border bg-muted/30">
          {imageSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imageSrc} alt={item.productName} className="h-full w-full object-cover" />
          ) : <ImageIcon className="h-7 w-7 text-muted-foreground" />}
        </div>
        <div className="space-y-2">
          <PhotoInput file={photo} onChange={setPhoto} compact />
          {item.passedNewProductId ? (
            <p className="flex items-center gap-1 text-xs font-medium text-emerald-700"><CheckCircle2 className="h-4 w-4" />신상품 진행관리 1단계에 등록됨</p>
          ) : (
            <Button type="button" className="w-full" onClick={pass} disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : <PackagePlus />}
              1차 통과 후 신상품 등록
            </Button>
          )}
        </div>
      </div>

      <SourcingFields values={values} onChange={setValues} operators={operators} viewer={viewer} />

      <div className="flex justify-end border-t pt-3">
        <Button type="button" onClick={save} disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <Save />}
          {pending ? '저장 중...' : '변경사항 저장'}
        </Button>
      </div>
    </div>
  )
}

function SourcingFields({ values, onChange, operators, viewer }: {
  values: SourcingValues
  onChange: (values: SourcingValues) => void
  operators: NewProductOperator[]
  viewer: NewProductViewer
}) {
  const calculatedCostKrw = calculateCnyCostKrw({
    chinaUnitPriceCny: numberValue(values.chinaUnitPriceCny),
    unitShippingCny: numberValue(values.unitShippingCny),
    exchangeRateKrw: numberValue(values.exchangeRateKrw),
  })

  function set<K extends keyof SourcingValues>(key: K, value: SourcingValues[K]) {
    onChange({ ...values, [key]: value })
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Field label="상품명" required><Input value={values.productName} onChange={(event) => set('productName', event.target.value)} /></Field>
      <Field label="상품 옵션"><Input value={values.productOption} onChange={(event) => set('productOption', event.target.value)} /></Field>
      <Field label="중국 위안화 (¥)"><Input value={values.chinaUnitPriceCny} onChange={(event) => set('chinaUnitPriceCny', event.target.value)} inputMode="decimal" placeholder="개당 상품가" /></Field>
      <Field label="개당 배송비 (¥)"><Input value={values.unitShippingCny} onChange={(event) => set('unitShippingCny', event.target.value)} inputMode="decimal" placeholder="개당 중국 배송비" /></Field>
      <Field label="적용 환율 (원/¥)"><Input value={values.exchangeRateKrw} onChange={(event) => set('exchangeRateKrw', event.target.value)} inputMode="decimal" /></Field>
      <Field label="한국원화 (자동 계산)">
        <div className="flex h-9 items-center rounded-md border bg-muted/30 px-3 text-sm font-semibold">{won(calculatedCostKrw)}</div>
      </Field>
      <Field label="중국 구매 링크"><LinkInput value={values.chinaPurchaseUrl} onChange={(value) => set('chinaPurchaseUrl', value)} /></Field>
      <Field label="국내판매 링크"><LinkInput value={values.domesticSaleUrl} onChange={(value) => set('domesticSaleUrl', value)} /></Field>
      <Field label="국내판매가 (₩)"><Input value={values.domesticSalePrice} onChange={(event) => set('domesticSalePrice', event.target.value)} inputMode="numeric" /></Field>
      <Field label="상세페이지 URL"><LinkInput value={values.detailPageUrl} onChange={(value) => set('detailPageUrl', value)} /></Field>
      {viewer.isMain ? (
        <Field label="담당 등록자">
          <select value={values.ownerOperatorId ?? ''} onChange={(event) => set('ownerOperatorId', event.target.value || null)} className="h-9 w-full rounded-md border bg-background px-3 text-sm">
            <option value="">등록자 선택</option>
            {operators.map((operator) => <option key={operator.id} value={operator.id}>{operator.displayName}</option>)}
          </select>
        </Field>
      ) : null}
      <Field label="비고 1"><textarea value={values.memo1} onChange={(event) => set('memo1', event.target.value)} rows={2} className="w-full resize-y rounded-md border bg-background px-3 py-2 text-sm" /></Field>
      <Field label="비고 2"><textarea value={values.memo2} onChange={(event) => set('memo2', event.target.value)} rows={2} className="w-full resize-y rounded-md border bg-background px-3 py-2 text-sm" /></Field>
    </div>
  )
}

function PhotoInput({ file, onChange, compact = false }: { file: File | null; onChange: (file: File | null) => void; compact?: boolean }) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <div className={compact ? '' : 'min-w-0'}>
      <input ref={ref} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={(event) => onChange(event.target.files?.[0] ?? null)} />
      <Button type="button" variant="outline" className={compact ? 'w-full' : ''} onClick={() => ref.current?.click()}>
        <UploadCloud />
        {file ? file.name : '사진 등록'}
      </Button>
      {!compact && <p className="mt-1 text-xs text-muted-foreground">대표 사진 1장, 최대 4MB</p>}
    </div>
  )
}

function LinkInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="flex gap-1">
      <Input type="url" value={value} onChange={(event) => onChange(event.target.value)} placeholder="https://" />
      {/^https?:\/\//.test(value) && (
        <a href={value} target="_blank" rel="noreferrer">
          <Button type="button" size="icon-sm" variant="outline" aria-label="링크 열기"><ExternalLink /></Button>
        </a>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const label = status === 'passed' ? '1차 통과' : status === 'hold' ? '보류' : '작성 중'
  return <span className={'inline-flex h-6 items-center rounded-full px-2 text-xs font-medium ring-1 ' + (statusClass[status] ?? statusClass.draft)}>{label}</span>
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value.toLocaleString('ko-KR')}</p>
    </div>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}{required ? <span className="ml-1 text-red-500">*</span> : null}</span>
      {children}
    </label>
  )
}

function emptyValues(exchangeRate: number, ownerOperatorId: string | null): SourcingValues {
  return {
    productName: '',
    productOption: '',
    chinaPurchaseUrl: '',
    chinaUnitPriceCny: '',
    unitShippingCny: '',
    exchangeRateKrw: String(exchangeRate),
    domesticSaleUrl: '',
    domesticSalePrice: '',
    detailPageUrl: '',
    memo1: '',
    memo2: '',
    ownerOperatorId,
  }
}

function itemValues(item: ManualSourcingItem, exchangeRate: number): SourcingValues {
  return {
    productName: item.productName,
    productOption: item.productOption ?? '',
    chinaPurchaseUrl: item.chinaPurchaseUrl ?? '',
    chinaUnitPriceCny: textNumber(item.chinaUnitPriceCny),
    unitShippingCny: textNumber(item.unitShippingCny),
    exchangeRateKrw: textNumber(item.exchangeRateKrw) || String(exchangeRate),
    domesticSaleUrl: item.domesticSaleUrl ?? '',
    domesticSalePrice: textNumber(item.domesticSalePrice),
    detailPageUrl: item.detailPageUrl ?? '',
    memo1: item.memo1 ?? '',
    memo2: item.memo2 ?? '',
    ownerOperatorId: item.ownerOperatorId,
  }
}

async function uploadPhoto(itemId: string, file: File) {
  const formData = new FormData()
  formData.set('itemId', itemId)
  formData.set('file', file)
  const response = await fetch('/api/operations/sourcing/images', { method: 'POST', body: formData })
  const result = await response.json().catch(() => ({}))
  return response.ok ? { success: true as const } : { success: false as const, error: result.error || '사진 등록에 실패했습니다.' }
}

function imageSource(item: ManualSourcingItem) {
  return item.hasImageFile ? '/api/operations/sourcing/images/' + item.id : item.legacyImageUrl
}

function numberValue(value: string) {
  const parsed = Number(value.replace(/,/g, '').trim())
  return Number.isFinite(parsed) ? parsed : null
}

function textNumber(value: number | null) {
  return value == null ? '' : String(value)
}

function money(value: number | null) {
  return value == null ? '-' : value.toLocaleString('ko-KR', { maximumFractionDigits: 2 })
}

function won(value: number | null) {
  return value == null ? '-' : '₩ ' + value.toLocaleString('ko-KR')
}

function dateText(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? '-' : new Intl.DateTimeFormat('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date)
}
