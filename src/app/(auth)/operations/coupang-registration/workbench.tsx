'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronRight, Download, ExternalLink, FileSpreadsheet, ImagePlus, Loader2, Plus, RefreshCw, Save, Search, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { applyProductMasterDefaults, applyRegistrationDefaults, attachCatalog, blankDraft, BUNDLE_COMPONENT_LIMIT, BUNDLE_QUANTITY_LIMIT, calculatePrice, confirmPricing, createRegistrationRow, detailHtml, getRegistrationStage, imageStem, isAutomaticTemplateColumn, isImageUrl, LABEL_FIELD, matchCatalog, money, priceIssues, returnToPricing, rowFields, rowIssues, type BundleComponent, type CatalogProduct, type RegistrationDraft, type RegistrationRow, type SavedFile, type TemplateColumn } from '@/lib/coupang-registration/model'
import { applyConvertedQualityLabels, applyQualityLabelIssue, qualityPdfNeedsConversion } from '@/lib/coupang-registration/quality-labels'
import { checkSupplierRegistration, pingSupplierExtension, startSupplierRegistration, subscribeSupplierRegistration } from '@/lib/coupang-registration/supplier-bridge'
import { CategoryRecommendations } from './category-recommendations'

const API = '/api/operations/coupang-registration'
const inputClass = 'h-8 rounded-md border bg-background px-2 text-xs outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100'
const buttonClass = 'inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border bg-background px-3 text-xs font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40'
const won = (value: number | null) => value === null ? '—' : `${value.toLocaleString('ko-KR', { maximumFractionDigits: 0 })}원`
const inputWon = (value: number) => `${value.toLocaleString('ko-KR', { maximumFractionDigits: 6 })}원`
const bundleKey = (component: BundleComponent) => JSON.stringify([component.sourceCode, component.optionName])
const marginText = (value: number | null, digits: number) => value === null ? '—' : `${value.toLocaleString('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`
type DraftSummary = { id: string; name: string; revision: number; updatedAt: string }
type CategoryTemplate = { id: string; name: string; sheets: Array<{ name: string }> }
type ConnectedTemplate = RegistrationDraft['templates'][number]
type CatalogSelection = { product: CatalogProduct; optionName: string }
type RegistrationStage = 'pricing' | 'information' | 'registered'
const steps: Array<{ stage: RegistrationStage; title: string; note: string }> = [
  { stage: 'pricing', title: '판매가설정', note: '상품 검색 · 세트 구성 · 가격 확정' },
  { stage: 'information', title: '상품등록정보', note: '필수정보 입력 · 엑셀 출력 · 상품등록' },
  { stage: 'registered', title: '등록완료', note: '서플라이어허브 등록 결과 확인' },
]
const submissionLocked = (row: RegistrationRow) => ['queued', 'running', 'login_required'].includes(row.submission?.status ?? '') || getRegistrationStage(row) === 'registered'
function connectedDefaults(row: RegistrationRow, templates: RegistrationDraft['templates']) {
  const sheet = templates.find((template) => template.id === row.templateId)?.sheets.find((sheet) => sheet.name === row.sheetName)
  return sheet ? applyRegistrationDefaults(row, sheet) : row
}
function OfficialColumnInput({ column, value, listId, onChange }: { column: TemplateColumn; value: string; listId: string; onChange: (value: string) => void }) {
  const className = `${inputClass} ${column.requirement === '필수' && !value.trim() ? 'border-amber-400 bg-amber-50/40' : ''}`
  if (column.choices?.length && (column.label === '카테고리' || !column.allowCustom)) return <select className={className} value={value} onChange={(event) => onChange(event.target.value)} title={column.guide}>
    <option value="">선택해주세요</option>
    {value && !column.choices.includes(value) && <option value={value}>{value}</option>}
    {column.choices.map((choice) => <option key={choice} value={choice}>{choice}</option>)}
  </select>
  return <><input className={className} list={column.choices?.length ? listId : undefined} value={value} onChange={(event) => onChange(event.target.value)} title={column.guide} />{column.choices?.length ? <datalist id={listId}>{column.choices.map((choice) => <option key={choice} value={choice} />)}</datalist> : null}</>
}
const submissionText = (row: RegistrationRow) => row.submission ? { queued: '등록 대기', running: '등록 중', login_required: '로그인 필요', failed: '등록 실패', succeeded: '등록 완료' }[row.submission.status] : '미등록'

const catalogOptionKey = (productCode: string, optionName: string) => JSON.stringify([productCode, optionName])

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
  const missing = rows.filter((row) => !submissionLocked(row) && !row.bundleComponents && row.costPrice == null && (row.internalSku || row.sourceName || row.name))
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
  const revision = useRef<number | undefined>(undefined)
  const [saved, setSaved] = useState<DraftSummary[]>([])
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [activeId, setActiveId] = useState('')
  const [catalogTarget, setCatalogTarget] = useState<{ bundleId?: string } | null>(null)
  const [query, setQuery] = useState('')
  const [catalog, setCatalog] = useState<CatalogProduct[]>([])
  const [catalogSelections, setCatalogSelections] = useState<CatalogSelection[]>([])
  const [searched, setSearched] = useState(false)
  const [rowSearch, setRowSearch] = useState('')
  const [templateChoice, setTemplateChoice] = useState('')
  const [templateLibrary, setTemplateLibrary] = useState<CategoryTemplate[]>([])
  const [onlyIssues, setOnlyIssues] = useState(false)
  const [stage, setStage] = useState<RegistrationStage>('pricing')
  const [extensionConnected, setExtensionConnected] = useState<boolean | null>(null)
  const submissionEvents = useRef<Promise<void>>(Promise.resolve())
  const draftSession = useRef(0)
  const templateInput = useRef<HTMLInputElement>(null)
  const templateImportMode = useRef<'registration' | 'category'>('registration')
  const labelInput = useRef<HTMLInputElement>(null)
  const bundleEditor = useRef<HTMLDivElement>(null)
  const informationEditor = useRef<HTMLDivElement>(null)
  const stageRows = draft.rows.filter((row) => getRegistrationStage(row) === stage)
  const active = stageRows.find((row) => row.id === activeId)
  const issueMap = new Map(draft.rows.map((row) => [row.id, rowIssues(row, draft)]))
  const pricingIssueMap = new Map(draft.rows.map((row) => [row.id, priceIssues(row, draft.rounding)]))
  const stageIssueMap = stage === 'pricing' ? pricingIssueMap : issueMap
  const needsInfo = stageRows.filter((row) => stageIssueMap.get(row.id)!.length)
  const visible = stageRows.filter((row) => (!onlyIssues || stageIssueMap.get(row.id)!.length) && [row.name, row.internalSku, row.sourceCode].some((value) => value.toLowerCase().includes(rowSearch.toLowerCase())))
  const allVisibleSelected = visible.length > 0 && visible.every((row) => selected.has(row.id))
  const selectedRows = stageRows.filter((row) => selected.has(row.id))
  const selectedSingleRows = selectedRows.filter((row) => !row.bundleComponents)
  const bundleSelectionIssue = selectedRows.length < 2
    ? '세트는 단품 2개 이상을 선택해주세요.'
    : selectedRows.length !== selectedSingleRows.length
      ? '이미 만든 세트 행은 세트 구성으로 다시 묶을 수 없습니다.'
      : selectedSingleRows.some((row) => !row.sourceCode || !(row.sourceName || row.name))
        ? 'B2B 상품 코드가 연결된 단품만 세트로 구성할 수 있습니다.'
        : ''
  const selectedCatalogOptionKeys = new Set(catalogSelections.map((item) => catalogOptionKey(item.product.code, item.optionName)))
  const categoryTemplates = Array.from(new Map([...templateLibrary, ...draft.templates].map((template) => [template.id, template])).values())
  const hasCategories = categoryTemplates.some((template) => template.sheets.length > 0)

  function update(change: (value: RegistrationDraft) => RegistrationDraft) { setDraft(change); setDirty(true) }
  function setRevision(value: number | undefined) { revision.current = value }
  function queueServerWrite<T,>(action: () => Promise<T>): Promise<T> {
    const next = submissionEvents.current.catch(() => undefined).then(action)
    submissionEvents.current = next.then(() => undefined, () => undefined)
    return next
  }
  function patchRow(id: string, patch: Partial<RegistrationRow>) {
    update((value) => ({ ...value, rows: value.rows.map((row) => row.id === id && !submissionLocked(row) ? connectedDefaults({ ...row, ...patch }, value.templates) : row) }))
  }
  function changeStage(next: RegistrationStage) { setStage(next); setSelected(new Set()); setActiveId(''); setOnlyIssues(false); setRowSearch('') }
  function toggle(id: string) { setSelected((value) => { const next = new Set(value); if (next.has(id)) next.delete(id); else next.add(id); return next }) }
  async function refreshDrafts() { const response = await jsonRequest('/drafts'); setSaved(response.drafts) }
  useEffect(() => {
    let cancelled = false
    void jsonRequest('/drafts').then((response) => { if (!cancelled) setSaved(response.drafts) }).catch((error) => { toast.error(error.message) })
    return () => { cancelled = true }
  }, [])
  useEffect(() => {
    let cancelled = false
    void jsonRequest('/templates').then((response) => { if (!cancelled) setTemplateLibrary(response.templates ?? []) }).catch(() => {
      if (!cancelled) toast.error('저장된 카테고리 양식을 불러오지 못했습니다. 카테고리 양식 연결로 파일을 추가해주세요.')
    })
    return () => { cancelled = true }
  }, [])
  useEffect(() => { void pingSupplierExtension().then((result) => setExtensionConnected(result.connected)).catch(() => setExtensionConnected(false)) }, [])
  useEffect(() => {
    if (!currentId) return
    const session = draftSession.current
    let subscribed = true
    const unsubscribe = subscribeSupplierRegistration((event) => {
      void queueServerWrite(async () => {
        const response = await postJson('/submissions', { draftId: currentId, ...event })
        if (!subscribed || session !== draftSession.current) return
        setRevision(response.revision)
        // Progress is authoritative only for registration state. An event may
        // finish after the user edits another product, so never replace fields.
        setDraft((value) => ({ ...value, rows: value.rows.map((row) => {
          const remote = (response.payload as RegistrationDraft).rows.find((item) => item.id === row.id)
          return remote ? { ...row, stage: remote.stage, registeredAt: remote.registeredAt, submission: remote.submission } : row
        }) }))
        if (event.status === 'succeeded') toast.success('서플라이어허브 상품 검수 완료를 확인했습니다.')
        else if (event.status === 'failed' || event.status === 'login_required') toast.error(event.message)
      }).catch((error) => { toast.error(error.message) })
    })
    return () => { subscribed = false; unsubscribe() }
  }, [currentId])
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault() }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [dirty])
  useEffect(() => {
    if (stage === 'information' && activeId) informationEditor.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  }, [activeId, stage])
  async function run(label: string, action: () => Promise<void>) {
    if (busy) return
    setBusy(label)
    try { await action() } catch (error) { toast.error(error instanceof Error ? error.message : '처리하지 못했습니다.') } finally { setBusy('') }
  }

  function openTemplateInput(mode: 'registration' | 'category') {
    templateImportMode.current = mode
    templateInput.current?.click()
  }
  async function chooseCategory(choice: string, rowIds?: string[]) {
    if (!choice) {
      if (rowIds) update((value) => ({ ...value, rows: value.rows.map((row) => rowIds.includes(row.id) && !submissionLocked(row) ? { ...row, templateId: '', sheetName: '' } : row) }))
      else setTemplateChoice('')
      return
    }
    const separator = choice.indexOf(':')
    const templateId = choice.slice(0, separator)
    const sheetName = choice.slice(separator + 1)
    const session = draftSession.current
    await run('카테고리 양식 연결 중', async () => {
      let template = draft.templates.find((item) => item.id === templateId)
      if (!template) {
        if (draft.templates.length >= 6) throw new Error('작업당 카테고리 양식은 6개까지 연결할 수 있습니다. 새 작업으로 나눠주세요.')
        const response = await jsonRequest(`/templates?id=${encodeURIComponent(templateId)}`)
        template = response.template as ConnectedTemplate | undefined
      }
      if (!template || template.id !== templateId || !template.file || !template.sheets.some((sheet) => sheet.name === sheetName)) throw new Error('카테고리 양식을 확인하지 못했습니다. 공식 양식을 다시 연결해주세요.')
      if (session !== draftSession.current) return
      const connected = template
      update((value) => ({
        ...value,
        templates: value.templates.some((item) => item.id === connected.id) ? value.templates : [...value.templates, connected],
        rows: rowIds ? value.rows.map((row) => rowIds.includes(row.id) && !submissionLocked(row) ? applyRegistrationDefaults({ ...row, templateId, sheetName }, connected.sheets.find((sheet) => sheet.name === sheetName)!) : row) : value.rows,
      }))
      if (!rowIds) setTemplateChoice(choice)
    })
  }
  function connectRecommendedCategory(rowId: string, template: ConnectedTemplate, categoryId: string) {
    const sheet = template.sheets.find((item) => item.name.startsWith(`QF_${categoryId}_`))
    if (!sheet || !template.file) { toast.error('선택한 쿠팡 분류와 공식 양식이 일치하지 않습니다.'); return }
    if (!draft.templates.some((item) => item.id === template.id) && draft.templates.length >= 6) { toast.error('작업당 카테고리 양식은 6개까지 연결할 수 있습니다. 새 작업으로 나눠주세요.'); return }
    update((value) => {
      const existing = value.templates.some((item) => item.id === template.id)
      const target = value.rows.find((row) => row.id === rowId)
      if (!target || submissionLocked(target) || !existing && value.templates.length >= 6) return value
      return {
        ...value,
        templates: existing ? value.templates : [...value.templates, template],
        rows: value.rows.map((row) => row.id === rowId ? applyRegistrationDefaults({ ...row, templateId: template.id, sheetName: sheet.name }, sheet) : row),
      }
    })
  }
  async function importTemplates(files: FileList | null) {
    if (!files?.length) return
    const mode = templateImportMode.current
    templateImportMode.current = 'registration'
    const session = draftSession.current
    await run(mode === 'category' ? '카테고리 양식 연결 중' : '견적서 불러오는 중', async () => {
      let next = draft
      for (const file of Array.from(files)) {
        const form = new FormData(); form.set('file', file)
        const response = await jsonRequest('/template', { method: 'POST', body: form })
        if (next.templates.some((template) => template.id === response.template.id)) continue
        if (next.templates.length >= 6 || (mode === 'registration' && next.rows.length + response.rows.length > 500)) throw new Error('작업당 견적서 6개, 등록행 500개까지 사용할 수 있습니다.')
        next = { ...next, templates: [...next.templates, response.template], rows: mode === 'registration' ? [...next.rows, ...response.rows] : next.rows }
      }
      if (mode === 'category') {
        if (session !== draftSession.current) return
        update((value) => ({ ...value, templates: [...value.templates, ...next.templates.filter((template) => !value.templates.some((item) => item.id === template.id))] }))
        toast.success('카테고리 양식을 연결했습니다. 상품에 적용할 카테고리를 선택해주세요.')
        return
      }
      const costs = await fillMissingCostsOnOpen(next.rows)
      setDraft({ ...next, rows: costs.rows.map((row) => connectedDefaults(row, next.templates)) }); setDirty(true)
      toast.success(`견적서 ${next.templates.length}개 · 등록행 ${next.rows.length}개를 불러왔습니다.`)
    })
    if (templateInput.current) templateInput.current.value = ''
  }

  async function reloadCosts() {
    await run('품목 신규 원가 확인 중', async () => {
      const targets = stageRows.filter((row) => !submissionLocked(row) && (!selected.size || selected.has(row.id)))
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
    const targets = stageRows.filter((row) => !submissionLocked(row) && !row.bundleComponents && (!selected.size || selected.has(row.id)))
    if (!targets.length) return
    await run('상품·이미지·품질표시 연결 중', async () => {
      const matched: CatalogProduct[] = []
      for (let start = 0; start < targets.length; start += 30) {
        const chunk = targets.slice(start, start + 30)
        const response = await postJson('/catalog', { names: chunk.map((row) => row.sourceName || row.name), codes: chunk.map((row) => row.sourceCode).filter(Boolean) })
        matched.push(...response.products)
      }
      const products = [...new Map(matched.map((product) => [product.code, product])).values()]
      const targetIds = new Set(targets.map((row) => row.id))
      const linkedRows = draft.rows.map((row) => {
        if (!targetIds.has(row.id)) return row
        const match = matchCatalog(row, products)
        if (!match) return row
        return applyProductMasterDefaults(attachCatalog(row, match))
      })
      const conversionRows = linkedRows.filter((row) => {
        const qualityPdf = row.productMaster?.qualityPdf
        return targetIds.has(row.id) && !!qualityPdf && qualityPdfNeedsConversion(row, qualityPdf.id, draft.labels)
      })
      const pdfs = [...new Map(conversionRows.flatMap((row) => row.productMaster?.qualityPdf ? [[row.productMaster.qualityPdf.id, row.productMaster.qualityPdf] as const] : [])).values()]
      const convertedByPdf = new Map<string, SavedFile[]>()
      const conversionErrors = new Map<string, string>()
      for (const qualityPdf of pdfs) {
        try {
          const response = await jsonRequest('/quality-label', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ attachmentId: qualityPdf.id }),
          })
          const labels = response.labels as SavedFile[]
          if (!Array.isArray(labels) || !labels.length || labels.some((label) => !label || typeof label.name !== 'string' || typeof label.data !== 'string')) {
            throw new Error('변환된 품질표시 이미지를 확인하지 못했습니다.')
          }
          convertedByPdf.set(qualityPdf.id, labels)
        } catch (error) {
          conversionErrors.set(qualityPdf.id, error instanceof Error ? error.message : '품질표시 PDF를 JPG로 변환하지 못했습니다.')
        }
      }
      const generatedLabels = [...convertedByPdf.values()].flat()
      const labels = [...new Map([...draft.labels, ...generatedLabels].map((file) => [file.name.normalize('NFC'), file])).values()]
      const rows = linkedRows.map((row) => {
        if (!targetIds.has(row.id)) return row
        const qualityPdf = row.productMaster?.qualityPdf
        if (!qualityPdf) return row
        const converted = convertedByPdf.get(qualityPdf.id)
        if (converted) return applyConvertedQualityLabels(row, qualityPdf.id, converted)
        const issue = conversionErrors.get(qualityPdf.id)
        return issue ? applyQualityLabelIssue(row, issue) : row
      })
      setDraft({ ...draft, rows: rows.map((row) => connectedDefaults(row, draft.templates)), labels }); setDirty(true)
      const count = targets.filter((row) => matchCatalog(row, products)).length
      const success = `${targets.length}개 중 ${count}개를 연결했습니다. 품질표시 JPG ${generatedLabels.length}장을 자동 변환했습니다.`
      toast.success(success)
      if (conversionErrors.size) toast.error(`품질표시 PDF ${conversionErrors.size}개는 자동 변환하지 못했습니다. 해당 상품의 확인 항목을 봐주세요.`)
    })
  }

  async function persist(nextDraft = draft, asNew = false) {
    return queueServerWrite(async () => {
      const response = await postJson('/drafts', { draft: nextDraft, ...(!asNew && currentId ? { id: currentId, revision: revision.current } : {}) })
      if (asNew) draftSession.current++
      setDraft(response.payload ?? nextDraft); setCurrentId(response.id); setRevision(response.revision); setDirty(false)
      await refreshDrafts()
      return response
    })
  }
  async function save(asNew = false) {
    await run('저장 중', async () => { await persist(draft, asNew); toast.success('가격·상품등록정보·품질표시를 저장했습니다.') })
  }
  async function completePricing(ids: string[]) {
    if (!ids.length) return
    await run('가격 확정 저장 중', async () => {
      const chosenIds = new Set(ids)
      const next = { ...draft, rows: draft.rows.map((row) => chosenIds.has(row.id) ? confirmPricing(row, draft.rounding) : row) }
      await persist(next)
      changeStage('information')
      toast.success(`${ids.length}개 상품을 상품등록정보 단계로 이동했습니다.`)
    })
  }
  async function reopenPricing(row: RegistrationRow) {
    await run('판매가설정으로 이동 중', async () => {
      const next = { ...draft, rows: draft.rows.map((item) => item.id === row.id ? returnToPricing(item) : item) }
      await persist(next)
      changeStage('pricing')
    })
  }
  async function checkExtension() {
    await run('등록 확장 연결 확인 중', async () => {
      const result = await pingSupplierExtension()
      setExtensionConnected(result.connected)
      if (!result.connected) toast.error('쿠팡 등록 확장 프로그램을 설치한 뒤 연결을 확인해주세요.')
    })
  }
  async function submitProducts() {
    const rows = stageRows.filter((row) => !selected.size || selected.has(row.id))
    if (stage !== 'information' || !rows.length) return
    if (rows.some((row) => submissionLocked(row))) { toast.error('등록 진행 중인 상품은 결과를 먼저 확인해주세요.'); return }
    const errors = rows.flatMap((row) => issueMap.get(row.id) ?? [])
    if (errors.length) { setOnlyIssues(true); toast.error(`필수항목 ${errors.length}건을 먼저 확인해주세요.`); return }
    await run('서플라이어허브 등록 준비 중', async () => {
      const extension = await pingSupplierExtension()
      setExtensionConnected(extension.connected)
      if (!extension.connected) throw new Error('쿠팡 등록 확장 프로그램을 연결해주세요.')
      const savedDraft = await persist()
      const response = await queueServerWrite(async () => {
        const submitted = await postJson('/submit', { draftId: savedDraft.id, revision: revision.current, rowIds: rows.map((row) => row.id) })
        setDraft(submitted.payload); setRevision(submitted.revision); setSelected(new Set()); setDirty(false)
        return submitted
      })
      try { await startSupplierRegistration(response.transfer) } catch {
        // A missing START response does not prove the extension did not start.
        // Keep the server's active-job lock until CHECK yields a real result.
        throw new Error('확장 응답을 확인하지 못했습니다. 등록이 진행 중일 수 있으니 등록 상태 확인을 눌러 결과를 확인해주세요.')
      }
      toast.success('서플라이어허브 등록을 시작했습니다. 허브에서 필수 확인사항을 확인해주세요.')
    })
  }
  async function refreshRegistration() {
    if (!currentId) return
    await run('등록 상태 확인 중', async () => {
      const savedDraft = dirty ? await persist() : { id: currentId }
      const response = await queueServerWrite(async () => {
        const latest = await jsonRequest(`/submissions?draftId=${encodeURIComponent(savedDraft.id)}`)
        setDraft(latest.payload); setRevision(latest.revision); setDirty(false)
        return latest
      })
      const extension = await pingSupplierExtension()
      setExtensionConnected(extension.connected)
      if (extension.connected) for (const transfer of response.transfers ?? []) await checkSupplierRegistration(transfer)
    })
  }
  async function load(id: string) {
    if (!id || dirty && !window.confirm('저장하지 않은 변경사항이 있습니다. 저장된 작업을 불러올까요?')) return
    draftSession.current++
    setActiveId('')
    await run('작업 불러오는 중', async () => {
      const response = await jsonRequest(`/drafts?id=${encodeURIComponent(id)}`)
      const payload: RegistrationDraft = response.payload
      const costs = await fillMissingCostsOnOpen(payload.rows)
      const rows = costs.rows.map((row) => connectedDefaults(row, payload.templates))
      setDraft({ ...payload, rows }); setCurrentId(response.id); setRevision(response.revision); setDirty(costs.filled > 0 || rows.some((row, index) => row !== costs.rows[index])); setSelected(new Set()); setActiveId(''); setTemplateChoice('')
      setStage(!payload.rows.length || payload.rows.some((row) => getRegistrationStage(row) === 'pricing') ? 'pricing' : payload.rows.some((row) => getRegistrationStage(row) === 'information') ? 'information' : 'registered')
    })
  }
  function newDraft() {
    if (dirty && !window.confirm('저장하지 않은 변경사항이 있습니다. 새 작업을 시작할까요?')) return
    draftSession.current++
    setDraft(blankDraft()); setCurrentId(undefined); setRevision(undefined); setDirty(false); setSelected(new Set()); setActiveId(''); setTemplateChoice(''); setStage('pricing')
  }
  async function download() {
    const rows = stageRows.filter((row) => !selected.size || selected.has(row.id))
    if (stage !== 'information' || !rows.length) return
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
  function closeCatalog() {
    if (busy) return
    setCatalogTarget(null)
    setCatalogSelections([])
    if (catalogTarget?.bundleId) bundleEditor.current?.scrollIntoView?.({ block: 'start' })
  }

  function toggleCatalogSelection(product: CatalogProduct, optionName: string) {
    const key = catalogOptionKey(product.code, optionName)
    setCatalogSelections((value) => value.some((item) => catalogOptionKey(item.product.code, item.optionName) === key)
      ? value.filter((item) => catalogOptionKey(item.product.code, item.optionName) !== key)
      : [...value, { product, optionName }])
  }

  function createBundle() {
    if (draft.rows.length >= 500) { toast.error('등록행은 500개까지 추가할 수 있습니다.'); return }
    const row: RegistrationRow = { ...createRegistrationRow(), bundleComponents: [] }
    update((value) => ({ ...value, rows: [...value.rows, row] }))
    setActiveId(row.id)
    setCatalogTarget({ bundleId: row.id })
  }

  function createBundleFromSelectedRows() {
    if (selectedRows.length < 2) { toast.error('세트는 단품 2개 이상을 선택해주세요.'); return }
    if (selectedRows.length !== selectedSingleRows.length) { toast.error('이미 만든 세트 행은 세트 구성으로 다시 묶을 수 없습니다.'); return }
    if (selectedSingleRows.some((row) => !row.sourceCode || !(row.sourceName || row.name))) { toast.error('B2B 상품 코드가 연결된 단품만 세트로 구성할 수 있습니다.'); return }

    const components = new Map<string, BundleComponent>()
    for (const row of selectedSingleRows) {
      const component: BundleComponent = {
        sourceCode: row.sourceCode,
        name: row.sourceName ? [row.sourceName, row.optionName].filter(Boolean).join(' ') : row.name,
        optionName: row.optionName,
        internalSku: row.internalSku,
        quantity: 1,
        unitCost: row.costPrice,
        unitWholesale: row.wholesalePrice,
      }
      const key = bundleKey(component)
      const existing = components.get(key)
      if (existing) {
        if (existing.name !== component.name || existing.internalSku !== component.internalSku || existing.unitCost !== component.unitCost || existing.unitWholesale !== component.unitWholesale) {
          toast.error('같은 상품 옵션의 원가·도매가 또는 SKU가 다릅니다. 원본 행을 맞춘 뒤 다시 구성해주세요.')
          return
        }
        if (existing.quantity >= BUNDLE_QUANTITY_LIMIT) { toast.error('구성품 수량 한도에 도달했습니다.'); return }
        components.set(key, { ...existing, quantity: existing.quantity + 1 })
      } else {
        if (components.size >= BUNDLE_COMPONENT_LIMIT) { toast.error('한 세트에는 구성품을 50종까지 추가할 수 있습니다.'); return }
        components.set(key, component)
      }
    }

    const bundle: RegistrationRow = {
      ...createRegistrationRow(),
      bundleComponents: [...components.values()],
      bundleReviewed: false,
    }
    const selectedIds = new Set(selectedSingleRows.map((row) => row.id))
    update((value) => {
      let inserted = false
      const rows = value.rows.flatMap((row) => {
        if (!selectedIds.has(row.id)) return [row]
        if (inserted) return []
        inserted = true
        return [bundle]
      })
      return { ...value, rows }
    })
    setSelected(new Set())
    setActiveId(bundle.id)
    setCatalogTarget(null)
    toast.success(`선택한 ${selectedSingleRows.length}개 상품을 세트로 구성했습니다. 세트명·이미지·품질표시를 확인해주세요.`)
  }

  async function addProduct(product: CatalogProduct, optionName: string) {
    const bundle = draft.rows.find((row) => row.id === catalogTarget?.bundleId)
    const components = bundle?.bundleComponents
    const existing = components?.find((item) => item.sourceCode === product.code && item.optionName === optionName)
    if (bundle && components && existing) {
      if (existing.quantity >= BUNDLE_QUANTITY_LIMIT) { toast.error('구성품 수량 한도에 도달했습니다.'); return }
      patchRow(bundle.id, {
        bundleComponents: components.map((item) => item === existing ? { ...item, quantity: item.quantity + 1 } : item),
        bundleReviewed: false,
      })
      toast.success(`${existing.name} 수량 1개 추가`)
      return
    }
    if (components) {
      if (components.length >= BUNDLE_COMPONENT_LIMIT) { toast.error('한 세트에는 구성품을 50종까지 추가할 수 있습니다.'); return }
    } else {
      if (draft.rows.length >= 500) { toast.error('등록행은 500개까지 추가할 수 있습니다.'); return }
      if (draft.rows.some((row) => row.sourceCode === product.code && row.optionName === optionName)) { toast.error('이미 추가된 상품 옵션입니다.'); return }
    }
    await run('선택 상품의 가격·원가 확인 중', async () => {
      const response = await jsonRequest(`/catalog?code=${encodeURIComponent(product.code)}`)
      const full: CatalogProduct = response.product
      setCatalog((value) => value.map((item) => item.code === full.code ? full : item))
      if (full.options.length ? !full.options.some((option) => option.name === optionName) : !!optionName) {
        throw new Error('상품 옵션이 변경되었습니다. 최신 옵션을 다시 선택해주세요.')
      }
      const row = createRegistrationRow(full, optionName)
      if (bundle && components) {
        const { sourceCode, name, internalSku, costPrice, wholesalePrice } = row
        patchRow(bundle.id, {
          bundleComponents: [...components, { sourceCode, name, optionName, internalSku, quantity: 1, unitCost: costPrice, unitWholesale: wholesalePrice }],
          bundleReviewed: false,
        })
        toast.success(`${name} 구성품 추가`)
        return
      }
      update((value) => ({ ...value, rows: [...value.rows, row] }))
      toast.success(`${row.name} 추가`)
    })
  }

  async function addSelectedProducts() {
    if (catalogTarget?.bundleId || !catalogSelections.length) return
    const existing = new Set(draft.rows.filter((row) => !row.bundleComponents).map((row) => catalogOptionKey(row.sourceCode, row.optionName)))
    const additions = catalogSelections.filter((item) => !existing.has(catalogOptionKey(item.product.code, item.optionName)))
    if (!additions.length) { toast.error('선택한 상품 옵션은 이미 등록 목록에 있습니다.'); return }
    if (draft.rows.length + additions.length > 500) { toast.error(`등록행은 500개까지 추가할 수 있습니다. ${500 - draft.rows.length}개만 더 추가해주세요.`); return }

    await run('선택 상품의 가격·원가 확인 중', async () => {
      const fullProducts = new Map<string, CatalogProduct>()
      const codes = [...new Set(additions.map((item) => item.product.code))]
      for (let start = 0; start < codes.length; start += 100) {
        const response = await postJson('/catalog', { names: [], codes: codes.slice(start, start + 100) })
        const products = response.products as CatalogProduct[]
        if (!Array.isArray(products)) throw new Error('선택한 B2B 상품 정보를 확인하지 못했습니다.')
        for (const product of products) fullProducts.set(product.code, product)
      }
      const invalid = additions.filter(({ product, optionName }) => {
        const full = fullProducts.get(product.code)
        return !full || (full.options.length ? !full.options.some((option) => option.name === optionName) : !!optionName)
      })
      if (invalid.length) throw new Error('일부 상품 옵션이 변경되었습니다. 검색 결과를 새로 확인해주세요.')

      const rows = additions.map(({ product, optionName }) => createRegistrationRow(fullProducts.get(product.code)!, optionName))
      setCatalog((value) => value.map((product) => fullProducts.get(product.code) ?? product))
      update((value) => ({ ...value, rows: [...value.rows, ...rows] }))
      setCatalogSelections([])
      setActiveId('')
      toast.success(`${rows.length}개 상품 옵션을 등록 목록에 추가했습니다.`)
    })
  }

  return <fieldset disabled={!!busy} className="min-w-0 space-y-4 pb-8">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground"><span>상품등록·광고</span><ChevronRight className="size-3" /><span>로켓배송</span></div><h1 className="text-2xl font-semibold tracking-tight">쿠팡상품등록</h1></div>
      <div className="flex flex-wrap items-center gap-2"><span className="mr-1 text-xs text-muted-foreground">{dirty ? '저장하지 않은 변경사항' : currentId ? '저장됨' : '새 작업'}</span><button className={buttonClass} disabled={!!busy} onClick={newDraft}><Plus className="size-3.5" />새 작업</button><button className={buttonClass} disabled={!!busy} onClick={() => void save()}><Save className="size-3.5" />임시저장</button>{stage === 'information' && <button className={`${buttonClass} border-blue-600 bg-blue-600 text-white hover:bg-blue-700`} disabled={!!busy || !stageRows.length} onClick={() => void download()}><Download className="size-3.5" />{selected.size ? `선택 ${selected.size}개 ` : ''}엑셀로 출력</button>}</div>
    </header>

    <section aria-label="작업 불러오기" className="rounded-lg border bg-card px-4 py-3">
      <div className="overflow-x-auto"><div className="flex min-w-max items-center gap-2">
        <input aria-label="작업 이름" className={`${inputClass} w-52 shrink-0 font-medium`} value={draft.name} onChange={(event) => update((value) => ({ ...value, name: event.target.value }))} />
        <select aria-label="저장된 작업 불러오기" className={`${inputClass} w-60 shrink-0`} value={currentId ?? ''} onChange={(event) => void load(event.target.value)}><option value="">저장된 작업 불러오기</option>{saved.map((item) => <option key={item.id} value={item.id}>{item.name} · {new Date(item.updatedAt).toLocaleDateString('ko-KR')}</option>)}</select>
        {currentId && <button className={`${buttonClass} shrink-0`} disabled={!!busy} onClick={() => void save(true)}>새 작업으로 저장</button>}
        {stage !== 'registered' && <button className={`${buttonClass} shrink-0`} disabled={!!busy} onClick={() => openTemplateInput('registration')}><FileSpreadsheet className="size-3.5" />쿠팡 견적서 불러오기</button>}
        {stage === 'information' && <button className={`${buttonClass} shrink-0`} disabled={!!busy} onClick={() => labelInput.current?.click()}><ImagePlus className="size-3.5" />품질표시 이미지 추가</button>}
        <a className="ml-auto inline-flex shrink-0 items-center gap-1 pl-2 text-xs text-blue-700 hover:underline" href="https://supplier.coupang.com/qvt/registration" target="_blank" rel="noreferrer">쿠팡 최신 양식 받기<ExternalLink className="size-3" /></a>
      </div></div>
      <input ref={templateInput} aria-label="쿠팡 견적서 파일" type="file" multiple accept=".xlsx" hidden onChange={(event) => void importTemplates(event.target.files)} /><input ref={labelInput} type="file" multiple accept="image/jpeg,image/png" hidden onChange={(event) => void importLabels(event.target.files)} />
      {draft.templates.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{draft.templates.map((template) => <span key={template.id} className="max-w-full truncate rounded bg-muted px-2 py-1 text-[11px]" title={template.name}>{template.name} · {template.sheets.length}개 카테고리</span>)}</div>}
    </section>

    <nav role="tablist" aria-label="쿠팡 상품등록 단계" className="grid gap-3 sm:grid-cols-3">{steps.map((step, index) => <button key={step.stage} role="tab" aria-selected={stage === step.stage} aria-controls={`coupang-step-${step.stage}`} className={`rounded-lg border px-4 py-3 text-left ${stage === step.stage ? 'border-blue-600 bg-blue-50 ring-1 ring-blue-600' : 'bg-card hover:bg-muted/40'}`} onClick={() => changeStage(step.stage)}><span className="flex items-center justify-between gap-3"><span className={`text-sm font-semibold ${stage === step.stage ? 'text-blue-800' : ''}`}>{index + 1}단계 {step.title}</span><span className="rounded-full bg-background px-2 py-0.5 text-xs tabular-nums">{draft.rows.filter((row) => getRegistrationStage(row) === step.stage).length}개</span></span><span className="mt-1 block text-[11px] text-muted-foreground">{step.note}</span></button>)}</nav>
    <div className="grid gap-3 sm:grid-cols-3"><Summary label={stage === 'pricing' ? '판매가설정 상품' : stage === 'information' ? '상품등록정보 작성' : '등록완료 상품'} value={`${stageRows.length}개`} note={steps.find((step) => step.stage === stage)!.note} /><Summary label={stage === 'pricing' ? '가격 확정 가능' : '필수정보 입력 완료'} value={`${stageRows.length - needsInfo.length}개`} note={stage === 'pricing' ? '공급가·판매가 기준' : '불러온 쿠팡 양식의 필수항목 기준'} /><Summary label={stage === 'registered' ? '보관 자료' : '확인이 필요한 상품'} value={stage === 'registered' ? `${draft.templates.length}개 양식` : `${needsInfo.length}개`} note={stage === 'registered' ? `품질표시 ${draft.labels.length}개` : stage === 'pricing' ? '가격을 확정하면 2단계로 이동합니다.' : '필수정보 입력 후 저장·엑셀 출력·등록하세요.'} warning={stage !== 'registered' && needsInfo.length > 0} /></div>

    {stage === 'pricing' && <section id="coupang-step-pricing" role="tabpanel" aria-label="판매가설정" className="overflow-hidden rounded-lg border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3"><div className="flex flex-wrap items-center gap-2"><div className="relative"><Search className="pointer-events-none absolute left-2 top-2 size-3.5 text-muted-foreground" /><input aria-label="등록목록 검색" placeholder="상품명·SKU 검색" className={`${inputClass} w-48 pl-7`} value={rowSearch} onChange={(event) => setRowSearch(event.target.value)} /></div><label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={onlyIssues} onChange={(event) => setOnlyIssues(event.target.checked)} />확인 필요만 보기</label></div><div className="flex gap-2"><button className={buttonClass} disabled={!!busy || !draft.rows.some((row) => !row.bundleComponents && (!selected.size || selected.has(row.id)))} onClick={() => void syncImages()}><RefreshCw className="size-3.5" />{selected.size ? '선택 상품' : '전체 상품'} 정보 연결</button><button className={buttonClass} disabled={!!busy} onClick={() => setCatalogTarget({})}><Plus className="size-3.5" />상품 추가</button><button className={buttonClass} onClick={createBundle}><Plus className="size-3.5" />새 빈 세트 만들기</button></div></div>
      <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-3 py-2"><span className="mr-1 text-xs font-medium">선택 {selected.size}개</span><button className={buttonClass} title={bundleSelectionIssue || '원본 단품 행은 새 세트 행으로 교체됩니다.'} disabled={!!busy || !!bundleSelectionIssue} onClick={createBundleFromSelectedRows}><Plus className="size-3.5" />선택 {selectedRows.length}개를 세트로 변환</button><span className="text-[11px] text-muted-foreground">{bundleSelectionIssue || '원본 단품 행은 새 세트 행으로 교체됩니다.'}</span><button className={`${buttonClass} border-blue-600 bg-blue-600 text-white hover:bg-blue-700`} disabled={!selectedRows.length || selectedRows.some((row) => pricingIssueMap.get(row.id)!.length > 0)} onClick={() => void completePricing(selectedRows.map((row) => row.id))}>선택 {selectedRows.length}개 가격설정 완료<ChevronRight className="size-3.5" /></button><label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">판매가 올림<select aria-label="판매가 올림 단위" className={inputClass} value={draft.rounding} onChange={(event) => update((value) => ({ ...value, rounding: Number(event.target.value) }))}>{[1, 10, 100, 1000].map((unit) => <option key={unit} value={unit}>{unit.toLocaleString()}원</option>)}</select></label></div>
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <button className={buttonClass} disabled={!!busy || !draft.rows.some((row) => !row.bundleComponents && row.costPrice == null && (!selected.size || selected.has(row.id)))} onClick={() => void reloadCosts()}>
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
          <th className="w-56 !text-left">상품 · 옵션</th>
          <th className="w-24" title="품목의 works 신규 원가">원가</th>
          <th className="w-24">도매가</th>
          <th className="w-24">쿠팡공급가</th>
          <th className="w-24">쿠팡판매가</th>
          <th className="w-24">매출부가세</th>
          <th className="w-24" title="공급가에 차감률을 곱해 순수익에서 뺍니다">추가 차감</th>
          <th className="w-24">순수익</th>
          <th className="w-20">우리 마진</th>
          <th className="w-20">쿠팡 마진</th>
          <th className="w-32">가격 확정</th>
          <th className="w-10"><span className="sr-only">삭제</span></th>
        </tr></thead>
        <tbody>{visible.map((row) => {
          const prices = calculatePrice(row, draft.rounding)
          const issues = pricingIssueMap.get(row.id)!
          const chosen = selected.has(row.id)
          return <tr key={row.id} className={`h-16 border-b last:border-0 [&>td]:px-2 [&>td]:py-3 [&>td]:align-middle ${activeId === row.id ? 'bg-blue-50/70' : chosen ? 'bg-blue-50/30' : 'hover:bg-muted/20'}`}>
            <td><input aria-label={`${row.name} 선택`} type="checkbox" checked={chosen} onChange={() => toggle(row.id)} /></td>
            <td className="text-left"><button onClick={() => setActiveId(row.id)} className="flex w-full items-center justify-start gap-2 text-left"><div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded border bg-muted">{isImageUrl(row.primaryImage) ? <img src={row.primaryImage} alt="" className="size-full object-contain" /> : <FileSpreadsheet className="size-4 text-muted-foreground" />}</div><div className="min-w-0"><div className="font-medium leading-5">{row.name || (row.bundleComponents ? '이름 없는 세트' : '상품명 입력 필요')}</div><div className="truncate text-[10px] text-muted-foreground">{row.bundleComponents ? `세트 · 구성품 ${row.bundleComponents.length}종` : row.internalSku || '원가 SKU 미연결'}{row.sourceCode && ` · B2B ${row.sourceCode}`}</div></div></button></td>
            <td>{row.bundleComponents ? <span aria-label={`${row.name} 원가`}>{won(prices.cost)}</span> : <MoneyInput label={`${row.name} 원가`} value={prices.cost} onChange={(value) => patchRow(row.id, { costPrice: value })} />}</td>
            <td><span aria-label={`${row.name} 도매가`} className="inline-flex h-8 items-center justify-center whitespace-nowrap">{won(prices.wholesale)}</span></td>
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
            <td><button aria-label={`${row.name} 가격설정 완료`} onClick={() => void completePricing([row.id])} disabled={issues.length > 0} title={issues.join('\n')} className={`${buttonClass} border-blue-200 text-blue-800`}>{issues.length ? `가격 확인 ${issues.length}건` : '가격설정 완료'}</button>{row.sourceStatus === 'RESTOCKING' && <div className="mt-1 text-[10px] text-amber-700">B2B 예약구매</div>}</td>
            <td><button aria-label={`${row.name} 삭제`} className="rounded p-2 text-muted-foreground hover:bg-red-50 hover:text-red-600" disabled={!!busy} onClick={() => { update((value) => ({ ...value, rows: value.rows.filter((item) => item.id !== row.id) })); setSelected((value) => { const next = new Set(value); next.delete(row.id); return next }) }}><Trash2 className="size-3.5" /></button></td>
          </tr>
        })}</tbody>
      </table>{!visible.length && <div className="flex flex-col items-center gap-3 py-16 text-center"><FileSpreadsheet className="size-8 text-muted-foreground/50" /><div><p className="text-sm font-medium">{draft.rows.length ? '검색 조건에 맞는 상품이 없습니다.' : '등록할 상품을 준비하세요'}</p><p className="mt-1 text-xs text-muted-foreground">{draft.rows.length ? '검색어나 확인 필요 필터를 변경해주세요.' : '작성한 쿠팡 견적서를 불러오거나 B2B 상품을 검색해 추가하세요.'}</p></div>{!draft.rows.length && <button className={buttonClass} onClick={() => setCatalogTarget({})}><Plus className="size-3.5" />B2B 상품 검색</button>}</div>}</div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground"><span>순수익 = 공급가 − 원가 − 매출부가세 − 추가 차감</span><span>자동 판매가 = 공급가 ÷ 0.6 · 직접 수정 시 실제 쿠팡 비중을 표시합니다.</span></div>
    </section>}

    {stage !== 'pricing' && <section id={`coupang-step-${stage}`} role="tabpanel" aria-label={stage === 'information' ? '상품등록정보' : '등록완료'} className="overflow-hidden rounded-lg border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-3"><div className="flex flex-wrap items-center gap-3"><input aria-label="등록목록 검색" placeholder="상품명·SKU 검색" className={`${inputClass} w-52`} value={rowSearch} onChange={(event) => setRowSearch(event.target.value)} />{stage === 'information' && <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={onlyIssues} onChange={(event) => setOnlyIssues(event.target.checked)} />확인 필요만 보기</label>}</div><div className="flex flex-wrap gap-2">{stage === 'information' && <><button className={buttonClass} disabled={!stageRows.some((row) => !submissionLocked(row) && !row.bundleComponents)} onClick={() => void syncImages()}><RefreshCw className="size-3.5" />상품 정보 연결</button><button className={buttonClass} onClick={() => void save()}><Save className="size-3.5" />등록정보 저장</button><button className={`${buttonClass} border-blue-600 bg-blue-600 text-white hover:bg-blue-700`} disabled={!stageRows.length || extensionConnected !== true} onClick={() => void submitProducts()}>{selectedRows.length ? `선택 ${selectedRows.length}개 ` : ''}상품등록<ExternalLink className="size-3.5" /></button></>}<button className={buttonClass} disabled={!currentId} onClick={() => void refreshRegistration()}><RefreshCw className="size-3.5" />등록 상태 확인</button></div></div>
      {stage === 'information' && <>
        <div className="space-y-2 border-b bg-muted/20 px-3 py-2">
          <div className="flex flex-wrap items-center gap-2"><span className="text-xs">선택 {selectedRows.length}개</span><CategorySelect label="일괄 카테고리" value={templateChoice} templates={categoryTemplates} onChange={(choice) => void chooseCategory(choice)} /><button className={buttonClass} disabled={!selectedRows.length || !templateChoice || selectedRows.some(submissionLocked)} onClick={() => void chooseCategory(templateChoice, selectedRows.map((row) => row.id))}>카테고리 적용</button></div>
          <CategoryConnection empty={!hasCategories} onConnect={() => openTemplateInput('category')} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-blue-50/50 px-3 py-3 text-xs"><div><p className="font-medium">쿠팡 등록 확장 {extensionConnected === null ? '확인 중' : extensionConnected ? '연결됨' : '연결 필요'}</p><p className="mt-1 text-[11px] text-muted-foreground">등록 버튼을 누르면 허브에 파일을 채웁니다. 허브의 필수 확인사항 확인 후 상품 검수가 완료되면 3단계로 이동합니다.</p></div><div className="flex gap-2"><a className={buttonClass} href={`${API}/extension`} download>등록 확장 다운로드</a><button className={buttonClass} onClick={() => void checkExtension()}>확장 연결 확인</button></div></div>
      </>}
      <div className="overflow-x-auto"><table className="w-full min-w-[860px] text-xs"><thead className="border-b bg-muted/30 text-muted-foreground"><tr>{stage === 'information' && <th className="w-10 p-3"><input aria-label="보이는 상품 전체 선택" type="checkbox" checked={allVisibleSelected} onChange={() => setSelected((value) => { const next = new Set(value); for (const row of visible) if (!submissionLocked(row)) { if (allVisibleSelected) next.delete(row.id); else next.add(row.id) } return next })} /></th>}<th className="min-w-64 p-3 text-left">상품 · 옵션</th><th className="p-3 text-left">쿠팡 카테고리</th><th className="p-3 text-right">확정 공급가 / 판매가</th><th className="p-3 text-left">{stage === 'information' ? '필수정보 · 등록 상태' : '등록 결과'}</th><th className="p-3 text-right">작업</th></tr></thead><tbody>{visible.map((row) => {
        const issues = issueMap.get(row.id)!
        const prices = calculatePrice(row, draft.rounding)
        const locked = submissionLocked(row)
        return <tr key={row.id} className="border-b last:border-0 [&>td]:p-3"><>{stage === 'information' && <td><input aria-label={`${row.name} 선택`} type="checkbox" disabled={locked} checked={selected.has(row.id)} onChange={() => toggle(row.id)} /></td>}</><td className="font-medium leading-5">{row.name}<span className="mt-1 block text-[10px] text-muted-foreground">{row.internalSku || (row.bundleComponents ? `세트 · 구성품 ${row.bundleComponents.length}종` : '원가 SKU 미연결')}</span></td><td className="max-w-64"><span className="line-clamp-2">{row.sheetName.replace(/^QF_\d+_/, '') || '카테고리 선택 필요'}</span></td><td className="whitespace-nowrap text-right tabular-nums">{won(prices.supply)} / {won(prices.sale)}</td><td><p className={row.submission?.status === 'failed' ? 'text-red-700' : row.submission?.status === 'succeeded' ? 'text-emerald-700' : 'text-blue-800'}>{row.submission ? submissionText(row) : issues.length ? `필수정보 ${issues.length}건 확인` : '필수정보 입력 완료'}</p>{row.submission?.message && <p className="mt-1 max-w-80 text-[11px] text-muted-foreground">{row.submission.message}</p>}{stage === 'registered' && <p className="mt-1 text-[11px] text-muted-foreground">{row.submission?.receiptId && `견적서 ID · ${row.submission.receiptId}`}{row.registeredAt && ` · ${new Date(row.registeredAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`}</p>}</td><td><div className="flex justify-end gap-2">{stage === 'information' ? <><button className={buttonClass} disabled={locked} aria-label={`${row.name} 등록정보 입력`} onClick={() => setActiveId(row.id)}>등록정보 입력</button><button className={buttonClass} disabled={locked} aria-label={`${row.name} 판매가 다시 설정`} onClick={() => void reopenPricing(row)}>가격 수정</button></> : row.submission?.receiptUrl ? <a className={buttonClass} href={row.submission.receiptUrl} target="_blank" rel="noreferrer">허브 결과<ExternalLink className="size-3" /></a> : <span className="text-[11px] text-muted-foreground">검수 완료</span>}</div></td></tr>
      })}</tbody></table>{!visible.length && <div className="px-5 py-14 text-center text-sm text-muted-foreground">{stage === 'information' ? '가격설정을 완료한 상품이 이곳에 표시됩니다.' : '서플라이어허브에서 상품 검수가 완료된 상품이 이곳에 표시됩니다.'}</div>}</div>
    </section>}
    {active && stage === 'pricing' && <div ref={active.bundleComponents ? bundleEditor : undefined} className="scroll-mt-4"><PricingEditor key={active.id} row={active} draft={draft} onPatch={(patch) => patchRow(active.id, patch)} onClose={() => setActiveId('')} onAddComponent={() => setCatalogTarget({ bundleId: active.id })} /></div>}
    {active && stage === 'information' && !submissionLocked(active) && <div ref={informationEditor} className="scroll-mt-4"><RowEditor key={active.id} row={active} draft={draft} categoryTemplates={categoryTemplates} issues={issueMap.get(active.id)!} onPatch={(patch) => patchRow(active.id, patch)} onCategory={(choice) => void chooseCategory(choice, [active.id])} onRecommendedCategory={(template, categoryId) => connectRecommendedCategory(active.id, template, categoryId)} onConnectCategory={() => openTemplateInput('category')} onClose={() => setActiveId('')} onAddComponent={() => setCatalogTarget({ bundleId: active.id })} /></div>}
    {stage === 'information' && <p className="text-xs text-muted-foreground">입력 중인 내용은 저장할 수 있습니다. 필수정보가 모두 갖춰지면 엑셀 출력과 상품등록을 진행하세요.</p>}
    {busy && <div role="status" className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-lg bg-gray-900 px-4 py-3 text-sm text-white shadow-lg"><Loader2 className="size-4 animate-spin" />{busy}</div>}

    {catalogTarget && <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/35 p-4 pt-16" onClick={closeCatalog}><section role="dialog" aria-modal="true" aria-label={catalogTarget.bundleId ? '세트 구성품 검색' : 'B2B 상품 검색'} className="w-full max-w-3xl rounded-xl bg-background shadow-xl" onClick={(event) => event.stopPropagation()}><header className="flex items-center justify-between border-b px-5 py-4"><div><h2 className="font-semibold">{catalogTarget.bundleId ? '세트 구성품 추가' : 'B2B 상품 추가'}</h2><p className="mt-1 text-xs text-muted-foreground">{catalogTarget.bundleId ? '옵션을 누르면 세트 구성품으로 바로 추가됩니다.' : '상품·옵션을 여러 개 체크한 뒤 한 번에 추가할 수 있습니다.'}</p></div><button aria-label="상품 검색 닫기" className="rounded p-2 hover:bg-muted" onClick={closeCatalog}><X className="size-4" /></button></header><form className="flex gap-2 p-4" onSubmit={(event) => { event.preventDefault(); void run('상품 검색 중', async () => { const response = await jsonRequest(`/catalog?q=${encodeURIComponent(query)}`); setCatalog(response.products); setSearched(true) }) }}><input autoFocus aria-label="B2B 상품명 또는 코드" className={`${inputClass} h-9 flex-1`} placeholder="상품명 또는 B2B 상품코드" value={query} onChange={(event) => setQuery(event.target.value)} /><button className={`${buttonClass} h-9`} disabled={!!busy || !query.trim()}><Search className="size-4" />검색</button></form><div className="max-h-[60vh] overflow-y-auto px-4 pb-4">{catalog.map((product) => <div key={product.code} className="flex gap-3 border-t py-3"><div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded border bg-muted">{product.thumbnails[0] && <img className="size-full object-contain" src={product.thumbnails[0]} alt="" />}</div><div className="min-w-0 flex-1"><div className="font-medium">{product.name}</div><div className="mt-1 text-xs text-muted-foreground">코드 {product.code} · 도매가 {won(product.price)} · 상세 {product.detailImages.length}장</div><div className="mt-2 flex flex-wrap gap-1.5">{(product.options.length ? product.options : [{ name: '', addPrice: 0 }]).map((option) => { const optionLabel = option.name || '기본 상품'; const key = catalogOptionKey(product.code, option.name); const alreadyAdded = !catalogTarget.bundleId && draft.rows.some((row) => !row.bundleComponents && row.sourceCode === product.code && row.optionName === option.name); return catalogTarget.bundleId ? <button key={key} className={buttonClass} onClick={() => void addProduct(product, option.name)}><Plus className="size-3" />{optionLabel}{option.addPrice > 0 ? ` (+${option.addPrice.toLocaleString()}원)` : ''}</button> : <label key={key} className={`flex h-8 items-center gap-1.5 rounded-md border px-2 text-xs ${alreadyAdded ? 'cursor-not-allowed bg-muted text-muted-foreground' : 'cursor-pointer hover:bg-muted'}`}><input aria-label={`${product.name} ${optionLabel} 선택`} type="checkbox" checked={selectedCatalogOptionKeys.has(key)} disabled={alreadyAdded} onChange={() => toggleCatalogSelection(product, option.name)} />{optionLabel}{option.addPrice > 0 ? ` (+${option.addPrice.toLocaleString()}원)` : ''}{alreadyAdded && <span className="text-[10px]">등록됨</span>}</label> })}</div></div></div>)}{searched && !catalog.length && <p className="py-10 text-center text-sm text-muted-foreground">검색된 공개 상품이 없습니다.</p>}</div><footer className="flex items-center justify-between gap-2 border-t px-4 py-3 text-xs">{catalogTarget.bundleId ? <><span>구성품 {active?.bundleComponents?.length ?? 0}종 추가</span><button className={buttonClass} onClick={closeCatalog}>구성 확인</button></> : <><span>선택한 상품·옵션 {catalogSelections.length}개</span><div className="flex gap-2"><button className={buttonClass} disabled={!catalogSelections.length} onClick={() => void addSelectedProducts()}>선택 상품 {catalogSelections.length}개 추가</button><button className={buttonClass} onClick={closeCatalog}>닫기</button></div></>}</footer></section></div>}
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

function PricingEditor({ row, draft, onPatch, onClose, onAddComponent }: { row: RegistrationRow; draft: RegistrationDraft; onPatch: (patch: Partial<RegistrationRow>) => void; onClose: () => void; onAddComponent: () => void }) {
  const prices = calculatePrice(row, draft.rounding)
  return <section className="rounded-lg border bg-card" aria-label="가격 상세 설정"><header className="flex items-center justify-between border-b p-4"><div><h2 className="font-semibold">판매가설정 상세</h2><p className="mt-1 text-xs text-muted-foreground">상품등록 필수정보는 가격을 확정한 뒤 2단계에서 입력합니다.</p></div><button aria-label="상품 상세 닫기" onClick={onClose} className="rounded p-2 hover:bg-muted"><X className="size-4" /></button></header><div className="space-y-4 p-4"><Field label="등록 상품명"><input className={`${inputClass} max-w-2xl`} value={row.name} onChange={(event) => onPatch({ name: event.target.value, bundleReviewed: false })} /></Field>{row.bundleComponents && <BundleEditor components={row.bundleComponents} prices={prices} onAdd={onAddComponent} onChange={(bundleComponents) => onPatch({ bundleComponents, bundleReviewed: false })} />}<div className="flex flex-wrap gap-2">{row.bundleComponents && row.priceMode === 'manual' && <button className={buttonClass} onClick={() => onPatch({ priceMode: 'wholesale', manualSupplyPrice: null })}>공급가 자동계산</button>}<button className={buttonClass} aria-label={`${row.name} 판매가 자동계산`} onClick={() => onPatch({ saleMode: 'auto', manualSalePrice: null })}>판매가 자동계산</button><button className={buttonClass} aria-label={`${row.name} 판매가 기준 쿠팡 40% 맞추기`} disabled={prices.sale === null} onClick={() => onPatch({ priceMode: 'manual', manualSupplyPrice: prices.sale! * 3 / 5 })}>쿠팡 40% 맞추기</button></div><div className="grid max-w-2xl gap-3 sm:grid-cols-2"><Field label="매출부가세 직접 입력" hint="비우면 공급가 ÷ 11로 계산합니다."><MoneyInput label="매출부가세 직접 입력" value={row.manualSalesVat ?? null} placeholder={prices.salesVat === null ? '자동 계산' : `자동 ${inputWon(prices.salesVat)}`} onChange={(manualSalesVat) => onPatch({ manualSalesVat })} /></Field><div className="space-y-1 text-xs"><p>추가 차감 {prices.deduction === null ? '—' : inputWon(prices.deduction)}</p><p>순수익 {prices.profit === null ? '—' : inputWon(prices.profit)}</p><p>우리 마진 {marginText(prices.profitRate, 4)} · 쿠팡 마진 {marginText(prices.coupangRate, 4)}</p></div></div></div></section>
}

function BundleEditor({ components, prices, onAdd, onChange, readOnly = false }: {
  components: BundleComponent[]
  prices: ReturnType<typeof calculatePrice>
  onAdd: () => void
  onChange: (components: BundleComponent[]) => void
  readOnly?: boolean
}) {
  function patchComponent(component: BundleComponent, patch: Partial<BundleComponent>) {
    onChange(components.map((item) => item === component ? { ...item, ...patch } : item))
  }

  return <fieldset disabled={readOnly} className="rounded-md border p-3" aria-label="세트 구성">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-medium">세트 구성품</h3>
      <button className={buttonClass} onClick={onAdd}><Plus className="size-3.5" />구성품 검색</button>
    </div>
    <p className="mt-1 text-xs text-muted-foreground">구성품별 단위 원가와 도매가에 수량을 곱해 합산합니다. 원가가 비어 있으면 단위 원가를 입력할 수 있습니다.</p>
    <ul className="mt-2 divide-y">
      {components.map((component) => <li key={bundleKey(component)} className="grid grid-cols-[4.5rem_minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2 py-2.5 text-xs lg:grid-cols-[minmax(0,1fr)_4.5rem_6.5rem_6rem_auto]">
        <div className="col-span-4 min-w-0 lg:col-span-1">
          <p className="font-medium">{component.name}</p>
          <p className="mt-0.5 text-muted-foreground">{component.internalSku || '원가 SKU 미연결'}</p>
        </div>
        <Field label="수량">
          <input type="number" aria-label={`${component.name} 구성 수량`} min={1} max={BUNDLE_QUANTITY_LIMIT} step={1}
            className={`${inputClass} w-full text-center`} value={component.quantity} onChange={(event) => {
              const quantity = event.target.valueAsNumber
              if (Number.isInteger(quantity) && quantity >= 1 && quantity <= BUNDLE_QUANTITY_LIMIT) patchComponent(component, { quantity })
            }} />
        </Field>
        <Field label="단위 원가">
          <MoneyInput label={`${component.name} 단위 원가`} value={component.unitCost} onChange={(unitCost) => patchComponent(component, { unitCost })} />
        </Field>
        <div className="text-center tabular-nums"><p className="font-medium">단위 도매가</p><p className="mt-1.5">{component.unitWholesale === null ? '미확인' : inputWon(component.unitWholesale)}</p></div>
        <button aria-label={`${component.name} 구성품 삭제`} className="rounded p-2 text-muted-foreground hover:bg-red-50 hover:text-red-600"
          onClick={() => onChange(components.filter((item) => item !== component))}><Trash2 className="size-3.5" /></button>
      </li>)}
    </ul>
    <dl className="mt-2 grid grid-cols-3 gap-2 rounded-md bg-muted/40 p-2 text-center text-xs tabular-nums">
      <div><dt className="text-muted-foreground">세트 원가</dt><dd className="mt-1 font-medium">{prices.cost === null ? '—' : inputWon(prices.cost)}</dd></div>
      <div><dt className="text-muted-foreground">세트 공급가</dt><dd className="mt-1 font-medium">{prices.supply === null ? '—' : inputWon(prices.supply)}</dd></div>
      <div><dt className="text-muted-foreground">세트 판매가</dt><dd className="mt-1 font-semibold text-blue-700">{prices.sale === null ? '—' : inputWon(prices.sale)}</dd></div>
    </dl>
  </fieldset>
}

function CategorySelect({ label, value, templates, onChange }: { label: string; value: string; templates: CategoryTemplate[]; onChange: (value: string) => void }) {
  const hasCategories = templates.some((template) => template.sheets.length > 0)
  return <select className={`${inputClass} max-w-full`} aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
    <option value="" disabled={!hasCategories}>{hasCategories ? '저장된 견적서 양식 선택' : '저장된 견적서 양식 없음'}</option>
    {templates.flatMap((template) => template.sheets.map((sheet) => <option key={`${template.id}:${sheet.name}`} value={`${template.id}:${sheet.name}`}>{sheet.name.replace(/^QF_\d+_/, '')}</option>))}
  </select>
}

function CategoryConnection({ empty, onConnect }: { empty: boolean; onConnect: () => void }) {
  return <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
    <span>{empty ? '저장된 견적서 양식이 없습니다. ' : ''}목록에는 저장한 견적서의 카테고리만 표시됩니다. 상품에 맞는 양식은 서플라이어허브에서 찾아 연결해주세요.</span>
    <button type="button" className={buttonClass} onClick={onConnect}><FileSpreadsheet className="size-3.5" />카테고리 양식 연결</button>
    <a className="inline-flex items-center gap-1 text-blue-700 hover:underline" href="https://supplier.coupang.com/qvt/registration" target="_blank" rel="noreferrer">서플라이어허브에서 양식 받기<ExternalLink className="size-3" /></a>
  </div>
}

function RowEditor({ row, draft, categoryTemplates, issues, onPatch, onCategory, onRecommendedCategory, onConnectCategory, onClose, onAddComponent }: { row: RegistrationRow; draft: RegistrationDraft; categoryTemplates: CategoryTemplate[]; issues: string[]; onPatch: (patch: Partial<RegistrationRow>) => void; onCategory: (choice: string) => void; onRecommendedCategory: (template: ConnectedTemplate, categoryId: string) => void; onConnectCategory: () => void; onClose: () => void; onAddComponent: () => void }) {
  const [costQuery, setCostQuery] = useState('')
  const [costs, setCosts] = useState<CatalogProduct['costCandidates']>([])
  const [finding, setFinding] = useState(false)
  const [preview, setPreview] = useState(false)
  const sheet = draft.templates.find((template) => template.id === row.templateId)?.sheets.find((sheet) => sheet.name === row.sheetName)
  const computed = rowFields(row, draft.rounding, draft.labels)
  const prices = calculatePrice(row, draft.rounding)
  const automatic = new Set(['상품명', '공급가', '쿠팡 판매가', '대표이미지 파일명', '추가이미지 파일명', '상세이미지 파일명', 'HTML 상품 상세 컨텐츠', LABEL_FIELD])
  const fieldValue = (label: string, value: string) => onPatch({ fields: { ...row.fields, [label]: value } })
  const labelFiles = row.label.split(',').map((name) => name.trim()).filter(Boolean).map((name) => draft.labels.find((label) => imageStem(label.name) === imageStem(name))).filter((file): file is SavedFile => !!file)
  const autoPdfLinked = !!row.productMaster?.qualityPdf && row.autoQualityLabel?.sourcePdfId === row.productMaster.qualityPdf.id && row.autoQualityLabel.value === row.label
  return <section className="rounded-lg border bg-card" aria-label="상품등록정보 입력">
    <header className="flex items-center justify-between border-b p-4"><div><h2 className="font-semibold">상품등록정보 입력</h2><p className="mt-1 text-xs text-muted-foreground">{row.name} · 별표(*) 항목은 선택한 쿠팡 엑셀 양식의 필수정보입니다.</p></div><button aria-label="상품 상세 닫기" onClick={onClose} className="rounded p-2 hover:bg-muted"><X className="size-4" /></button></header>
    {issues.length > 0 && <div className="mx-4 mt-4 rounded-md border border-amber-200 bg-amber-50 p-3"><p className="text-xs font-medium text-amber-900">입력 확인 {issues.length}건</p><ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-amber-800">{issues.map((issue) => <li key={issue}>· {issue}</li>)}</ul></div>}
    <div className="grid gap-5 p-4 lg:grid-cols-[1fr_360px]"><div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2"><Field label="등록 상품명"><input className={inputClass} value={row.name} placeholder={row.bundleComponents ? '쿠팡에 등록할 세트 상품명' : undefined} onChange={(event) => onPatch({ name: event.target.value, bundleReviewed: false })} /></Field><div className="space-y-3"><CategoryRecommendations sourceCode={row.sourceCode} selectedSheetName={row.sheetName} onConnect={onRecommendedCategory} /><details className="rounded-md border p-2 text-xs"><summary className="cursor-pointer text-muted-foreground">저장된 양식 직접 선택</summary><div className="mt-2 space-y-2"><Field label="저장된 견적서 양식"><CategorySelect label="저장된 견적서 양식" value={row.templateId && row.sheetName ? `${row.templateId}:${row.sheetName}` : ''} templates={categoryTemplates} onChange={onCategory} /></Field><CategoryConnection empty={!categoryTemplates.some((template) => template.sheets.length > 0)} onConnect={onConnectCategory} /></div></details></div></div>
      {row.bundleComponents ? <BundleEditor readOnly components={row.bundleComponents} prices={prices} onAdd={onAddComponent} onChange={(bundleComponents) => onPatch({ bundleComponents, bundleReviewed: false })} /> : <div className="rounded-md border p-3"><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs font-medium">원가 SKU 연결 · {row.internalSku || '미연결'}</span><form className="flex gap-1" onSubmit={(event) => { event.preventDefault(); setFinding(true); void jsonRequest(`/catalog?cost=1&q=${encodeURIComponent(costQuery)}`).then((response) => setCosts(response.costs)).catch((error) => toast.error(error.message)).finally(() => setFinding(false)) }}><input aria-label="원가 SKU 검색" className={`${inputClass} w-40`} placeholder="품목코드·상품명" value={costQuery} onChange={(event) => setCostQuery(event.target.value)} /><button className={buttonClass} disabled={finding || !costQuery.trim()}>{finding ? <Loader2 className="size-3 animate-spin" /> : '조회'}</button></form></div>{costs.length > 0 && <div className="mt-2 max-h-36 overflow-y-auto">{costs.map((cost) => <button key={cost.sku} className="flex w-full justify-between gap-2 border-t p-2 text-left text-xs hover:bg-muted" onClick={() => { onPatch({ internalSku: cost.sku, costPrice: cost.costPrice }); setCosts([]) }}><span>{cost.sku} · {cost.name} {cost.optionName}</span><span>{won(cost.costPrice)}</span></button>)}</div>}<p className="mt-2 text-[11px] text-muted-foreground">원가는 품목의 works 신규 원가(원화)에서 가져옵니다. 신규원가가 없으면 비워둡니다. </p></div>}
      {(row.bundleComponents?.length || /[2-9]\d*개입/.test(row.name)) ? <label className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs"><input type="checkbox" checked={row.bundleReviewed} onChange={(event) => onPatch({ bundleReviewed: event.target.checked })} />묶음 구성, 세트 원가·도매가·공급가 및 라벨을 확인했습니다.</label> : null}
      <div className="grid gap-3 sm:grid-cols-2"><Field label="품질표시 파일명 또는 공개 URL" hint="추가한 라벨 파일명과 일치해야 합니다. 여러 장은 쉼표로 구분합니다."><input className={inputClass} list="coupang-label-files" value={row.label} onChange={(event) => onPatch({ label: event.target.value })} /><datalist id="coupang-label-files">{draft.labels.map((label) => <option key={label.name} value={label.name} />)}</datalist></Field><div className="flex items-end gap-2"><button className={buttonClass} onClick={() => setPreview((value) => !value)}>상세 HTML {preview ? '닫기' : '미리보기'}</button>{row.sourceCode && <a className={buttonClass} href={`https://funtasticb2b.com/goods/view?no=${encodeURIComponent(row.sourceCode)}`} target="_blank" rel="noreferrer">원본 상세페이지<ExternalLink className="size-3" /></a>}</div></div>
      {row.productMaster && <div className="rounded-md border border-blue-100 bg-blue-50/60 p-3 text-xs text-blue-950"><p className="font-medium">상품관리 정보 연결됨 · {row.productMaster.match === 'sku' ? 'SKU 일치' : '상품명 일치'}</p><p className="mt-1">포장 기본값: {row.fields['한 개 단품 포장 사이즈'] || '크기 확인 필요'} mm · {row.fields['한 개 단품 포장 무게'] || '무게 확인 필요'} g <span className="text-blue-700">(상품 크기 각 변 +2cm 기준)</span></p>{row.productMaster.qualityPdf && <p className="mt-1">품질표시 PDF: <a className="underline" href={`/api/new-products/attachments/${encodeURIComponent(row.productMaster.qualityPdf.id)}`} target="_blank" rel="noreferrer">{row.productMaster.qualityPdf.fileName}</a> <span className="text-blue-700">· {autoPdfLinked ? `JPG ${labelFiles.length}장 자동 변환·연결됨` : '정보 연결 시 JPG로 자동 변환됩니다.'}</span></p>}</div>}
      {labelFiles.length > 0 && <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">품질표시 미리보기 {labelFiles.length}장</summary><div className="mt-2 grid gap-2 sm:grid-cols-2">{labelFiles.map((file) => <img key={file.name} className="max-h-96 max-w-full border" src={`data:image/${/\.png$/i.test(file.name) ? 'png' : 'jpeg'};base64,${file.data}`} alt={`${file.name} 품질표시 스티커`} />)}</div></details>}
      <Field label="추가이미지 URL" hint="대표이미지를 포함한 후보 목록입니다. JPG·PNG 공개 URL을 한 줄에 하나씩 입력합니다."><textarea className={`${inputClass} h-16 py-2 font-mono text-[11px]`} value={row.thumbnails.join('\n')} onChange={(event) => onPatch({ thumbnails: event.target.value.split('\n').map((value) => value.trim()).filter(Boolean), fields: { ...row.fields, '추가이미지 파일명': '' } })} /></Field>
      <Field label="상세이미지 URL" hint="JPG·PNG 공개 URL을 한 줄에 하나씩 입력합니다. HTML은 자동 생성됩니다."><textarea className={`${inputClass} h-20 py-2 font-mono text-[11px]`} value={row.detailImages.join('\n')} onChange={(event) => onPatch({ detailImages: event.target.value.split('\n').map((value) => value.trim()).filter(Boolean) })} /></Field>
      {preview && <iframe title="쿠팡 상세 HTML 미리보기" sandbox="" className="h-[560px] w-full rounded border bg-white" srcDoc={`<!doctype html><html lang="ko"><head><meta charset="utf-8"></head><body>${detailHtml(row.detailImages, row.name)}</body></html>`} />}
      <details open className="rounded-md border"><summary className="cursor-pointer px-3 py-2 text-xs font-medium">카테고리 필수정보 · 상품 사이즈·포장·인증</summary><div className="grid gap-3 border-t p-3 sm:grid-cols-2">{sheet ? sheet.columns.filter((column) => !automatic.has(column.label) && !isAutomaticTemplateColumn(column) && (column.requirement === '필수' || column.requirement.includes('조건부') || !!row.fields[column.label])).map((column) => <Field key={column.column} label={`${column.label}${column.requirement === '필수' ? ' *' : column.requirement.includes('조건부') ? ' (조건부)' : ''}`} hint={column.guide.slice(0, 120)}><OfficialColumnInput column={column} value={row.fields[column.label] ?? ''} listId={`official-${row.id}-${column.column}`} onChange={(value) => fieldValue(column.label, value)} /></Field>) : <p className="text-xs text-muted-foreground">카테고리 양식을 연결하고 선택하면 필수 입력항목이 표시됩니다.</p>}</div></details>
      <fieldset disabled className="rounded-md border p-3">
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
      </fieldset>
    </div><aside className="space-y-3"><div><h3 className="text-xs font-medium">대표이미지 선택</h3><div className="mt-2 grid grid-cols-4 gap-2">{row.thumbnails.filter(isImageUrl).map((url, index) => <button key={url} aria-label={`대표이미지 ${index + 1} 선택`} className={`relative aspect-square overflow-hidden rounded border bg-white ${row.primaryImage === url ? 'border-blue-600 ring-2 ring-blue-200' : ''}`} onClick={() => onPatch({ primaryImage: url })}><img className="size-full object-contain" src={url} alt={`상품 이미지 ${index + 1}`} />{row.primaryImage === url && <Check className="absolute bottom-1 right-1 size-4 rounded-full bg-blue-600 text-white" />}</button>)}</div></div><Field label="대표이미지 URL"><input className={inputClass} value={row.primaryImage} onChange={(event) => onPatch({ primaryImage: event.target.value })} /></Field><div className="rounded-md bg-muted/40 p-3 text-xs leading-6"><p>상품관리 크기가 연결되면 <strong>각 변 +2cm</strong>를 포장 사이즈 기본값으로 넣습니다.</p><p className="mt-2">쿠팡 물류용 <strong>포장 사이즈·무게</strong>는 수정값을 우선 보존합니다.</p><p className="mt-2 text-muted-foreground">원본 고시정보와 라벨의 내용이 일치하는지도 확인해주세요.</p></div><div className="rounded-md border p-3 text-xs"><div className="font-medium">견적서 반영 가격</div><p className="mt-2 text-muted-foreground">가격 변경은 목록의 가격 수정에서 진행하세요.</p><div className="mt-2 flex justify-between"><span className="text-muted-foreground">공급가</span><span>{computed['공급가'] ? inputWon(Number(computed['공급가'])) : '—'}</span></div><div className="mt-1 flex justify-between"><span className="text-muted-foreground">판매가</span><span className="font-semibold text-blue-700">{computed['쿠팡 판매가'] ? inputWon(Number(computed['쿠팡 판매가'])) : '—'}</span></div></div></aside></div>
  </section>
}
