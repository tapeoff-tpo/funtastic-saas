'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Dialog } from '@base-ui/react/dialog'
import {
  CalendarDays,
  ChevronLeft,
  Loader2,
  Plus,
  Save,
  Trash2,
  Users,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { calculateCnyCostKrw, type CnyKrwReferenceRate } from '@/lib/new-products/cny-cost'
import type {
  ManualSourcingItem,
  ManualSourcingReviewStatus,
  ManualShippingChargeType,
  SourcingMeeting,
  SourcingOperator,
  SourcingViewer,
} from '@/lib/operations/sourcing'
import {
  createSourcingMeetingAction,
  deleteSourcingMeetingAction,
  saveSourcingOperatorsAction,
  saveSourcingMeetingRowsAction,
  updateSourcingMeetingAction,
} from './actions'

type Props = {
  meetings: SourcingMeeting[]
  operators: SourcingOperator[]
  viewer: SourcingViewer
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
  shippingChargeType: ManualShippingChargeType
  shippingBundleQuantity: string
  exchangeRateKrw: string
  domesticSaleUrl: string
  domesticSalePrice: string
  detailPageUrl: string
  memo1: string
  memo2: string
  status: ManualSourcingReviewStatus
  passedNewProductId: string | null
}

type SheetOwner = {
  id: string | null
  displayName: string
}

const manualSourcingReviewStatusLabels: Record<ManualSourcingReviewStatus, string> = {
  passed: '통과',
  rejected: '탈락',
  hold: '보류',
}

const meetingStatusClass: Record<SourcingMeeting['status'], string> = {
  open: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  closed: 'bg-slate-100 text-slate-700 ring-slate-200',
  archived: 'bg-amber-50 text-amber-800 ring-amber-200',
}

export function SourcingBoard({ meetings, operators, viewer, exchangeRate, availableMembers }: Props) {
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null)
  const [screen, setScreen] = useState<'list' | 'sheet'>('list')
  const [activeOwnerId, setActiveOwnerId] = useState<string | null>(() => viewer.isMain ? null : viewer.operatorId)
  const selectedMeeting = meetings.find((meeting) => meeting.id === selectedMeetingId) ?? null
  const selectedOwnerId = viewer.isMain
    ? operators.some((operator) => operator.id === activeOwnerId) ? activeOwnerId : null
    : viewer.operatorId

  function openMeeting(id: string) {
    setSelectedMeetingId(id)
    setScreen('sheet')
  }

  return (
    <div className="space-y-4">
      <SourcingWorkspaceTabs
        operators={operators}
        viewer={viewer}
        activeOwnerId={selectedOwnerId}
        onChange={setActiveOwnerId}
      />
      {screen === 'sheet' && selectedMeeting ? (
        <MeetingSheet
          key={`${meetingVersion(selectedMeeting)}:${selectedOwnerId ?? 'main'}`}
          meeting={selectedMeeting}
          operators={operators}
          viewer={viewer}
          activeOwnerId={selectedOwnerId}
          exchangeRate={exchangeRate}
          onBack={() => setScreen('list')}
        />
      ) : (
        <MeetingList
          meetings={meetings}
          canCreate={viewer.isMain || Boolean(viewer.operatorId)}
          canManage={viewer.isMain}
          operators={operators}
          activeOwnerId={selectedOwnerId}
          availableMembers={availableMembers}
          exchangeRate={exchangeRate}
          onOpen={openMeeting}
        />
      )}
    </div>
  )
}

function SourcingWorkspaceTabs({ operators, viewer, activeOwnerId, onChange }: {
  operators: SourcingOperator[]
  viewer: SourcingViewer
  activeOwnerId: string | null
  onChange: (ownerId: string | null) => void
}) {
  const visibleOperators = viewer.isMain
    ? operators
    : operators.filter((operator) => operator.id === viewer.operatorId)

  return (
    <nav aria-label="소싱 등록자 작업공간" className="overflow-x-auto border-b">
      <div role="tablist" className="flex min-w-max items-end gap-1">
        {viewer.isMain ? (
          <button
            type="button"
            role="tab"
            aria-selected={!activeOwnerId}
            onClick={() => onChange(null)}
            className={cn('border-b-2 px-4 py-2.5 text-sm transition-colors', !activeOwnerId ? 'border-primary font-semibold text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}
          >
            메인
          </button>
        ) : null}
        {visibleOperators.map((operator) => (
          <button
            key={operator.id}
            type="button"
            role="tab"
            aria-selected={activeOwnerId === operator.id}
            onClick={() => onChange(operator.id)}
            className={cn('border-b-2 px-4 py-2.5 text-sm transition-colors', activeOwnerId === operator.id ? 'border-primary font-semibold text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}
          >
            {operator.displayName}
          </button>
        ))}
      </div>
    </nav>
  )
}

function MeetingList({ meetings, canCreate, canManage, operators, activeOwnerId, availableMembers, exchangeRate, onOpen }: {
  meetings: SourcingMeeting[]
  canCreate: boolean
  canManage: boolean
  operators: SourcingOperator[]
  activeOwnerId: string | null
  availableMembers: Array<{ id: string; displayName: string }>
  exchangeRate: CnyKrwReferenceRate
  onOpen: (id: string) => void
}) {
  const router = useRouter()
  const [meetingDate, setMeetingDate] = useState(nextWednesday())
  const [title, setTitle] = useState('')
  const [pending, startTransition] = useTransition()
  const visibleItemCount = (meeting: SourcingMeeting) => activeOwnerId
    ? meeting.items.filter((item) => item.ownerOperatorId === activeOwnerId).length
    : meeting.items.length
  const totalRows = meetings.reduce((total, meeting) => total + visibleItemCount(meeting), 0)

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
                    {activeOwnerId ? '이 등록자 상품' : '전체 상품'} {visibleItemCount(meeting).toLocaleString('ko-KR')}개
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
  operators: SourcingOperator[]
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
              인원 제한 없이 추가할 수 있습니다. 메인은 전체를 관리하고, 등록자는 자기 탭의 상품만 등록·수정할 수 있습니다.
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
            <Button type="button" variant="outline" className="w-full border-dashed" onClick={() => setDrafts((current) => [...current, { memberUserId: '', displayName: '' }])}><Plus />등록자 추가</Button>
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

function MeetingSheet({ meeting, operators, viewer, activeOwnerId, exchangeRate, onBack }: {
  meeting: SourcingMeeting
  operators: SourcingOperator[]
  viewer: SourcingViewer
  activeOwnerId: string | null
  exchangeRate: CnyKrwReferenceRate
  onBack: () => void
}) {
  const router = useRouter()
  const [meetingDate, setMeetingDate] = useState(meeting.meetingDate)
  const [title, setTitle] = useState(meeting.title)
  const [status, setStatus] = useState<SourcingMeeting['status']>(meeting.status)
  const [isEditing, setIsEditing] = useState(false)
  const [pending, startTransition] = useTransition()
  const selectedOwnerId = viewer.isMain ? activeOwnerId : viewer.operatorId
  const selectedOperator = operators.find((operator) => operator.id === selectedOwnerId) ?? null
  const canEdit = viewer.isMain || Boolean(viewer.operatorId)
  const showAllOperators = viewer.isMain && !selectedOwnerId
  const operatorSections = showAllOperators
    ? operators.map((operator) => ({ owner: { id: operator.id, displayName: operator.displayName }, items: meeting.items.filter((item) => item.ownerOperatorId === operator.id) }))
    : selectedOperator
      ? [{ owner: { id: selectedOperator.id, displayName: selectedOperator.displayName }, items: meeting.items.filter((item) => item.ownerOperatorId === selectedOperator.id) }]
      : []
  const unassignedItems = showAllOperators ? meeting.items.filter((item) => !item.ownerOperatorId) : []
  const visibleItemCount = showAllOperators
    ? meeting.items.length
    : selectedOwnerId
      ? meeting.items.filter((item) => item.ownerOperatorId === selectedOwnerId).length
      : 0

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
      setIsEditing(false)
      router.refresh()
    })
  }

  function toggleEditing() {
    if (isEditing) {
      setMeetingDate(meeting.meetingDate)
      setTitle(meeting.title)
      setStatus(meeting.status)
    }
    setIsEditing((current) => !current)
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
              {formatMeetingDate(meeting.meetingDate)} · {visibleItemCount.toLocaleString('ko-KR')}개 상품
            </p>
          </div>
          <div className="flex flex-wrap items-start justify-end gap-2">
            {canEdit ? <Button type="button" variant={isEditing ? 'outline' : 'default'} onClick={toggleEditing}>{isEditing ? '수정 취소' : '수정'}</Button> : null}
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-right text-sm">
              <p className="text-xs text-muted-foreground">이번 회의 기본 환율</p>
              <p className="font-semibold">1 ¥ = {exchangeRate.rate.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}원</p>
            </div>
          </div>
        </div>

        {viewer.isMain && isEditing ? (
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
          key={`${section.owner.id}:${isEditing ? 'edit' : 'view'}`}
          meetingId={meeting.id}
          owner={section.owner}
          rows={section.items}
          operators={operators}
          canAssignOwner={showAllOperators}
          isEditing={isEditing}
          exchangeRate={exchangeRate.rate}
          onChanged={() => router.refresh()}
        />
      ))}

      {unassignedItems.length > 0 ? (
        <OwnerSheet
          key={`unassigned:${isEditing ? 'edit' : 'view'}`}
          meetingId={meeting.id}
          owner={{ id: null, displayName: '미지정 · 이전 수집 데이터' }}
          rows={unassignedItems}
          operators={operators}
          canAssignOwner
          isEditing={isEditing}
          exchangeRate={exchangeRate.rate}
          allowNewRows={false}
          onChanged={() => router.refresh()}
        />
      ) : null}

      {operatorSections.length === 0 && unassignedItems.length === 0 ? (
        <section className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
          소싱 등록자가 아직 설정되지 않았습니다. 메인 탭의 등록자 설정에서 담당자를 먼저 지정해 주세요.
        </section>
      ) : null}
    </div>
  )
}

function OwnerSheet({ meetingId, owner, rows: sourceRows, operators, canAssignOwner = false, isEditing, exchangeRate, allowNewRows = true, onChanged }: {
  meetingId: string
  owner: SheetOwner
  rows: ManualSourcingItem[]
  operators: SourcingOperator[]
  canAssignOwner?: boolean
  isEditing: boolean
  exchangeRate: number
  allowNewRows?: boolean
  onChanged: () => void
}) {
  const [rows, setRows] = useState<DraftRow[]>(() => sourceRows.map((item) => rowFromItem(item, exchangeRate)))
  const [pending, startTransition] = useTransition()
  const canAddRows = isEditing && allowNewRows && Boolean(owner.id)
  const showOwnerColumn = canAssignOwner

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
        shippingChargeType: row.shippingChargeType,
        shippingBundleQuantity: row.shippingBundleQuantity,
        exchangeRateKrw: row.exchangeRateKrw,
        domesticSaleUrl: row.domesticSaleUrl,
        domesticSalePrice: row.domesticSalePrice,
        detailPageUrl: row.detailPageUrl,
        memo1: row.memo1,
        memo2: row.memo2,
        ownerOperatorId: row.ownerOperatorId,
        reviewStatus: row.status,
      })),
    })
    if (!result.success) throw new Error(result.error)

    return new Map(result.saved.map((saved) => [saved.clientId, saved.id]))
  }

  function saveAll() {
    startTransition(async () => {
      try {
        const populatedRows = rows.filter((row) => row.productName.trim())
        if (populatedRows.length === 0) {
          toast.message('상품명이 입력된 행부터 저장됩니다.')
          return
        }
        let rowsToSave = rows
        let automaticPriceCount = 0
        const priceFailures: string[] = []
        const priceTargets = populatedRows.filter((row) => !row.chinaUnitPriceCny.trim() && row.chinaPurchaseUrl.trim())
        for (const target of priceTargets) {
          const result = await lookup1688Price(target.chinaPurchaseUrl, target.productOption)
          if (result.status === 'unavailable') break
          if (result.status === 'failed') {
            priceFailures.push(`${target.productName}: ${result.message}`)
            continue
          }
          automaticPriceCount += 1
          rowsToSave = rowsToSave.map((row) => row.clientId === target.clientId
            ? { ...row, chinaUnitPriceCny: String(result.price) }
            : row)
          setRows(rowsToSave)
        }
        await persistRows(rowsToSave)
        const passedCount = populatedRows.filter((row) => row.status === 'passed').length
        toast.success(passedCount > 0
          ? `${populatedRows.length}개 상품을 저장했고, 통과 ${passedCount}개는 상품관리 1단계에 자동 등록했습니다.`
          : `${populatedRows.length}개 상품을 저장했습니다.`)
        if (automaticPriceCount > 0) toast.success(`1688 위안화 가격 ${automaticPriceCount}건을 자동 입력했습니다.`)
        if (priceFailures.length > 0) toast.warning(`가격을 자동 입력하지 못한 상품 ${priceFailures.length}건: ${priceFailures.slice(0, 3).join(' / ')}`)
        onChanged()
      } catch (error) {
        toast.error(errorMessage(error))
      }
    })
  }

  function changeReviewStatus(row: DraftRow, status: ManualSourcingReviewStatus) {
    const previousStatus = row.status
    updateRow(row.clientId, { status })
    startTransition(async () => {
      try {
        if (!row.productName.trim()) throw new Error('진행여부를 정하려면 상품명을 먼저 입력해 주세요.')
        await persistRows([{ ...row, status }])
        toast.success(status === 'passed'
          ? '통과 처리되어 상품관리 1단계에 자동 등록했습니다.'
          : `진행여부를 ${manualSourcingReviewStatusLabels[status]}로 변경했습니다.`)
        onChanged()
      } catch (error) {
        updateRow(row.clientId, { status: previousStatus })
        toast.error(errorMessage(error))
      }
    })
  }

  if (!isEditing) {
    return <ReadOnlyOwnerSheet owner={owner} rows={sourceRows} showOwnerColumn={showOwnerColumn} />
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

      <div className="w-full overflow-hidden">
        <table className="w-full table-fixed border-collapse text-xs">
          <colgroup>
            <col className="w-[3%]" />
            <col className="w-[10%]" />
            <col className="w-[6%]" />
            <col className="w-[9%]" />
            <col className="w-[6%]" />
            <col className="w-[10%]" />
            <col className="w-[5%]" />
            <col className="w-[6%]" />
            <col className="w-[8%]" />
            <col className="w-[5%]" />
            <col className="w-[8%]" />
            <col className="w-[6%]" />
            <col className="w-[6%]" />
            {showOwnerColumn ? <col className="w-[7%]" /> : null}
            <col className="w-[7%]" />
            <col className="w-[3%]" />
          </colgroup>
          <thead className="bg-muted/40 text-left text-xs font-medium text-muted-foreground">
            <tr>
              <TableHeader>순번</TableHeader>
              <TableHeader required>상품명</TableHeader>
              <TableHeader>상품 옵션</TableHeader>
              <TableHeader>1688 URL</TableHeader>
              <TableHeader>중국 위안화</TableHeader>
              <TableHeader>배송비 기준</TableHeader>
              <TableHeader>환율</TableHeader>
              <TableHeader>한국원화</TableHeader>
              <TableHeader>국내판매 링크</TableHeader>
              <TableHeader>국내판매가</TableHeader>
              <TableHeader>상세페이지 URL</TableHeader>
              <TableHeader>비고 1</TableHeader>
              <TableHeader>비고 2</TableHeader>
              {showOwnerColumn ? <TableHeader>등록자</TableHeader> : null}
              <TableHeader>진행여부</TableHeader>
              <TableHeader>정리</TableHeader>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const calculatedCost = calculateCnyCostKrw({
                chinaUnitPriceCny: numberValue(row.chinaUnitPriceCny),
                unitShippingCny: effectiveUnitShippingCny(row),
                exchangeRateKrw: numberValue(row.exchangeRateKrw),
              })
              return (
                <tr key={row.clientId} className="border-t align-top hover:bg-muted/20">
                  <TableCell className="text-center text-xs text-muted-foreground">{index + 1}</TableCell>
                  <TableCell><AutoGrowTextarea value={row.productName} onChange={(value) => updateRow(row.clientId, { productName: value })} placeholder="상품명" /></TableCell>
                  <TableCell><AutoGrowTextarea value={row.productOption} onChange={(value) => updateRow(row.clientId, { productOption: value })} placeholder="옵션" /></TableCell>
                  <TableCell><AutoGrowTextarea value={row.chinaPurchaseUrl} onChange={(value) => updateRow(row.clientId, { chinaPurchaseUrl: value })} placeholder="https://detail.1688.com/..." /></TableCell>
                  <TableCell><NumericCell value={row.chinaUnitPriceCny} onChange={(value) => updateRow(row.clientId, { chinaUnitPriceCny: value })} placeholder="¥" decimal /></TableCell>
                  <TableCell><ShippingCostCell row={row} onChange={(patch) => updateRow(row.clientId, patch)} /></TableCell>
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
                    <div className="space-y-1.5">
                      <select
                        value={row.status}
                        onChange={(event) => changeReviewStatus(row, event.target.value as ManualSourcingReviewStatus)}
                        disabled={pending}
                        className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {Object.entries(manualSourcingReviewStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                      {row.status === 'passed' && row.passedNewProductId ? <p className="text-[11px] text-emerald-700">신상품 1단계 등록됨</p> : null}
                    </div>
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
              <tr><td colSpan={showOwnerColumn ? 16 : 15} className="px-4 py-12 text-center text-sm text-muted-foreground">등록된 상품이 없습니다. {canAddRows ? '행 추가로 상품을 입력해 주세요.' : ''}</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function ReadOnlyOwnerSheet({ owner, rows, showOwnerColumn }: {
  owner: SheetOwner
  rows: ManualSourcingItem[]
  showOwnerColumn: boolean
}) {
  return (
    <section className="overflow-hidden rounded-lg border bg-card">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h3 className="text-sm font-semibold">{owner.displayName}</h3>
        <span className="text-xs text-muted-foreground">{rows.length.toLocaleString('ko-KR')}개 상품</span>
      </div>
      <div className="w-full overflow-hidden">
        <table className="w-full table-fixed border-collapse text-xs">
          <colgroup>
            <col className="w-[3%]" />
            <col className="w-[11%]" />
            <col className="w-[7%]" />
            <col className="w-[10%]" />
            <col className="w-[5%]" />
            <col className="w-[10%]" />
            <col className="w-[5%]" />
            <col className="w-[7%]" />
            <col className="w-[9%]" />
            <col className="w-[6%]" />
            <col className="w-[9%]" />
            <col className="w-[7%]" />
            <col className="w-[7%]" />
            {showOwnerColumn ? <col className="w-[7%]" /> : null}
            <col className="w-[7%]" />
          </colgroup>
          <thead className="bg-muted/40 text-left text-xs font-medium text-muted-foreground">
            <tr>
              <TableHeader>순번</TableHeader>
              <TableHeader>상품명</TableHeader>
              <TableHeader>상품 옵션</TableHeader>
              <TableHeader>1688 URL</TableHeader>
              <TableHeader>중국 위안화</TableHeader>
              <TableHeader>배송비 기준</TableHeader>
              <TableHeader>환율</TableHeader>
              <TableHeader>한국원화</TableHeader>
              <TableHeader>국내판매 링크</TableHeader>
              <TableHeader>국내판매가</TableHeader>
              <TableHeader>상세페이지 URL</TableHeader>
              <TableHeader>비고 1</TableHeader>
              <TableHeader>비고 2</TableHeader>
              {showOwnerColumn ? <TableHeader>등록자</TableHeader> : null}
              <TableHeader>진행여부</TableHeader>
            </tr>
          </thead>
          <tbody>
            {rows.map((item, index) => (
              <tr key={item.id} className="border-t align-top hover:bg-muted/20">
                <TableCell className="text-center text-xs text-muted-foreground">{index + 1}</TableCell>
                <TableCell><ReadOnlyText value={item.productName} /></TableCell>
                <TableCell><ReadOnlyText value={item.productOption} /></TableCell>
                <TableCell><ReadOnlyLink value={item.chinaPurchaseUrl} /></TableCell>
                <TableCell className="text-right tabular-nums"><ReadOnlyText value={decimalText(item.chinaUnitPriceCny)} /></TableCell>
                <TableCell><ReadOnlyShippingCost item={item} /></TableCell>
                <TableCell className="text-right tabular-nums"><ReadOnlyText value={decimalText(item.exchangeRateKrw)} /></TableCell>
                <TableCell className="text-right font-semibold tabular-nums"><ReadOnlyText value={won(item.calculatedCostKrw)} /></TableCell>
                <TableCell><ReadOnlyLink value={item.domesticSaleUrl} /></TableCell>
                <TableCell className="text-right tabular-nums"><ReadOnlyText value={won(item.domesticSalePrice)} /></TableCell>
                <TableCell><ReadOnlyLink value={item.detailPageUrl} /></TableCell>
                <TableCell><ReadOnlyText value={item.memo1} /></TableCell>
                <TableCell><ReadOnlyText value={item.memo2} /></TableCell>
                {showOwnerColumn ? <TableCell><ReadOnlyText value={item.ownerName} /></TableCell> : null}
                <TableCell><ReviewStatusBadge status={item.status} passedNewProductId={item.passedNewProductId} /></TableCell>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr><td colSpan={showOwnerColumn ? 15 : 14} className="px-4 py-12 text-center text-sm text-muted-foreground">등록된 상품이 없습니다.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function ReadOnlyText({ value }: { value: string | null | undefined }) {
  return value ? <span className="block whitespace-pre-wrap break-words leading-5">{value}</span> : <span className="text-muted-foreground">-</span>
}

function ReadOnlyLink({ value }: { value: string | null | undefined }) {
  const href = externalUrl(value)
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className="block break-all leading-5 text-primary underline underline-offset-2 hover:text-primary/80">
      {value}
    </a>
  ) : <ReadOnlyText value={value} />
}

function ReviewStatusBadge({ status, passedNewProductId }: { status: ManualSourcingReviewStatus; passedNewProductId: string | null }) {
  const className = status === 'passed'
    ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
    : status === 'rejected'
      ? 'bg-rose-50 text-rose-700 ring-rose-200'
      : 'bg-amber-50 text-amber-800 ring-amber-200'
  return (
    <div className="space-y-1">
      <span className={cn('inline-flex h-6 items-center rounded-full px-2 text-xs font-medium ring-1', className)}>{manualSourcingReviewStatusLabels[status]}</span>
      {status === 'passed' && passedNewProductId ? <p className="text-[11px] text-emerald-700">신상품 1단계 등록됨</p> : null}
    </div>
  )
}

function TableHeader({ children, required = false }: { children: React.ReactNode; required?: boolean }) {
  return <th scope="col" className="break-keep border-r px-1 py-2 align-bottom font-medium leading-4 last:border-r-0">{children}{required ? <span className="ml-0.5 text-destructive">*</span> : null}</th>
}

const SAAS_MESSAGE_SOURCE = 'funtastic-saas'
const EXTENSION_MESSAGE_SOURCE = 'funtastic-1688-extension'

type PriceLookupResult =
  | { status: 'success'; price: number }
  | { status: 'failed'; message: string }
  | { status: 'unavailable' }

function lookup1688Price(url: string, option: string): Promise<PriceLookupResult> {
  const requestId = crypto.randomUUID()
  return new Promise((resolve) => {
    let acknowledged = false
    let finished = false
    const finish = (result: PriceLookupResult) => {
      if (finished) return
      finished = true
      clearTimeout(ackTimer)
      clearTimeout(resultTimer)
      window.removeEventListener('message', receive)
      resolve(result)
    }
    const receive = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return
      const message = event.data
      if (!message || message.source !== EXTENSION_MESSAGE_SOURCE || message.requestId !== requestId) return
      if (message.type === 'FUNTASTIC_1688_PRICE_LOOKUP_ACK') {
        acknowledged = true
        return
      }
      if (message.type === 'FUNTASTIC_1688_PRICE_LOOKUP_RESULT') {
        const price = Number(message.price)
        finish(Number.isFinite(price) && price > 0
          ? { status: 'success', price }
          : { status: 'failed', message: message.message || '가격을 찾지 못했습니다.' })
        return
      }
      if (message.type === 'FUNTASTIC_1688_PRICE_LOOKUP_ERROR') {
        finish({ status: 'failed', message: message.message || '가격 조회에 실패했습니다.' })
      }
    }
    window.addEventListener('message', receive)
    const ackTimer = window.setTimeout(() => {
      if (!acknowledged) finish({ status: 'unavailable' })
    }, 800)
    const resultTimer = window.setTimeout(() => {
      finish(acknowledged
        ? { status: 'failed', message: '1688 가격 조회 응답 시간이 초과되었습니다.' }
        : { status: 'unavailable' })
    }, 55_000)
    window.postMessage({
      source: SAAS_MESSAGE_SOURCE,
      type: 'FUNTASTIC_1688_PRICE_LOOKUP_START',
      requestId,
      url,
      option,
    }, window.location.origin)
  })
}

function TableCell({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={cn('min-w-0 border-r p-1 align-top last:border-r-0', className)}>{children}</td>
}

function NumericCell({ value, onChange, placeholder, decimal = false }: {
  value: string
  onChange: (value: string) => void
  placeholder: string
  decimal?: boolean
}) {
  return <Input value={value} onChange={(event) => onChange(event.target.value)} inputMode={decimal ? 'decimal' : 'numeric'} placeholder={placeholder} className="px-1 text-right text-xs" />
}

function ShippingCostCell({ row, onChange }: { row: DraftRow; onChange: (patch: Partial<DraftRow>) => void }) {
  const effective = effectiveUnitShippingCny(row)
  return (
    <div className="space-y-1 rounded-md border border-violet-200 bg-violet-50/40 p-1">
      <select
        value={row.shippingChargeType}
        onChange={(event) => onChange({ shippingChargeType: event.target.value as ManualShippingChargeType })}
        className="h-7 w-full rounded-md border border-input bg-background px-1 text-xs"
      >
        <option value="unit">개당</option>
        <option value="bundle">묶음당</option>
        <option value="free">무료</option>
      </select>
      {row.shippingChargeType === 'unit' ? (
        <NumericCell value={row.unitShippingCny} onChange={(value) => onChange({ unitShippingCny: value })} placeholder="개당 ¥" decimal />
      ) : null}
      {row.shippingChargeType === 'bundle' ? (
        <div className="grid grid-cols-2 gap-1">
          <label><span className="block text-[9px] text-muted-foreground">묶음 수량</span><NumericCell value={row.shippingBundleQuantity} onChange={(value) => onChange({ shippingBundleQuantity: value })} placeholder="개" /></label>
          <label><span className="block text-[9px] text-muted-foreground">총배송비</span><NumericCell value={row.unitShippingCny} onChange={(value) => onChange({ unitShippingCny: value })} placeholder="¥" decimal /></label>
        </div>
      ) : null}
      <p className="border-t border-dashed border-violet-200 pt-1 text-right text-[10px] font-semibold text-violet-700">
        개당 {effective == null ? '-' : `¥${decimalText(effective)}`}
      </p>
    </div>
  )
}

function ReadOnlyShippingCost({ item }: { item: ManualSourcingItem }) {
  const effective = effectiveUnitShippingCny({
    shippingChargeType: item.shippingChargeType,
    shippingBundleQuantity: textNumber(item.shippingBundleQuantity),
    unitShippingCny: textNumber(item.unitShippingCny),
  })
  const basis = item.shippingChargeType === 'free'
    ? '무료'
    : item.shippingChargeType === 'bundle'
      ? `${item.shippingBundleQuantity?.toLocaleString('ko-KR') ?? '-'}개당 ¥${decimalText(item.unitShippingCny)}`
      : `개당 ¥${decimalText(item.unitShippingCny)}`
  return <div><p className="font-medium">{basis}</p>{item.shippingChargeType === 'bundle' ? <p className="text-[10px] text-violet-700">환산 개당 {effective == null ? '-' : `¥${decimalText(effective)}`}</p> : null}</div>
}

function effectiveUnitShippingCny(row: Pick<DraftRow, 'shippingChargeType' | 'shippingBundleQuantity' | 'unitShippingCny'>) {
  if (row.shippingChargeType === 'free') return 0
  const fee = numberValue(row.unitShippingCny)
  if (row.shippingChargeType === 'unit') return fee
  const quantity = numberValue(row.shippingBundleQuantity)
  return fee != null && quantity != null && quantity > 0 ? fee / quantity : null
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
      className="block min-h-8 w-full resize-y overflow-hidden rounded-md border border-input bg-background px-1.5 py-1.5 text-xs leading-5 break-words outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
    />
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
    shippingChargeType: item.shippingChargeType,
    shippingBundleQuantity: textNumber(item.shippingBundleQuantity),
    exchangeRateKrw: textNumber(item.exchangeRateKrw) || String(exchangeRate),
    domesticSaleUrl: item.domesticSaleUrl ?? '',
    domesticSalePrice: textNumber(item.domesticSalePrice),
    detailPageUrl: item.detailPageUrl ?? '',
    memo1: item.memo1 ?? '',
    memo2: item.memo2 ?? '',
    status: item.status,
    passedNewProductId: item.passedNewProductId,
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
    shippingChargeType: 'unit',
    shippingBundleQuantity: '',
    exchangeRateKrw: String(exchangeRate),
    domesticSaleUrl: '',
    domesticSalePrice: '',
    detailPageUrl: '',
    memo1: '',
    memo2: '',
    status: 'hold',
    passedNewProductId: null,
  }
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

function decimalText(value: number | null) {
  return value == null ? '-' : value.toLocaleString('ko-KR', { maximumFractionDigits: 2 })
}

function externalUrl(value: string | null | undefined) {
  const text = value?.trim()
  if (!text) return null
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

function operatorDrafts(operators: SourcingOperator[]) {
  return operators.length > 0
    ? operators.map((operator) => ({ memberUserId: operator.memberUserId, displayName: operator.displayName }))
    : [{ memberUserId: '', displayName: '' }]
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '처리 중 오류가 발생했습니다.'
}
