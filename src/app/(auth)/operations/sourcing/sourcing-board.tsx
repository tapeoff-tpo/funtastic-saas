'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Dialog } from '@base-ui/react/dialog'
import {
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ImageIcon,
  Loader2,
  PackagePlus,
  Plus,
  Save,
  Trash2,
  UploadCloud,
  Users,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { calculateCnyCostKrw, type CnyKrwReferenceRate } from '@/lib/new-products/cny-cost'
import type { NewProductOperator, NewProductViewer } from '@/lib/new-products/workflow'
import type { ManualSourcingItem, SourcingMeeting } from '@/lib/operations/sourcing'
import {
  createSourcingMeetingAction,
  deleteSourcingMeetingAction,
  passManualSourcingAction,
  saveSourcingOperatorsAction,
  saveSourcingMeetingRowsAction,
  updateSourcingMeetingAction,
} from './actions'

type Props = {
  meetings: SourcingMeeting[]
  operators: NewProductOperator[]
  viewer: NewProductViewer
  exchangeRate: CnyKrwReferenceRate
  availableMembers: Array<{ id: string; displayName: string }>
}

type DraftRow = {
  clientId: string
  itemId: string | null
  ownerOperatorId: string | null
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
  status: string
  passedNewProductId: string | null
  hasImageFile: boolean
  legacyImageUrl: string | null
}

type SheetOwner = {
  id: string | null
  displayName: string
}

const meetingStatusClass: Record<SourcingMeeting['status'], string> = {
  open: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  closed: 'bg-slate-100 text-slate-700 ring-slate-200',
  archived: 'bg-amber-50 text-amber-800 ring-amber-200',
}

export function SourcingBoard({ meetings, operators, viewer, exchangeRate, availableMembers }: Props) {
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null)
  const [screen, setScreen] = useState<'list' | 'sheet'>('list')
  const selectedMeeting = meetings.find((meeting) => meeting.id === selectedMeetingId) ?? null

  function openMeeting(id: string) {
    setSelectedMeetingId(id)
    setScreen('sheet')
  }

  if (screen === 'sheet' && selectedMeeting) {
    return (
      <MeetingSheet
        key={meetingVersion(selectedMeeting)}
        meeting={selectedMeeting}
        operators={operators}
        viewer={viewer}
        exchangeRate={exchangeRate}
        onBack={() => setScreen('list')}
      />
    )
  }

  return (
    <MeetingList
      meetings={meetings}
      canCreate={viewer.isMain || Boolean(viewer.operatorId)}
      canManage={viewer.isMain}
      operators={operators}
      availableMembers={availableMembers}
      exchangeRate={exchangeRate}
      onOpen={openMeeting}
    />
  )
}

function MeetingList({ meetings, canCreate, canManage, operators, availableMembers, exchangeRate, onOpen }: {
  meetings: SourcingMeeting[]
  canCreate: boolean
  canManage: boolean
  operators: NewProductOperator[]
  availableMembers: Array<{ id: string; displayName: string }>
  exchangeRate: CnyKrwReferenceRate
  onOpen: (id: string) => void
}) {
  const router = useRouter()
  const [meetingDate, setMeetingDate] = useState(nextWednesday())
  const [title, setTitle] = useState('')
  const [pending, startTransition] = useTransition()
  const totalRows = meetings.reduce((total, meeting) => total + meeting.items.length, 0)

  function createMeeting() {
    startTransition(async () => {
      const result = await createSourcingMeetingAction({ meetingDate, title })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success('소싱회의를 만들었습니다.')
      setTitle('')
      onOpen(result.id)
      router.refresh()
    })
  }

  function deleteMeeting(meeting: SourcingMeeting) {
    const message = meeting.items.length > 0
      ? `이 소싱회의와 포함된 ${meeting.items.length}개 상품을 삭제할까요? 이 작업은 되돌릴 수 없습니다.`
      : '이 소싱회의를 삭제할까요? 이 작업은 되돌릴 수 없습니다.'
    if (!window.confirm(message)) return

    startTransition(async () => {
      const result = await deleteSourcingMeetingAction(meeting.id)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(`소싱회의를 삭제했습니다.${result.deletedItems ? ` 상품 ${result.deletedItems}개도 함께 삭제했습니다.` : ''}`)
      router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      <section className="border-b pb-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-sm font-semibold">주간 소싱회의</p>
            <p className="mt-1 text-sm text-muted-foreground">
              회의 날짜를 먼저 만들고, 회의 안에서 등록자별로 여러 상품을 가로 표에 한 번에 입력합니다.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-3 rounded-md border bg-muted/30 px-3 py-2 text-sm">
              <span className="text-muted-foreground">CNY 기준환율</span>
              <span className="font-semibold">1 ¥ = {exchangeRate.rate.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}원</span>
              <span className="text-xs text-muted-foreground">{exchangeRate.date ? `${exchangeRate.date} 기준` : '기본값'}</span>
            </div>
            {canManage ? <SourcingOperatorSettingsDialog operators={operators} availableMembers={availableMembers} onSaved={() => router.refresh()} /> : null}
          </div>
        </div>
      </section>

      {canCreate ? (
        <section className="grid gap-3 rounded-lg border bg-card p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] lg:items-end">
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">소싱회의 날짜</span>
            <Input type="date" value={meetingDate} onChange={(event) => setMeetingDate(event.target.value)} />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">회의 이름 <span className="font-normal">(비우면 날짜로 자동 생성)</span></span>
            <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={meetingTitle(meetingDate)} maxLength={300} />
          </label>
          <Button type="button" onClick={createMeeting} disabled={pending || !meetingDate}>
            {pending ? <Loader2 className="animate-spin" /> : <CalendarDays />}
            {pending ? '만드는 중...' : '소싱회의 만들기'}
          </Button>
        </section>
      ) : (
        <section className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          소싱 등록자로 설정된 계정만 새 소싱회의를 만들 수 있습니다.
        </section>
      )}

      <section className="overflow-hidden rounded-lg border bg-card">
        <div className="flex flex-col gap-1 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold">소싱회의 목록</h2>
            <p className="mt-1 text-xs text-muted-foreground">날짜를 눌러 회의별 입력 시트를 엽니다.</p>
          </div>
          <p className="text-xs text-muted-foreground">{meetings.length}개 회의 · {totalRows.toLocaleString('ko-KR')}개 상품</p>
        </div>
        {meetings.length > 0 ? (
          <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
            {meetings.map((meeting) => (
              <div key={meeting.id} className="group relative">
                <button
                  type="button"
                  onClick={() => onOpen(meeting.id)}
                  className="flex min-h-32 w-full flex-col items-start rounded-lg border bg-background p-4 text-left transition-colors hover:border-primary/50 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="flex w-full items-start justify-between gap-3 pr-8">
                    <span className="flex items-center gap-2 text-sm font-semibold">
                      <CalendarDays className="size-4 text-primary" />
                      {formatMeetingDate(meeting.meetingDate)}
                    </span>
                    <MeetingStatusBadge status={meeting.status} />
                  </div>
                  <strong className="mt-4 break-words text-base leading-6 group-hover:text-primary">{meeting.title}</strong>
                  <span className="mt-auto pt-4 text-xs text-muted-foreground">
                    내게 보이는 상품 {meeting.items.length.toLocaleString('ko-KR')}개
                  </span>
                </button>
                {canManage ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="absolute right-2 top-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    aria-label={`${meeting.title} 삭제`}
                    title="소싱회의 삭제"
                    disabled={pending}
                    onClick={() => deleteMeeting(meeting)}
                  >
                    <Trash2 />
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <div className="grid min-h-64 place-items-center px-6 text-center text-sm text-muted-foreground">
            아직 만든 소싱회의가 없습니다. 수요일 회의를 하나 만들고 상품을 추가해 주세요.
          </div>
        )}
      </section>
    </div>
  )
}

function SourcingOperatorSettingsDialog({ operators, availableMembers, onSaved }: {
  operators: NewProductOperator[]
  availableMembers: Array<{ id: string; displayName: string }>
  onSaved: () => void
}) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [drafts, setDrafts] = useState(() => operatorDrafts(operators))

  function setDialogOpen(next: boolean) {
    setOpen(next)
    if (next) setDrafts(operatorDrafts(operators))
  }

  function save() {
    startTransition(async () => {
      const result = await saveSourcingOperatorsAction({ operators: drafts })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success('등록자 작업공간을 저장했습니다.')
      setOpen(false)
      onSaved()
    })
  }

  return (
    <Dialog.Root open={open} onOpenChange={setDialogOpen}>
      <Dialog.Trigger render={(props) => <Button {...props} type="button" variant="outline"><Users />등록자 설정</Button>} />
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px]" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[min(94vw,680px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl bg-background shadow-2xl">
          <div className="border-b p-5">
            <Dialog.Title className="text-lg font-semibold">소싱 등록자 설정</Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-muted-foreground">
              1~5명까지 지정할 수 있습니다. 메인은 전체를 관리하고, 등록자는 자기 시트의 상품만 수정합니다. 이 설정은 신상품 진행관리에도 함께 적용됩니다.
            </Dialog.Description>
          </div>
          <div className="flex-1 space-y-2 overflow-y-auto p-4">
            {drafts.map((draft, index) => (
              <div key={`${draft.memberUserId}-${index}`} className="grid gap-2 rounded-lg border bg-muted/20 p-3 md:grid-cols-[88px_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-center">
                <span className="text-xs font-semibold text-muted-foreground">등록자 {index + 1}</span>
                <select
                  value={draft.memberUserId}
                  onChange={(event) => {
                    const member = availableMembers.find((entry) => entry.id === event.target.value)
                    setDrafts((current) => current.map((entry, entryIndex) => entryIndex === index
                      ? { memberUserId: event.target.value, displayName: member?.displayName ?? entry.displayName }
                      : entry))
                  }}
                  className="h-8 min-w-0 rounded-lg border bg-background px-2 text-sm"
                >
                  <option value="">계정 선택</option>
                  {availableMembers.map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}
                </select>
                <Input value={draft.displayName} onChange={(event) => setDrafts((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, displayName: event.target.value } : entry))} placeholder="화면에 표시할 이름" />
                <Button type="button" variant="ghost" size="icon-sm" disabled={drafts.length <= 1} aria-label="등록자 제거" title="등록자 제거" onClick={() => setDrafts((current) => current.filter((_, entryIndex) => entryIndex !== index))}><Trash2 /></Button>
              </div>
            ))}
            {drafts.length < 5 ? <Button type="button" variant="outline" className="w-full border-dashed" onClick={() => setDrafts((current) => [...current, { memberUserId: '', displayName: '' }])}><Plus />등록자 추가</Button> : null}
            {availableMembers.length < 2 ? <p className="px-1 text-xs text-muted-foreground">추가할 사람이 목록에 없다면 먼저 해당 직원의 계정을 만들어 주세요.</p> : null}
          </div>
          <div className="flex justify-end gap-2 border-t p-4">
            <Dialog.Close render={(props) => <Button {...props} type="button" variant="outline">취소</Button>} />
            <Button type="button" onClick={save} disabled={pending}>{pending ? <Loader2 className="animate-spin" /> : null}등록자 저장</Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function MeetingSheet({ meeting, operators, viewer, exchangeRate, onBack }: {
  meeting: SourcingMeeting
  operators: NewProductOperator[]
  viewer: NewProductViewer
  exchangeRate: CnyKrwReferenceRate
  onBack: () => void
}) {
  const router = useRouter()
  const [meetingDate, setMeetingDate] = useState(meeting.meetingDate)
  const [title, setTitle] = useState(meeting.title)
  const [status, setStatus] = useState<SourcingMeeting['status']>(meeting.status)
  const [pending, startTransition] = useTransition()
  const currentOperator = operators.find((operator) => operator.id === viewer.operatorId) ?? null
  const operatorSections = viewer.isMain
    ? operators.map((operator) => ({ owner: { id: operator.id, displayName: operator.displayName }, items: meeting.items.filter((item) => item.ownerOperatorId === operator.id) }))
    : currentOperator
      ? [{ owner: { id: currentOperator.id, displayName: currentOperator.displayName }, items: meeting.items }]
      : []
  const unassignedItems = viewer.isMain ? meeting.items.filter((item) => !item.ownerOperatorId) : []

  function saveMeetingDetails() {
    startTransition(async () => {
      const result = await updateSourcingMeetingAction({
        meetingId: meeting.id,
        values: { meetingDate, title, status },
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success('소싱회의 정보를 저장했습니다.')
      router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      <header className="border-b pb-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <Button type="button" variant="ghost" size="sm" className="-ml-2" onClick={onBack}>
              <ChevronLeft />
              소싱회의 목록
            </Button>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold">{meeting.title}</h2>
              <MeetingStatusBadge status={meeting.status} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {formatMeetingDate(meeting.meetingDate)} · {meeting.items.length.toLocaleString('ko-KR')}개 상품
            </p>
          </div>
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-right text-sm">
            <p className="text-xs text-muted-foreground">이번 회의 기본 환율</p>
            <p className="font-semibold">1 ¥ = {exchangeRate.rate.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}원</p>
          </div>
        </div>

        {viewer.isMain ? (
          <div className="mt-4 grid gap-3 rounded-lg border bg-card p-3 lg:grid-cols-[170px_minmax(0,1fr)_130px_auto] lg:items-end">
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">회의 날짜</span>
              <Input type="date" value={meetingDate} onChange={(event) => setMeetingDate(event.target.value)} />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">회의 이름</span>
              <Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={300} />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">상태</span>
              <select value={status} onChange={(event) => setStatus(event.target.value as SourcingMeeting['status'])} className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50">
                <option value="open">진행 중</option>
                <option value="closed">마감</option>
                <option value="archived">이전 데이터</option>
              </select>
            </label>
            <Button type="button" onClick={saveMeetingDetails} disabled={pending || !meetingDate || !title.trim()}>
              {pending ? <Loader2 className="animate-spin" /> : <Save />}
              회의 저장
            </Button>
          </div>
        ) : null}
      </header>

      {operatorSections.map((section) => (
        <OwnerSheet
          key={section.owner.id}
          meetingId={meeting.id}
          owner={section.owner}
          rows={section.items}
          operators={operators}
          viewer={viewer}
          exchangeRate={exchangeRate.rate}
          onChanged={() => router.refresh()}
        />
      ))}

      {unassignedItems.length > 0 ? (
        <OwnerSheet
          meetingId={meeting.id}
          owner={{ id: null, displayName: '미지정 · 이전 수집 데이터' }}
          rows={unassignedItems}
          operators={operators}
          viewer={viewer}
          exchangeRate={exchangeRate.rate}
          allowNewRows={false}
          onChanged={() => router.refresh()}
        />
      ) : null}

      {operatorSections.length === 0 && unassignedItems.length === 0 ? (
        <section className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
          등록자가 아직 설정되지 않았습니다. 신상품 진행관리의 등록자 설정에서 담당자를 먼저 지정해 주세요.
        </section>
      ) : null}
    </div>
  )
}

function OwnerSheet({ meetingId, owner, rows: sourceRows, operators, viewer, exchangeRate, allowNewRows = true, onChanged }: {
  meetingId: string
  owner: SheetOwner
  rows: ManualSourcingItem[]
  operators: NewProductOperator[]
  viewer: NewProductViewer
  exchangeRate: number
  allowNewRows?: boolean
  onChanged: () => void
}) {
  const [rows, setRows] = useState<DraftRow[]>(() => sourceRows.map((item) => rowFromItem(item, exchangeRate)))
  const [photos, setPhotos] = useState<Record<string, File>>({})
  const [pending, startTransition] = useTransition()
  const canAddRows = allowNewRows && Boolean(owner.id)
  const showOwnerColumn = viewer.isMain

  function updateRow(clientId: string, patch: Partial<DraftRow>) {
    setRows((currentRows) => currentRows.map((row) => row.clientId === clientId ? { ...row, ...patch } : row))
  }

  function appendRows(count: number) {
    const ownerId = owner.id
    if (!ownerId) return
    setRows((currentRows) => [...currentRows, ...Array.from({ length: count }, () => blankRow(exchangeRate, ownerId))])
  }

  function removeUnsavedRow(clientId: string) {
    setRows((currentRows) => currentRows.filter((row) => row.clientId !== clientId))
    setPhotos((currentPhotos) => {
      const remaining = { ...currentPhotos }
      delete remaining[clientId]
      return remaining
    })
  }

  async function persistRows(targetRows: DraftRow[]) {
    const result = await saveSourcingMeetingRowsAction({
      meetingId,
      rows: targetRows.map((row) => ({
        clientId: row.clientId,
        itemId: row.itemId,
        productName: row.productName,
        productOption: row.productOption,
        chinaPurchaseUrl: row.chinaPurchaseUrl,
        chinaUnitPriceCny: row.chinaUnitPriceCny,
        unitShippingCny: row.unitShippingCny,
        exchangeRateKrw: row.exchangeRateKrw,
        domesticSaleUrl: row.domesticSaleUrl,
        domesticSalePrice: row.domesticSalePrice,
        detailPageUrl: row.detailPageUrl,
        memo1: row.memo1,
        memo2: row.memo2,
        ownerOperatorId: row.ownerOperatorId,
      })),
    })
    if (!result.success) throw new Error(result.error)

    const ids = new Map(result.saved.map((saved) => [saved.clientId, saved.id]))
    for (const row of targetRows) {
      const file = photos[row.clientId]
      if (!file) continue
      const itemId = ids.get(row.clientId) ?? row.itemId
      if (!itemId) continue
      const uploaded = await uploadPhoto(itemId, file)
      if (!uploaded.success) throw new Error(uploaded.error)
    }
    return ids
  }

  function saveAll() {
    startTransition(async () => {
      try {
        const populatedRows = rows.filter((row) => row.productName.trim())
        if (populatedRows.length === 0) {
          toast.message('상품명이 입력된 행부터 저장됩니다.')
          return
        }
        await persistRows(rows)
        toast.success(`${populatedRows.length}개 상품을 저장했습니다.`)
        onChanged()
      } catch (error) {
        toast.error(errorMessage(error))
      }
    })
  }

  function passRow(row: DraftRow) {
    startTransition(async () => {
      try {
        if (!row.productName.trim()) throw new Error('1차 통과할 상품명을 입력해 주세요.')
        const ids = await persistRows([row])
        const itemId = ids.get(row.clientId) ?? row.itemId
        if (!itemId) throw new Error('소싱 상품 저장에 실패했습니다.')
        const result = await passManualSourcingAction(itemId)
        if (!result.success) throw new Error(result.error)
        toast.success(result.existing ? '이미 신상품 진행관리 1단계에 등록된 상품입니다.' : '신상품 진행관리 1단계에 등록했습니다.')
        onChanged()
      } catch (error) {
        toast.error(errorMessage(error))
      }
    })
  }

  return (
    <section className="overflow-hidden rounded-lg border bg-card">
      <div className="flex flex-col gap-3 border-b px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h3 className="text-sm font-semibold">{owner.displayName}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            이 표 안에서 여러 상품을 추가하고 한 번에 저장할 수 있습니다. 긴 텍스트는 셀 높이가 자동으로 늘어납니다.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canAddRows ? (
            <>
              <Button type="button" variant="outline" size="sm" onClick={() => appendRows(1)} disabled={pending}>
                <Plus />
                행 추가
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => appendRows(5)} disabled={pending}>
                <Plus />
                5행 추가
              </Button>
            </>
          ) : null}
          <Button type="button" size="sm" onClick={saveAll} disabled={pending || rows.length === 0}>
            {pending ? <Loader2 className="animate-spin" /> : <Save />}
            {pending ? '저장 중...' : '변경사항 저장'}
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className={cn('min-w-[2680px] table-fixed border-collapse text-sm', showOwnerColumn && 'min-w-[2840px]')}>
          <colgroup>
            <col className="w-12" />
            <col className="w-32" />
            <col className="w-56" />
            <col className="w-44" />
            <col className="w-64" />
            <col className="w-28" />
            <col className="w-30" />
            <col className="w-28" />
            <col className="w-32" />
            <col className="w-64" />
            <col className="w-32" />
            <col className="w-64" />
            <col className="w-56" />
            <col className="w-56" />
            {showOwnerColumn ? <col className="w-40" /> : null}
            <col className="w-36" />
            <col className="w-20" />
          </colgroup>
          <thead className="bg-muted/40 text-left text-xs font-medium text-muted-foreground">
            <tr>
              <TableHeader>순번</TableHeader>
              <TableHeader>사진</TableHeader>
              <TableHeader required>상품명</TableHeader>
              <TableHeader>상품 옵션</TableHeader>
              <TableHeader>1688 URL</TableHeader>
              <TableHeader>중국 위안화</TableHeader>
              <TableHeader>개당 배송비</TableHeader>
              <TableHeader>환율</TableHeader>
              <TableHeader>한국원화</TableHeader>
              <TableHeader>국내판매 링크</TableHeader>
              <TableHeader>국내판매가</TableHeader>
              <TableHeader>상세페이지 URL</TableHeader>
              <TableHeader>비고 1</TableHeader>
              <TableHeader>비고 2</TableHeader>
              {showOwnerColumn ? <TableHeader>등록자</TableHeader> : null}
              <TableHeader>진행</TableHeader>
              <TableHeader>정리</TableHeader>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const calculatedCost = calculateCnyCostKrw({
                chinaUnitPriceCny: numberValue(row.chinaUnitPriceCny),
                unitShippingCny: numberValue(row.unitShippingCny),
                exchangeRateKrw: numberValue(row.exchangeRateKrw),
              })
              return (
                <tr key={row.clientId} className="border-t align-top hover:bg-muted/20">
                  <TableCell className="text-center text-xs text-muted-foreground">{index + 1}</TableCell>
                  <TableCell>
                    <PhotoCell
                      row={row}
                      file={photos[row.clientId] ?? null}
                      onChange={(file) => setPhotos((currentPhotos) => file
                        ? { ...currentPhotos, [row.clientId]: file }
                        : omitFile(currentPhotos, row.clientId))}
                    />
                  </TableCell>
                  <TableCell><AutoGrowTextarea value={row.productName} onChange={(value) => updateRow(row.clientId, { productName: value })} placeholder="상품명" /></TableCell>
                  <TableCell><AutoGrowTextarea value={row.productOption} onChange={(value) => updateRow(row.clientId, { productOption: value })} placeholder="옵션" /></TableCell>
                  <TableCell><AutoGrowTextarea value={row.chinaPurchaseUrl} onChange={(value) => updateRow(row.clientId, { chinaPurchaseUrl: value })} placeholder="https://detail.1688.com/..." /></TableCell>
                  <TableCell><NumericCell value={row.chinaUnitPriceCny} onChange={(value) => updateRow(row.clientId, { chinaUnitPriceCny: value })} placeholder="¥" decimal /></TableCell>
                  <TableCell><NumericCell value={row.unitShippingCny} onChange={(value) => updateRow(row.clientId, { unitShippingCny: value })} placeholder="¥" decimal /></TableCell>
                  <TableCell><NumericCell value={row.exchangeRateKrw} onChange={(value) => updateRow(row.clientId, { exchangeRateKrw: value })} placeholder="원/¥" decimal /></TableCell>
                  <TableCell><div className="min-h-8 rounded-md border bg-muted/40 px-2 py-1.5 text-right font-semibold">{won(calculatedCost)}</div></TableCell>
                  <TableCell><AutoGrowTextarea value={row.domesticSaleUrl} onChange={(value) => updateRow(row.clientId, { domesticSaleUrl: value })} placeholder="https://" /></TableCell>
                  <TableCell><NumericCell value={row.domesticSalePrice} onChange={(value) => updateRow(row.clientId, { domesticSalePrice: value })} placeholder="원" /></TableCell>
                  <TableCell><AutoGrowTextarea value={row.detailPageUrl} onChange={(value) => updateRow(row.clientId, { detailPageUrl: value })} placeholder="상세페이지 참고 URL" /></TableCell>
                  <TableCell><AutoGrowTextarea value={row.memo1} onChange={(value) => updateRow(row.clientId, { memo1: value })} placeholder="비고" /></TableCell>
                  <TableCell><AutoGrowTextarea value={row.memo2} onChange={(value) => updateRow(row.clientId, { memo2: value })} placeholder="비고" /></TableCell>
                  {showOwnerColumn ? (
                    <TableCell>
                      <select value={row.ownerOperatorId ?? ''} onChange={(event) => updateRow(row.clientId, { ownerOperatorId: event.target.value || null })} className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50">
                        <option value="">등록자 선택</option>
                        {operators.map((operator) => <option key={operator.id} value={operator.id}>{operator.displayName}</option>)}
                      </select>
                    </TableCell>
                  ) : null}
                  <TableCell>
                    {row.passedNewProductId || row.status === 'passed' ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700"><CheckCircle2 className="size-4" />1차 통과</span>
                    ) : (
                      <Button type="button" size="sm" variant="outline" className="w-full" onClick={() => passRow(row)} disabled={pending}>
                        <PackagePlus />
                        1차 통과
                      </Button>
                    )}
                  </TableCell>
                  <TableCell>
                    {!row.itemId ? (
                      <Button type="button" variant="ghost" size="icon-sm" aria-label="빈 행 제거" onClick={() => removeUnsavedRow(row.clientId)} disabled={pending}>
                        <X />
                      </Button>
                    ) : <span className="text-xs text-muted-foreground">저장됨</span>}
                  </TableCell>
                </tr>
              )
            })}
            {rows.length === 0 ? (
              <tr><td colSpan={showOwnerColumn ? 17 : 16} className="px-4 py-12 text-center text-sm text-muted-foreground">등록된 상품이 없습니다. {canAddRows ? '행 추가로 상품을 입력해 주세요.' : ''}</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function TableHeader({ children, required = false }: { children: React.ReactNode; required?: boolean }) {
  return <th scope="col" className="border-r px-2 py-2.5 align-bottom font-medium last:border-r-0">{children}{required ? <span className="ml-1 text-destructive">*</span> : null}</th>
}

function TableCell({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={cn('border-r p-2 last:border-r-0', className)}>{children}</td>
}

function NumericCell({ value, onChange, placeholder, decimal = false }: {
  value: string
  onChange: (value: string) => void
  placeholder: string
  decimal?: boolean
}) {
  return <Input value={value} onChange={(event) => onChange(event.target.value)} inputMode={decimal ? 'decimal' : 'numeric'} placeholder={placeholder} className="text-right" />
}

function AutoGrowTextarea({ value, onChange, placeholder }: {
  value: string
  onChange: (value: string) => void
  placeholder: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)

  function resize() {
    const element = ref.current
    if (!element) return
    element.style.height = '0px'
    element.style.height = `${Math.max(32, element.scrollHeight)}px`
  }

  useEffect(() => {
    const element = ref.current
    if (!element) return
    element.style.height = '0px'
    element.style.height = `${Math.max(32, element.scrollHeight)}px`
  }, [value])

  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      onInput={resize}
      onChange={(event) => {
        onChange(event.target.value)
        requestAnimationFrame(resize)
      }}
      placeholder={placeholder}
      className="block min-h-8 w-full resize-y overflow-hidden rounded-md border border-input bg-background px-2 py-1.5 text-sm leading-5 break-words outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
    />
  )
}

function PhotoCell({ row, file, onChange }: { row: DraftRow; file: File | null; onChange: (file: File | null) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const source = row.itemId && row.hasImageFile ? `/api/operations/sourcing/images/${row.itemId}` : row.legacyImageUrl
  return (
    <div className="space-y-2">
      <div className="grid aspect-square w-24 place-items-center overflow-hidden rounded-md border bg-muted/30">
        {source ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={source} alt="" className="h-full w-full object-cover" />
        ) : <ImageIcon className="size-5 text-muted-foreground" />}
      </div>
      <input ref={ref} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={(event) => onChange(event.target.files?.[0] ?? null)} />
      <Button type="button" variant="outline" size="xs" className="w-full" onClick={() => ref.current?.click()}>
        <UploadCloud />
        {file ? '사진 선택됨' : '사진 등록'}
      </Button>
      {file ? <p className="line-clamp-2 text-[11px] leading-4 text-muted-foreground">{file.name}</p> : null}
    </div>
  )
}

function MeetingStatusBadge({ status }: { status: SourcingMeeting['status'] }) {
  const label = status === 'open' ? '진행 중' : status === 'closed' ? '마감' : '이전 데이터'
  return <span className={cn('inline-flex h-6 items-center rounded-full px-2 text-xs font-medium ring-1', meetingStatusClass[status])}>{label}</span>
}

function rowFromItem(item: ManualSourcingItem, exchangeRate: number): DraftRow {
  return {
    clientId: item.id,
    itemId: item.id,
    ownerOperatorId: item.ownerOperatorId,
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
    status: item.status,
    passedNewProductId: item.passedNewProductId,
    hasImageFile: item.hasImageFile,
    legacyImageUrl: item.legacyImageUrl,
  }
}

function blankRow(exchangeRate: number, ownerOperatorId: string): DraftRow {
  return {
    clientId: crypto.randomUUID(),
    itemId: null,
    ownerOperatorId,
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
    status: 'draft',
    passedNewProductId: null,
    hasImageFile: false,
    legacyImageUrl: null,
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

function meetingVersion(meeting: SourcingMeeting) {
  return `${meeting.id}:${meeting.updatedAt}:${meeting.items.map((item) => `${item.id}:${item.updatedAt}`).join('|')}`
}

function meetingTitle(meetingDate: string) {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(meetingDate)
  if (!matched) return '소싱회의'
  return `${Number(matched[1])}년 ${Number(matched[2])}월 ${Number(matched[3])}일 소싱회의`
}

function nextWednesday() {
  const today = new Date()
  const date = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  date.setDate(date.getDate() + ((3 - date.getDay() + 7) % 7))
  return localDateString(date)
}

function localDateString(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatMeetingDate(value: string) {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!matched) return value
  return `${Number(matched[1])}년 ${Number(matched[2])}월 ${Number(matched[3])}일`
}

function numberValue(value: string) {
  const parsed = Number(value.replace(/,/g, '').trim())
  return Number.isFinite(parsed) ? parsed : null
}

function textNumber(value: number | null) {
  return value == null ? '' : String(value)
}

function won(value: number | null) {
  return value == null ? '-' : `₩ ${value.toLocaleString('ko-KR')}`
}

function omitFile(files: Record<string, File>, clientId: string) {
  const remaining = { ...files }
  delete remaining[clientId]
  return remaining
}

function operatorDrafts(operators: NewProductOperator[]) {
  return operators.length > 0
    ? operators.map((operator) => ({ memberUserId: operator.memberUserId, displayName: operator.displayName }))
    : [{ memberUserId: '', displayName: '' }]
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '처리 중 오류가 발생했습니다.'
}
