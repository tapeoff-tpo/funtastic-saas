'use client'

import { useRef, useState, type FormEvent } from 'react'
import { Download, FileSpreadsheet, Loader2, X } from 'lucide-react'
import type { prepareImportDocument } from '@/lib/purchasing/china-import-document'

type Prepared = ReturnType<typeof prepareImportDocument> & { snapshot: string }
const inputClass = 'h-9 w-full rounded-md border bg-background px-2 text-sm'
const fields = [
  ['invoiceNo', '문서번호 / 发票编号', 'text'], ['invoiceDate', '문서일자 / 发票日期', 'date'],
  ['sailingDate', '선적일 / 装船日期', 'date'], ['exporter', '수출자 / 出口商', 'text'],
  ['importer', '수입자 / 进口商', 'text'], ['importerAddress', '수입자 주소 / 进口商地址', 'text'],
  ['loadingPort', '출발항 / 装货港', 'text'], ['destinationPort', '도착항 / 目的港', 'text'],
  ['paymentTerms', '결제조건 / 付款条件', 'text'],
] as const
const preferenceKeys = ['exporter', 'importer', 'importerAddress', 'loadingPort', 'destinationPort', 'paymentTerms', 'palletTareKg', 'palletExtraCbm']

export function ChinaImportDocumentDialog({ shipmentId }: { shipmentId: string }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [data, setData] = useState<Prepared | null>(null)
  const [settings, setSettings] = useState<Record<string, string>>({})
  const [items, setItems] = useState<Record<string, { englishName: string; unitPriceCny: string }>>({})
  const [boxes, setBoxes] = useState<Record<string, { grossWeightKg: string; cbm: string }>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const url = `/api/purchasing/china-shipments/${encodeURIComponent(shipmentId)}/import-documents`

  async function load() {
    setBusy(true)
    setError('')
    setData(null)
    try {
      const response = await fetch(url, { cache: 'no-store' })
      if (!response.ok) throw new Error((await response.json()).error || '수입문서 정보를 불러오지 못했습니다.')
      const next: Prepared = await response.json()
      const preferences: Record<string, string> = {}
      try {
        const saved: unknown = JSON.parse(localStorage.getItem('china-import-document-defaults') ?? '{}')
        if (saved && typeof saved === 'object') for (const key of preferenceKeys) {
          const value = (saved as Record<string, unknown>)[key]
          if (typeof value === 'string') preferences[key] = value
        }
      } catch { /* Browser storage is optional. */ }
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
      setSettings({
        exporter: 'WEIHAI TAIPUAO INTERNATIONAL TRADE CO.,LTD', importer: 'TAPEOFF CO.,LTD.',
        importerAddress: '', loadingPort: 'WEIHAI', destinationPort: 'INCHEON', paymentTerms: 'BY T/T',
        palletTareKg: '', palletExtraCbm: '', ...preferences,
        invoiceNo: next.shipmentNo, invoiceDate: today, sailingDate: next.plannedOutboundDate ?? today,
      })
      setItems(Object.fromEntries(next.items.map((item) => [item.id, { englishName: item.englishName, unitPriceCny: item.unitPriceCny == null ? '' : String(item.unitPriceCny) }])))
      setBoxes(Object.fromEntries(next.boxes.map((box) => [box.id, { grossWeightKg: box.grossWeightKg == null ? '' : String(box.grossWeightKg), cbm: box.cbm == null ? '' : String(box.cbm) }])))
      setData(next)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '수입문서 정보를 불러오지 못했습니다.') }
    finally { setBusy(false) }
  }

  async function download(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!data) return
    setBusy(true)
    setError('')
    try {
      const response = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...settings, snapshot: data.snapshot,
          palletTareKg: data.palletCount ? Number(settings.palletTareKg) : 0,
          palletExtraCbm: data.palletCount ? Number(settings.palletExtraCbm) : 0,
          items: Object.fromEntries(Object.entries(items).map(([id, value]) => [id, { ...value, unitPriceCny: Number(value.unitPriceCny) }])),
          boxes: Object.fromEntries(Object.entries(boxes).map(([id, value]) => [id, { grossWeightKg: Number(value.grossWeightKg), cbm: Number(value.cbm) }])),
        }),
      })
      if (!response.ok) throw new Error((await response.json()).error || '수입문서를 만들지 못했습니다.')
      const blobUrl = URL.createObjectURL(await response.blob())
      const anchor = document.createElement('a')
      anchor.href = blobUrl
      anchor.download = `${data.shipmentNo}_INV_PL.xlsx`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 10000)
      try { localStorage.setItem('china-import-document-defaults', JSON.stringify(Object.fromEntries(preferenceKeys.map((key) => [key, settings[key] ?? ''])))) } catch { /* Optional. */ }
    } catch (cause) { setError(cause instanceof Error ? cause.message : '수입문서를 만들지 못했습니다.') }
    finally { setBusy(false) }
  }

  return <>
    <button type="button" onClick={() => { dialog.current?.showModal(); void load() }} className="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium hover:bg-muted"><FileSpreadsheet className="size-4" />수입문서 자동작성 / 进口单证</button>
    <dialog ref={dialog} onCancel={(event) => { if (busy) event.preventDefault() }} className="m-auto max-h-[90vh] w-[min(1100px,95vw)] overflow-y-auto rounded-xl border bg-background p-5 text-foreground shadow-xl backdrop:bg-black/50">
      <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-semibold">수입문서 자동작성 / 进口单证</h2><button type="button" disabled={busy} aria-label="닫기 / 关闭" onClick={() => dialog.current?.close()}><X className="size-5" /></button></div>
      <p className="my-3 text-sm text-muted-foreground">저장된 실제 포장수량과 품목의 위안화 단가로 작성합니다. / 使用已保存的装箱数量和商品人民币单价。</p>
      {error ? <p role="alert" className="my-3 rounded-md border border-red-200 p-3 text-sm text-red-700">{error}</p> : null}
      {busy && !data ? <p className="py-8">불러오는 중 / 加载中...</p> : null}
      {!data && !busy ? <button type="button" onClick={() => void load()} className="rounded border px-3 py-2">다시 확인 / 重试</button> : null}
      {data ? <form onSubmit={download} className="space-y-5">
        <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-3">{fields.map(([key, label, type]) => <label key={key} className="space-y-1 text-sm"><span>{label}</span><input required maxLength={500} type={type} value={settings[key] ?? ''} onChange={(event) => setSettings((current) => ({ ...current, [key]: event.target.value }))} className={inputClass} /></label>)}</fieldset>
        <p className="text-sm">{data.palletCount} PLT + {data.looseBoxCount} CTN = {data.packageCount} PACKAGES · 내부 박스 / 内箱 {data.boxCount}</p>
        <fieldset disabled={busy} className="space-y-2"><legend className="font-medium">상품 단가 확인 / 商品单价确认 (CNY)</legend>
          <div className="max-h-64 overflow-auto rounded border"><table className="w-full text-sm"><thead className="sticky top-0 bg-muted"><tr>{['품목 / 商品', '실제 수량 / 数量', '영문명 / 英文名称', '단가(CNY) / 单价'].map((label) => <th key={label} className="p-2 text-left">{label}</th>)}</tr></thead><tbody>{data.items.map((item) => <tr key={item.id} className="border-t"><td className="p-2" data-no-translate>{item.sku}<br />{item.productName} {item.optionName}</td><td className="p-2">{item.quantity}</td><td className="p-2"><input required maxLength={500} aria-label={`${item.sku} English name`} className={inputClass} value={items[item.id]?.englishName ?? ''} onChange={(event) => setItems((current) => ({ ...current, [item.id]: { ...current[item.id], englishName: event.target.value } }))} /></td><td className="p-2"><input required type="number" min="0" max="100000000" step="any" aria-label={`${item.sku} CNY price`} className={inputClass} value={items[item.id]?.unitPriceCny ?? ''} onChange={(event) => setItems((current) => ({ ...current, [item.id]: { ...current[item.id], unitPriceCny: event.target.value } }))} /></td></tr>)}</tbody></table></div>
        </fieldset>
        <fieldset disabled={busy} className="space-y-2"><legend className="font-medium">박스 중량·부피 / 箱子重量和体积</legend>
          <div className="max-h-64 overflow-auto rounded border"><table className="w-full text-sm"><thead className="sticky top-0 bg-muted"><tr>{['박스 / 箱号', '파렛트 / 托盘', '총중량(kg) / 毛重', 'CBM / 体积'].map((label) => <th key={label} className="p-2 text-left">{label}</th>)}</tr></thead><tbody>{data.boxes.map((box) => <tr key={box.id} className="border-t"><td className="p-2">{box.boxNo}</td><td className="p-2">{box.palletNo ?? 'BOX'}</td>{(['grossWeightKg', 'cbm'] as const).map((key) => <td key={key} className="p-2"><input required type="number" min="0.000001" step="any" aria-label={`${box.boxNo} ${key}`} className={inputClass} value={boxes[box.id]?.[key] ?? ''} onChange={(event) => setBoxes((current) => ({ ...current, [box.id]: { ...current[box.id], [key]: event.target.value } }))} /></td>)}</tr>)}</tbody></table></div>
          {data.palletCount > 0 ? <div className="grid gap-3 sm:grid-cols-2">{[['palletTareKg', '파렛트 1개당 추가중량(kg) / 每托盘包装重量'], ['palletExtraCbm', '파렛트 1개당 추가부피(CBM) / 每托盘额外体积']].map(([key, label]) => <label key={key} className="space-y-1 text-sm"><span>{label}</span><input required type="number" min="0" step="any" className={inputClass} value={settings[key] ?? ''} onChange={(event) => setSettings((current) => ({ ...current, [key]: event.target.value }))} /></label>)}</div> : null}
        </fieldset>
        <p className="text-xs text-muted-foreground">이 화면의 수정은 이번 문서에 적용됩니다. / 此处修改仅用于本次单证。</p>
        <button type="submit" disabled={busy} className="inline-flex h-10 items-center gap-2 rounded bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50">{busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}인보이스·패킹리스트 다운로드 / 下载发票和装箱单</button>
      </form> : null}
    </dialog>
  </>
}
