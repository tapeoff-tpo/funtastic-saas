'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronRight, Download, ExternalLink, FileSpreadsheet, ImagePlus, Loader2, Plus, RefreshCw, Save, Search, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { attachCatalog, blankDraft, calculatePrice, createRegistrationRow, detailHtml, imageStem, isImageUrl, LABEL_FIELD, matchCatalog, money, rowFields, rowIssues, type CatalogProduct, type RegistrationDraft, type RegistrationRow, type SavedFile } from '@/lib/coupang-registration/model'

const API = '/api/operations/coupang-registration'
const inputClass = 'h-8 rounded-md border bg-background px-2 text-xs outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100'
const buttonClass = 'inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border bg-background px-3 text-xs font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40'
const won = (value: number | null) => value === null ? '—' : `${value.toLocaleString('ko-KR', { maximumFractionDigits: 0 })}원`
const inputWon = (value: number) => `${value.toLocaleString('ko-KR', { maximumFractionDigits: 6 })}원`
const marginText = (value: number | null, digits: number) => value === null ? '—' : `${value.toLocaleString('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`
type DraftSummary = { id: string; name: string; revision: number; updatedAt: string }

async function jsonRequest(path: string, init?: RequestInit) {
  const response = await fetch(`${API}${path}`, init)
  const body = await response.json().catch(() => null)
  if (!response.ok || !body) throw new Error(body?.error ?? '요청을 처리하지 못했습니다.')
  return body
}
function postJson(path: string, value: unknown) {
  const body = JSON.stringify(value)
  if (new TextEncoder().encode(body).length > 4_000_000) throw new Error('작업 용량이 4MB를 초과했습니다. 견적서 또는 상품을 나눠주세요.')
  return jsonRequest(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
}

async function fillMissingCosts(rows: RegistrationRow[]) {
  const missing = rows.filter((row) => row.costPrice == null && (row.internalSku || row.sourceName || row.name))
  const found = new Map<string, { internalSku: string; costPrice: number }>()
  for (let start = 0; start < missing.length; start += 30) {
    const lookup = missing.slice(start, start + 30).map(({ id, name, sourceName, optionName, internalSku }) => ({
      id, name, sourceName, optionName, internalSku,
    }))
    const { costs } = await postJson('/costs', lookup)
    for (const { id, internalSku, costPrice } of costs) found.set(id, { internalSku, costPrice })
  }
  return {
    rows: rows.map((row) => row.costPrice == null && found.has(row.id) ? { ...row, ...found.get(row.id) } : row),
    filled: found.size,
    unresolved: missing.length - found.size,
  }
}

async function fillMissingCostsOnOpen(rows: RegistrationRow[]) {
  try { return await fillMissingCosts(rows) } catch {
    toast.error('원가를 자동으로 불러오지 못했습니다. 빈 원가 채우기로 다시 시도해주세요.')
    return { rows, filled: 0 }
  }
}
async function savedFile(file: File): Promise<SavedFile> {
  if (file.size > 3_000_000) throw new Error('파일은 3MB 이하로 선택해주세요.')
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
  return { name: file.name.normalize('NFC'), data }
}

export function CoupangRegistrationWorkbench() {
  const [draft, setDraft] = useState<RegistrationDraft>(blankDraft)
  const [currentId, setCurrentId] = useState<string>()
  const [revision, setRevision] = useState<number>()
  const [saved, setSaved] = useState<DraftSummary[]>([])
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [activeId, setActiveId] = useState('')
  const [catalogOpen, setCatalogOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [catalog, setCatalog] = useState<CatalogProduct[]>([])
  const [searched, setSearched] = useState(false)
  const [rowSearch, setRowSearch] = useState('')
  const [templateChoice, setTemplateChoice] = useState('')
  const [onlyIssues, setOnlyIssues] = useState(false)
  const templateInput = useRef<HTMLInputElement>(null)
  const labelInput = useRef<HTMLInputElement>(null)
  const active = draft.rows.find((row) => row.id === activeId)
  const issueMap = new Map(draft.rows.map((row) => [row.id, rowIssues(row, draft)]))
  const needsInfo = draft.rows.filter((row) => issueMap.get(row.id)!.length)
  const visible = draft.rows.filter((row) => (!onlyIssues || issueMap.get(row.id)!.length) && [row.name, row.internalSku, row.sourceCode].some((value) => value.toLowerCase().includes(rowSearch.toLowerCase())))
  const allVisibleSelected = visible.length > 0 && visible.every((row) => selected.has(row.id))

  function update(change: (value: RegistrationDraft) => RegistrationDraft) { setDraft(change); setDirty(true) }
  function patchRow(id: string, patch: Partial<RegistrationRow>) {
    update((value) => ({ ...value, rows: value.rows.map((row) => row.id === id ? { ...row, ...patch } : row) }))
  }
  function toggle(id: string) { setSelected((value) => { const next = new Set(value); if (next.has(id)) next.delete(id); else next.add(id); return next }) }
  async function refreshDrafts() { const response = await jsonRequest('/drafts'); setSaved(response.drafts) }
  useEffect(() => { void refreshDrafts().catch((error) => toast.error(error.message)) }, [])
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault() }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [dirty])
  async function run(label: string, action: () => Promise<void>) {
    if (busy) return
    setBusy(label)
    try { await action() } catch (error) { toast.error(error instanceof Error ? error.message : '처리하지 못했습니다.') } finally { setBusy('') }
  }

  async function importTemplates(files: FileList | null) {
    if (!files?.length) return
    await run('견적서 불러오는 중', async () => {
      let next = draft
      for (const file of Array.from(files)) {
        const form = new FormData(); form.set('file', file)
        const response = await jsonRequest('/template', { method: 'POST', body: form })
        if (next.templates.some((template) => template.id === response.template.id)) continue
        if (next.templates.length >= 6 || next.rows.length + response.rows.length > 500) throw new Error('작업당 견적서 6개, 등록행 500개까지 사용할 수 있습니다.')
        next = { ...next, templates: [...next.templates, response.template], rows: [...next.rows, ...response.rows] }
      }
      const costs = await fillMissingCostsOnOpen(next.rows)
      setDraft({ ...next, rows: costs.rows }); setDirty(true)
      toast.success(`견적서 ${next.templates.length}개 · 등록행 ${next.rows.length}개를 불러왔습니다.`)
    })
    if (templateInput.current) templateInput.current.value = ''
  }

  async function reloadCosts() {
    await run('품목 신규 원가 확인 중', async () => {
      const targets = selected.size ? draft.rows.filter((row) => selected.has(row.id)) : draft.rows
      const result = await fillMissingCosts(targets)
      const byId = new Map(result.rows.map((row) => [row.id, row]))
      if (result.filled) update((value) => ({
        ...value,
        rows: value.rows.map((row) => row.costPrice == null ? byId.get(row.id) ?? row : row),
      }))
      toast.success(`원가 ${result.filled}개 입력 · 확인 필요 ${result.unresolved}개`)
    })
  }

  async function importLabels(files: FileList | null) {
    if (!files?.length) return
    await run('품질표시 불러오는 중', async () => {
      const labels: SavedFile[] = []
      for (const file of Array.from(files)) {
        if (!/\.(jpe?g|png)$/i.test(file.name)) throw new Error('품질표시는 JPG·PNG 파일로 선택해주세요.')
        labels.push(await savedFile(file))
      }
      update((value) => {
        const merged = [...new Map([...value.labels, ...labels].map((file) => [file.name, file])).values()]
        return { ...value, labels: merged, rows: value.rows.map((row) => {
          if (row.label) return row
          const expected = imageStem(`${row.sourceName || row.name} 품질`)
          const matches = merged.filter((file) => imageStem(file.name) === expected)
          return matches.length === 1 ? { ...row, label: matches[0].name } : row
        }) }
      })
      toast.success(`품질표시 ${labels.length}개를 추가했습니다.`)
    })
    if (labelInput.current) labelInput.current.value = ''
  }

  async function syncImages() {
    const targets = selected.size ? draft.rows.filter((row) => selected.has(row.id)) : draft.rows
    if (!targets.length) return
    await run('상품·이미지 매칭 중', async () => {
      const matched: CatalogProduct[] = []
      for (let start = 0; start < targets.length; start += 30) {
        const chunk = targets.slice(start, start + 30)
        const response = await postJson('/catalog', { names: chunk.map((row) => row.sourceName || row.name), codes: chunk.map((row) => row.sourceCode).filter(Boolean) })
        matched.push(...response.products)
      }
      const products = [...new Map(matched.map((product) => [product.code, product])).values()]
      const targetIds = new Set(targets.map((row) => row.id))
      update((value) => ({ ...value, rows: value.rows.map((row) => {
        if (!targetIds.has(row.id)) return row
        const match = matchCatalog(row, products)
        if (!match) return row
        return attachCatalog(row, match)
      }) }))
      const count = targets.filter((row) => matchCatalog(row, products)).length
      toast.success(`${targets.length}개 중 ${count}개를 매칭했습니다. 기존 입력 가격은 유지했습니다.`)
    })
  }

  async function save(asNew = false) {
    await run('저장 중', async () => {
      const response = await postJson('/drafts', { draft, ...(!asNew && currentId ? { id: currentId, revision } : {}) })
      setCurrentId(response.id); setRevision(response.revision); setDirty(false)
      await refreshDrafts(); toast.success('가격·견적서·품질표시를 저장했습니다.')
    })
  }
  async function load(id: string) {
    if (!id || dirty && !window.confirm('저장하지 않은 변경사항이 있습니다. 저장된 작업을 불러올까요?')) return
    await run('작업 불러오는 중', async () => {
      const response = await jsonRequest(`/drafts?id=${encodeURIComponent(id)}`)
      const payload: RegistrationDraft = response.payload
      const costs = await fillMissingCostsOnOpen(payload.rows)
      setDraft({ ...payload, rows: costs.rows }); setCurrentId(response.id); setRevision(response.revision); setDirty(costs.filled > 0); setSelected(new Set()); setActiveId('')
    })
  }
  function newDraft() {
    if (dirty && !window.confirm('저장하지 않은 변경사항이 있습니다. 새 작업을 시작할까요?')) return
    setDraft(blankDraft()); setCurrentId(undefined); setRevision(undefined); setDirty(false); setSelected(new Set()); setActiveId('')
  }
  async function download() {
    const rows = selected.size ? draft.rows.filter((row) => selected.has(row.id)) : draft.rows
    const errors = rows.flatMap((row) => issueMap.get(row.id) ?? [])
    if (errors.length) { setOnlyIssues(true); toast.error(`필수항목 ${errors.length}건을 먼저 확인해주세요.`); return }
    await run('견적서 만드는 중', async () => {
      const body = JSON.stringify({ ...draft, rows })
      if (new TextEncoder().encode(body).length > 4_000_000) throw new Error('작업 용량이 4MB를 초과했습니다. 견적서를 나눠주세요.')
      const response = await fetch(`${API}/export`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
      if (!response.ok) throw new Error((await response.json()).error)
      const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = document.createElement('a')
      link.href = url; link.download = `쿠팡상품등록_${new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' })}.zip`; link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      toast.success('등록용 엑셀과 품질표시 파일을 다운로드했습니다.')
    })
  }
  async function addProduct(product: CatalogProduct, optionName: string) {
    if (draft.rows.length >= 500) { toast.error('등록행은 500개까지 추가할 수 있습니다.'); return }
    if (draft.rows.some((row) => row.sourceCode === product.code && row.optionName === optionName)) { toast.error('이미 추가된 상품 옵션입니다.'); return }
    await run('선택 상품의 가격·원가 확인 중', async () => {
      const response = await jsonRequest(`/catalog?code=${encodeURIComponent(product.code)}`)
      const full: CatalogProduct = response.product
      setCatalog((value) => value.map((item) => item.code === full.code ? full : item))
      if (full.options.length ? !full.options.some((option) => option.name === optionName) : !!optionName) {
        throw new Error('상품 옵션이 변경되었습니다. 최신 옵션을 다시 선택해주세요.')
      }
      const row = createRegistrationRow(full, optionName)
      update((value) => ({ ...value, rows: [...value.rows, row] })); setActiveId(row.id)
      toast.success(`${row.name} 추가`)
    })
  }

  return <fieldset disabled={!!busy} className="min-w-0 space-y-4 pb-8">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground"><span>상품등록·광고</span><ChevronRight className="size-3" /><span>로켓배송</span></div><h1 className="text-2xl font-semibold tracking-tight">쿠팡상품등록</h1><p className="mt-1 text-xs text-muted-foreground">상품을 모으고 가격·이미지를 확인한 뒤 쿠팡 견적서로 내려받으세요.</p></div>
      <div className="flex flex-wrap items-center gap-2"><span className="mr-1 text-xs text-muted-foreground">{dirty ? '저장하지 않은 변경사항' : currentId ? '저장됨' : '새 작업'}</span><button className={buttonClass} disabled={!!busy} onClick={newDraft}><Plus className="size-3.5" />새 작업</button><button className={buttonClass} disabled={!!busy} onClick={() => void save()}><Save className="size-3.5" />임시저장</button><button className={`${buttonClass} border-blue-600 bg-blue-600 text-white hover:bg-blue-700`} disabled={!!busy || !draft.rows.length} onClick={() => void download()}><Download className="size-3.5" />{selected.size ? `선택 ${selected.size}개` : '전체'} 견적서 다운로드</button></div>
    </header>

    <div className="grid gap-3 sm:grid-cols-3"><Summary label="등록 준비 상품" value={`${draft.rows.length}개`} note={`견적서 ${draft.templates.length}개 · 품질표시 ${draft.labels.length}개`} /><Summary label="자료 확인 완료" value={`${draft.rows.length - needsInfo.length}개`} note="현재 양식의 필수항목 기준" /><Summary label="확인이 필요한 상품" value={`${needsInfo.length}개`} note="누락 항목과 묶음 구성을 확인하세요" warning={needsInfo.length > 0} /></div>

    <section className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap items-center gap-2"><input aria-label="작업 이름" className={`${inputClass} w-52 font-medium`} value={draft.name} onChange={(event) => update((value) => ({ ...value, name: event.target.value }))} /><select aria-label="저장된 작업 불러오기" className={`${inputClass} max-w-64`} value={currentId ?? ''} onChange={(event) => void load(event.target.value)}><option value="">저장된 작업 불러오기</option>{saved.map((item) => <option key={item.id} value={item.id}>{item.name} · {new Date(item.updatedAt).toLocaleDateString('ko-KR')}</option>)}</select>{currentId && <button className={buttonClass} disabled={!!busy} onClick={() => void save(true)}>새 작업으로 저장</button>}</div><a className="inline-flex items-center gap-1 text-xs text-blue-700 hover:underline" href="https://supplier.coupang.com/qvt/registration" target="_blank" rel="noreferrer">쿠팡 최신 양식 받기<ExternalLink className="size-3" /></a></div>
      <div className="mt-3 flex flex-wrap items-center gap-2"><button className={buttonClass} disabled={!!busy} onClick={() => templateInput.current?.click()}><FileSpreadsheet className="size-3.5" />쿠팡 견적서 불러오기</button><button className={buttonClass} disabled={!!busy} onClick={() => labelInput.current?.click()}><ImagePlus className="size-3.5" />품질표시 이미지 추가</button><input ref={templateInput} type="file" multiple accept=".xlsx" hidden onChange={(event) => void importTemplates(event.target.files)} /><input ref={labelInput} type="file" multiple accept="image/jpeg,image/png" hidden onChange={(event) => void importLabels(event.target.files)} /><span className="text-xs text-muted-foreground">작성한 견적서는 기존 상품도 함께 불러옵니다. 라벨은 파일명으로 연결합니다.</span></div>
      {draft.templates.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{draft.templates.map((template) => <span key={template.id} className="max-w-full truncate rounded bg-muted px-2 py-1 text-[11px]" title={template.name}>{template.name} · {template.sheets.length}개 카테고리</span>)}</div>}
    </section>

    <section className="overflow-hidden rounded-lg border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3"><div className="flex flex-wrap items-center gap-2"><div className="relative"><Search className="pointer-events-none absolute left-2 top-2 size-3.5 text-muted-foreground" /><input aria-label="등록목록 검색" placeholder="상품명·SKU 검색" className={`${inputClass} w-48 pl-7`} value={rowSearch} onChange={(event) => setRowSearch(event.target.value)} /></div><label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={onlyIssues} onChange={(event) => setOnlyIssues(event.target.checked)} />확인 필요만 보기</label></div><div className="flex gap-2"><button className={buttonClass} disabled={!!busy || !draft.rows.length} onClick={() => void syncImages()}><RefreshCw className="size-3.5" />{selected.size ? '선택 상품' : '전체 상품'} 이미지 연결</button><button className={buttonClass} disabled={!!busy} onClick={() => setCatalogOpen(true)}><Plus className="size-3.5" />상품 추가</button></div></div>
      <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-3 py-2"><span className="mr-1 text-xs font-medium">선택 {selected.size}개</span><select className={`${inputClass} max-w-52`} aria-label="일괄 카테고리" value={templateChoice} onChange={(event) => setTemplateChoice(event.target.value)}><option value="">쿠팡 견적서 카테고리</option>{draft.templates.flatMap((template) => template.sheets.map((sheet) => <option key={`${template.id}:${sheet.name}`} value={`${template.id}:${sheet.name}`}>{sheet.name.replace(/^QF_\d+_/, '')}</option>))}</select><button className={buttonClass} disabled={!!busy || !selected.size || !templateChoice} onClick={() => { const [templateId, sheetName] = templateChoice.split(':'); update((value) => ({ ...value, rows: value.rows.map((row) => selected.has(row.id) ? { ...row, templateId, sheetName } : row) })) }}>카테고리 적용</button><label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">판매가 올림<select aria-label="판매가 올림 단위" className={inputClass} value={draft.rounding} onChange={(event) => update((value) => ({ ...value, rounding: Number(event.target.value) }))}>{[1, 10, 100, 1000].map((unit) => <option key={unit} value={unit}>{unit.toLocaleString()}원</option>)}</select></label></div>
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <button className={buttonClass} disabled={!!busy || !draft.rows.some((row) => row.costPrice == null && (!selected.size || selected.has(row.id)))} onClick={() => void reloadCosts()}>
          <RefreshCw className="size-3.5" />빈 원가 채우기
        </button>
        <label className="text-xs text-muted-foreground" htmlFor="bulk-supply-deduction">선택 상품 추가 차감</label>
        <select id="bulk-supply-deduction" className={inputClass} value="" disabled={!selected.size || !!busy} onChange={(event) => {
          const supplyDeductionPercent: NonNullable<RegistrationRow['supplyDeductionPercent']> = event.target.value === '10' ? 10 : 0
          update((value) => ({ ...value, rows: value.rows.map((row) => selected.has(row.id) ? { ...row, supplyDeductionPercent } : row) }))
        }}>
          <option value="" disabled>차감률 선택</option>
          <option value="0">차감 없음 (0%)</option>
          <option value="10">공급가의 10%</option>
        </select>
      </div>
      <div className="overflow-x-auto"><table className="w-full min-w-[1280px] table-fixed text-center text-xs tabular-nums">
        <thead className="border-b bg-muted/40 text-muted-foreground [&_th]:h-11 [&_th]:px-2 [&_th]:text-center [&_th]:align-middle [&_th]:whitespace-nowrap"><tr>
          <th className="w-9"><input aria-label="보이는 상품 전체 선택" type="checkbox" checked={allVisibleSelected} onChange={() => setSelected((value) => { const next = new Set(value); for (const row of visible) { if (allVisibleSelected) next.delete(row.id); else next.add(row.id) } return next })} /></th>
          <th className="w-56">상품 · 옵션</th>
          <th className="w-24" title="품목의 works 신규 원가">원가</th>
          <th className="w-24">도매가</th>
          <th className="w-24">쿠팡공급가</th>
          <th className="w-24">쿠팡판매가</th>
          <th className="w-24">매출부가세</th>
          <th className="w-24" title="공급가에 차감률을 곱해 순수익에서 뺍니다">추가 차감</th>
          <th className="w-24">순수익</th>
          <th className="w-20">우리 마진</th>
          <th className="w-20">쿠팡 마진</th>
          <th className="w-24">확인 상태</th>
          <th className="w-10"><span className="sr-only">삭제</span></th>
        </tr></thead>
        <tbody>{visible.map((row) => {
          const prices = calculatePrice(row, draft.rounding)
          const issues = issueMap.get(row.id)!
          const chosen = selected.has(row.id)
          return <tr key={row.id} className={`h-16 border-b last:border-0 [&>td]:px-2 [&>td]:py-3 [&>td]:align-middle ${activeId === row.id ? 'bg-blue-50/70' : chosen ? 'bg-blue-50/30' : 'hover:bg-muted/20'}`}>
            <td><input aria-label={`${row.name} 선택`} type="checkbox" checked={chosen} onChange={() => toggle(row.id)} /></td>
            <td><button onClick={() => setActiveId(row.id)} className="flex w-full items-center justify-center gap-2"><div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded border bg-muted">{isImageUrl(row.primaryImage) ? <img src={row.primaryImage} alt="" className="size-full object-contain" /> : <FileSpreadsheet className="size-4 text-muted-foreground" />}</div><div className="min-w-0"><div className="font-medium leading-5">{row.name || '상품명 입력 필요'}</div><div className="truncate text-[10px] text-muted-foreground">{row.internalSku || '원가 SKU 미연결'}{row.sourceCode && ` · B2B ${row.sourceCode}`}</div></div></button></td>
            <td><MoneyInput label={`${row.name} 원가`} value={row.costPrice} onChange={(value) => patchRow(row.id, { costPrice: value })} /></td>
            <td><span aria-label={`${row.name} 도매가`} className="inline-flex h-8 items-center justify-center whitespace-nowrap">{won(row.wholesalePrice)}</span></td>
            <td><MoneyInput label={`${row.name} 쿠팡공급가`} value={prices.supply} onChange={(value) => patchRow(row.id, { priceMode: 'manual', manualSupplyPrice: value })} /></td>
            <td><MoneyInput label={`${row.name} 쿠팡판매가`} value={prices.sale} onChange={(value) => patchRow(row.id, { saleMode: 'manual', manualSalePrice: value })} /></td>
            <td className="whitespace-nowrap" title={row.manualSalesVat == null ? '공급가 ÷ 11' : '직접 입력한 매출부가세'}>{won(prices.salesVat)}{row.manualSalesVat != null && <div className="text-[10px] text-muted-foreground">직접 입력</div>}</td>
            <td>
              <select aria-label={`${row.name} 추가 차감률`} className={inputClass} value={row.supplyDeductionPercent ?? 0} onChange={(event) => patchRow(row.id, { supplyDeductionPercent: event.target.value === '10' ? 10 : 0 })}>
                <option value={0}>0%</option>
                <option value={10}>10%</option>
              </select>
              <div className="mt-1 whitespace-nowrap text-muted-foreground">{won(prices.deduction)}</div>
            </td>
            <td className={`whitespace-nowrap ${prices.profit !== null && prices.profit < 0 ? 'font-medium text-red-600' : ''}`}>{won(prices.profit)}</td>
            <td title={marginText(prices.profitRate, 4)}>{marginText(prices.profitRate, 0)}</td>
            <td title={marginText(prices.coupangRate, 4)}>{marginText(prices.coupangRate, 1)}</td>
            <td><button onClick={() => setActiveId(row.id)} className={`rounded px-2 py-1 text-[11px] ${issues.length ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-800'}`}>{issues.length ? `확인 ${issues.length}건` : '입력 완료'}</button>{row.sourceStatus === 'RESTOCKING' && <div className="mt-1 text-[10px] text-amber-700">B2B 예약구매</div>}</td>
            <td><button aria-label={`${row.name} 삭제`} className="rounded p-2 text-muted-foreground hover:bg-red-50 hover:text-red-600" disabled={!!busy} onClick={() => { update((value) => ({ ...value, rows: value.rows.filter((item) => item.id !== row.id) })); setSelected((value) => { const next = new Set(value); next.delete(row.id); return next }) }}><Trash2 className="size-3.5" /></button></td>
          </tr>
        })}</tbody>
      </table>{!visible.length && <div className="flex flex-col items-center gap-3 py-16 text-center"><FileSpreadsheet className="size-8 text-muted-foreground/50" /><div><p className="text-sm font-medium">{draft.rows.length ? '검색 조건에 맞는 상품이 없습니다.' : '등록할 상품을 준비하세요'}</p><p className="mt-1 text-xs text-muted-foreground">{draft.rows.length ? '검색어나 확인 필요 필터를 변경해주세요.' : '작성한 쿠팡 견적서를 불러오거나 B2B 상품을 검색해 추가하세요.'}</p></div>{!draft.rows.length && <button className={buttonClass} onClick={() => setCatalogOpen(true)}><Plus className="size-3.5" />B2B 상품 검색</button>}</div>}</div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground"><span>순수익 = 공급가 − 원가 − 매출부가세 − 추가 차감</span><span>자동 판매가 = 공급가 ÷ 0.6 · 직접 수정 시 실제 쿠팡 비중을 표시합니다.</span></div>
    </section>

    {active && <RowEditor key={active.id} row={active} draft={draft} issues={issueMap.get(active.id)!} onPatch={(patch) => patchRow(active.id, patch)} onClose={() => setActiveId('')} />}
    <p className="text-xs text-muted-foreground">견적서 다운로드 후 서플라이어 허브에서 파일 검증을 진행하세요. 현재 화면의 검사는 쿠팡의 등록 승인 결과와 다릅니다.</p>
    {busy && <div role="status" className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-lg bg-gray-900 px-4 py-3 text-sm text-white shadow-lg"><Loader2 className="size-4 animate-spin" />{busy}</div>}

    {catalogOpen && <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/35 p-4 pt-16" onClick={() => setCatalogOpen(false)}><section role="dialog" aria-modal="true" aria-label="B2B 상품 검색" className="w-full max-w-3xl rounded-xl bg-background shadow-xl" onClick={(event) => event.stopPropagation()}><header className="flex items-center justify-between border-b px-5 py-4"><div><h2 className="font-semibold">B2B 상품 추가</h2><p className="mt-1 text-xs text-muted-foreground">상품 목록을 먼저 표시합니다. 옵션 추가금과 신규원가는 상품 선택 시 확인합니다.</p></div><button aria-label="상품 검색 닫기" className="rounded p-2 hover:bg-muted" onClick={() => setCatalogOpen(false)}><X className="size-4" /></button></header><form className="flex gap-2 p-4" onSubmit={(event) => { event.preventDefault(); void run('상품 검색 중', async () => { const response = await jsonRequest(`/catalog?q=${encodeURIComponent(query)}`); setCatalog(response.products); setSearched(true) }) }}><input autoFocus aria-label="B2B 상품명 또는 코드" className={`${inputClass} h-9 flex-1`} placeholder="상품명 또는 B2B 상품코드" value={query} onChange={(event) => setQuery(event.target.value)} /><button className={`${buttonClass} h-9`} disabled={!!busy || !query.trim()}><Search className="size-4" />검색</button></form><div className="max-h-[60vh] overflow-y-auto px-4 pb-4">{catalog.map((product) => <div key={product.code} className="flex gap-3 border-t py-3"><div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded border bg-muted">{product.thumbnails[0] && <img className="size-full object-contain" src={product.thumbnails[0]} alt="" />}</div><div className="min-w-0 flex-1"><div className="font-medium">{product.name}</div><div className="mt-1 text-xs text-muted-foreground">코드 {product.code} · 도매가 {won(product.price)} · 상세 {product.detailImages.length}장</div><div className="mt-2 flex flex-wrap gap-1.5">{(product.options.length ? product.options : [{ name: '', addPrice: 0 }]).map((option) => <button key={option.name} className={buttonClass} onClick={() => void addProduct(product, option.name)}><Plus className="size-3" />{option.name || '기본 상품'}{option.addPrice > 0 ? ` (+${option.addPrice.toLocaleString()}원)` : ''}</button>)}</div></div></div>)}{searched && !catalog.length && <p className="py-10 text-center text-sm text-muted-foreground">검색된 공개 상품이 없습니다.</p>}</div></section></div>}
  </fieldset>
}

function Summary({ label, value, note, warning }: { label: string; value: string; note: string; warning?: boolean }) {
  return <div className="rounded-lg border bg-card px-4 py-3"><div className="text-xs text-muted-foreground">{label}</div><div className={`mt-1 text-2xl font-semibold tabular-nums ${warning ? 'text-amber-700' : ''}`}>{value}</div><div className="mt-1 text-[11px] text-muted-foreground">{note}</div></div>
}
function MoneyInput({ label, value, onChange, placeholder = '미입력' }: { label: string; value: number | null; onChange: (value: number | null) => void; placeholder?: string }) {
  return <input aria-label={label} type="number" min="0" max="1000000000" step="any" className={`${inputClass} w-full min-w-0 text-center tabular-nums`} value={value ?? ''} placeholder={placeholder} onChange={(event) => onChange(money(event.target.value))} />
}
function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="flex flex-col gap-1.5 text-xs"><span className="font-medium">{label}</span>{children}{hint && <span className="text-[10px] text-muted-foreground">{hint}</span>}</label>
}

function RowEditor({ row, draft, issues, onPatch, onClose }: { row: RegistrationRow; draft: RegistrationDraft; issues: string[]; onPatch: (patch: Partial<RegistrationRow>) => void; onClose: () => void }) {
  const [costQuery, setCostQuery] = useState('')
  const [costs, setCosts] = useState<CatalogProduct['costCandidates']>([])
  const [finding, setFinding] = useState(false)
  const [preview, setPreview] = useState(false)
  const sheet = draft.templates.find((template) => template.id === row.templateId)?.sheets.find((sheet) => sheet.name === row.sheetName)
  const computed = rowFields(row, draft.rounding, draft.labels)
  const prices = calculatePrice(row, draft.rounding)
  const automatic = new Set(['상품명', '공급가', '쿠팡 판매가', '대표이미지 파일명', '추가이미지 파일명', '상세이미지 파일명', 'HTML 상품 상세 컨텐츠', LABEL_FIELD])
  const fieldValue = (label: string, value: string) => onPatch({ fields: { ...row.fields, [label]: value } })
  const file = draft.labels.find((label) => imageStem(label.name) === imageStem(row.label))
  return <section className="rounded-lg border bg-card">
    <header className="flex items-center justify-between border-b p-4"><div><h2 className="font-semibold">상품 정보 확인</h2><p className="mt-1 text-xs text-muted-foreground">{row.name}</p></div><button aria-label="상품 상세 닫기" onClick={onClose} className="rounded p-2 hover:bg-muted"><X className="size-4" /></button></header>
    {issues.length > 0 && <div className="mx-4 mt-4 rounded-md border border-amber-200 bg-amber-50 p-3"><p className="text-xs font-medium text-amber-900">입력 확인 {issues.length}건</p><ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-amber-800">{issues.map((issue) => <li key={issue}>· {issue}</li>)}</ul></div>}
    <div className="grid gap-5 p-4 lg:grid-cols-[1fr_360px]"><div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2"><Field label="등록 상품명"><input className={inputClass} value={row.name} onChange={(event) => onPatch({ name: event.target.value, bundleReviewed: false })} /></Field><Field label="쿠팡 카테고리 양식"><select className={`${inputClass} w-full`} value={row.templateId && row.sheetName ? `${row.templateId}:${row.sheetName}` : ''} onChange={(event) => { const [templateId, sheetName] = event.target.value.split(':'); onPatch({ templateId: templateId ?? '', sheetName: sheetName ?? '' }) }}><option value="">견적서 카테고리 선택</option>{draft.templates.flatMap((template) => template.sheets.map((sheet) => <option key={`${template.id}:${sheet.name}`} value={`${template.id}:${sheet.name}`}>{sheet.name.replace(/^QF_\d+_/, '')}</option>))}</select></Field></div>
      <div className="rounded-md border p-3"><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs font-medium">원가 SKU 연결 · {row.internalSku || '미연결'}</span><form className="flex gap-1" onSubmit={(event) => { event.preventDefault(); setFinding(true); void jsonRequest(`/catalog?cost=1&q=${encodeURIComponent(costQuery)}`).then((response) => setCosts(response.costs)).catch((error) => toast.error(error.message)).finally(() => setFinding(false)) }}><input aria-label="원가 SKU 검색" className={`${inputClass} w-40`} placeholder="품목코드·상품명" value={costQuery} onChange={(event) => setCostQuery(event.target.value)} /><button className={buttonClass} disabled={finding || !costQuery.trim()}>{finding ? <Loader2 className="size-3 animate-spin" /> : '조회'}</button></form></div>{costs.length > 0 && <div className="mt-2 max-h-36 overflow-y-auto">{costs.map((cost) => <button key={cost.sku} className="flex w-full justify-between gap-2 border-t p-2 text-left text-xs hover:bg-muted" onClick={() => { onPatch({ internalSku: cost.sku, costPrice: cost.costPrice }); setCosts([]) }}><span>{cost.sku} · {cost.name} {cost.optionName}</span><span>{won(cost.costPrice)}</span></button>)}</div>}<p className="mt-2 text-[11px] text-muted-foreground">원가는 품목의 works 신규 원가(원화)에서 가져옵니다. 신규원가가 없으면 비워둡니다. 묶음은 구성품 원가 합계와 세트 도매가를 입력해주세요.</p></div>
      {/[2-9]\d*개입/.test(row.name) && <label className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs"><input type="checkbox" checked={row.bundleReviewed} onChange={(event) => onPatch({ bundleReviewed: event.target.checked })} />묶음 구성, 세트 원가·도매가·공급가 및 라벨을 확인했습니다.</label>}
      <div className="grid gap-3 sm:grid-cols-2"><Field label="품질표시 파일명 또는 공개 URL" hint="추가한 라벨 파일명과 일치해야 합니다. 여러 장은 쉼표로 구분합니다."><input className={inputClass} list="coupang-label-files" value={row.label} onChange={(event) => onPatch({ label: event.target.value })} /><datalist id="coupang-label-files">{draft.labels.map((label) => <option key={label.name} value={label.name} />)}</datalist></Field><div className="flex items-end gap-2"><button className={buttonClass} onClick={() => setPreview((value) => !value)}>상세 HTML {preview ? '닫기' : '미리보기'}</button>{row.sourceCode && <a className={buttonClass} href={`https://funtasticb2b.com/goods/view?no=${encodeURIComponent(row.sourceCode)}`} target="_blank" rel="noreferrer">원본 상세페이지<ExternalLink className="size-3" /></a>}</div></div>
      {file && <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">품질표시 미리보기</summary><img className="mt-2 max-h-96 max-w-full border" src={`data:image/${/\.png$/i.test(file.name) ? 'png' : 'jpeg'};base64,${file.data}`} alt="연결한 품질표시 스티커" /></details>}
      <Field label="추가이미지 URL" hint="대표이미지를 포함한 후보 목록입니다. JPG·PNG 공개 URL을 한 줄에 하나씩 입력합니다."><textarea className={`${inputClass} h-16 py-2 font-mono text-[11px]`} value={row.thumbnails.join('\n')} onChange={(event) => onPatch({ thumbnails: event.target.value.split('\n').map((value) => value.trim()).filter(Boolean), fields: { ...row.fields, '추가이미지 파일명': '' } })} /></Field>
      <Field label="상세이미지 URL" hint="JPG·PNG 공개 URL을 한 줄에 하나씩 입력합니다. HTML은 자동 생성됩니다."><textarea className={`${inputClass} h-20 py-2 font-mono text-[11px]`} value={row.detailImages.join('\n')} onChange={(event) => onPatch({ detailImages: event.target.value.split('\n').map((value) => value.trim()).filter(Boolean) })} /></Field>
      {preview && <iframe title="쿠팡 상세 HTML 미리보기" sandbox="" className="h-[560px] w-full rounded border bg-white" srcDoc={`<!doctype html><html lang="ko"><head><meta charset="utf-8"></head><body>${detailHtml(row.detailImages, row.name)}</body></html>`} />}
      <details open className="rounded-md border"><summary className="cursor-pointer px-3 py-2 text-xs font-medium">카테고리 필수정보 · 상품 사이즈·포장·인증</summary><div className="grid gap-3 border-t p-3 sm:grid-cols-2">{sheet ? sheet.columns.filter((column) => !automatic.has(column.label) && (column.requirement === '필수' || column.requirement.includes('조건부') || !!row.fields[column.label])).map((column) => <Field key={column.column} label={`${column.label}${column.requirement === '필수' ? ' *' : column.requirement.includes('조건부') ? ' (조건부)' : ''}`} hint={column.guide.slice(0, 120)}><input className={inputClass} value={row.fields[column.label] ?? ''} onChange={(event) => fieldValue(column.label, event.target.value)} title={column.guide} /></Field>) : <p className="text-xs text-muted-foreground">쿠팡 견적서를 불러오고 카테고리를 선택하면 필수 입력항목이 표시됩니다.</p>}</div></details>
      <section className="rounded-md border p-3">
        <h3 className="text-xs font-medium">수익 계산 상세</h3>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <Field label="매출부가세 직접 입력" hint="비우면 공급가 ÷ 11로 계산합니다. 합산 부가세 등 엑셀 예외 행은 값을 그대로 입력하세요.">
            <MoneyInput label="매출부가세 직접 입력" value={row.manualSalesVat ?? null}
              placeholder={prices.salesVat === null ? '자동 계산' : `자동 ${inputWon(prices.salesVat)}`}
              onChange={(manualSalesVat) => onPatch({ manualSalesVat })} />
          </Field>
          <div className="space-y-1 text-xs">
            <p>추가 차감 {prices.deduction === null ? '—' : inputWon(prices.deduction)}</p>
            <p>순수익 {prices.profit === null ? '—' : inputWon(prices.profit)}</p>
            <p>우리 마진 {marginText(prices.profitRate, 4)} · 쿠팡 마진 {marginText(prices.coupangRate, 4)}</p>
          </div>
        </div>
      </section>
    </div><aside className="space-y-3"><div><h3 className="text-xs font-medium">대표이미지 선택</h3><div className="mt-2 grid grid-cols-4 gap-2">{row.thumbnails.filter(isImageUrl).map((url, index) => <button key={url} aria-label={`대표이미지 ${index + 1} 선택`} className={`relative aspect-square overflow-hidden rounded border bg-white ${row.primaryImage === url ? 'border-blue-600 ring-2 ring-blue-200' : ''}`} onClick={() => onPatch({ primaryImage: url })}><img className="size-full object-contain" src={url} alt={`상품 이미지 ${index + 1}`} />{row.primaryImage === url && <Check className="absolute bottom-1 right-1 size-4 rounded-full bg-blue-600 text-white" />}</button>)}</div></div><Field label="대표이미지 URL"><input className={inputClass} value={row.primaryImage} onChange={(event) => onPatch({ primaryImage: event.target.value })} /></Field><div className="rounded-md bg-muted/40 p-3 text-xs leading-6"><p>상세페이지에서 <strong>상품 자체 사이즈</strong>를 확인해주세요.</p><p className="mt-2">쿠팡 물류용 <strong>포장 사이즈·무게</strong>는 포장한 상태의 실측값을 입력해야 합니다.</p><p className="mt-2 text-muted-foreground">원본 고시정보와 라벨의 내용이 일치하는지도 확인해주세요.</p></div><div className="rounded-md border p-3 text-xs"><div className="font-medium">견적서 반영 가격</div><div className="mt-2 flex flex-wrap gap-2"><button className={buttonClass} aria-label={`${row.name} 판매가 자동계산`} onClick={() => onPatch({ saleMode: 'auto', manualSalePrice: null })}>판매가 자동계산</button><button className={buttonClass} aria-label={`${row.name} 판매가 기준 쿠팡 40% 맞추기`} disabled={!computed['쿠팡 판매가']} onClick={() => onPatch({ priceMode: 'manual', manualSupplyPrice: Number(computed['쿠팡 판매가']) * 3 / 5 })}>쿠팡 40% 맞추기</button></div><div className="mt-2 flex justify-between"><span className="text-muted-foreground">공급가</span><span>{computed['공급가'] ? inputWon(Number(computed['공급가'])) : '—'}</span></div><div className="mt-1 flex justify-between"><span className="text-muted-foreground">판매가</span><span className="font-semibold text-blue-700">{computed['쿠팡 판매가'] ? inputWon(Number(computed['쿠팡 판매가'])) : '—'}</span></div></div></aside></div>
  </section>
}
