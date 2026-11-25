'use client'

import { memo, useCallback, useEffect, useRef, useState, type FocusEvent } from 'react'
import { Download, Save } from 'lucide-react'
import { ShipmentCostPanel } from './shipment-cost-panel'
import { importDocumentProductCode, type ImportDocumentDraft } from '@/lib/purchasing/china-import-editing'
import type { ImportDocumentDetail, prepareImportDocument } from '@/lib/purchasing/china-import-document'
import { calculateChinaOutboundBoxCbm } from '@/lib/purchasing/china-outbound-dimensions'

type Prepared = ReturnType<typeof prepareImportDocument> & { snapshot: string; savedDocument?: { inputs: ImportDocumentDraft; revision: number; snapshot: string } | null; costPacking?: ImportDocumentDetail }
const inputClass = 'h-9 w-full rounded-md border bg-background px-2 text-sm'
const preferenceKeys = ['exporter', 'importer', 'importerAddress', 'loadingPort', 'destinationPort', 'paymentTerms', 'palletTareKg', 'palletExtraCbm']

const ImportDocumentTable = memo(function ImportDocumentTable({ html, zoom }: { html: string; zoom: string }) {
  return <div style={{ zoom, fontFamily: 'Dotum, Arial, sans-serif' }} dangerouslySetInnerHTML={{ __html: html.slice(html.indexOf('<table'), html.lastIndexOf('</table>') + 8) }} />
})

export function ImportDocumentEditor({ shipmentId, onDirtyChange, mode = 'document' }: { shipmentId: string; onDirtyChange: (dirty: boolean) => void; mode?: 'document' | 'cost' }) {
  const [template, setTemplate] = useState<'ssj' | 'tapeoff'>('ssj')
  const [data, setData] = useState<Prepared | null>(null)
  const [settings, setSettings] = useState<Record<string, string>>({})
  const [items, setItems] = useState<Record<string, { englishName: string; unitPriceCny: string; hsCode?: string }>>({})
  const [boxes, setBoxes] = useState<Record<string, { grossWeightKg: string; cbm: string }>>({})
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  const [unsaved, setUnsaved] = useState(false)
  const [saveNotice, setSaveNotice] = useState('')
  const [editing, setEditing] = useState(false)
  const editingRef = useRef(false)
  const [previewZoom, setPreviewZoom] = useState('0.65')
  const [previewHtml, setPreviewHtml] = useState('')
  const [previewError, setPreviewError] = useState('')
  const [previewBusy, setPreviewBusy] = useState(false)
  const [error, setError] = useState('')
  const url = `/api/purchasing/china-shipments/${encodeURIComponent(shipmentId)}/import-documents`

  const load = useCallback(async (signal?: AbortSignal) => {
    setBusy(true)
    setError('')
    setData(null)
    setPreviewHtml('')
    setPreviewError('')
    try {
      const response = await fetch(url, { cache: 'no-store', signal })
      if (!response.ok) throw new Error((await response.json()).error || '인보이스·패킹리스트 정보를 불러오지 못했습니다.')
      const next: Prepared = await response.json()
      if (signal?.aborted) return
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
      const saved = next.savedDocument?.inputs
      if (saved) setSettings((current) => ({ ...current, ...Object.fromEntries(Object.entries(saved).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) }))
      setItems(Object.fromEntries(next.items.map((item) => {
        const override = saved?.items[item.id]
        const price = override ? override.unitPriceCny : item.unitPriceCny
        return [item.id, { englishName: override?.englishName ?? item.englishName, hsCode: override?.hsCode ?? item.hsCode, unitPriceCny: price == null ? '' : String(price) }]
      })))
      setBoxes(Object.fromEntries(next.boxes.map((box) => {
        const override = next.savedDocument?.snapshot === next.snapshot ? saved?.boxes[box.id] : undefined
        return [box.id, { grossWeightKg: (override ? override.grossWeightKg : box.grossWeightKg)?.toString() ?? '', cbm: (override ? override.cbm : box.cbm)?.toString() ?? '' }]
      })))
      setRevision(next.savedDocument?.revision ?? 0)
      setUnsaved(false)
      setSaveNotice(next.savedDocument ? (next.savedDocument.snapshot === next.snapshot ? '저장된 문서를 불러왔습니다.' : '저장된 문서정보를 불러왔습니다. 변경된 출고자료의 수량·규격을 확인해주세요.') : '')
      setData(next)
      onDirtyChange(false)
    } catch (cause) {
      if (!signal?.aborted) setError(cause instanceof Error ? cause.message : '인보이스·패킹리스트 정보를 불러오지 못했습니다.')
    } finally {
      if (!signal?.aborted) setBusy(false)
    }
  }, [url, onDirtyChange])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  const payload = JSON.stringify({
    ...settings, template, snapshot: data?.snapshot,
    palletTareKg: 5,
    palletExtraCbm: data?.palletCount && data.pallets.some((pallet) => calculateChinaOutboundBoxCbm(pallet) == null) ? Number(settings.palletExtraCbm) : 0,
    items: Object.fromEntries(Object.entries(items).map(([id, value]) => [id, { ...value, unitPriceCny: value.unitPriceCny.trim() ? Number(value.unitPriceCny) : null }])),
    boxes: Object.fromEntries(Object.entries(boxes).map(([id, value]) => [id, { grossWeightKg: value.grossWeightKg.trim() ? Number(value.grossWeightKg) : null, cbm: value.cbm.trim() ? Number(value.cbm) : null }])),
  })
  useEffect(() => {
    if (!data || mode === 'cost' || editing) return
    const controller = new AbortController()
    setPreviewBusy(true)
    setPreviewError('')
    const timeout = window.setTimeout(async () => {
      try {
        const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...JSON.parse(payload), intent: 'preview' }), signal: controller.signal })
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || '문서 미리보기를 불러오지 못했습니다.')
        if (!controller.signal.aborted && !editingRef.current) setPreviewHtml(result.html)
      } catch (cause) { if (!controller.signal.aborted) setPreviewError(cause instanceof Error ? cause.message : '문서 미리보기를 불러오지 못했습니다.') }
      finally { if (!controller.signal.aborted) setPreviewBusy(false) }
    }, 350)
    return () => { window.clearTimeout(timeout); controller.abort() }
  }, [data, url, payload, mode, editing])

  function editCell(event: FocusEvent<HTMLDivElement>) {
    const target = event.target
    if (!(target instanceof HTMLInputElement) || !data) return
    const key = target.dataset.editKey
    if (!key || target.value === target.defaultValue) return
    const value = target.value
    for (const input of event.currentTarget.querySelectorAll<HTMLInputElement>('input[data-edit-key]')) if (input.dataset.editKey === key) { input.value = value; input.defaultValue = value }
    setUnsaved(true); setSaveNotice(''); onDirtyChange(true)
    const product = key.match(/^product:(.+):(englishName|unitPriceCny|hsCode)$/)
    if (product) {
      setItems((current) => {
        const next = { ...current }
        for (const item of data.items) if (importDocumentProductCode(item.sku) === product[1]) next[item.id] = { ...current[item.id], [product[2]]: value }
        return next
      })
    } else if (key === 'importerAddress1' || key === 'importerAddress2') {
      setSettings((current) => { const lines = (current.importerAddress ?? '').split('\n'); lines[key === 'importerAddress1' ? 0 : 1] = value; return { ...current, importerAddress: lines.join('\n') } })
    } else if (['invoiceNo', 'invoiceDate', 'sailingDate', 'exporter', 'importer', 'loadingPort', 'destinationPort', 'paymentTerms'].includes(key)) setSettings((current) => ({ ...current, [key]: value }))
  }
  async function saveDocument() {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...JSON.parse(payload), intent: 'save-document', revision }) })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || '문서를 저장하지 못했습니다.')
    setRevision(result.revision); setUnsaved(false); onDirtyChange(false); setSaveNotice('저장되었습니다.')
  }
  async function save() {
    if (!data || busy) return
    setBusy(true); setError('')
    try { await saveDocument() } catch (cause) { setError(cause instanceof Error ? cause.message : '문서를 저장하지 못했습니다.') }
    finally { setBusy(false) }
  }

  async function download() {
    if (!data) return
    setBusy(true)
    setError('')
    try {
      const response = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: payload,
      })
      if (!response.ok) throw new Error((await response.json()).error || '인보이스·패킹리스트를 만들지 못했습니다.')
      const blobUrl = URL.createObjectURL(await response.blob())
      const anchor = document.createElement('a')
      anchor.href = blobUrl
      anchor.download = `${data.shipmentNo}_INV_PL_${template.toUpperCase()}.xlsx`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 10000)
      try { localStorage.setItem('china-import-document-defaults', JSON.stringify(Object.fromEntries(preferenceKeys.map((key) => [key, settings[key] ?? ''])))) } catch { /* Optional. */ }
    } catch (cause) { setError(cause instanceof Error ? cause.message : '인보이스·패킹리스트를 만들지 못했습니다.') }
    finally { setBusy(false) }
  }

  return <div className="space-y-4">
    {mode === 'document' && <section aria-label="인보이스·패킹리스트 작성" className="rounded-lg border bg-background p-4">
      {error ? <p role="alert" className="my-3 rounded-md border border-red-200 p-3 text-sm text-red-700">{error}</p> : null}
      {busy && !data ? <p className="py-8">불러오는 중 / 加载中...</p> : null}
      {!data && !busy ? <button type="button" onClick={() => void load()} className="rounded border px-3 py-2">다시 확인 / 重试</button> : null}
      {data && <section aria-label="인보이스·패킹리스트 미리보기" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">INVOICE · PACKING LIST</h2><div role="group" aria-label="문서 양식" className="my-2 flex gap-4">{(['ssj', 'tapeoff'] as const).map((value) => <label key={value} className="flex items-center gap-2 text-sm"><input type="radio" name="import-template" value={value} checked={template === value} disabled={busy} onChange={() => { setPreviewHtml(''); setTemplate(value) }} />{value.toUpperCase()}용</label>)}</div><p className="text-xs text-muted-foreground">{template === 'tapeoff' ? 'TAPEOFF: 기준 단가 × 1.3 (현지 수수료 포함) · Measurement에 검역 문구 표시. 단가 수정은 SSJ용에서 하세요.' : 'SSJ: 기존 기준 단가 사용'}</p><p className="text-xs text-muted-foreground">파란 칸을 클릭해 수정 후 저장하세요. 수량·박스번호·합계는 자동 계산됩니다.</p></div><div className="flex items-center gap-2"><label className="text-xs">확대 <select aria-label="문서 미리보기 배율" value={previewZoom} onChange={(event) => setPreviewZoom(event.target.value)} className="rounded border bg-background px-2 py-2">{[['0.5', '50%'], ['0.65', '65%'], ['0.8', '80%'], ['1', '100%']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><button type="button" disabled={busy} onClick={() => void save()} className="inline-flex items-center gap-2 rounded border px-3 py-2 text-sm disabled:opacity-50"><Save className="size-4" />{busy ? '처리 중…' : '저장'}</button><button type="button" disabled={busy || previewBusy} onClick={() => void download()} className="inline-flex items-center gap-2 rounded bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"><Download className="size-4" />엑셀 다운로드</button></div></div>
        {previewBusy && <p role="status" className="text-sm text-muted-foreground">양식 미리보기 불러오는 중…</p>}
        {previewError && <p role="alert" className="text-sm text-red-700">{previewError}</p>}
        {saveNotice && <p role="status" className="text-sm text-emerald-700">{saveNotice}</p>}
        {unsaved && <p className="text-xs text-amber-700">저장하지 않은 변경사항이 있습니다.</p>}
        {previewHtml && <fieldset disabled={busy} className="min-w-0"><div aria-label="인보이스·패킹리스트 엑셀 양식" className="max-h-[72vh] overflow-auto rounded border bg-slate-100 p-4 text-black" onFocusCapture={() => { editingRef.current = true; setEditing(true) }} onBlurCapture={(event) => { editCell(event); if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { editingRef.current = false; setEditing(false) } }}>
          <ImportDocumentTable html={previewHtml} zoom={previewZoom} />
        </div></fieldset>}

      </section>}
    </section>}
    {mode === 'cost' && <section aria-label="회차 원가 상품 단가" className="space-y-3 rounded-lg border bg-background p-4">
      {busy && !data && <p>회차 원가 정보를 불러오는 중…</p>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {!data && !busy && <button type="button" onClick={() => void load()} className="rounded border px-3 py-2">다시 확인</button>}
      {data && <><h2 className="font-semibold">상품 매입단가 (CNY)</h2><div className="max-h-64 overflow-auto rounded border"><table className="w-full text-left text-sm"><thead className="sticky top-0 bg-muted"><tr>{['품목코드', '상품명 / 옵션', '수량', '매입단가(CNY)'].map((label) => <th key={label} className="p-2">{label}</th>)}</tr></thead><tbody>{data.items.map((item) => <tr key={item.id} className="border-t"><td className="p-2">{item.sku}</td><td className="p-2">{item.productName} {item.optionName}</td><td className="p-2">{item.quantity}</td><td className="p-2"><input aria-label={`${item.sku} 원가 계산 단가`} type="number" min="0" step="any" className={inputClass} value={items[item.id]?.unitPriceCny ?? ''} onChange={(event) => { onDirtyChange(true); setItems((current) => ({ ...current, [item.id]: { ...current[item.id], unitPriceCny: event.target.value } })) }} /></td></tr>)}</tbody></table></div></>}
    </section>}
    {mode === 'cost' && data?.costPacking && <ShipmentCostPanel key={data.snapshot} packing={data.costPacking} url={url} snapshot={data.snapshot}
      prices={Object.fromEntries(Object.entries(items).map(([id, value]) => [id, value.unitPriceCny]))} />}
  </div>
}
