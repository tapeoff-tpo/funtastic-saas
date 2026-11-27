'use client'

import { useCallback, useEffect, useRef, useState, type ComponentProps, type CSSProperties, type ReactNode } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { Check, ChevronRight, Download, ExternalLink, FileSpreadsheet, Loader2, Maximize2, Plus, RefreshCw, RotateCcw, Save, Search, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { applyProductMasterDefaults, applyRegistrationDefaults, attachCatalog, blankDraft, BUNDLE_COMPONENT_LIMIT, BUNDLE_QUANTITY_LIMIT, calculatePrice, confirmPricing, confirmRegistration, createRegistrationRow, detailHtml, getRegistrationStage, hasPreparedSupplierDraft, hasVerifiedSupplierRegistration, imageStem, isAutomaticTemplateColumn, isImageUrl, LABEL_FIELD, matchCatalog, money, priceIssues, registrationCommonSheet, registrationFieldKey, registrationFieldValue, registrationInformationSheet, reopenRegistration, returnToPricing, rowFields, rowIssues, SEARCH_TAGS_FIELD, type BundleComponent, type CatalogProduct, type RegistrationDraft, type RegistrationProductMaster, type RegistrationRow, type SavedFile, type TemplateColumn } from '@/lib/coupang-registration/model'
import { applyConvertedQualityLabels, applyQualityLabelIssue, qualityPdfNeedsConversion } from '@/lib/coupang-registration/quality-labels'
import type { CategoryContext } from '@/lib/coupang-registration/category-context'
import { matchCategorySheet, type SavedSheetMapping } from '@/lib/coupang-registration/sheet-matching'
import { useWorkbenchNavigation, type RegistrationStage } from './use-workbench-navigation'
import { buildInformationColumns, groupInformationRows } from './information-columns'
import { CategoryTemplatePicker } from './category-template-picker'
import { SupplierRegistrationControls, type SupplierRegistrationMode, type SupplierRegistrationProgressItem } from './supplier-registration-controls'
import { attachSupplierRegistration, checkSupplierRegistration, inspectSupplierRegistration, openSupplierRegistration, pingSupplierExtension, resumeSupplierRegistration, startSupplierRegistration, stopSupplierRegistration, subscribeSupplierRegistration, type SupplierJobReference, type SupplierRegistrationProgress, type SupplierTransferJob } from '@/lib/coupang-registration/supplier-bridge'

const API = '/api/operations/coupang-registration'
const inputClass = 'h-8 rounded-md border bg-background px-2 text-xs outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100'
const buttonClass = 'inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border bg-background px-3 text-xs font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40'
const won = (value: number | null) => value === null ? '—' : `${value.toLocaleString('ko-KR', { maximumFractionDigits: 0 })}원`
const inputWon = (value: number) => `${value.toLocaleString('ko-KR', { maximumFractionDigits: 6 })}원`
const bundleKey = (component: BundleComponent) => JSON.stringify([component.sourceCode, component.optionName])
const marginText = (value: number | null, digits: number) => value === null ? '—' : `${value.toLocaleString('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`
const individualVerificationFields = [
  '전기용품 및 생활용품, 어린이 (KC) 인증 마크 타입', '전기용품 및 생활용품, 어린이 (KC) 인증번호',
  '방송통신 기자재 (EMC) 인증 번호', '안전기준적합확인 신고번호', '인증/허가 사항',
  '제조국', '박스 내 SKU 수량', '유통기간', '취급주의 사유',
] as const
type DraftSummary = { id: string; name: string; revision: number; updatedAt: string }
type CategoryTemplate = { id: string; name: string; sheets: Array<{ name: string }> }
type ConnectedTemplate = RegistrationDraft['templates'][number]
type CatalogSelection = { product: CatalogProduct; optionName: string }
const steps: Array<{ stage: RegistrationStage; title: string }> = [
  { stage: 'pricing', title: '판매가설정' },
  { stage: 'information', title: '상품등록정보' },
  { stage: 'registered', title: '등록완료' },
]
const stepColors: Record<RegistrationStage, { active: string; inactive: string }> = {
  pricing: { active: 'border-blue-600 bg-blue-600 text-white ring-1 ring-blue-600', inactive: 'border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100' },
  information: { active: 'border-violet-600 bg-violet-600 text-white ring-1 ring-violet-600', inactive: 'border-violet-200 bg-violet-50 text-violet-800 hover:bg-violet-100' },
  registered: { active: 'border-emerald-700 bg-emerald-700 text-white ring-1 ring-emerald-700', inactive: 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100' },
}
const submissionLocked = (row: RegistrationRow) => ['queued', 'running', 'login_required', 'attention_required', 'prepared'].includes(row.submission?.status ?? '') || !!row.submission?.products?.some(product => product.id === row.id && product.status === 'prepared') || getRegistrationStage(row) === 'registered'
const completionInFlight = (row: RegistrationRow) => ['queued', 'running', 'login_required', 'attention_required'].includes(row.submission?.status ?? '')
const completedDeletionLocked = (row: RegistrationRow) => hasVerifiedSupplierRegistration(row) || hasPreparedSupplierDraft(row) || completionInFlight(row)
const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date())
function connectedDefaults(row: RegistrationRow, templates: RegistrationDraft['templates']) {
  const sheet = templates.find((template) => template.id === row.templateId)?.sheets.find((sheet) => sheet.name === row.sheetName)
  return applyRegistrationDefaults(row, registrationInformationSheet(sheet ?? registrationCommonSheet))
}
const gridTextStyle: CSSProperties = { fieldSizing: 'content', height: 'auto', minHeight: 32, maxHeight: 46, lineHeight: '16px', paddingBlock: 6, resize: 'none', overflowY: 'auto', overflowWrap: 'anywhere' }
function GridTextInput({ singleLine = true, onChange, ...props }: ComponentProps<'textarea'> & { singleLine?: boolean }) {
  return <textarea {...props} rows={1} data-grid-single-line={singleLine || undefined} style={gridTextStyle} onChange={(event) => {
    if (singleLine) event.target.value = event.target.value.replace(/[\r\n]/g, '')
    onChange?.(event)
  }} />
}
function OfficialColumnInput({ column, value, listId, onChange, expandText = false }: { column: TemplateColumn; value: string; listId: string; onChange: (value: string) => void; expandText?: boolean }) {
  const className = `${inputClass} ${column.requirement === '필수' && !value.trim() ? 'border-amber-400 bg-amber-50/40' : ''}`
  if (column.choices?.length && (column.label === '카테고리' || !column.allowCustom)) return <select className={className} value={value} onChange={(event) => onChange(event.target.value)} title={column.guide}>
    <option value="">선택해주세요</option>
    {value && !column.choices.includes(value) && <option value={value}>{value}</option>}
    {column.choices.map((choice) => <option key={choice} value={choice}>{choice}</option>)}
  </select>
  if (expandText && !column.choices?.length) return <GridTextInput singleLine={column.label !== SEARCH_TAGS_FIELD} className={`${className} block w-full min-w-0`} value={value} onChange={(event) => onChange(event.target.value)} title={column.guide} />
  return <><input className={className} list={column.choices?.length ? listId : undefined} value={value} onChange={(event) => onChange(event.target.value)} title={column.guide} />{column.choices?.length ? <datalist id={listId}>{column.choices.map((choice) => <option key={choice} value={choice} />)}</datalist> : null}</>
}
const submissionText = (row: RegistrationRow) => row.submission ? { queued: '등록 대기', running: '등록 중', login_required: '로그인 필요', attention_required: '확인 필요', prepared: '입력·저장 완료', cancelled: '중지됨', failed: '등록 실패', succeeded: '등록 완료' }[row.submission.status] : '미등록'

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
export function CoupangRegistrationWorkbench() {
  const [draft, setDraft] = useState<RegistrationDraft>(blankDraft)
  const [currentId, setCurrentId] = useState<string>()
  const revision = useRef<number | undefined>(undefined)
  const [saved, setSaved] = useState<DraftSummary[]>([])
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const { activeId, catalogTarget, stage, navigate, reset: resetNavigation } = useWorkbenchNavigation()
  const [query, setQuery] = useState('')
  const [catalog, setCatalog] = useState<CatalogProduct[]>([])
  const [catalogSelections, setCatalogSelections] = useState<CatalogSelection[]>([])
  const [searched, setSearched] = useState(false)
  const [productQuery, setProductQuery] = useState('')
  const [templateLibrary, setTemplateLibrary] = useState<CategoryTemplate[]>([])
  const [onlyIssues, setOnlyIssues] = useState(false)
  const [informationLimit, setInformationLimit] = useState(20)
  const [expandedWorkbench, setExpandedWorkbench] = useState(false)
  const [completionDate, setCompletionDate] = useState(today)
  const [sheetMappings, setSheetMappings] = useState<SavedSheetMapping[]>([])
  const [sheetMappingsReady, setSheetMappingsReady] = useState(false)
  const [categoryContexts, setCategoryContexts] = useState<Record<string, CategoryContext | null>>({})
  const [registrationMode, setRegistrationMode] = useState<SupplierRegistrationMode>('excel')
  const [registrationJobs, setRegistrationJobs] = useState<Array<{ jobId: string; mode: SupplierRegistrationMode; status: string; message: string; rowIds: string[]; control: SupplierJobReference; products?: NonNullable<RegistrationRow['submission']>['products'] }>>([])
  const registrationTransfers = useRef(new Map<string, SupplierTransferJob>())
  const registrationDrafts = useRef(new Map<string, string>())
  const activeDraftId = useRef<string | undefined>(undefined)
  const [registrationConflict, setRegistrationConflict] = useState(false)
  const registrationConflictRef = useRef(false)
  const categoryRequests = useRef(new Set<string>())
  const manualSheetRows = useRef(new Set<string>())
  const connectedRows = useRef(new Set<string>())
  const submissionEvents = useRef<Promise<void>>(Promise.resolve())
  const draftSession = useRef(0)
  const bundleEditor = useRef<HTMLDivElement>(null)
  const informationEditor = useRef<HTMLDivElement>(null)
  const stageRows = draft.rows.filter((row) => getRegistrationStage(row) === stage)
  const active = stageRows.find((row) => row.id === activeId)
  const issueMap = new Map(draft.rows.map((row) => [row.id, rowIssues(row, draft)]))
  const pricingIssueMap = new Map(draft.rows.map((row) => [row.id, priceIssues(row, draft.rounding)]))
  const stageIssueMap = stage === 'pricing' ? pricingIssueMap : issueMap
  const visible = stageRows.filter((row) => !onlyIssues || stageIssueMap.get(row.id)!.length)
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
  const registrationItems: SupplierRegistrationProgressItem[] = registrationJobs.flatMap(job => {
    const products = job.mode === 'individual' && job.products?.length ? job.products : job.rowIds.map(id => ({ id, name: draft.rows.find(row => row.id === id)?.name ?? '상품', status: job.status, message: job.message }))
    return products.map(product => ({ id: `${job.jobId}:${product.id}`, name: product.name,
      status: (product.status === 'attention_required' ? 'review_required' : product.status === 'cancelled' ? 'stopped' : product.status) as SupplierRegistrationProgressItem['status'],
      message: product.message || job.message, canOpen: job.mode === 'individual' && !['cancelled', 'failed'].includes(job.status),
      canStop: job.mode === 'individual' && ['queued', 'running', 'login_required', 'attention_required'].includes(job.status),
      canCheck: ['queued', 'running', 'login_required', 'attention_required'].includes(job.status) }))
  })
  const visibleSteps = steps
  const sheetStatus = new Map(stageRows.map((row) => {
    const context = categoryContexts[row.sourceCode]
    if (row.bundleComponents) return [row.id, '세트 카테고리 선택']
    if (!/^\d{1,100}$/.test(row.sourceCode)) return [row.id, '카테고리 직접 선택']
    if (context === undefined) return [row.id, '펀타 분류 확인 중']
    if (context === null) return [row.id, '분류 조회 실패 · 직접 선택']
    const match = matchCategorySheet(context, draft.templates, sheetMappings.find((mapping) => mapping.sourceCode === row.sourceCode))
    return [row.id, `${context.categoryPath || context.categoryName || '등록 분류 없음'} · ${row.templateId && row.sheetName ? '연결됨' : match.status === 'ambiguous' ? '후보 여러 개 · 선택 필요' : match.status === 'unmatched' ? '맞는 시트 선택 필요' : '자동 연결 중'}`]
  }))

  function update(change: (value: RegistrationDraft) => RegistrationDraft) { setDraft(change); setDirty(true) }
  function setRevision(value: number | undefined) { revision.current = value }
  const queueServerWrite = useCallback(<T,>(action: () => Promise<T>): Promise<T> => {
    const next = submissionEvents.current.catch(() => undefined).then(action)
    submissionEvents.current = next.then(() => undefined, () => undefined)
    return next
  }, [])
  const applySubmissionResponse = useCallback((response: { id: string; revision: number; payload: RegistrationDraft; submissions?: typeof registrationJobs; transfers?: SupplierTransferJob[]; eventBaseRevision?: number; eventAppliedRevision?: number }) => {
    if (activeDraftId.current !== response.id) return
    if (!response.submissions || !response.payload || response.revision < (revision.current ?? 0)) return
    const expectedRevision = revision.current
    const conflict = response.eventBaseRevision === undefined
      ? expectedRevision !== undefined && response.revision !== expectedRevision
      : response.eventBaseRevision !== expectedRevision || response.eventAppliedRevision !== response.revision
    if (conflict || registrationConflictRef.current) {
      registrationConflictRef.current = true; setRegistrationConflict(true)
      return
    }
    revision.current = response.revision
    const serverRows = new Map(response.payload.rows.filter(row => row.submission).map(row => [row.id, row]))
    setDraft(value => ({ ...value, rows: value.rows.map(row => {
      const server = serverRows.get(row.id)
      if (!server) return row
      return { ...row, submission: server.submission, ...(server.submission?.status === 'succeeded' ? { stage: server.stage, registeredAt: server.registeredAt, registrationCompletedAt: server.registrationCompletedAt } : {}) }
    }) }))
    if (response.submissions) {
      setRegistrationJobs(response.submissions)
      for (const job of response.submissions) registrationDrafts.current.set(job.jobId, response.id)
    }
    for (const transfer of response.transfers ?? []) registrationTransfers.current.set(transfer.jobId, transfer)
  }, [])
  useEffect(() => {
    activeDraftId.current = currentId
    if (!currentId) return
    let cancelled = false
    void jsonRequest(`/submissions?draftId=${encodeURIComponent(currentId)}`).then(async response => {
      if (cancelled) return
      applySubmissionResponse(response)
      for (const job of response.submissions ?? []) if (job.mode === 'individual' && ['queued', 'running', 'login_required', 'attention_required'].includes(job.status)) {
        await attachSupplierRegistration(job.control).catch(() => undefined)
      }
    }).catch(() => { if (!cancelled) toast.error('쿠팡 등록 진행 상태를 불러오지 못했습니다.') })
    return () => { cancelled = true }
  }, [currentId, applySubmissionResponse])
  useEffect(() => subscribeSupplierRegistration((progress: SupplierRegistrationProgress) => {
    const id = registrationDrafts.current.get(progress.jobId)
    if (!id) return
    void queueServerWrite(async () => {
      const response = await postJson('/submissions', { ...progress, draftId: id })
      applySubmissionResponse(response)
    }).catch(() => toast.error('쿠팡 등록 진행 상태를 저장하지 못했습니다. 다시 확인을 눌러주세요.'))
  }), [applySubmissionResponse, queueServerWrite])
  function patchRow(id: string, patch: Partial<RegistrationRow>) {
    update((value) => ({ ...value, rows: value.rows.map((row) => row.id === id && !submissionLocked(row) ? connectedDefaults({ ...row, ...patch }, value.templates) : row) }))
  }
  function setActiveId(activeId: string) { navigate({ activeId }) }
  function setCatalogTarget(catalogTarget: { bundleId?: string } | null) { navigate({ catalogTarget }) }
  function changeStage(next: RegistrationStage) { navigate({ stage: next, activeId: '', catalogTarget: null }); setSelected(new Set()); setOnlyIssues(false); setProductQuery(''); setInformationLimit(20) }
  function toggle(id: string) { setSelected((value) => { const next = new Set(value); if (next.has(id)) next.delete(id); else next.add(id); return next }) }
  useEffect(() => {
    let cancelled = false
    void jsonRequest('/drafts').then((response) => { if (!cancelled) setSaved(response.drafts) }).catch((error) => { toast.error(error.message) })
    return () => { cancelled = true }
  }, [])
  useEffect(() => {
    let cancelled = false
    void jsonRequest('/sheet-mappings').then((response) => {
      if (!Array.isArray(response.mappings)) throw new Error('저장된 카테고리 연결을 확인하지 못했습니다.')
      if (!cancelled) { setSheetMappings(response.mappings); setSheetMappingsReady(true) }
    }).catch(() => { if (!cancelled) toast.error('저장된 카테고리 연결을 불러오지 못했습니다.') })
    return () => { cancelled = true }
  }, [])
  useEffect(() => {
    if (stage !== 'information') return
    const codes = [...new Set(stageRows.filter((row) => !row.bundleComponents && !submissionLocked(row) && /^\d{1,100}$/.test(row.sourceCode)).map((row) => row.sourceCode))]
      .filter((code) => !categoryRequests.current.has(code))
    for (const code of codes) categoryRequests.current.add(code)
    if (!codes.length) return
    void (async () => {
      for (let index = 0; index < codes.length; index += 4) {
        await Promise.all(codes.slice(index, index + 4).map(async (code) => {
          try {
            const { context } = await jsonRequest(`/category-context?code=${encodeURIComponent(code)}`)
            if (!context || context.sourceCode !== code || typeof context.categoryName !== 'string' || typeof context.categoryPath !== 'string') throw new Error('상품 분류를 확인하지 못했습니다.')
            setCategoryContexts((value) => ({ ...value, [code]: context }))
          } catch { setCategoryContexts((value) => ({ ...value, [code]: null })) }
        }))
      }
    })()
  })
  useEffect(() => {
    if (busy || stage !== 'information' || !sheetMappingsReady || !draft.templates.length) return
    const matches = new Map(draft.rows.flatMap((row) => {
      if (getRegistrationStage(row) !== 'information' || submissionLocked(row) || row.bundleComponents || row.templateId && row.sheetName || manualSheetRows.current.has(`${draftSession.current}:${row.id}`)) return []
      const context = categoryContexts[row.sourceCode]
      if (!context) return []
      const result = matchCategorySheet(context, draft.templates, sheetMappings.find((mapping) => mapping.sourceCode === row.sourceCode))
      return result.status === 'matched' && result.matched ? [[row.id, result.matched] as const] : []
    }))
    if (!matches.size) return
    setDraft((value) => ({ ...value, rows: value.rows.map((row) => {
      const match = matches.get(row.id)
      if (!match || row.templateId && row.sheetName || submissionLocked(row)) return row
      const sheet = value.templates.find((template) => template.id === match.templateId)?.sheets.find((sheet) => sheet.name === match.sheetName)
      return sheet ? applyRegistrationDefaults({ ...row, templateId: match.templateId, sheetName: match.sheetName }, registrationInformationSheet(sheet)) : row
    }) }))
    setDirty(true)
  }, [busy, stage, sheetMappingsReady, draft.rows, draft.templates, categoryContexts, sheetMappings])
  useEffect(() => {
    let cancelled = false
    void jsonRequest('/templates').then((response) => { if (!cancelled) setTemplateLibrary(response.templates ?? []) }).catch(() => {
      if (!cancelled) toast.error('저장된 카테고리 양식을 불러오지 못했습니다. 카테고리 양식 연결로 파일을 추가해주세요.')
    })
    return () => { cancelled = true }
  }, [])
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault() }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [dirty])
  useEffect(() => {
    if (stage === 'information' && activeId) informationEditor.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
  }, [stage, activeId])
  async function run(label: string, action: () => Promise<void>) {
    if (busy) return
    setBusy(label)
    try { await action() } catch (error) { toast.error(error instanceof Error ? error.message : '처리하지 못했습니다.') } finally { setBusy('') }
  }

  async function chooseCategory(choice: string, rowIds?: string[]) {
    for (const id of rowIds ?? []) manualSheetRows.current.add(`${draftSession.current}:${id}`)
    if (!choice) {
      if (rowIds) update((value) => ({ ...value, rows: value.rows.map((row) => rowIds.includes(row.id) && !submissionLocked(row) ? { ...row, templateId: '', sheetName: '' } : row) }))
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
        rows: rowIds ? value.rows.map((row) => rowIds.includes(row.id) && !submissionLocked(row) ? applyRegistrationDefaults({ ...row, templateId, sheetName }, registrationInformationSheet(connected.sheets.find((sheet) => sheet.name === sheetName)!)) : row) : value.rows,
      }))
      const codes = [...new Set(draft.rows.filter((row) => rowIds?.includes(row.id) && !submissionLocked(row) && !row.bundleComponents && /^\d{1,100}$/.test(row.sourceCode)).map((row) => row.sourceCode))]
      let failures = 0
      for (let index = 0; index < codes.length; index += 30) {
        try {
          const response = await postJson('/sheet-mappings', { sourceCodes: codes.slice(index, index + 30), targetSheetName: sheetName, file: connected.file })
          const saved = Array.isArray(response.mappings) ? response.mappings as SavedSheetMapping[] : []
          if (session === draftSession.current) setSheetMappings((value) => [...value.filter((mapping) => !saved.some((item) => item.sourceCode === mapping.sourceCode)), ...saved])
          failures += response.failures?.length ?? 0
        } catch { failures += Math.min(30, codes.length - index) }
      }
      if (failures) toast.error(`현재 시트는 연결했지만 ${failures}개 상품의 다음 작업용 연결은 저장하지 못했습니다. 다시 선택해주세요.`)
    })
  }
  async function importTemplates(files: FileList | null, rowId?: string) {
    if (!files?.length) return
    const chosenFiles = Array.from(files)
    if (rowId && chosenFiles.length !== 1) { toast.error('상품별 카테고리 엑셀은 한 파일씩 선택해주세요.'); return }
    const session = draftSession.current
    await run('카테고리 엑셀 읽는 중', async () => {
      let templates = draft.templates
      for (const file of chosenFiles) {
        const form = new FormData(); form.set('file', file)
        const response = await jsonRequest('/template', { method: 'POST', body: form })
        const template = response.template as ConnectedTemplate
        if (!template?.file || !template.sheets?.length) throw new Error('카테고리 엑셀의 입력항목을 확인하지 못했습니다.')
        if (!templates.some((item) => item.id === template.id) && templates.length >= 6) throw new Error('작업당 카테고리 엑셀은 6개까지 연결할 수 있습니다. 새 작업으로 나눠주세요.')
        templates = [...templates.filter((item) => item.id !== template.id), template]
      }
      if (session !== draftSession.current) return
      update((value) => ({
        ...value, templates,
      }))
      toast.success('카테고리 엑셀을 읽었습니다.')
    })
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

  async function syncImages(ids: Set<string>) {
    const targets = stageRows.filter((row) => ids.has(row.id) && !submissionLocked(row) && !row.bundleComponents)
    if (!targets.length) return
    await run('상품·이미지·품질표시 연결 중', async () => {
      const matched: CatalogProduct[] = []
      const rowMasters = new Map<string, RegistrationProductMaster>()
      for (let start = 0; start < targets.length; start += 30) {
        const chunk = targets.slice(start, start + 30)
        const response = await postJson('/catalog', {
          names: [], codes: [...new Set(chunk.map((row) => row.sourceCode).filter(Boolean))],
          rows: chunk.map(({ id, sourceCode, name, sourceName, optionName, internalSku }) => ({ id, sourceCode, name, sourceName, optionName, internalSku })),
        })
        matched.push(...response.products)
        for (const [id, master] of Object.entries(response.productMasters ?? {})) rowMasters.set(id, master as RegistrationProductMaster)
      }
      const products = [...new Map(matched.map((product) => [product.code, product])).values()]
      const targetIds = new Set(targets.map((row) => row.id))
      const linkedRows = draft.rows.map((row) => {
        if (!targetIds.has(row.id)) return row
        const match = matchCatalog(row, products)
        if (!match) return row
        const master = rowMasters.get(row.id)
        return applyProductMasterDefaults(attachCatalog(row, master ? { ...match, productMaster: master } : match))
      })
      const conversionRows = linkedRows.filter((row) => {
        const qualityPdf = row.productMaster?.qualityPdf
        return targetIds.has(row.id) && !!qualityPdf && qualityPdfNeedsConversion(row, qualityPdf.id, draft.labels)
      })
      const pdfs = [...new Map(conversionRows.flatMap((row) => row.productMaster?.qualityPdf ? [[row.productMaster.qualityPdf.id, row.productMaster.qualityPdf] as const] : [])).values()]
      const convertedByPdf = new Map<string, SavedFile[]>()
      const conversionErrors = new Map<string, string>()
      for (let index = 0; index < pdfs.length; index += 4) await Promise.all(pdfs.slice(index, index + 4).map(async (qualityPdf) => {
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
      }))
      const generatedLabels = pdfs.flatMap(qualityPdf => convertedByPdf.get(qualityPdf.id) ?? [])
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
      if (conversionErrors.size) toast.error(`품질표시 PDF ${conversionErrors.size}개는 자동 변환하지 못했습니다. 해당 상품의 확인 항목을 봐주세요.`)
    })
  }

  useEffect(() => {
    if (busy || stage !== 'information') return
    const targets = stageRows.filter((row) => !submissionLocked(row) && !row.bundleComponents && !!row.sourceCode
      && !connectedRows.current.has(`${draftSession.current}:${row.id}:${row.sourceCode}`))
    if (!targets.length) return
    for (const row of targets) connectedRows.current.add(`${draftSession.current}:${row.id}:${row.sourceCode}`)
    void syncImages(new Set(targets.map((row) => row.id)))
  })

  async function persist(nextDraft = draft, asNew = false, deleteCompletedRowIds?: string[]) {
    if (!asNew && registrationConflictRef.current) throw new Error('다른 변경이 감지되었습니다. 현재 내용을 확인한 뒤 저장된 작업을 다시 불러와주세요.')
    return queueServerWrite(async () => {
      const response = await postJson('/drafts', { draft: nextDraft, ...(!asNew && currentId ? { id: currentId, revision: revision.current } : {}), ...(deleteCompletedRowIds?.length ? { deleteCompletedRowIds } : {}) })
      if (asNew) draftSession.current++
      activeDraftId.current = response.id
      setDraft(response.payload ?? nextDraft); setCurrentId(response.id); setRevision(response.revision); setDirty(false)
      setSaved(value => [{ id: response.id, name: (response.payload ?? nextDraft).name, revision: response.revision, updatedAt: new Date().toISOString() }, ...value.filter(item => item.id !== response.id)].slice(0, 100))
      return response
    })
  }
  async function persistTransition(nextDraft: RegistrationDraft, nextStage?: RegistrationStage) {
    setDraft(nextDraft); setDirty(true)
    if (nextStage) changeStage(nextStage)
    try { return await persist(nextDraft) } catch (error) {
      setDraft(draft); setDirty(dirty); setSelected(selected)
      if (nextStage) {
        navigate({ stage, activeId, catalogTarget })
        setOnlyIssues(onlyIssues)
        setProductQuery(productQuery); setInformationLimit(informationLimit)
      }
      throw error
    }
  }
  async function save(asNew = false) {
    await run('저장 중', async () => { await persist(draft, asNew); toast.success('가격·상품등록정보·품질표시를 저장했습니다.') })
  }
  async function startRegistration() {
    if (!selectedRows.length) return
    await run('쿠팡 등록 준비 중', async () => {
      const extension = await pingSupplierExtension({ requireIndividual: registrationMode === 'individual' })
      if (!extension.connected || registrationMode === 'individual' && !extension.supportsIndividual) throw new Error('쿠팡 등록 확장을 최신 버전으로 설치하거나 업데이트한 뒤 다시 시도해주세요.')
      if (selectedRows.some(submissionLocked)) throw new Error('이미 등록 중이거나 중간 저장된 상품이 포함되어 있습니다. 진행 상태를 확인해주세요.')
      const saved = await persist(draft)
      const contexts = Object.fromEntries(selectedRows.flatMap(row => {
        const context = categoryContexts[row.sourceCode]
        return context ? [[row.sourceCode, context]] : []
      }))
      const response = await queueServerWrite(() => postJson('/submit', { draftId: saved.id, revision: saved.revision, rowIds: selectedRows.map(row => row.id), mode: registrationMode, ...(registrationMode === 'individual' ? { categoryContexts: contexts } : {}) }))
      if (activeDraftId.current !== saved.id) return
      setDraft(response.payload); setRevision(response.revision); setDirty(false)
      setRegistrationJobs(value => [response.submission, ...value.filter(job => job.jobId !== response.submission.jobId)])
      registrationDrafts.current.set(response.submission.jobId, saved.id)
      if (!response.transfer) throw new Error('이미 진행한 등록 작업입니다. 아래 진행 상태를 확인해주세요.')
      registrationTransfers.current.set(response.transfer.jobId, response.transfer)
      await startSupplierRegistration(response.transfer)
      toast.success('쿠팡 등록 작업을 시작했습니다. 진행 상태를 확인해주세요.')
    })
  }
  async function controlRegistration(itemId: string, action: 'open' | 'stop' | 'check') {
    const separator = itemId.indexOf(':')
    const job = registrationJobs.find(value => value.jobId === itemId.slice(0, separator))
    if (!job) return
    const productId = itemId.slice(separator + 1)
    await run('쿠팡 등록 상태 확인 중', async () => {
      if (action === 'open') await openSupplierRegistration(job.control, productId)
      else if (action === 'stop') await stopSupplierRegistration(job.control)
      else {
        const inspection = await inspectSupplierRegistration(job.control)
        if (!inspection.found) throw new Error('이 Chrome에서 등록 작업을 찾을 수 없습니다. 중복 등록을 방지하기 위해 처음 작업을 시작한 Chrome에서 확인해주세요.')
        if (inspection.mode !== job.mode) throw new Error('등록 방식이 일치하지 않습니다. 처음 작업을 시작한 Chrome을 확인해주세요.')
        if (job.mode === 'individual') { await resumeSupplierRegistration(job.control); return }
        const transfer = registrationTransfers.current.get(job.jobId)
        if (!transfer) throw new Error('등록 작업을 다시 불러온 뒤 확인해주세요.')
        await checkSupplierRegistration(transfer)
      }
    })
  }
  async function downloadInformation(rowIds: string[]) {
    if (!rowIds.length) return
    await run('등록정보 저장·엑셀 다운로드 중', async () => {
      const targets = draft.rows.filter(row => rowIds.includes(row.id))
      if (targets.length !== rowIds.length || targets.some(row => getRegistrationStage(row) !== 'information' || submissionLocked(row))) throw new Error('2단계에서 다운로드할 상품을 선택해주세요.')
      const invalid = targets.find(row => issueMap.get(row.id)?.length)
      if (invalid) throw new Error(`${invalid.name}: ${issueMap.get(invalid.id)!.slice(0, 3).join(', ')}`)
      const saved = await persist(draft)
      const body = JSON.stringify({ draft: saved.payload ?? draft, rowIds })
      if (new TextEncoder().encode(body).length > 4_000_000) throw new Error('작업 용량이 4MB를 초과했습니다. 상품을 나눠 다운로드해주세요.')
      const response = await fetch(`${API}/export`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
      if (!response.ok) {
        const error = await response.json().catch(() => null)
        throw new Error(error?.error ?? '엑셀을 다운로드하지 못했습니다.')
      }
      const type = response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()
      if (!['application/zip', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'].includes(type ?? '')) throw new Error('엑셀 파일 응답을 확인하지 못했습니다. 페이지를 새로고침해 다시 시도해주세요.')
      const disposition = response.headers.get('Content-Disposition') ?? ''
      const encodedName = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1]
      let filename = `쿠팡상품등록_${today()}.${type === 'application/zip' ? 'zip' : 'xlsx'}`
      if (encodedName) { try { filename = decodeURIComponent(encodedName) } catch { /* Use the safe fallback name. */ } }
      const url = URL.createObjectURL(await response.blob())
      const link = document.createElement('a')
      try {
        link.href = url; link.download = filename.replace(/[\\/\u0000-\u001f]/g, '_')
        document.body.appendChild(link); link.click()
      } finally { link.remove(); URL.revokeObjectURL(url) }
      toast.success(`${rowIds.length}개 상품의 등록정보를 저장하고 다운로드했습니다.`)
    })
  }
  async function completeRegistration(ids: string[]) {
    await run('등록완료 저장 중', async () => {
      const selectedIds = new Set(ids)
      await persistTransition({ ...draft, rows: draft.rows.map((row) => selectedIds.has(row.id) ? confirmRegistration(row, completionDate) : row) })
      setSelected(new Set())
      toast.success(`${ids.length}개 상품을 등록완료로 표시했습니다.`)
    })
  }
  async function changeCompletion(row: RegistrationRow, date: string) {
    await run('등록완료 정보 저장 중', async () => {
      const revised = confirmRegistration(reopenRegistration(row), date)
      await persistTransition({ ...draft, rows: draft.rows.map((item) => item.id === row.id ? revised : item) })
    })
  }
  async function returnCompleted(ids: string[]) {
    if (!ids.length) return
    await run('2단계로 되돌리는 중', async () => {
      const targetIds = new Set(ids)
      const targets = draft.rows.filter(row => targetIds.has(row.id))
      if (targets.length !== targetIds.size || targets.some(row => getRegistrationStage(row) !== 'registered' || completionInFlight(row))) throw new Error('등록완료 상품을 선택해주세요.')
      await persistTransition({ ...draft, rows: draft.rows.map(row => targetIds.has(row.id) ? reopenRegistration(row) : row) }, 'information')
      toast.success(`${ids.length}개 상품을 2단계 상품등록정보로 되돌렸습니다.`)
    })
  }
  async function deleteCompleted(row: RegistrationRow) {
    if (busy || completedDeletionLocked(row)) return
    if (!window.confirm(`${row.name} 상품을 등록완료 목록에서 삭제할까요? 이 작업에 저장된 해당 상품의 등록정보도 삭제됩니다.`)) return
    await run('등록완료 상품 삭제 중', async () => {
      const next = { ...draft, rows: draft.rows.filter(item => item.id !== row.id) }
      const saved = await persist(next, false, [row.id])
      if ((saved.payload?.rows ?? next.rows).some((item: RegistrationRow) => item.id === row.id)) throw new Error('해당 상품을 삭제하지 못했습니다. 최신 작업을 다시 불러와주세요.')
      setSelected(value => { const next = new Set(value); next.delete(row.id); return next })
      toast.success('등록완료 상품을 삭제했습니다.')
    })
  }
  async function searchProducts() {
    const searchQuery = productQuery.trim()
    if (!searchQuery) return
    setQuery(searchQuery)
    setProductQuery('')
    setCatalogTarget({})
    await run('상품 검색 중', async () => {
      const response = await jsonRequest(`/catalog?q=${encodeURIComponent(searchQuery)}`)
      setCatalog(response.products); setSearched(true)
    })
  }
  async function completePricing(ids: string[]) {
    if (!ids.length) return
    await run('가격 확정 저장 중', async () => {
      const chosenIds = new Set(ids)
      const next = { ...draft, rows: draft.rows.map((row) => chosenIds.has(row.id) ? connectedDefaults(confirmPricing(row, draft.rounding), draft.templates) : row) }
      await persistTransition(next, 'information')
      toast.success(`${ids.length}개 상품을 상품등록정보 단계로 이동했습니다.`)
    })
  }
  async function reopenPricing(row: RegistrationRow) {
    await run('판매가설정으로 이동 중', async () => {
      const next = { ...draft, rows: draft.rows.map((item) => item.id === row.id ? returnToPricing(item) : item) }
      await persistTransition(next, 'pricing')
    })
  }
  async function load(id: string) {
    if (!id || dirty && !window.confirm('저장하지 않은 변경사항이 있습니다. 저장된 작업을 불러올까요?')) return
    draftSession.current++
    await run('작업 불러오는 중', async () => {
      const response = await jsonRequest(`/drafts?id=${encodeURIComponent(id)}`)
      const payload: RegistrationDraft = response.payload
      const costs = await fillMissingCostsOnOpen(payload.rows)
      const rows = costs.rows.map((row) => connectedDefaults(row, payload.templates))
      setRegistrationJobs([]); registrationTransfers.current.clear()
      activeDraftId.current = response.id
      registrationConflictRef.current = false; setRegistrationConflict(false)
      setDraft({ ...payload, rows }); setCurrentId(response.id); setRevision(response.revision); setDirty(costs.filled > 0 || rows.some((row, index) => row !== costs.rows[index])); setSelected(new Set())
      resetNavigation({ stage: !payload.rows.length || payload.rows.some((row) => getRegistrationStage(row) === 'pricing') ? 'pricing' : payload.rows.some((row) => getRegistrationStage(row) === 'information') ? 'information' : 'registered', activeId: '', catalogTarget: null })
    })
  }
  function newDraft() {
    if (dirty && !window.confirm('저장하지 않은 변경사항이 있습니다. 새 작업을 시작할까요?')) return
    draftSession.current++
    activeDraftId.current = undefined
    setRegistrationJobs([]); registrationTransfers.current.clear()
    registrationConflictRef.current = false; setRegistrationConflict(false)
    setDraft(blankDraft()); setCurrentId(undefined); setRevision(undefined); setDirty(false); setSelected(new Set()); resetNavigation({ stage: 'pricing', activeId: '', catalogTarget: null })
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
    navigate({ activeId: bundle.id, catalogTarget: null })
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
      const response = await jsonRequest(`/catalog?code=${encodeURIComponent(product.code)}&phase=pricing`)
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
        const response = await postJson('/catalog', { names: [], codes: codes.slice(start, start + 100), phase: 'pricing' })
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

  function informationToolbar() {
    const downloadRows = selectedRows.length ? selectedRows : visible.filter(row => !submissionLocked(row))
    return <div role="region" aria-label="상품등록정보 도구" className="flex shrink-0 flex-wrap items-center gap-3">
      <span className="inline-flex h-8 items-center rounded-md border border-blue-600 bg-blue-50 px-3 text-xs font-medium text-blue-700">전체 {stageRows.length}개</span>
      <label className="flex items-center gap-1.5 text-xs"><input aria-label="보이는 상품 전체 선택" type="checkbox" checked={allVisibleSelected} onChange={() => setSelected((value) => { const next = new Set(value); for (const row of visible) if (!completionInFlight(row)) { if (allVisibleSelected) next.delete(row.id); else next.add(row.id) } return next })} />전체 선택</label><span className="text-xs">선택 {selectedRows.length}개</span>
      <div className="ml-auto flex flex-wrap items-center gap-2"><label className="flex items-center gap-2 text-xs">등록완료일<input aria-label="등록완료일" type="date" className={inputClass} value={completionDate} onChange={(event) => setCompletionDate(event.target.value)} /></label><button className={buttonClass} disabled={!selectedRows.length || selectedRows.some(completionInFlight) || !completionDate} onClick={() => void completeRegistration(selectedRows.map((row) => row.id))}>선택 {selectedRows.length}개 등록완료</button><button className={buttonClass} onClick={() => void save()}><Save className="size-3.5" />등록정보 저장</button><button className={buttonClass} disabled={!downloadRows.length || selectedRows.some(submissionLocked)} title={`현재 목록의 ${downloadRows.length}개 상품을 저장한 뒤 원본 양식에 채워 다운로드합니다.`} onClick={() => void downloadInformation(downloadRows.map(row => row.id))}><Download className="size-3.5" />{selectedRows.length ? `선택 ${downloadRows.length}개 엑셀 다운로드` : '엑셀 다운로드'}</button></div>
    </div>
  }
  function informationRows(expanded = false) {
    const groups = groupInformationRows(visible.slice(0, informationLimit), draft.templates)
    return <>
      {!visible.length && <p className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">{draft.rows.length ? '검색 조건에 맞는 상품이 없습니다.' : '1단계에서 상품을 추가하고 가격설정을 완료해주세요.'}</p>}
      {groups.length > 0 && <div className={expanded ? 'flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto' : 'space-y-4'}>{groups.map((group) => <section key={group.key} role="region" aria-label={group.name + ' 입력표'} className={expanded && groups.length === 1 ? 'flex min-h-0 flex-1 flex-col gap-2' : 'shrink-0 space-y-2'}><header className="flex shrink-0 items-center gap-3 px-1"><h3 className="text-sm font-semibold">{group.name}</h3><span className="text-xs text-muted-foreground">{group.rows.length}개</span>{group.fileName && <span className="truncate text-[10px] text-muted-foreground" title={group.fileName}>{group.fileName}</span>}</header><InformationGrid sheetStatus={sheetStatus} expanded={expanded && groups.length === 1} rows={group.rows} columnRows={group.rows} draft={draft} categoryTemplates={categoryTemplates} issues={issueMap} selected={selected} onToggle={toggle} onPatch={patchRow} onCategory={(rowId, choice) => void chooseCategory(choice, [rowId])} onUpload={(rowId, files) => void importTemplates(files, rowId)} onOpen={setActiveId} onPrice={(row) => void reopenPricing(row)} onComplete={(row) => void completeRegistration([row.id])} /></section>)}</div>}
      {visible.length > informationLimit && <button className={`${buttonClass} shrink-0 self-start`} onClick={() => setInformationLimit((value) => value + 20)}>다음 상품 20개 더 보기 ({informationLimit}/{visible.length})</button>}
    </>
  }

  const workbenchContents = <fieldset disabled={!!busy} className={expandedWorkbench ? 'flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3' : 'min-w-0 space-y-4 pb-8'}>
    <section aria-label="작업 불러오기" className="shrink-0 rounded-lg border bg-card px-4 py-3">
      <div className="overflow-x-auto"><div className="flex min-w-max items-center gap-2">
        <select aria-label="저장된 작업 불러오기" className={`${inputClass} w-60 shrink-0`} value={currentId ?? ''} onChange={(event) => void load(event.target.value)}><option value="">저장된 작업 불러오기</option>{saved.map((item) => <option key={item.id} value={item.id}>{item.name} · {new Date(item.updatedAt).toLocaleDateString('ko-KR')}</option>)}</select>
        <button className={`${buttonClass} shrink-0`} disabled={!!busy} onClick={newDraft}><Plus className="size-3.5" />새 작업하기</button>
        {currentId && <button className={`${buttonClass} shrink-0`} disabled={!!busy} onClick={() => void save(true)}>새 작업으로 저장</button>}
        <a className="ml-auto inline-flex shrink-0 items-center gap-1 pl-2 text-xs text-blue-700 hover:underline" href="https://supplier.coupang.com/qvt/registration" target="_blank" rel="noreferrer">쿠팡 최신 양식 받기<ExternalLink className="size-3" /></a>
      </div></div>
      {draft.templates.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{draft.templates.map((template) => <span key={template.id} className="max-w-full truncate rounded bg-muted px-2 py-1 text-[11px]" title={template.name}>{template.name} · {template.sheets.length}개 카테고리</span>)}</div>}
    </section>

    <section aria-label="상품 검색" className="flex shrink-0 flex-wrap items-center gap-3 rounded-lg border bg-card p-3">
      <form className="flex items-center gap-2" onSubmit={(event) => { event.preventDefault(); void searchProducts() }}><Search aria-hidden="true" className="size-4 text-muted-foreground" /><input aria-label="상품 검색어" className={`${inputClass} w-64`} placeholder="추가할 상품명·B2B코드 검색" value={productQuery} onChange={(event) => setProductQuery(event.target.value)} /><button className={buttonClass} disabled={!productQuery.trim()}>상품 검색</button></form>
      {stage !== 'registered' && <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={onlyIssues} onChange={(event) => { setOnlyIssues(event.target.checked); setInformationLimit(20) }} />확인 필요만 보기</label>}
    </section>

    <nav role="tablist" aria-label="쿠팡 상품등록 단계" className="grid shrink-0 gap-3 sm:grid-cols-3">{visibleSteps.map((step, index) => <button key={step.stage} role="tab" aria-selected={stage === step.stage} aria-controls={`coupang-step-${step.stage}`} className={`rounded-lg border px-4 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 ${stage === step.stage ? stepColors[step.stage].active : stepColors[step.stage].inactive}`} onClick={() => changeStage(step.stage)}><span className="flex items-center justify-between gap-3"><span className="text-sm font-semibold">{index + 1}단계 {step.title}</span><span className={`rounded-full px-2 py-0.5 text-xs tabular-nums ${stage === step.stage ? 'bg-white/20 text-white' : 'bg-white/80'}`}>{draft.rows.filter((row) => getRegistrationStage(row) === step.stage).length}개</span></span></button>)}</nav>

    {stage === 'pricing' && <section id="coupang-step-pricing" role="tabpanel" aria-label="판매가설정" className={`${expandedWorkbench ? 'flex min-h-80 flex-1 flex-col [&>div:not(.overflow-auto)]:shrink-0' : ''} overflow-hidden rounded-lg border bg-card`}>
      <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-3 py-2"><span className="mr-1 text-xs font-medium">선택 {selected.size}개</span><button className={buttonClass} title={bundleSelectionIssue || '원본 단품 행은 새 세트 행으로 교체됩니다.'} disabled={!!busy || !!bundleSelectionIssue} onClick={createBundleFromSelectedRows}><Plus className="size-3.5" />선택 {selectedRows.length}개를 세트로 변환</button><button className={`${buttonClass} border-blue-600 bg-blue-600 text-white hover:bg-blue-700`} disabled={!selectedRows.length || selectedRows.some((row) => pricingIssueMap.get(row.id)!.length > 0)} onClick={() => void completePricing(selectedRows.map((row) => row.id))}>선택 {selectedRows.length}개 가격설정 완료<ChevronRight className="size-3.5" /></button><label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">판매가 올림<select aria-label="판매가 올림 단위" className={inputClass} value={draft.rounding} onChange={(event) => update((value) => ({ ...value, rounding: Number(event.target.value) }))}>{[1, 10, 100, 1000].map((unit) => <option key={unit} value={unit}>{unit.toLocaleString()}원</option>)}</select></label></div>
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
      <div className={expandedWorkbench ? 'min-h-0 flex-1 overflow-auto' : 'overflow-x-auto'}><table className="w-full min-w-[1280px] table-fixed text-center text-xs tabular-nums">
        <thead className={`${expandedWorkbench ? 'sticky top-0 z-10' : ''} border-b bg-muted text-muted-foreground [&_th]:h-11 [&_th]:px-2 [&_th]:text-center [&_th]:align-middle [&_th]:whitespace-nowrap`}><tr>
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
      </table>{!visible.length && <div className="flex flex-col items-center gap-3 py-16 text-center"><FileSpreadsheet className="size-8 text-muted-foreground/50" /><div><p className="text-sm font-medium">{draft.rows.length ? '검색 조건에 맞는 상품이 없습니다.' : '등록할 상품을 준비하세요'}</p></div></div>}</div>
    </section>}

    {stage === 'information' && <section id="coupang-step-information" role="tabpanel" aria-label="상품등록정보" className={expandedWorkbench ? 'flex min-h-80 flex-1 flex-col gap-3' : 'space-y-4'}>
      {informationToolbar()}
      {registrationConflict && <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">다른 변경이 감지되어 저장을 잠시 중지했습니다. 현재 내용을 확인한 뒤 저장된 작업을 다시 불러와주세요.</p>}
      <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-3">
        <SupplierRegistrationControls mode={registrationMode} onModeChange={setRegistrationMode} selectedCount={selectedRows.length} busy={!!busy} onStart={() => void startRegistration()} items={registrationItems} onOpen={id => void controlRegistration(id, 'open')} onStop={id => void controlRegistration(id, 'stop')} onCheck={id => void controlRegistration(id, 'check')} />
        <p className="mt-2 text-xs text-muted-foreground">쿠팡 등록 확장이 필요합니다. 개별등록은 입력 후 쿠팡에 중간 저장하며 최종 등록은 쿠팡 화면에서 확인합니다.</p>
        <a className="mt-1 inline-block text-xs text-blue-700 underline" href={`${API}/extension`}>쿠팡 등록 확장 다운로드</a>
      </div>
      {informationRows(expandedWorkbench)}
    </section>}
    {stage === 'registered' && <section id="coupang-step-registered" role="tabpanel" aria-label="등록완료" className={`${expandedWorkbench ? 'min-h-0 flex-1' : ''} overflow-auto rounded-lg border bg-card`}>
      <div className="flex flex-wrap items-center gap-3 border-b bg-muted/30 p-3"><label className="flex items-center gap-1.5 text-xs"><input aria-label="등록완료 상품 전체 선택" type="checkbox" checked={allVisibleSelected} onChange={() => setSelected(value => { const next = new Set(value); for (const row of visible) { if (allVisibleSelected) next.delete(row.id); else next.add(row.id) } return next })} />전체 선택</label><span className="text-xs">선택 {selectedRows.length}개</span><button className={buttonClass} disabled={!selectedRows.length || selectedRows.some(completionInFlight)} onClick={() => void returnCompleted(selectedRows.map(row => row.id))}><RotateCcw className="size-3.5" />선택 {selectedRows.length}개 2단계로 되돌리기</button></div>
      <table aria-label="등록완료 목록" className="w-full min-w-[1000px] text-left text-xs">
        <thead className="sticky top-0 z-10 border-b bg-muted"><tr><th className="w-20 p-3">선택</th><th className="p-3">상품명</th><th className="p-3">SKU</th><th className="p-3">등록완료일</th><th className="p-3 text-right">공급가</th><th className="p-3 text-right">판매가</th><th className="w-56 p-3">관리</th></tr></thead>
        <tbody>{visible.map((row) => <tr key={row.id} aria-label={row.name + ' 등록완료 정보'} className="border-b last:border-0">
          <td className="p-3 text-center"><input aria-label={row.name + ' 선택'} type="checkbox" checked={selected.has(row.id)} onChange={() => toggle(row.id)} /></td>
          <td className="p-3 font-medium">{row.name}</td><td className="p-3">{row.internalSku || '—'}</td>
          <td className="p-3"><input aria-label={row.name + ' 등록완료일'} type="date" className={inputClass} value={row.registrationCompletedAt ?? ''} onChange={(event) => { if (event.target.value) void changeCompletion(row, event.target.value) }} /></td>
          <td className="p-3 text-right tabular-nums">{won(calculatePrice(row, draft.rounding).supply)}</td><td className="p-3 text-right tabular-nums">{won(calculatePrice(row, draft.rounding).sale)}</td>
          <td className="p-3"><div className="flex gap-2"><button className={buttonClass} aria-label={row.name + ' 2단계로 되돌리기'} disabled={completionInFlight(row)} onClick={() => void returnCompleted([row.id])}><RotateCcw className="size-3.5" />2단계로 되돌리기</button><button className={`${buttonClass} text-red-600 hover:bg-red-50`} aria-label={row.name + ' 등록완료 목록에서 삭제'} title={completedDeletionLocked(row) ? '등록 처리 중이거나 허브 등록 이력이 있는 상품은 삭제할 수 없습니다.' : '등록완료 목록에서 삭제'} disabled={completedDeletionLocked(row)} onClick={() => void deleteCompleted(row)}><Trash2 className="size-3.5" />삭제</button></div></td>
        </tr>)}</tbody>
      </table>
      {!visible.length && <p className="p-10 text-center text-sm text-muted-foreground">등록완료 상품이 없습니다.</p>}
    </section>}

    {active && stage === 'pricing' && <div ref={active.bundleComponents ? bundleEditor : undefined} className="scroll-mt-4"><PricingEditor key={active.id} row={active} draft={draft} onPatch={(patch) => patchRow(active.id, patch)} onClose={() => setActiveId('')} onAddComponent={() => setCatalogTarget({ bundleId: active.id })} /></div>}

    {active && stage === 'information' && !submissionLocked(active) && <div ref={informationEditor} className="scroll-mt-4 rounded-lg border bg-card"><div className="flex items-center justify-between border-b px-4 py-2"><span className="text-xs font-medium">상품 상세정보 · 이미지·원가 연결 확인</span><button aria-label="상품 상세정보 닫기" className="rounded p-2 hover:bg-muted" onClick={() => setActiveId('')}><X className="size-4" /></button></div><RowEditor key={active.id} row={active} draft={draft} categoryTemplates={categoryTemplates} issues={issueMap.get(active.id)!} onPatch={(patch) => patchRow(active.id, patch)} onCategory={(choice) => void chooseCategory(choice, [active.id])} onUpload={(files) => void importTemplates(files, active.id)} onAddComponent={() => setCatalogTarget({ bundleId: active.id })} /></div>}

    {busy && <div role="status" className="fixed bottom-5 left-1/2 z-[130] flex -translate-x-1/2 items-center gap-2 rounded-lg bg-gray-900 px-4 py-3 text-sm text-white shadow-lg"><Loader2 className="size-4 animate-spin" />{busy}</div>}

    {catalogTarget && <div className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-black/35 p-4 pt-16" onClick={closeCatalog}><section role="dialog" aria-modal="true" aria-label={catalogTarget.bundleId ? '세트 구성품 검색' : 'B2B 상품 검색'} className="w-full max-w-3xl rounded-xl bg-background shadow-xl" onClick={(event) => event.stopPropagation()}><header className="flex items-center justify-between border-b px-5 py-4"><div><h2 className="font-semibold">{catalogTarget.bundleId ? '세트 구성품 추가' : 'B2B 상품 추가'}</h2></div><button aria-label="상품 검색 닫기" className="rounded p-2 hover:bg-muted" onClick={closeCatalog}><X className="size-4" /></button></header><form className="flex gap-2 p-4" onSubmit={(event) => { event.preventDefault(); void run('상품 검색 중', async () => { const response = await jsonRequest(`/catalog?q=${encodeURIComponent(query)}`); setCatalog(response.products); setSearched(true) }) }}><input autoFocus aria-label="B2B 상품명 또는 코드" className={`${inputClass} h-9 flex-1`} placeholder="상품명 또는 B2B 상품코드" value={query} onChange={(event) => setQuery(event.target.value)} /><button className={`${buttonClass} h-9`} disabled={!!busy || !query.trim()}><Search className="size-4" />검색</button></form><div className="max-h-[60vh] overflow-y-auto px-4 pb-4">{catalog.map((product) => <div key={product.code} className="flex gap-3 border-t py-3"><div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded border bg-muted">{product.thumbnails[0] && <img className="size-full object-contain" src={product.thumbnails[0]} alt="" />}</div><div className="min-w-0 flex-1"><div className="font-medium">{product.name}</div><div className="mt-1 text-xs text-muted-foreground">코드 {product.code} · 도매가 {won(product.price)} · 상세 {product.detailImages.length}장</div><div className="mt-2 flex flex-wrap gap-1.5">{(product.options.length ? product.options : [{ name: '', addPrice: 0 }]).map((option) => { const optionLabel = option.name || '기본 상품'; const key = catalogOptionKey(product.code, option.name); const alreadyAdded = !catalogTarget.bundleId && draft.rows.some((row) => !row.bundleComponents && row.sourceCode === product.code && row.optionName === option.name); return catalogTarget.bundleId ? <button key={key} className={buttonClass} onClick={() => void addProduct(product, option.name)}><Plus className="size-3" />{optionLabel}{option.addPrice > 0 ? ` (+${option.addPrice.toLocaleString()}원)` : ''}</button> : <label key={key} className={`flex h-8 items-center gap-1.5 rounded-md border px-2 text-xs ${alreadyAdded ? 'cursor-not-allowed bg-muted text-muted-foreground' : 'cursor-pointer hover:bg-muted'}`}><input aria-label={`${product.name} ${optionLabel} 선택`} type="checkbox" checked={selectedCatalogOptionKeys.has(key)} disabled={alreadyAdded} onChange={() => toggleCatalogSelection(product, option.name)} />{optionLabel}{option.addPrice > 0 ? ` (+${option.addPrice.toLocaleString()}원)` : ''}{alreadyAdded && <span className="text-[10px]">등록됨</span>}</label> })}</div></div></div>)}{searched && !catalog.length && <p className="py-10 text-center text-sm text-muted-foreground">검색된 공개 상품이 없습니다.</p>}</div><footer className="flex items-center justify-between gap-2 border-t px-4 py-3 text-xs">{catalogTarget.bundleId ? <><span>구성품 {active?.bundleComponents?.length ?? 0}종 추가</span><button className={buttonClass} onClick={closeCatalog}>구성 확인</button></> : <><span>선택한 상품·옵션 {catalogSelections.length}개</span><div className="flex gap-2"><button className={buttonClass} disabled={!catalogSelections.length} onClick={() => void addSelectedProducts()}>선택 상품 {catalogSelections.length}개 추가</button><button className={buttonClass} onClick={closeCatalog}>닫기</button></div></>}</footer></section></div>}
  </fieldset>

  return <Dialog.Root open={expandedWorkbench} onOpenChange={setExpandedWorkbench}>
    <div className="min-w-0 space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div><div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground"><span>상품등록·광고</span><ChevronRight className="size-3" /><span>로켓배송</span></div><h1 className="text-2xl font-semibold tracking-tight">쿠팡상품등록</h1></div>
        <div className="flex flex-wrap items-center gap-2"><span className="mr-1 text-xs text-muted-foreground">{dirty ? '저장하지 않은 변경사항' : currentId ? '저장됨' : '새 작업'}</span><Dialog.Trigger render={(props) => <button {...props} type="button" className={buttonClass}><Maximize2 aria-hidden="true" className="size-3.5" />크게 보기</button>} /></div>
      </header>
      {!expandedWorkbench && workbenchContents}
    </div>
    <Dialog.Portal>
      <Dialog.Backdrop className="fixed inset-0 z-[100] bg-black/40" />
      <Dialog.Popup className="fixed inset-0 z-[101] flex h-[100dvh] w-screen flex-col bg-background text-foreground shadow-xl focus:outline-none">
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
          <div><Dialog.Title className="text-lg font-semibold">쿠팡상품등록 · 크게 보기</Dialog.Title><Dialog.Description className="sr-only">판매가설정, 상품등록정보, 등록완료 목록</Dialog.Description></div>
          <div className="flex items-center gap-2"><span className="text-xs text-muted-foreground">{dirty ? '저장하지 않은 변경사항' : currentId ? '저장됨' : '새 작업'}</span><Dialog.Close render={(props) => <button {...props} type="button" className={buttonClass}><X aria-hidden="true" className="size-3.5" />닫기</button>} /></div>
        </header>
        {expandedWorkbench && workbenchContents}
      </Dialog.Popup>
    </Dialog.Portal>
  </Dialog.Root>
}

function InformationGrid({ expanded = false, sheetStatus, rows, columnRows, draft, categoryTemplates, issues, selected, onToggle, onPatch, onCategory, onUpload, onOpen, onPrice, onComplete }: {
  expanded?: boolean
  sheetStatus: Map<string, string>
  rows: RegistrationRow[]
  columnRows: RegistrationRow[]
  draft: RegistrationDraft
  categoryTemplates: CategoryTemplate[]
  issues: Map<string, string[]>
  selected: Set<string>
  onToggle: (id: string) => void
  onPatch: (id: string, patch: Partial<RegistrationRow>) => void
  onCategory: (id: string, choice: string) => void
  onUpload: (id: string, files: FileList | null) => void
  onOpen: (id: string) => void
  onPrice: (row: RegistrationRow) => void
  onComplete: (row: RegistrationRow) => void
}) {
  const grid = buildInformationColumns(columnRows, draft.templates)
  const columnWidths = [40, 240, 80, 240, ...grid.columns.map(() => 192), 240, 112, 112, 256, 256, 256]
  const uploadInputs = useRef(new Map<string, HTMLInputElement>())
  const cellClass = 'border-b border-r px-2 py-2 align-top'
  const gridInput = `${inputClass} w-full min-w-0 bg-transparent`
  const headerClass = 'sticky top-0 z-20 border-b border-r bg-slate-100 px-3 py-3 text-left font-medium text-slate-700'
  const imageLines = (text: string) => text.split('\n').map((value) => value.trim()).filter(Boolean)

  return <div className={`${expanded ? 'flex min-h-0 flex-1 flex-col' : ''} overflow-hidden rounded-lg border bg-card`}>
    <div role="region" aria-label="상품등록정보 가로 스크롤" tabIndex={0} className={`${expanded ? 'min-h-0 flex-1' : 'max-h-[65vh]'} overflow-auto overscroll-contain`} onKeyDown={(event) => {
      if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
      const target = event.target
      if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement && target.hasAttribute('data-grid-single-line')) || target instanceof HTMLInputElement && ['checkbox', 'file'].includes(target.type)) return
      if (target instanceof HTMLTextAreaElement) event.preventDefault()
      const cell = target.closest('td')
      const nextRow = cell?.parentElement?.nextElementSibling as HTMLTableRowElement | null
      const next = cell && nextRow?.cells[cell.cellIndex]?.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input:not([type="file"]):not([type="checkbox"]), select, textarea')
      if (next && !next.matches(':disabled')) { event.preventDefault(); next.focus() }
    }}>
      <table aria-label="상품등록정보 입력표" style={{ width: columnWidths.reduce((sum, width) => sum + width, 0) }} className="min-w-full table-fixed border-separate border-spacing-0 text-xs">
        <colgroup>{columnWidths.map((width, index) => <col key={index} style={{ width }} />)}</colgroup>
        <thead><tr>
          <th scope="col" className="sticky left-0 top-0 z-40 w-10 min-w-10 max-w-10 border-b border-r bg-slate-100 px-1 py-3 text-center text-[10px] font-medium text-slate-700">선택</th>
          <th scope="col" className={`${headerClass} left-10 z-40 shadow-[2px_0_3px_-2px_#94a3b8]`}>등록 상품명</th>
          <th scope="col" className={headerClass}>등록완료</th>
          <th scope="col" className={headerClass}>카테고리 엑셀 양식</th>
          {grid.columns.map((column) => <th key={column.key} scope="col" title={`${column.headerLabel}${column.requiredAny ? ' · 해당 양식에서 필수' : column.conditionalAny ? ' · 해당 조건에서 필수' : ''}`} className={`${headerClass} min-w-48 max-w-56`}><div className="max-w-48 truncate">{column.headerLabel}{!column.requiredAny && column.conditionalAny && <span className="ml-1 text-[10px] text-muted-foreground">조건부</span>}</div></th>)}
          <th scope="col" className={`${headerClass} min-w-60`}>품질표시 파일명 또는 공개 URL</th>
          <th scope="col" className={`${headerClass} min-w-28`}>확정 공급가</th>
          <th scope="col" className={`${headerClass} min-w-28`}>확정 판매가</th>
          <th scope="col" className={`${headerClass} min-w-64`}>대표이미지 URL</th>
          <th scope="col" className={`${headerClass} min-w-64`}>추가이미지 URL</th>
          <th scope="col" className={`${headerClass} min-w-64`}>상세이미지 URL</th>
        </tr></thead>
        <tbody>{rows.map((row) => {
          const locked = submissionLocked(row)
          const rowIssues = issues.get(row.id) ?? []
          const prices = calculatePrice(row, draft.rounding)
          const rowColumns = grid.rows.get(row.id)
          return <tr key={row.id} aria-label={row.name + ' 상품등록정보'} className="group bg-card hover:bg-blue-50/30">
            <td className={`${cellClass} sticky left-0 z-10 w-10 min-w-10 bg-card text-center`}><input aria-label={row.name + ' 선택'} type="checkbox" checked={selected.has(row.id)} disabled={completionInFlight(row)} onChange={() => onToggle(row.id)} /></td>
            <td className={`${cellClass} sticky left-10 z-10 bg-card shadow-[2px_0_3px_-2px_#94a3b8]`}>
              <GridTextInput aria-label="등록 상품명" className={`${gridInput} block font-medium`} value={row.name} disabled={locked} onChange={(event) => onPatch(row.id, { name: event.target.value, bundleReviewed: false })} />
              <div className="mt-1 flex items-center justify-between gap-2 text-[10px]"><span className="truncate text-muted-foreground">{row.internalSku || 'SKU 미연결'}</span><div className="flex shrink-0 gap-2"><button className="text-blue-700 hover:underline disabled:opacity-40" aria-label={row.name + ' 상세정보'} disabled={locked} onClick={() => onOpen(row.id)}>상세정보</button><button className="text-muted-foreground hover:underline disabled:opacity-40" aria-label={row.name + ' 판매가 다시 설정'} disabled={locked} onClick={() => onPrice(row)}>가격 수정</button></div></div>
              <div className="mt-1">{locked ? <span className="text-muted-foreground">{submissionText(row)} · 저장된 자료 보존</span> : rowIssues.length ? <><button className="text-[10px] text-amber-700 hover:underline" title={rowIssues.join('\n')} aria-describedby={'information-issues-' + row.id} onClick={() => onOpen(row.id)}>입력 확인 {rowIssues.length}건</button><ul id={'information-issues-' + row.id} className="sr-only">{rowIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul></> : <span className="text-[10px] text-emerald-700">필수정보 입력 완료</span>}</div>
              {(row.bundleComponents?.length || /[2-9]\d*개입/.test(row.name)) ? <label className="mt-1 flex items-center gap-1 text-[10px]"><input type="checkbox" checked={row.bundleReviewed} disabled={locked} onChange={(event) => onPatch(row.id, { bundleReviewed: event.target.checked })} />세트 구성·가격·라벨 확인</label> : null}
            </td>
            <td className={`${cellClass} text-center`}><input aria-label={row.name + ' 등록완료'} type="checkbox" checked={false} disabled={completionInFlight(row)} onChange={() => onComplete(row)} /></td>
            <td className={cellClass}><fieldset disabled={locked} className="min-w-0 space-y-1"><div className="[&_select]:w-full"><CategorySelect label="업로드한 카테고리 양식" value={row.templateId && row.sheetName ? row.templateId + ':' + row.sheetName : ''} templates={categoryTemplates} onChange={(choice) => onCategory(row.id, choice)} /></div><p className="truncate text-[10px] text-muted-foreground" title={sheetStatus.get(row.id)}>{sheetStatus.get(row.id)}</p><button className="flex items-center gap-1 text-[10px] text-blue-700 hover:underline" onClick={() => uploadInputs.current.get(row.id)?.click()}><FileSpreadsheet className="size-3" />카테고리 엑셀 업로드</button><input ref={(node) => { if (node) uploadInputs.current.set(row.id, node); else uploadInputs.current.delete(row.id) }} aria-label={row.name + ' 카테고리 엑셀 파일'} type="file" accept=".xlsx" hidden onChange={(event) => { onUpload(row.id, event.target.files); event.target.value = '' }} /></fieldset></td>
            {grid.columns.map((header) => {
              const cell = rowColumns?.columns.get(header.key)
              if (!cell) return <td key={header.key} className={`${cellClass} bg-muted/30 text-center text-muted-foreground`} title="이 상품의 양식에 없는 항목입니다.">—</td>
              const { column, fieldKey, value } = cell
              const label = column.label + (column.requirement.includes('조건부') ? ' (조건부)' : '')
              return <td key={header.key} title={column.guide || undefined} className={`${cellClass} ${column.requirement === '필수' && !value.trim() ? 'bg-amber-50/50' : ''}`}><fieldset disabled={locked} className="min-w-0"><label className="block [&_input]:min-w-0 [&_input]:w-full [&_select]:min-w-0 [&_select]:w-full"><span className="sr-only">{label}</span><OfficialColumnInput expandText column={column} value={value} listId={'grid-' + row.id + '-' + column.column} onChange={(value) => onPatch(row.id, { fields: { ...row.fields, [fieldKey]: value } })} /></label></fieldset></td>
            })}
            <td className={cellClass}><input aria-label="품질표시 파일명 또는 공개 URL" className={gridInput} list={'grid-labels-' + row.id} value={row.label} disabled={locked} onChange={(event) => onPatch(row.id, { label: event.target.value })} /><datalist id={'grid-labels-' + row.id}>{draft.labels.map((label) => <option key={label.name} value={label.name} />)}</datalist></td>
            <td className={`${cellClass} text-right tabular-nums`}>{won(prices.supply)}</td>
            <td className={`${cellClass} text-right tabular-nums`}>{won(prices.sale)}</td>
            <td className={cellClass}><GridTextInput aria-label="대표이미지 URL" className={`${gridInput} block`} value={row.primaryImage} disabled={locked} onChange={(event) => onPatch(row.id, { primaryImage: event.target.value })} /></td>
            <td className={cellClass}><GridTextInput singleLine={false} aria-label="추가이미지 URL" className={`${gridInput} block`} value={row.thumbnails.join('\n')} disabled={locked} onChange={(event) => onPatch(row.id, { thumbnails: imageLines(event.target.value), fields: { ...row.fields, '추가이미지 파일명': '' } })} /></td>
            <td className={cellClass}><GridTextInput singleLine={false} aria-label="상세이미지 URL" className={`${gridInput} block`} value={row.detailImages.join('\n')} disabled={locked} onChange={(event) => onPatch(row.id, { detailImages: imageLines(event.target.value) })} /></td>
          </tr>
        })}</tbody>
      </table>
    </div>
  </div>
}

function MoneyInput({ label, value, onChange, placeholder = '미입력' }: { label: string; value: number | null; onChange: (value: number | null) => void; placeholder?: string }) {
  return <input aria-label={label} type="number" min="0" max="1000000000" step="any" className={`${inputClass} w-full min-w-0 text-center tabular-nums`} value={value ?? ''} placeholder={placeholder} onChange={(event) => onChange(money(event.target.value))} />
}
function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label title={hint} className="flex flex-col gap-1.5 text-xs"><span className="font-medium">{label}</span>{children}</label>
}

function PricingEditor({ row, draft, onPatch, onClose, onAddComponent }: { row: RegistrationRow; draft: RegistrationDraft; onPatch: (patch: Partial<RegistrationRow>) => void; onClose: () => void; onAddComponent: () => void }) {
  const prices = calculatePrice(row, draft.rounding)
  return <section className="rounded-lg border bg-card" aria-label="가격 상세 설정"><header className="flex items-center justify-between border-b p-4"><div><h2 className="font-semibold">판매가설정 상세</h2></div><button aria-label="상품 상세 닫기" onClick={onClose} className="rounded p-2 hover:bg-muted"><X className="size-4" /></button></header><div className="space-y-4 p-4"><Field label="등록 상품명"><input className={`${inputClass} max-w-2xl`} value={row.name} onChange={(event) => onPatch({ name: event.target.value, bundleReviewed: false })} /></Field>{row.bundleComponents && <BundleEditor components={row.bundleComponents} prices={prices} onAdd={onAddComponent} onChange={(bundleComponents) => onPatch({ bundleComponents, bundleReviewed: false })} />}<div className="flex flex-wrap gap-2">{row.bundleComponents && row.priceMode === 'manual' && <button className={buttonClass} onClick={() => onPatch({ priceMode: 'wholesale', manualSupplyPrice: null })}>공급가 자동계산</button>}<button className={buttonClass} aria-label={`${row.name} 판매가 자동계산`} onClick={() => onPatch({ saleMode: 'auto', manualSalePrice: null })}>판매가 자동계산</button><button className={buttonClass} aria-label={`${row.name} 판매가 기준 쿠팡 40% 맞추기`} disabled={prices.sale === null} onClick={() => onPatch({ priceMode: 'manual', manualSupplyPrice: prices.sale! * 3 / 5 })}>쿠팡 40% 맞추기</button></div><div className="grid max-w-2xl gap-3 sm:grid-cols-2"><Field label="매출부가세 직접 입력" hint="비우면 공급가 ÷ 11로 계산합니다."><MoneyInput label="매출부가세 직접 입력" value={row.manualSalesVat ?? null} placeholder={prices.salesVat === null ? '자동 계산' : `자동 ${inputWon(prices.salesVat)}`} onChange={(manualSalesVat) => onPatch({ manualSalesVat })} /></Field><div className="space-y-1 text-xs"><p>추가 차감 {prices.deduction === null ? '—' : inputWon(prices.deduction)}</p><p>순수익 {prices.profit === null ? '—' : inputWon(prices.profit)}</p><p>우리 마진 {marginText(prices.profitRate, 4)} · 쿠팡 마진 {marginText(prices.coupangRate, 4)}</p></div></div></div></section>
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
  return <CategoryTemplatePicker label={label} value={value} templates={templates} onChange={onChange} />
}

function RowEditor({ row, draft, categoryTemplates, issues, onPatch, onCategory, onUpload, onAddComponent }: { row: RegistrationRow; draft: RegistrationDraft; categoryTemplates: CategoryTemplate[]; issues: string[]; onPatch: (patch: Partial<RegistrationRow>) => void; onCategory: (choice: string) => void; onUpload: (files: FileList | null) => void; onAddComponent: () => void }) {
  const [costQuery, setCostQuery] = useState('')
  const [costs, setCosts] = useState<CatalogProduct['costCandidates']>([])
  const [finding, setFinding] = useState(false)
  const [preview, setPreview] = useState(false)
  const categoryFileInput = useRef<HTMLInputElement>(null)
  const sheet = draft.templates.find((template) => template.id === row.templateId)?.sheets.find((sheet) => sheet.name === row.sheetName)
  const displayedSheet = registrationInformationSheet(sheet ?? registrationCommonSheet)
  const computed = rowFields(row, draft.rounding, draft.labels)
  const prices = calculatePrice(row, draft.rounding)
  const automatic = new Set(['상품명', '공급가', '쿠팡 판매가', '대표이미지 파일명', '추가이미지 파일명', '상세이미지 파일명', 'HTML 상품 상세 컨텐츠', LABEL_FIELD])
  const fieldValue = (column: TemplateColumn, value: string) => {
    onPatch({ fields: { ...row.fields, [registrationFieldKey(row, displayedSheet, column)]: value } })
  }
  const verifyIndividualField = (label: string, value: string) => {
    const defaults = { ...row.defaultedFields }
    if (value.trim()) delete defaults[label]
    else defaults[label] = ''
    onPatch({ fields: { ...row.fields, [label]: value }, defaultedFields: defaults })
  }
  const labelFiles = row.label.split(',').map((name) => name.trim()).filter(Boolean).map((name) => draft.labels.find((label) => imageStem(label.name) === imageStem(name))).filter((file): file is SavedFile => !!file)
  return <section className="rounded-lg border bg-card" aria-label={row.name + ' 상품등록정보'}>
    <header className="flex flex-wrap items-center justify-between gap-3 border-b p-4"><div><h2 className="font-semibold">{row.name}</h2></div><span className="text-xs tabular-nums">공급가 {won(prices.supply)} / 판매가 {won(prices.sale)}</span></header>
    {issues.length > 0 && <div className="mx-4 mt-4 rounded-md border border-amber-200 bg-amber-50 p-3"><p className="text-xs font-medium text-amber-900">입력 확인 {issues.length}건</p><ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-amber-800">{issues.map((issue) => <li key={issue}>· {issue}</li>)}</ul></div>}
    <div className="grid gap-5 p-4 lg:grid-cols-[1fr_360px]"><div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2"><Field label="등록 상품명"><input className={inputClass} value={row.name} placeholder={row.bundleComponents ? '등록할 세트 상품명' : undefined} onChange={(event) => onPatch({ name: event.target.value, bundleReviewed: false })} /></Field><div className="space-y-2"><Field label="업로드한 카테고리 양식"><CategorySelect label="업로드한 카테고리 양식" value={row.templateId && row.sheetName ? row.templateId + ':' + row.sheetName : ''} templates={categoryTemplates} onChange={onCategory} /></Field><button className={buttonClass} onClick={() => categoryFileInput.current?.click()}><FileSpreadsheet className="size-3.5" />카테고리 엑셀 업로드</button><input ref={categoryFileInput} aria-label={row.name + ' 카테고리 엑셀 파일'} type="file" accept=".xlsx" hidden onChange={(event) => { onUpload(event.target.files); event.target.value = '' }} /></div></div>
      {row.bundleComponents ? <BundleEditor readOnly components={row.bundleComponents} prices={prices} onAdd={onAddComponent} onChange={(bundleComponents) => onPatch({ bundleComponents, bundleReviewed: false })} /> : <div className="rounded-md border p-3"><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs font-medium">원가 SKU 연결 · {row.internalSku || '미연결'}</span><form className="flex gap-1" onSubmit={(event) => { event.preventDefault(); setFinding(true); void jsonRequest(`/catalog?cost=1&q=${encodeURIComponent(costQuery)}`).then((response) => setCosts(response.costs)).catch((error) => toast.error(error.message)).finally(() => setFinding(false)) }}><input aria-label="원가 SKU 검색" className={`${inputClass} w-40`} placeholder="품목코드·상품명" value={costQuery} onChange={(event) => setCostQuery(event.target.value)} /><button className={buttonClass} disabled={finding || !costQuery.trim()}>{finding ? <Loader2 className="size-3 animate-spin" /> : '조회'}</button></form></div>{costs.length > 0 && <div className="mt-2 max-h-36 overflow-y-auto">{costs.map((cost) => <button key={cost.sku} className="flex w-full justify-between gap-2 border-t p-2 text-left text-xs hover:bg-muted" onClick={() => { onPatch({ internalSku: cost.sku, costPrice: cost.costPrice }); setCosts([]) }}><span>{cost.sku} · {cost.name} {cost.optionName}</span><span>{won(cost.costPrice)}</span></button>)}</div>}</div>}
      {(row.bundleComponents?.length || /[2-9]\d*개입/.test(row.name)) ? <label className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs"><input type="checkbox" checked={row.bundleReviewed} onChange={(event) => onPatch({ bundleReviewed: event.target.checked })} />묶음 구성, 세트 원가·도매가·공급가 및 라벨을 확인했습니다.</label> : null}
      <div className="grid gap-3 sm:grid-cols-2"><Field label="품질표시 파일명 또는 공개 URL" hint="추가한 라벨 파일명과 일치해야 합니다. 여러 장은 쉼표로 구분합니다."><input className={inputClass} list={'coupang-label-files-' + row.id} value={row.label} onChange={(event) => onPatch({ label: event.target.value })} /><datalist id={'coupang-label-files-' + row.id}>{draft.labels.map((label) => <option key={label.name} value={label.name} />)}</datalist></Field><div className="flex items-end gap-2"><button className={buttonClass} onClick={() => setPreview((value) => !value)}>상세 HTML {preview ? '닫기' : '미리보기'}</button>{row.sourceCode && <a className={buttonClass} href={`https://funtasticb2b.com/goods/view?no=${encodeURIComponent(row.sourceCode)}`} target="_blank" rel="noreferrer">원본 상세페이지<ExternalLink className="size-3" /></a>}</div></div>
      {row.productMaster?.qualityPdf && <a className="text-xs text-blue-700 underline" href={`/api/new-products/attachments/${encodeURIComponent(row.productMaster.qualityPdf.id)}`} target="_blank" rel="noreferrer">{row.productMaster.qualityPdf.fileName}</a>}
      {labelFiles.length > 0 && <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">품질표시 미리보기 {labelFiles.length}장</summary><div className="mt-2 grid gap-2 sm:grid-cols-2">{labelFiles.map((file) => <img key={file.name} className="max-h-96 max-w-full border" src={`data:image/${/\.png$/i.test(file.name) ? 'png' : 'jpeg'};base64,${file.data}`} alt={`${file.name} 품질표시 스티커`} />)}</div></details>}
      <Field label="추가이미지 URL" hint="대표이미지를 포함한 후보 목록입니다. JPG·PNG 공개 URL을 한 줄에 하나씩 입력합니다."><textarea className={`${inputClass} h-16 py-2 font-mono text-[11px]`} value={row.thumbnails.join('\n')} onChange={(event) => onPatch({ thumbnails: event.target.value.split('\n').map((value) => value.trim()).filter(Boolean), fields: { ...row.fields, '추가이미지 파일명': '' } })} /></Field>
      <Field label="상세이미지 URL" hint="JPG·PNG 공개 URL을 한 줄에 하나씩 입력합니다. HTML은 자동 생성됩니다."><textarea className={`${inputClass} h-20 py-2 font-mono text-[11px]`} value={row.detailImages.join('\n')} onChange={(event) => onPatch({ detailImages: event.target.value.split('\n').map((value) => value.trim()).filter(Boolean) })} /></Field>
      {preview && <iframe title="쿠팡 상세 HTML 미리보기" sandbox="" className="h-[560px] w-full rounded border bg-white" srcDoc={`<!doctype html><html lang="ko"><head><meta charset="utf-8"></head><body>${detailHtml(row.detailImages, row.name)}</body></html>`} />}
      <div className="rounded-md border border-amber-200 bg-amber-50/40"><h3 className="px-3 py-2 text-xs font-medium">개별등록 인증·물류 확인</h3><p className="px-3 text-xs text-muted-foreground">자동 입력된 값은 상품과 일치하는지 확인한 뒤 각 항목의 ‘값 확인’을 눌러주세요. 해당하지 않는 항목은 ‘해당사항없음’으로 입력합니다.</p><div className="grid gap-3 p-3 sm:grid-cols-2">{individualVerificationFields.map(label => <Field key={label} label={label}><div className="flex gap-1"><input aria-label={`개별등록 ${label}`} className={`${inputClass} min-w-0 flex-1`} value={row.fields[label] ?? ''} onChange={event => verifyIndividualField(label, event.target.value)} />{row.fields[label] && row.defaultedFields?.[label] === row.fields[label] && <button type="button" className={buttonClass} onClick={() => verifyIndividualField(label, row.fields[label])}>값 확인</button>}</div></Field>)}</div></div>
      <div className="rounded-md border"><h3 className="px-3 py-2 text-xs font-medium">{sheet ? '원본 양식 필수·조건부 정보' : '미리 채운 공통 정보'}</h3><div className="grid gap-3 border-t p-3 sm:grid-cols-2">{displayedSheet.columns.filter((column) => !automatic.has(column.label) && !isAutomaticTemplateColumn(column) && (!sheet || column.requirement === '필수' || column.requirement.includes('조건부') || !!registrationFieldValue(row, displayedSheet, column))).map((column) => <Field key={column.column} label={column.label + (column.requirement.includes('조건부') ? ' (조건부)' : '')} hint={column.guide.slice(0, 120)}><OfficialColumnInput column={column} value={registrationFieldValue(row, displayedSheet, column) ?? ''} listId={'official-' + row.id + '-' + column.column} onChange={(value) => fieldValue(column, value)} /></Field>)}</div></div>
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
    </div><aside className="space-y-3"><div><h3 className="text-xs font-medium">대표이미지 선택</h3><div className="mt-2 grid grid-cols-4 gap-2">{row.thumbnails.filter(isImageUrl).map((url, index) => <button key={url} aria-label={`대표이미지 ${index + 1} 선택`} className={`relative aspect-square overflow-hidden rounded border bg-white ${row.primaryImage === url ? 'border-blue-600 ring-2 ring-blue-200' : ''}`} onClick={() => onPatch({ primaryImage: url })}><img className="size-full object-contain" src={url} alt={`상품 이미지 ${index + 1}`} />{row.primaryImage === url && <Check className="absolute bottom-1 right-1 size-4 rounded-full bg-blue-600 text-white" />}</button>)}</div></div><Field label="대표이미지 URL"><input className={inputClass} value={row.primaryImage} onChange={(event) => onPatch({ primaryImage: event.target.value })} /></Field><div className="rounded-md border p-3 text-xs"><div className="font-medium">확정 가격</div><div className="mt-2 flex justify-between"><span className="text-muted-foreground">공급가</span><span>{computed['공급가'] ? inputWon(Number(computed['공급가'])) : '—'}</span></div><div className="mt-1 flex justify-between"><span className="text-muted-foreground">판매가</span><span className="font-semibold text-blue-700">{computed['쿠팡 판매가'] ? inputWon(Number(computed['쿠팡 판매가'])) : '—'}</span></div></div></aside></div>
  </section>
}
