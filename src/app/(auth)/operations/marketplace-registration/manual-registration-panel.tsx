'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Copy, Plus, Store } from 'lucide-react'
import { toast } from 'sonner'
import { MallPriceCell } from '../../analytics/price-table/mall-price-cell'
import { saveManualRegistrationNumber, saveMallDisplayedPrice } from '../../analytics/price-table/price-registration-actions'

export type ManualRegistrationMall = {
  id: string
  label: string
  numbers: Array<{ key: string; value: string; date: string | null; manual: boolean }>
  price: number | null
  priceEdited: boolean
  margin: number | null
  fee: number | null
  groupSnapshot?: string
  options?: Array<{ rowId: string; sku: string; label: string; registrationPrice: number | null; overridePrice?: number | null;
    displayedPrice: number | null; displayedDate: string | null; priceEdited: boolean }>
  shippingExcluded?: boolean
}

export function RegistrationCopy({ label, value }: { label: string; value: string | null | undefined }) {
  const [copied, setCopied] = useState(false)
  if (!value) return <div className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 text-xs text-muted-foreground">미입력</dd></div>
  return <div className="min-w-0">
    <dt className="text-xs text-muted-foreground">{label}</dt>
    <dd className="mt-1 flex items-start gap-2">
      <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm">{value}</span>
      <button type="button" aria-label={`${label} 복사`} className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value)
            setCopied(true)
            toast.success(`${label}을 복사했습니다.`)
          } catch { toast.error('복사하지 못했습니다. 내용을 선택해 복사해주세요.') }
        }}>
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </button>
    </dd>
  </div>
}

export function ManualRegistrationPanel({ rowId, malls, initialMallId }: {
  rowId: string
  malls: ManualRegistrationMall[]
  initialMallId?: string
}) {
  const registered = malls.filter((mall) => mall.numbers.length > 0)
  const unregistered = malls.filter((mall) => mall.numbers.length === 0)
  const initial = malls.find((mall) => mall.id === initialMallId)
  const initialRegistered = initial ? initial.numbers.length > 0 : registered.length > 0
  const [tab, setTab] = useState<'registered' | 'unregistered'>(initialRegistered ? 'registered' : 'unregistered')
  const visible = tab === 'registered' ? registered : unregistered
  return <section aria-label="몰별 수동 등록" className="space-y-3">
    <div className="flex flex-wrap items-center gap-1 border-b">
      {([
        { id: 'registered', label: '등록된 몰', count: registered.length },
        { id: 'unregistered', label: '미등록 몰', count: unregistered.length },
      ] as const).map((item) => <button key={item.id} type="button" aria-label={`${item.label} ${item.count}`} aria-pressed={tab === item.id}
        onClick={() => setTab(item.id)}
        className="flex items-center gap-2 border-b-2 border-transparent px-3 py-2 text-sm aria-pressed:border-primary aria-pressed:font-semibold">
        {item.label}<span className="text-xs tabular-nums text-muted-foreground">{item.count}</span>
      </button>)}
    </div>
    <p className="text-xs text-muted-foreground">
      {tab === 'registered' ? '상품번호를 더블클릭하면 수정할 수 있습니다.' : '각 몰에서 직접 등록한 후 상품번호를 입력하세요.'}
      {malls.some((mall) => mall.groupSnapshot) && ' 대표번호를 저장하면 같은 상품의 모든 옵션에 반영됩니다.'}
    </p>
    <div className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">
      {visible.map((mall) => <MallCard key={mall.id} rowId={rowId} mall={mall}
        onRegistered={() => setTab('registered')} />)}
    </div>
    {!visible.length && <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
      {tab === 'registered' ? '등록된 몰이 없습니다.' : '모든 몰에 등록번호가 입력되어 있습니다.'}
    </p>}
  </section>
}

function MallCard({ rowId, mall, onRegistered }: {
  rowId: string
  mall: ManualRegistrationMall
  onRegistered: () => void
}) {
  const router = useRouter()
  const [editing, setEditing] = useState<{ key: string | null; previousValue: string | null } | null>(null)
  const [showOptions, setShowOptions] = useState(false)
  const [draft, setDraft] = useState('')
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState('')
  function startEdit(key: string | null, value: string | null) {
    setDraft(value ?? '')
    setEditing({ key, previousValue: value })
    setError('')
  }
  function save() {
    if (!editing) return
    startTransition(async () => {
      setError('')
      try {
        const result = await saveManualRegistrationNumber({
          rowId, mallId: mall.id, identifierKey: editing.key, previousValue: editing.previousValue, number: draft,
          ...(mall.groupSnapshot ? { groupSnapshot: mall.groupSnapshot } : {}),
        })
        if (result.error) { setError(result.error); return }
        setEditing(null)
        toast.success(`${mall.label} 상품번호를 저장했습니다.`)
        onRegistered()
        router.refresh()
      } catch { setError('저장하지 못했습니다. 다시 시도해주세요.') }
    })
  }
  return <article aria-label={`${mall.label} 등록정보`} className={`min-w-0 space-y-3 rounded-lg border bg-card p-3 ${mall.numbers.length ? 'border-emerald-200 dark:border-emerald-900' : ''}`}>
    <div className="flex items-center justify-between gap-2">
      <h3 className="flex min-w-0 items-center gap-1.5 text-sm font-semibold"><Store className="size-3.5 shrink-0 text-muted-foreground" /><span className="truncate" title={mall.label}>{mall.label}</span></h3>
      <span className={`shrink-0 text-[11px] ${mall.numbers.length ? 'text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground'}`}>{mall.groupSnapshot && mall.numbers.length > 1 ? '번호 확인' : mall.numbers.length ? '등록됨' : '미등록'}</span>
    </div>
    {editing ? <form onSubmit={(event) => { event.preventDefault(); save() }} className="space-y-2">
      <label className="grid gap-1 text-xs">상품등록번호
        <input autoFocus required maxLength={200} aria-label={`${mall.label} 상품등록번호`} value={draft}
          disabled={pending} onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Escape' && !pending) setEditing(null) }}
          className="min-w-0 w-full rounded-md border bg-background px-2 py-1.5 font-mono text-sm" />
      </label>
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button disabled={pending} className="rounded bg-primary px-3 py-1 text-xs text-primary-foreground">{pending ? '저장 중' : '저장'}</button>
        <button type="button" disabled={pending} onClick={() => setEditing(null)} className="rounded border px-3 py-1 text-xs">취소</button>
      </div>
    </form> : mall.numbers.length ? <div className="space-y-2">
      {mall.numbers.map((number) => <div key={number.key + number.value}>
        <button type="button" aria-label={`${mall.label} 상품번호 ${number.value}`}
          title="더블클릭 또는 Enter로 수정" onDoubleClick={() => startEdit(number.key, number.value)}
          onKeyDown={(event) => { if (event.key === 'Enter' || event.key === 'F2') { event.preventDefault(); startEdit(number.key, number.value) } }}
          className={`max-w-full break-all rounded px-1 py-0.5 text-left font-mono text-sm hover:bg-muted ${number.manual ? 'text-amber-700 dark:text-amber-400' : ''}`}>
          {number.value}
        </button>
        {number.date && <p className="text-[10px] text-muted-foreground">입력일 {number.date}</p>}
      </div>)}
    </div> : <button type="button" onClick={() => startEdit(null, null)}
      aria-label={`${mall.label} 등록번호 입력`} className="flex w-full items-center justify-center gap-1 rounded-md border border-dashed px-2 py-3 text-xs text-muted-foreground hover:bg-muted">
      <Plus className="size-3.5" />등록번호 입력
    </button>}
    <div className="flex flex-wrap items-center justify-between gap-1 border-t pt-2 text-xs">
      <span className="text-muted-foreground">등록가</span>
      <span className={mall.priceEdited ? 'font-semibold text-amber-700 dark:text-amber-400' : 'font-semibold'}>{mall.options ? amountRange(mall.options.map((option) => option.registrationPrice)) : amountRange([mall.price])}</span>
    </div>
    {mall.options && <>
      <div className="flex flex-wrap items-center justify-between gap-1 text-xs">
        <span className="text-muted-foreground">몰 표시가</span>
        <span>{amountRange(mall.options.map((option) => option.displayedPrice), '미확인')}</span>
      </div>
      <button type="button" aria-expanded={showOptions} onClick={() => setShowOptions((value) => !value)}
        className="w-full rounded border px-2 py-1.5 text-left text-xs hover:bg-muted">
        옵션별 등록가·몰 표시가 {mall.options.length}개 {showOptions ? '접기' : '보기'}
      </button>
      {showOptions && <div className="overflow-auto">
        <p className="mb-2 text-[10px] text-muted-foreground">몰 표시가는 직접 확인한 금액입니다.</p>
        <table className="w-full text-left text-[11px]">
          <thead><tr><th className="py-1">옵션</th><th className="py-1 text-right">등록가</th><th className="py-1 text-right">몰 표시가</th></tr></thead>
          <tbody>{mall.options.map((option) => <tr key={option.rowId} className="border-t">
            <td className="max-w-28 py-2 pr-1"><span className="block truncate" title={option.label}>{option.label}</span><span className="block font-mono text-[10px] text-muted-foreground">{option.sku}</span></td>
            <td className={`py-2 text-right tabular-nums ${option.priceEdited ? 'text-amber-700' : ''}`}><MallPriceCell rowId={option.rowId} mallId={mall.id} mallName={mall.label} productName={option.label}
              price={option.registrationPrice} override={option.overridePrice ?? null} canEdit priceLabel="등록가"><></></MallPriceCell></td>
            <td className="py-2 pl-1 text-right"><DisplayedPriceEditor rowId={option.rowId} mallId={mall.id}
              label={option.label} price={option.displayedPrice} date={option.displayedDate} /></td>
          </tr>)}</tbody>
        </table>
      </div>}
    </>}
    {mall.fee !== null && <p className="text-[11px] text-muted-foreground">수수료 {mall.fee}%{mall.margin !== null && ` · 예상 마진 ${mall.margin.toLocaleString('ko-KR')}원`}{mall.margin !== null && mall.shippingExcluded && ' · 배송비 제외'}</p>}
    {mall.margin !== null && mall.margin <= 0 && <p className="text-xs font-medium text-red-600">마진 검토가 필요합니다.</p>}
  </article>
}


function amountRange(values: Array<number | null>, empty = '미입력') {
  const amounts = values.filter((value): value is number => value !== null)
  if (!amounts.length) return empty
  const low = Math.min(...amounts)
  const high = Math.max(...amounts)
  return low === high ? `${low.toLocaleString('ko-KR')}원`
    : `${low.toLocaleString('ko-KR')}~${high.toLocaleString('ko-KR')}원`
}

function DisplayedPriceEditor({ rowId, mallId, label, price, date }: {
  rowId: string; mallId: string; label: string; price: number | null; date: string | null
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [pending, startTransition] = useTransition()
  function open() { setValue(price === null ? '' : String(price)); setEditing(true) }
  if (!editing) return <div>
    <button type="button" aria-label={`${label} 몰 표시가 입력`} onClick={() => { if (price === null) open() }}
      onDoubleClick={open} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); open() } }}
      title="더블클릭하여 확인한 금액 입력" className="text-primary underline-offset-2 hover:underline">{price === null ? '확인금액 입력' : price.toLocaleString('ko-KR')}</button>
    {date && <p className="text-[10px] text-muted-foreground">{date} 확인</p>}
  </div>
  return <form className="space-y-1" onSubmit={(event) => {
    event.preventDefault()
    startTransition(async () => {
      try {
        const result = await saveMallDisplayedPrice({ rowId, mallId, price: value, previousPrice: price })
        if (result.error) { toast.error(result.error); return }
        setEditing(false)
        router.refresh()
      } catch { toast.error('표시가를 저장하지 못했습니다.') }
    })
  }}>
    <input autoFocus required min="0" max="9999999999.99" step="0.01" type="number" value={value}
      onChange={(event) => setValue(event.target.value)} aria-label={`${label} 확인한 몰 표시가`}
      disabled={pending} className="w-24 rounded border bg-background p-1 text-xs" />
    <div className="flex justify-end gap-1"><button disabled={pending} className="rounded border px-1 py-0.5">저장</button>
      <button type="button" disabled={pending} onClick={() => setEditing(false)} className="px-1 py-0.5">취소</button></div>
  </form>
}
