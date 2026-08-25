'use client'

import { useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Dialog } from '@base-ui/react/dialog'
import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CirclePause,
  ExternalLink,
  FileText,
  GripVertical,
  ImageIcon,
  Loader2,
  PackageSearch,
  PencilLine,
  Plus,
  Save,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { calculateSalesPrices } from '@/lib/new-products/price-calculator'
import type {
  NewProductAttachment,
  NewProductItem,
  NewProductStage,
  NewProductStageTone,
} from '@/lib/new-products/workflow'
import {
  createNewProductAction,
  moveNewProductsAction,
  saveNewProductStagesAction,
  updateNewProductAction,
} from './actions'

type Props = {
  initialStages: NewProductStage[]
  initialItems: NewProductItem[]
}

const toneClasses: Record<NewProductStageTone, { chip: string; dot: string; border: string }> = {
  slate: { chip: 'bg-slate-100 text-slate-700', dot: 'bg-slate-500', border: 'border-slate-300' },
  blue: { chip: 'bg-blue-100 text-blue-700', dot: 'bg-blue-500', border: 'border-blue-300' },
  violet: { chip: 'bg-violet-100 text-violet-700', dot: 'bg-violet-500', border: 'border-violet-300' },
  cyan: { chip: 'bg-cyan-100 text-cyan-700', dot: 'bg-cyan-500', border: 'border-cyan-300' },
  amber: { chip: 'bg-amber-100 text-amber-800', dot: 'bg-amber-500', border: 'border-amber-300' },
  orange: { chip: 'bg-orange-100 text-orange-700', dot: 'bg-orange-500', border: 'border-orange-300' },
  indigo: { chip: 'bg-indigo-100 text-indigo-700', dot: 'bg-indigo-500', border: 'border-indigo-300' },
  purple: { chip: 'bg-purple-100 text-purple-700', dot: 'bg-purple-500', border: 'border-purple-300' },
  rose: { chip: 'bg-rose-100 text-rose-700', dot: 'bg-rose-500', border: 'border-rose-300' },
  teal: { chip: 'bg-teal-100 text-teal-700', dot: 'bg-teal-500', border: 'border-teal-300' },
  sky: { chip: 'bg-sky-100 text-sky-700', dot: 'bg-sky-500', border: 'border-sky-300' },
  lime: { chip: 'bg-lime-100 text-lime-800', dot: 'bg-lime-500', border: 'border-lime-300' },
  emerald: { chip: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500', border: 'border-emerald-300' },
  green: { chip: 'bg-green-100 text-green-700', dot: 'bg-green-500', border: 'border-green-300' },
  red: { chip: 'bg-red-100 text-red-700', dot: 'bg-red-500', border: 'border-red-300' },
}

export function NewProductBoard({ initialStages, initialItems }: Props) {
  const router = useRouter()
  const [activeStageId, setActiveStageId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(initialItems[0]?.id ?? null)
  const [checkedIds, setCheckedIds] = useState<string[]>([])
  const [bulkStageId, setBulkStageId] = useState('')
  const [pending, startTransition] = useTransition()

  const visibleItems = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('ko')
    return initialItems.filter((item) => {
      if (activeStageId && item.stageId !== activeStageId) return false
      if (!query) return true
      return [item.productName, item.sampleCode, item.registeredProductName, item.englishName, String(item.productNumber)]
        .some((value) => value?.toLocaleLowerCase('ko').includes(query))
    })
  }, [activeStageId, initialItems, search])

  const selectedItem = initialItems.find((item) => item.id === selectedId) ?? initialItems[0] ?? null
  const effectiveSelectedId = selectedItem?.id ?? null
  const completedCount = initialItems.filter((item) => item.stageName === '등록완료').length
  const pausedCount = initialItems.filter((item) => item.stageName.includes('불가') || item.stageName.includes('보류')).length

  function toggleAll() {
    const visibleIds = visibleItems.map((item) => item.id)
    const allChecked = visibleIds.length > 0 && visibleIds.every((id) => checkedIds.includes(id))
    setCheckedIds(allChecked
      ? checkedIds.filter((id) => !visibleIds.includes(id))
      : [...new Set([...checkedIds, ...visibleIds])])
  }

  function runBulkMove() {
    if (!bulkStageId || checkedIds.length === 0) return
    startTransition(async () => {
      const result = await moveNewProductsAction({ itemIds: checkedIds, stageId: bulkStageId })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(`${result.moved}개 상품의 단계를 변경했습니다.`)
      setCheckedIds([])
      setBulkStageId('')
      router.refresh()
    })
  }

  function runSingleMove(itemId: string, stageId: string) {
    startTransition(async () => {
      const result = await moveNewProductsAction({ itemIds: [itemId], stageId })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success('진행 단계를 변경했습니다.')
      router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={PackageSearch} label="전체 신상품" value={initialItems.length} helper={`${initialStages.length}개 단계 운영 중`} accent="violet" />
        <MetricCard icon={Sparkles} label="진행 중" value={Math.max(0, initialItems.length - completedCount - pausedCount)} helper="등록완료·보류·불가 제외" accent="blue" />
        <MetricCard icon={CheckCircle2} label="등록 완료" value={completedCount} helper="최종 등록을 마친 상품" accent="green" />
        <MetricCard icon={CirclePause} label="보류·진행불가" value={pausedCount} helper="재검토가 필요한 상품" accent="amber" />
      </section>

      <section className="rounded-xl border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold">전체 진행 단계</h2>
            <p className="text-xs text-muted-foreground">단계를 누르면 해당 상품만 표시됩니다.</p>
          </div>
          <div className="flex gap-2">
            <StageSettingsDialog stages={initialStages} onSaved={() => router.refresh()} />
            <CreateProductDialog
              stages={initialStages}
              onCreated={(id) => {
                setActiveStageId(null)
                setSelectedId(id)
                router.refresh()
              }}
            />
          </div>
        </div>
        <div className="overflow-x-auto p-3">
          <div className="flex min-w-max items-stretch gap-2">
            <button
              type="button"
              onClick={() => setActiveStageId(null)}
              className={cn(
                'flex w-36 shrink-0 flex-col justify-between rounded-lg border p-3 text-left transition hover:border-violet-300 hover:bg-violet-50/60',
                activeStageId === null && 'border-violet-500 bg-violet-50 ring-1 ring-violet-200',
              )}
            >
              <span className="text-xs font-semibold">전체 단계</span>
              <span className="mt-3 text-2xl font-bold tabular-nums">{initialItems.length}</span>
            </button>
            {initialStages.map((stage, index) => {
              const tone = toneClasses[stage.tone]
              return (
                <div key={stage.id} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveStageId(activeStageId === stage.id ? null : stage.id)}
                    className={cn(
                      'flex w-44 shrink-0 flex-col justify-between rounded-lg border bg-background p-3 text-left transition hover:-translate-y-0.5 hover:shadow-sm',
                      activeStageId === stage.id ? cn(tone.border, 'ring-1 ring-current/10') : 'border-border',
                    )}
                  >
                    <span className="flex items-start gap-2">
                      <span className={cn('mt-1 h-2 w-2 shrink-0 rounded-full', tone.dot)} />
                      <span className="line-clamp-2 text-xs font-semibold leading-4">{index + 1}. {stage.name}</span>
                    </span>
                    <span className="mt-3 flex items-end justify-between">
                      <span className="text-2xl font-bold tabular-nums">{stage.itemCount}</span>
                      <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', tone.chip)}>상품</span>
                    </span>
                  </button>
                  {index < initialStages.length - 1 && <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50" />}
                </div>
              )
            })}
          </div>
        </div>
      </section>

      <section className={cn('grid gap-4', selectedItem && 'xl:grid-cols-[minmax(440px,0.85fr)_minmax(520px,1.15fr)]')}>
        <div className="min-w-0 overflow-hidden rounded-xl border bg-card shadow-sm">
          <div className="flex flex-col gap-3 border-b p-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative min-w-56 flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="제품명, 샘플번호, 등록상품명 검색" className="pl-8" />
            </div>
            {checkedIds.length > 0 && (
              <div className="flex items-center gap-2 rounded-lg bg-violet-50 px-2 py-1.5">
                <span className="whitespace-nowrap text-xs font-semibold text-violet-700">{checkedIds.length}개 선택</span>
                <select value={bulkStageId} onChange={(event) => setBulkStageId(event.target.value)} className="h-7 max-w-44 rounded-md border bg-white px-2 text-xs">
                  <option value="">이동할 단계</option>
                  {initialStages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}
                </select>
                <Button size="sm" onClick={runBulkMove} disabled={!bulkStageId || pending}>일괄 이동</Button>
                <Button size="icon-sm" variant="ghost" aria-label="선택 해제" onClick={() => setCheckedIds([])}><X /></Button>
              </div>
            )}
          </div>

          <div className="overflow-auto">
            <table className="w-full min-w-[700px] text-sm">
              <thead className="sticky top-0 z-10 bg-muted/90 text-left text-xs text-muted-foreground backdrop-blur">
                <tr>
                  <th className="w-10 px-3 py-2.5"><input type="checkbox" aria-label="전체 선택" checked={visibleItems.length > 0 && visibleItems.every((item) => checkedIds.includes(item.id))} onChange={toggleAll} /></th>
                  <th className="w-20 px-2 py-2.5">번호</th>
                  <th className="px-2 py-2.5">제품</th>
                  <th className="w-48 px-2 py-2.5">진행 단계</th>
                  <th className="w-24 px-2 py-2.5">판매예정</th>
                  <th className="w-28 px-2 py-2.5">수정일</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {visibleItems.map((item) => (
                  <tr
                    key={item.id}
                    onClick={() => setSelectedId(item.id)}
                    className={cn('cursor-pointer transition hover:bg-muted/50', effectiveSelectedId === item.id && 'bg-violet-50/80')}
                  >
                    <td className="px-3 py-2.5" onClick={(event) => event.stopPropagation()}>
                      <input type="checkbox" aria-label={`${item.productName} 선택`} checked={checkedIds.includes(item.id)} onChange={() => setCheckedIds((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])} />
                    </td>
                    <td className="px-2 py-2.5 font-mono text-xs text-muted-foreground">#{item.productNumber}</td>
                    <td className="px-2 py-2.5">
                      <p className="line-clamp-1 font-medium">{item.productName}</p>
                      <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{item.sampleCode || item.registeredProductName || '샘플번호 미입력'}</p>
                    </td>
                    <td className="px-2 py-2.5" onClick={(event) => event.stopPropagation()}>
                      <select value={item.stageId} onChange={(event) => runSingleMove(item.id, event.target.value)} disabled={pending} className={cn('h-7 w-full rounded-md border-0 px-2 text-xs font-medium', toneClasses[item.stageTone].chip)}>
                        {initialStages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-2.5 text-xs text-muted-foreground">{shortDate(item.plannedSaleDate)}</td>
                    <td className="px-2 py-2.5 text-xs text-muted-foreground">{shortDate(item.updatedAt)}</td>
                  </tr>
                ))}
                {visibleItems.length === 0 && (
                  <tr><td colSpan={6} className="h-52 text-center text-sm text-muted-foreground">조건에 맞는 신상품이 없습니다.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {selectedItem && (
          <ProductDetail
            key={`${selectedItem.id}:${selectedItem.updatedAt}`}
            item={selectedItem}
            stages={initialStages}
            onClose={() => setSelectedId(null)}
            onSaved={() => router.refresh()}
          />
        )}
      </section>
    </div>
  )
}

function MetricCard({ icon: Icon, label, value, helper, accent }: {
  icon: typeof PackageSearch
  label: string
  value: number
  helper: string
  accent: 'violet' | 'blue' | 'green' | 'amber'
}) {
  const accents = {
    violet: 'bg-violet-100 text-violet-700',
    blue: 'bg-blue-100 text-blue-700',
    green: 'bg-green-100 text-green-700',
    amber: 'bg-amber-100 text-amber-700',
  }
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card p-3 shadow-sm">
      <div className={cn('flex h-10 w-10 items-center justify-center rounded-lg', accents[accent])}><Icon className="h-5 w-5" /></div>
      <div className="min-w-0">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="text-xl font-bold tabular-nums">{value}</p>
        <p className="truncate text-[10px] text-muted-foreground">{helper}</p>
      </div>
    </div>
  )
}

function CreateProductDialog({ stages, onCreated }: { stages: NewProductStage[]; onCreated: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [productName, setProductName] = useState('')
  const [sampleCode, setSampleCode] = useState('')
  const [stageId, setStageId] = useState(stages[0]?.id ?? '')

  function submit(event: React.FormEvent) {
    event.preventDefault()
    startTransition(async () => {
      const result = await createNewProductAction({ productName, sampleCode, stageId })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(`신상품 #${result.productNumber}을 등록했습니다.`)
      setOpen(false)
      setProductName('')
      setSampleCode('')
      onCreated(result.id)
    })
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger render={(props) => <Button {...props}><Plus />신상품 등록</Button>} />
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px]" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,480px)] -translate-x-1/2 -translate-y-1/2 rounded-xl bg-background p-5 shadow-2xl">
          <Dialog.Title className="text-lg font-semibold">신상품 등록</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted-foreground">우선 핵심 정보만 등록하고 상세 정보와 파일은 이어서 입력합니다.</Dialog.Description>
          <form onSubmit={submit} className="mt-5 space-y-4">
            <Field label="제품명" required><Input value={productName} onChange={(event) => setProductName(event.target.value)} autoFocus placeholder="예: 아이렙 메이크업 쿠션퍼프 세트" /></Field>
            <Field label="샘플 가칭번호"><Input value={sampleCode} onChange={(event) => setSampleCode(event.target.value)} placeholder="BH-브랜드_PH-플랫폼" /></Field>
            <Field label="시작 단계"><StageSelect value={stageId} onChange={setStageId} stages={stages} /></Field>
            <div className="flex justify-end gap-2 pt-2">
              <Dialog.Close render={(props) => <Button {...props} type="button" variant="outline">취소</Button>} />
              <Button type="submit" disabled={pending || !productName.trim() || !stageId}>{pending && <Loader2 className="animate-spin" />}등록</Button>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function StageSettingsDialog({ stages, onSaved }: { stages: NewProductStage[]; onSaved: () => void }) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [drafts, setDrafts] = useState<Array<{ id?: string; name: string; tone: NewProductStageTone }>>(
    () => stages.map(({ id, name, tone }) => ({ id, name, tone })),
  )

  function setDialogOpen(next: boolean) {
    setOpen(next)
    if (next) setDrafts(stages.map(({ id, name, tone }) => ({ id, name, tone })))
  }

  function move(index: number, direction: -1 | 1) {
    const nextIndex = index + direction
    if (nextIndex < 0 || nextIndex >= drafts.length) return
    setDrafts((current) => {
      const next = [...current]
      ;[next[index], next[nextIndex]] = [next[nextIndex], next[index]]
      return next
    })
  }

  function save() {
    startTransition(async () => {
      const result = await saveNewProductStagesAction({ stages: drafts })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success('진행 단계 설정을 저장했습니다.')
      setOpen(false)
      onSaved()
    })
  }

  return (
    <Dialog.Root open={open} onOpenChange={setDialogOpen}>
      <Dialog.Trigger render={(props) => <Button {...props} variant="outline"><Settings2 />단계 설정</Button>} />
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px]" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[min(94vw,680px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl bg-background shadow-2xl">
          <div className="border-b p-5">
            <Dialog.Title className="text-lg font-semibold">진행 단계 설정</Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-muted-foreground">이름과 색상을 바꾸거나 새 단계를 추가하고, 화살표로 노출 순서를 조정합니다.</Dialog.Description>
          </div>
          <div className="flex-1 space-y-2 overflow-y-auto p-4">
            {drafts.map((stage, index) => (
              <div key={stage.id ?? `new-${index}`} className="flex items-center gap-2 rounded-lg border bg-muted/20 p-2">
                <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground/50" />
                <span className="w-6 text-center text-xs font-semibold text-muted-foreground">{index + 1}</span>
                <Input value={stage.name} onChange={(event) => setDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} className="flex-1" />
                <select value={stage.tone} onChange={(event) => setDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, tone: event.target.value as NewProductStageTone } : item))} className="h-8 rounded-lg border bg-background px-2 text-xs">
                  {Object.keys(toneClasses).map((tone) => <option key={tone} value={tone}>{tone}</option>)}
                </select>
                <Button type="button" variant="ghost" size="icon-sm" disabled={index === 0} aria-label="위로 이동" onClick={() => move(index, -1)}><ArrowUp /></Button>
                <Button type="button" variant="ghost" size="icon-sm" disabled={index === drafts.length - 1} aria-label="아래로 이동" onClick={() => move(index, 1)}><ArrowDown /></Button>
                {!stage.id && <Button type="button" variant="ghost" size="icon-sm" aria-label="새 단계 삭제" onClick={() => setDrafts((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 /></Button>}
              </div>
            ))}
            <Button type="button" variant="outline" className="w-full border-dashed" onClick={() => setDrafts((current) => [...current, { name: '새 단계', tone: 'slate' as const }])}><Plus />단계 추가</Button>
          </div>
          <div className="flex justify-end gap-2 border-t p-4">
            <Dialog.Close render={(props) => <Button {...props} type="button" variant="outline">취소</Button>} />
            <Button onClick={save} disabled={pending}>{pending && <Loader2 className="animate-spin" />}설정 저장</Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

type EditorValues = ReturnType<typeof editorValues>

function ProductDetail({ item, stages, onClose, onSaved }: {
  item: NewProductItem
  stages: NewProductStage[]
  onClose: () => void
  onSaved: () => void
}) {
  const [values, setValues] = useState(() => editorValues(item))
  const [pending, startTransition] = useTransition()

  function setValue<K extends keyof EditorValues>(key: K, value: EditorValues[K]) {
    setValues((current) => ({ ...current, [key]: value }))
  }

  function setCost(value: string) {
    const cost = normalizedNumber(value)
    const calculation = calculateSalesPrices({ costKrw: cost ?? 0 })
    setValues((current) => ({
      ...current,
      estimatedCost: value,
      b2bPrice: calculation ? String(calculation.b2bPrice) : '',
      b2cPrice: calculation ? String(calculation.b2cPrice) : '',
    }))
  }

  function applyAutomaticPrice() {
    const calculation = calculateSalesPrices({ costKrw: normalizedNumber(values.estimatedCost) ?? 0 })
    if (!calculation) return toast.error('예상원가를 먼저 입력해주세요.')
    setValues((current) => ({ ...current, b2bPrice: String(calculation.b2bPrice), b2cPrice: String(calculation.b2cPrice) }))
    toast.success('펀타스틱 계산식으로 판매가를 계산했습니다.')
  }

  function save() {
    startTransition(async () => {
      const result = await updateNewProductAction({ itemId: item.id, values })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success('신상품 정보를 저장했습니다.')
      onSaved()
    })
  }

  const calculation = calculateSalesPrices({
    costKrw: normalizedNumber(values.estimatedCost) ?? 0,
    b2bPriceOverride: normalizedNumber(values.b2bPrice),
    b2cPriceOverride: normalizedNumber(values.b2cPrice),
  })

  return (
    <aside className="min-w-0 overflow-hidden rounded-xl border bg-card shadow-sm xl:max-h-[calc(100vh-6rem)]">
      <div className="flex items-start justify-between border-b bg-gradient-to-r from-violet-50 to-white p-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-violet-700">제품 #{item.productNumber}</p>
          <h2 className="mt-1 truncate text-lg font-semibold">{item.productName}</h2>
          <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><CalendarDays className="h-3 w-3" />최근 수정 {formatDateTime(item.updatedAt)}</p>
        </div>
        <div className="flex gap-1">
          <Button onClick={save} disabled={pending}><Save />{pending ? '저장 중' : '저장'}</Button>
          <Button variant="ghost" size="icon" aria-label="상세 닫기" onClick={onClose}><X /></Button>
        </div>
      </div>

      <div className="space-y-5 overflow-y-auto p-4 xl:max-h-[calc(100vh-12rem)]">
        <Section title="진행 상태" icon={Sparkles}>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="현재 단계"><StageSelect value={values.stageId} onChange={(value) => setValue('stageId', value)} stages={stages} /></Field>
            <Field label="샘플 가칭번호"><Input value={values.sampleCode} onChange={(event) => setValue('sampleCode', event.target.value)} /></Field>
          </div>
          {item.stageHistory.length > 0 && (
            <div className="mt-3 rounded-lg bg-muted/40 p-3">
              <p className="mb-2 text-xs font-semibold">최근 단계 변경</p>
              <div className="space-y-2">
                {item.stageHistory.slice(0, 4).map((history) => (
                  <div key={history.id} className="flex items-start justify-between gap-3 text-xs">
                    <span className="min-w-0"><span className="text-muted-foreground">{history.fromStageName ? `${history.fromStageName} → ` : ''}</span><strong>{history.toStageName}</strong>{history.note && <span className="ml-1 text-muted-foreground">· {history.note}</span>}</span>
                    <time className="shrink-0 text-muted-foreground">{shortDate(history.changedAt)}</time>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Section>

        <Section title="기본 상품 정보" icon={PencilLine}>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="제품명" required><Input value={values.productName} onChange={(event) => setValue('productName', event.target.value)} /></Field>
            <Field label="등록 상품명"><Input value={values.registeredProductName} onChange={(event) => setValue('registeredProductName', event.target.value)} /></Field>
            <Field label="제품 영문명"><Input value={values.englishName} onChange={(event) => setValue('englishName', event.target.value)} /></Field>
            <Field label="중국사용 항목"><Input value={values.chinaItemName} onChange={(event) => setValue('chinaItemName', event.target.value)} /></Field>
            <Field label="구매·소싱 URL"><UrlInput value={values.sourceUrl} onChange={(value) => setValue('sourceUrl', value)} /></Field>
            <Field label="패키지 정보 URL"><UrlInput value={values.packageInfoUrl} onChange={(value) => setValue('packageInfoUrl', value)} /></Field>
            <Field label="판매예정일"><Input type="date" value={values.plannedSaleDate} onChange={(event) => setValue('plannedSaleDate', event.target.value)} /></Field>
            <Field label="상세페이지 완료예정일"><Input type="date" value={values.detailPageDueDate} onChange={(event) => setValue('detailPageDueDate', event.target.value)} /></Field>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <Field label="필수 체크 사항"><TextArea value={values.requiredChecks} onChange={(value) => setValue('requiredChecks', value)} placeholder="미팅 전 반드시 확인할 내용" /></Field>
            <Field label="비고"><TextArea value={values.referenceNotes} onChange={(value) => setValue('referenceNotes', value)} /></Field>
          </div>
          <div className="mt-3"><Field label="히스토리 메모"><TextArea value={values.historyNotes} onChange={(value) => setValue('historyNotes', value)} placeholder="날짜 / 담당자 / 결정 내용" rows={4} /></Field></div>
        </Section>

        <Section title="이미지 및 품질표시 파일" icon={ImageIcon}>
          <div className="grid gap-3 md:grid-cols-2">
            <AttachmentPanel itemId={item.id} kind="product_image" label="제품 이미지" attachments={item.attachments} onChanged={onSaved} />
            <AttachmentPanel itemId={item.id} kind="sample_china_image" label="샘플 입고 구성품·검수 이미지 (중국)" attachments={item.attachments} onChanged={onSaved} />
            <AttachmentPanel itemId={item.id} kind="final_sample_image" label="샘플 확정 이미지·구성품 (한국)" attachments={item.attachments} onChanged={onSaved} />
            <AttachmentPanel itemId={item.id} kind="quality_pdf" label="품질표시 등록 PDF" attachments={item.attachments} onChanged={onSaved} />
          </div>
        </Section>

        <Section title="패키지·등록 준비" icon={PackageSearch}>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="패키지 진행완료 여부"><StatusInput value={values.packageProgressStatus} onChange={(value) => setValue('packageProgressStatus', value)} /></Field>
            <Field label="패키지 상태"><Input value={values.packageStatus} onChange={(event) => setValue('packageStatus', event.target.value)} /></Field>
            <Field label="한글 설명서 유무"><StatusInput value={values.koreanManualStatus} onChange={(value) => setValue('koreanManualStatus', value)} /></Field>
            <Field label="품질표시 작업"><Input value={values.qualityNoticeStatus} onChange={(event) => setValue('qualityNoticeStatus', event.target.value)} /></Field>
            <Field label="패키지박스 디자인"><StatusInput value={values.packageBoxDesign} onChange={(value) => setValue('packageBoxDesign', value)} /></Field>
            <Field label="패키지 제조"><StatusInput value={values.packageManufacturer} onChange={(value) => setValue('packageManufacturer', value)} /></Field>
            <Field label="패키지 포장"><StatusInput value={values.packagePacking} onChange={(value) => setValue('packagePacking', value)} /></Field>
            <Field label="택배사"><Input value={values.carrier} onChange={(event) => setValue('carrier', event.target.value)} /></Field>
          </div>
        </Section>

        <Section title="원가 및 판매가 계산" icon={PencilLine}>
          <div className="rounded-lg border border-violet-200 bg-violet-50/50 p-3">
            <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
              <div>
                <p className="text-sm font-semibold text-violet-900">펀타스틱 판매가 계산식</p>
                <p className="text-xs text-violet-700">예상원가를 기준으로 도매·소매 판매가와 예상 마진을 계산합니다.</p>
              </div>
              <div className="flex gap-2">
                <a href="https://funtastic-calc.vercel.app/" target="_blank" rel="noreferrer"><Button type="button" size="sm" variant="outline">기존 계산기<ExternalLink /></Button></a>
                <Button type="button" size="sm" onClick={applyAutomaticPrice}>자동 계산</Button>
              </div>
            </div>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <Field label="예상원가 (₩)"><MoneyInput value={values.estimatedCost} onChange={setCost} /></Field>
            <Field label="B2B 판매가·도매 (₩)"><MoneyInput value={values.b2bPrice} onChange={(value) => setValue('b2bPrice', value)} /></Field>
            <Field label="B2C 판매가·소매 (₩)"><MoneyInput value={values.b2cPrice} onChange={(value) => setValue('b2cPrice', value)} /></Field>
            <Field label="신고금액"><MoneyInput value={values.declaredValue} onChange={(value) => setValue('declaredValue', value)} /></Field>
            <Field label="B2B 택배비"><MoneyInput value={values.b2bShippingFee} onChange={(value) => setValue('b2bShippingFee', value)} /></Field>
            <Field label="B2C 택배비"><MoneyInput value={values.b2cShippingFee} onChange={(value) => setValue('b2cShippingFee', value)} /></Field>
          </div>
          {calculation && (
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <ProfitCard label="B2B 예상" price={calculation.b2bPrice} profit={calculation.b2bProfit} margin={calculation.b2bMargin} fee="수수료 10%" />
              <ProfitCard label="B2C 예상" price={calculation.b2cPrice} profit={calculation.b2cProfit} margin={calculation.b2cMargin} fee="수수료 25%" />
            </div>
          )}
        </Section>

        <div className="sticky bottom-0 flex justify-end border-t bg-background/95 py-3 backdrop-blur">
          <Button onClick={save} disabled={pending} size="lg"><Save />{pending ? '저장 중...' : '변경사항 저장'}</Button>
        </div>
      </div>
    </aside>
  )
}

function Section({ title, icon: Icon, children }: { title: string; icon: typeof Sparkles; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-3 flex items-center gap-2 border-b pb-2 text-sm font-semibold"><Icon className="h-4 w-4 text-violet-600" />{title}</h3>
      {children}
    </section>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}{required && <span className="ml-1 text-red-500">*</span>}</span>
      {children}
    </label>
  )
}

function StageSelect({ value, onChange, stages }: { value: string; onChange: (value: string) => void; stages: NewProductStage[] }) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)} className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30">
      {stages.map((stage, index) => <option key={stage.id} value={stage.id}>{index + 1}. {stage.name}</option>)}
    </select>
  )
}

function StatusInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)} className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm">
      <option value="">선택 안 함</option>
      <option value="대기">대기</option>
      <option value="진행중">진행중</option>
      <option value="완료">완료</option>
      <option value="해당없음">해당없음</option>
    </select>
  )
}

function UrlInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="flex gap-1">
      <Input type="url" value={value} onChange={(event) => onChange(event.target.value)} placeholder="https://" />
      {/^https?:\/\//.test(value) && <a href={value} target="_blank" rel="noreferrer"><Button type="button" size="icon" variant="outline" aria-label="링크 열기"><ExternalLink /></Button></a>}
    </div>
  )
}

function TextArea({ value, onChange, placeholder, rows = 3 }: { value: string; onChange: (value: string) => void; placeholder?: string; rows?: number }) {
  return <textarea value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} rows={rows} className="w-full resize-y rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/30" />
}

function MoneyInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <Input inputMode="numeric" value={value} onChange={(event) => onChange(event.target.value.replace(/[^0-9.]/g, ''))} placeholder="0" />
}

function ProfitCard({ label, price, profit, margin, fee }: { label: string; price: number; profit: number; margin: number; fee: string }) {
  return (
    <div className="rounded-lg border bg-muted/25 p-3">
      <div className="flex items-center justify-between"><strong className="text-xs">{label}</strong><span className="text-[10px] text-muted-foreground">{fee}</span></div>
      <p className="mt-2 text-lg font-bold">{won(price)}</p>
      <p className={cn('text-xs', profit >= 0 ? 'text-emerald-700' : 'text-red-600')}>예상 이익 {won(profit)} · 마진 {(margin * 100).toFixed(1)}%</p>
    </div>
  )
}

function AttachmentPanel({ itemId, kind, label, attachments, onChanged }: {
  itemId: string
  kind: NewProductAttachment['kind']
  label: string
  attachments: NewProductAttachment[]
  onChanged: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const files = attachments.filter((attachment) => attachment.kind === kind)
  const isPdf = kind === 'quality_pdf'

  async function upload(file?: File) {
    if (!file) return
    setUploading(true)
    try {
      const formData = new FormData()
      formData.set('itemId', itemId)
      formData.set('kind', kind)
      formData.set('file', file)
      const response = await fetch('/api/new-products/attachments', { method: 'POST', body: formData })
      const result = await response.json() as { success?: boolean; error?: string }
      if (!response.ok) throw new Error(result.error || '업로드에 실패했습니다.')
      toast.success(`${file.name} 업로드 완료`)
      onChanged()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '업로드에 실패했습니다.')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function remove(attachment: NewProductAttachment) {
    if (!window.confirm(`“${attachment.fileName}” 파일을 정말 삭제할까요?`)) return
    const response = await fetch(`/api/new-products/attachments/${attachment.id}`, { method: 'DELETE' })
    const result = await response.json() as { success?: boolean; error?: string }
    if (!response.ok) return toast.error(result.error || '파일 삭제에 실패했습니다.')
    toast.success('파일을 삭제했습니다.')
    onChanged()
  }

  return (
    <div className="rounded-lg border p-3">
      <p className="mb-2 text-xs font-semibold">{label}</p>
      <button
        type="button"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => { event.preventDefault(); void upload(event.dataTransfer.files[0]) }}
        className="flex w-full flex-col items-center justify-center rounded-lg border border-dashed py-4 text-xs text-muted-foreground transition hover:border-violet-400 hover:bg-violet-50/50"
      >
        {uploading ? <Loader2 className="mb-1 h-5 w-5 animate-spin" /> : <UploadCloud className="mb-1 h-5 w-5" />}
        {uploading ? '업로드 중...' : `${isPdf ? 'PDF' : '이미지'}를 끌어놓거나 클릭`}
      </button>
      <input ref={inputRef} type="file" accept={isPdf ? 'application/pdf' : 'image/jpeg,image/png,image/webp,image/gif'} className="hidden" onChange={(event) => void upload(event.target.files?.[0])} />
      {files.length > 0 && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          {files.map((attachment) => (
            <div key={attachment.id} className="group relative overflow-hidden rounded-md border bg-muted/20">
              <a href={`/api/new-products/attachments/${attachment.id}`} target="_blank" rel="noreferrer" className="block">
                {isPdf ? (
                  <div className="flex h-20 flex-col items-center justify-center px-2"><FileText className="h-6 w-6 text-red-500" /><span className="mt-1 line-clamp-1 max-w-full text-[10px]">{attachment.fileName}</span></div>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/new-products/attachments/${attachment.id}`} alt={attachment.fileName} className="h-24 w-full object-cover" />
                )}
              </a>
              <button type="button" aria-label="첨부 삭제" onClick={() => void remove(attachment)} className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/65 text-white opacity-0 transition group-hover:opacity-100"><Trash2 className="h-3 w-3" /></button>
            </div>
          ))}
        </div>
      )}
      <p className="mt-2 text-[10px] text-muted-foreground">파일당 최대 4MB</p>
    </div>
  )
}

function editorValues(item: NewProductItem) {
  return {
    stageId: item.stageId,
    sampleCode: item.sampleCode ?? '',
    productName: item.productName,
    englishName: item.englishName ?? '',
    sourceUrl: item.sourceUrl ?? '',
    requiredChecks: item.requiredChecks ?? '',
    estimatedCost: valueString(item.estimatedCost),
    historyNotes: item.historyNotes ?? '',
    referenceNotes: item.referenceNotes ?? '',
    chinaItemName: item.chinaItemName ?? '',
    plannedSaleDate: item.plannedSaleDate ?? '',
    detailPageDueDate: item.detailPageDueDate ?? '',
    registeredProductName: item.registeredProductName ?? '',
    packageInfoUrl: item.packageInfoUrl ?? '',
    packageProgressStatus: item.packageProgressStatus ?? '',
    packageStatus: item.packageStatus ?? '',
    koreanManualStatus: item.koreanManualStatus ?? '',
    declaredValue: valueString(item.declaredValue),
    b2bPrice: valueString(item.b2bPrice),
    b2cPrice: valueString(item.b2cPrice),
    carrier: item.carrier ?? '',
    b2bShippingFee: valueString(item.b2bShippingFee),
    b2cShippingFee: valueString(item.b2cShippingFee),
    qualityNoticeStatus: item.qualityNoticeStatus ?? '',
    packageBoxDesign: item.packageBoxDesign ?? '',
    packageManufacturer: item.packageManufacturer ?? '',
    packagePacking: item.packagePacking ?? '',
  }
}

function normalizedNumber(value: string) {
  const parsed = Number(value.replace(/,/g, ''))
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function valueString(value: number | null) {
  return value == null ? '' : String(value)
}

function won(value: number) {
  return `${Math.round(value).toLocaleString('ko-KR')}원`
}

function shortDate(value: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('ko-KR', { month: '2-digit', day: '2-digit' }).format(date)
}

function formatDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date)
}
