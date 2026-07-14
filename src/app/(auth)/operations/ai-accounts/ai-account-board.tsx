'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { CalendarDays, Copy, Eye, EyeOff, MessageSquare, Save, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import {
  addAiAccountMessageAction,
  bulkUpdateAiAccountRenewalAction,
  deleteAiAccountAction,
  readAiAccountPasswordAction,
  updateAiAccountAction,
  updateAiAccountOperationalStateAction,
} from './actions'

type AiAccountRow = {
  id: string
  name: string
  email: string | null
  secondaryEmail: string | null
  status: string
  currentUserName: string | null
  notes: string | null
  renewalDueOn: string | null
}

type AiAccountMessage = {
  id: string
  accountId: string
  authorName: string | null
  eventType: string
  message: string
  createdAt: string
}

type Props = {
  accounts: AiAccountRow[]
  messages: AiAccountMessage[]
  userCandidates: { id: string; name: string }[]
  statusLabels: Record<string, string>
}

function statusClassName(status: string) {
  if (status === 'weekly_limit_reached') return 'border-red-200 bg-red-50 text-red-700'
  return 'border-emerald-200 bg-emerald-50 text-emerald-700'
}

function normalizeStatus(status: string) {
  return status === 'weekly_limit_reached' ? 'weekly_limit_reached' : 'in_use'
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value))
}

function renewalState(value: string | null, now: Date | null) {
  if (!value) return null
  if (!now) return { label: value, urgency: 'normal' as const }
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const due = new Date(`${value}T00:00:00`)
  const days = Math.round((due.getTime() - today.getTime()) / 86_400_000)
  if (days < 0) return { label: `D+${Math.abs(days)}`, urgency: 'overdue' as const }
  if (days === 0) return { label: '오늘', urgency: 'urgent' as const }
  if (days <= 7) return { label: `D-${days}`, urgency: 'urgent' as const }
  return { label: value, urgency: 'normal' as const }
}

export function AiAccountBoard({
  accounts,
  messages,
  userCandidates,
  statusLabels,
}: Props) {
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(accounts[0]?.id ?? null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [revealedPassword, setRevealedPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [passwordError, setPasswordError] = useState('')
  const [passwordLoading, setPasswordLoading] = useState(false)
  const [now, setNow] = useState<Date | null>(null)
  const [selectedBulkIds, setSelectedBulkIds] = useState<string[]>([])
  const [bulkRenewalDueOn, setBulkRenewalDueOn] = useState('')
  const [bulkMessage, setBulkMessage] = useState('')
  const [bulkPending, startBulkTransition] = useTransition()
  useEffect(() => {
    const initial = window.setTimeout(() => setNow(new Date()), 0)
    const interval = window.setInterval(() => setNow(new Date()), 60_000)
    return () => {
      window.clearTimeout(initial)
      window.clearInterval(interval)
    }
  }, [])

  const selectedAccount = accounts.find((account) => account.id === selectedAccountId) || accounts[0] || null
  const messagesByAccount = useMemo(() => {
    return messages.reduce<Record<string, AiAccountMessage[]>>((acc, message) => {
      acc[message.accountId] = acc[message.accountId] || []
      acc[message.accountId].push(message)
      return acc
    }, {})
  }, [messages])
  const selectedMessages = selectedAccount ? messagesByAccount[selectedAccount.id] || [] : []
  const selectedDisplayStatus = normalizeStatus(selectedAccount?.status || 'in_use')
  const selectedDisplayLabel = selectedAccount
    ? statusLabels[selectedDisplayStatus]
    : '사용 중'
  const allSelected = accounts.length > 0 && selectedBulkIds.length === accounts.length

  async function copyAccountId(account: AiAccountRow) {
    if (!account.email) return
    await navigator.clipboard.writeText(account.email)
    setCopiedId(account.id)
    window.setTimeout(() => setCopiedId((current) => current === account.id ? null : current), 1200)
  }

  function selectAccount(accountId: string) {
    setSelectedAccountId(accountId)
    setRevealedPassword('')
    setShowPassword(false)
    setPasswordError('')
  }

  async function loadPassword() {
    if (!selectedAccount) return
    if (revealedPassword) {
      setShowPassword((current) => !current)
      return
    }
    setPasswordLoading(true)
    setPasswordError('')
    const result = await readAiAccountPasswordAction(selectedAccount.id)
    setPasswordLoading(false)
    if ('error' in result) {
      setPasswordError(result.error || '비밀번호를 불러오지 못했습니다.')
      return
    }
    setRevealedPassword(result.password)
    setShowPassword(true)
  }

  async function copyPassword() {
    if (!revealedPassword) return
    await navigator.clipboard.writeText(revealedPassword)
    setCopiedId(`password-${selectedAccount?.id}`)
    window.setTimeout(() => setCopiedId(null), 1200)
  }

  function toggleBulkAccount(accountId: string) {
    setSelectedBulkIds((current) => current.includes(accountId)
      ? current.filter((id) => id !== accountId)
      : [...current, accountId])
    setBulkMessage('')
  }

  function applyBulkRenewal() {
    if (!selectedBulkIds.length || !bulkRenewalDueOn) return
    setBulkMessage('')
    startBulkTransition(async () => {
      const result = await bulkUpdateAiAccountRenewalAction({
        accountIds: selectedBulkIds,
        renewalDueOn: bulkRenewalDueOn,
      })
      if ('error' in result) {
        setBulkMessage(result.error || '갱신 예정일을 변경하지 못했습니다.')
        return
      }
      setBulkMessage(`${result.count}개 계정의 갱신 예정일을 변경했습니다.`)
      setSelectedBulkIds([])
    })
  }

  return (
    <section className="rounded-md border bg-background">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div>
          <h2 className="text-base font-semibold">계정 목록</h2>
          <p className="text-xs text-muted-foreground">총 {accounts.length}개</p>
        </div>
      </div>

      <div className="grid gap-0 xl:grid-cols-[minmax(780px,900px)_minmax(400px,1fr)]">
        <div className="min-w-0 border-b xl:border-b-0 xl:border-r">
          <div className="border-b bg-muted/20 p-3">
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex h-9 items-center gap-2 rounded-md border bg-background px-3 text-sm">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={() => setSelectedBulkIds(allSelected ? [] : accounts.map((account) => account.id))}
                  className="h-4 w-4"
                />
                전체 선택
              </label>
              <label className="space-y-1">
                <span className="block text-xs font-medium text-muted-foreground">일괄 갱신 예정일</span>
                <Input type="date" value={bulkRenewalDueOn} onChange={(event) => setBulkRenewalDueOn(event.target.value)} className="h-9 w-40 bg-background" />
              </label>
              <Button type="button" className="h-9" onClick={applyBulkRenewal} disabled={!selectedBulkIds.length || !bulkRenewalDueOn || bulkPending}>
                <CalendarDays className="h-4 w-4" />
                {bulkPending ? '적용 중' : `갱신일 적용 (${selectedBulkIds.length})`}
              </Button>
            </div>
            {bulkMessage ? <p className="mt-2 text-xs text-muted-foreground">{bulkMessage}</p> : null}
          </div>

          <div className="overflow-x-auto">
            <div className="min-w-[760px]">
              <div className="hidden border-b bg-muted/40 px-3 py-2 text-xs font-semibold text-muted-foreground md:grid md:grid-cols-[28px_88px_minmax(120px,1fr)_112px_112px_190px] md:items-center md:gap-2">
                <div />
                <div>계정명</div>
                <div>계정아이디</div>
                <div>상태</div>
                <div>사용자</div>
                <div>갱신 예정일</div>
              </div>

              <div className="divide-y">
            {accounts.map((account) => {
              const isSelected = selectedAccount?.id === account.id
              const displayStatus = normalizeStatus(account.status)
              const renewal = renewalState(account.renewalDueOn, now)
              const candidateNames = userCandidates.map((candidate) => candidate.name)
              return (
                <div
                  key={account.id}
                  role="button"
                  tabIndex={0}
                  className={cn(
                    'cursor-pointer',
                    'grid w-full gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/50 md:grid-cols-[28px_88px_minmax(120px,1fr)_112px_112px_190px] md:items-center md:gap-2',
                    isSelected && 'bg-muted',
                  )}
                  onClick={() => selectAccount(account.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      selectAccount(account.id)
                    }
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedBulkIds.includes(account.id)}
                    onChange={() => toggleBulkAccount(account.id)}
                    onClick={(event) => event.stopPropagation()}
                    aria-label={`${account.name} 계정 선택`}
                    className="h-4 w-4"
                  />
                  <div className="min-w-0">
                    <p className="truncate whitespace-nowrap text-sm font-semibold" title={account.name}>{account.name}</p>
                    <p className="text-xs text-muted-foreground md:hidden">계정명</p>
                  </div>
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-medium">{account.email || '-'}</span>
                      {account.email ? (
                        <span
                          role="button"
                          tabIndex={0}
                          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border bg-background hover:bg-muted"
                          title="계정 아이디 복사"
                          onClick={(event) => {
                            event.stopPropagation()
                            copyAccountId(account)
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              event.stopPropagation()
                              copyAccountId(account)
                            }
                          }}
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground md:hidden">
                      {copiedId === account.id ? '복사됨' : '계정아이디'}
                    </p>
                    {copiedId === account.id ? <p className="mt-1 hidden text-xs text-emerald-700 md:block">복사됨</p> : null}
                  </div>
                  <form action={updateAiAccountOperationalStateAction} className="contents" onClick={(event) => event.stopPropagation()}>
                    <input type="hidden" name="accountId" value={account.id} />
                    <input type="hidden" name="changedField" value="" />
                    <select
                      name="status"
                      defaultValue={displayStatus}
                      onChange={(event) => {
                        const form = event.currentTarget.form
                        const changedField = form?.elements.namedItem('changedField')
                        if (changedField instanceof HTMLInputElement) changedField.value = 'status'
                        form?.requestSubmit()
                      }}
                      aria-label={`${account.name} 상태`}
                      className={cn('h-9 w-full rounded-md border px-2 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring', statusClassName(displayStatus))}
                    >
                      {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                    <select
                      name="currentUserName"
                      defaultValue={account.currentUserName || ''}
                      onChange={(event) => {
                        const form = event.currentTarget.form
                        const changedField = form?.elements.namedItem('changedField')
                        if (changedField instanceof HTMLInputElement) changedField.value = 'currentUserName'
                        form?.requestSubmit()
                      }}
                      aria-label={`${account.name} 사용자`}
                      className="h-9 w-full rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <option value="">사용자 없음</option>
                      {account.currentUserName && !candidateNames.includes(account.currentUserName) ? <option value={account.currentUserName}>{account.currentUserName}</option> : null}
                      {userCandidates.map((candidate) => <option key={candidate.id} value={candidate.name}>{candidate.name}</option>)}
                    </select>
                    <div className="flex min-w-0 items-center gap-2">
                      <Input
                        name="renewalDueOn"
                        type="date"
                        defaultValue={account.renewalDueOn || ''}
                        onChange={(event) => {
                          const form = event.currentTarget.form
                          const changedField = form?.elements.namedItem('changedField')
                          if (changedField instanceof HTMLInputElement) changedField.value = 'renewalDueOn'
                          form?.requestSubmit()
                        }}
                        aria-label={`${account.name} 갱신 예정일`}
                        className="h-9 w-[132px] shrink-0 bg-background px-2 text-xs"
                      />
                      {renewal ? <span className={cn(
                        'shrink-0 whitespace-nowrap text-xs font-medium',
                        renewal.urgency === 'overdue' && 'text-red-700',
                        renewal.urgency === 'urgent' && 'text-amber-800',
                        renewal.urgency === 'normal' && 'text-muted-foreground',
                      )}>{renewal.label}</span> : null}
                    </div>
                  </form>
                </div>
              )
            })}
              </div>
            </div>
          </div>
        </div>

        <aside className="min-w-0 bg-muted/15">
          {selectedAccount ? (
            <div className="sticky top-0 space-y-3 p-4">
              <div className="rounded-md border bg-background p-3">
                <form id={`delete-ai-account-${selectedAccount.id}`} action={deleteAiAccountAction}>
                  <input type="hidden" name="accountId" value={selectedAccount.id} />
                </form>
                <form key={`account-${selectedAccount.id}`} action={updateAiAccountAction} className="space-y-3">
                  <input type="hidden" name="accountId" value={selectedAccount.id} />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold">로그인 정보</h3>
                    <Badge
                      variant="outline"
                      className={cn(
                        'h-7 justify-center rounded-full',
                        statusClassName(selectedDisplayStatus),
                      )}
                    >
                      {selectedDisplayLabel}
                    </Badge>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">계정 이름</span><Input name="name" defaultValue={selectedAccount.name} className="h-9 font-semibold" required /></label>
                    <label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">아이디</span><Input name="email" defaultValue={selectedAccount.email || ''} placeholder="메일주소 또는 전화번호" autoComplete="username" className="h-9" /></label>
                    <label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">새 비밀번호</span><Input name="password" type="password" placeholder="변경할 때만 입력" autoComplete="new-password" className="h-9" /></label>
                    <label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">추가 메일</span><Input name="secondaryEmail" defaultValue={selectedAccount.secondaryEmail || ''} placeholder="복구용 또는 추가 메일" className="h-9" /></label>
                    <label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">갱신 예정일</span><Input name="renewalDueOn" type="date" defaultValue={selectedAccount.renewalDueOn || ''} className="h-9" /></label>
                  </div>
                  <label className="block space-y-1">
                    <span className="text-xs font-medium text-muted-foreground">저장된 비밀번호</span>
                    <div className="flex gap-2">
                      <Input readOnly type={showPassword ? 'text' : 'password'} value={revealedPassword} placeholder={passwordError || '확인 버튼을 눌러 조회'} className="h-9" />
                      <Button type="button" variant="outline" className="h-9" onClick={loadPassword} disabled={passwordLoading}>
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        {passwordLoading ? '확인 중' : '확인'}
                      </Button>
                      <Button type="button" variant="outline" size="icon" className="h-9 w-9" onClick={copyPassword} disabled={!revealedPassword} title="비밀번호 복사">
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                    {copiedId === `password-${selectedAccount.id}` ? <p className="text-xs text-emerald-700">비밀번호가 복사되었습니다.</p> : null}
                  </label>
                  <label className="block space-y-1">
                    <span className="text-xs font-medium text-muted-foreground">비고 / 로그인 방법</span>
                    <textarea name="notes" rows={4} defaultValue={selectedAccount.notes || ''} placeholder="예: 네이버 간편 로그인, 인증 문자는 담당자에게 요청" className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50" />
                  </label>
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button type="submit" form={`delete-ai-account-${selectedAccount.id}`} variant="destructive" className="h-9"><Trash2 className="h-4 w-4" />계정 삭제</Button>
                    <Button type="submit" className="h-9"><Save className="h-4 w-4" />저장</Button>
                  </div>
                </form>
              </div>

              <form action={addAiAccountMessageAction} className="rounded-md border bg-background p-3">
                <input type="hidden" name="accountId" value={selectedAccount.id} />
                <h3 className="mb-3 text-sm font-semibold">메모 남기기</h3>
                <div className="flex items-end gap-2">
                  <label className="min-w-0 flex-1 space-y-1">
                    <span className="text-xs font-medium text-muted-foreground">메모</span>
                    <textarea
                      name="message"
                      rows={3}
                      placeholder="필요한 내용을 수기로 입력"
                      required
                      className="min-h-20 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    />
                  </label>
                  <Button type="submit" className="h-9">
                    <MessageSquare className="h-4 w-4" />
                    등록
                  </Button>
                </div>
              </form>

              <div className="rounded-md border bg-background">
                <div className="border-b px-3 py-2">
                  <h3 className="text-sm font-semibold">메모</h3>
                </div>
                <div className="max-h-[420px] overflow-y-auto divide-y">
                  {selectedMessages.length ? selectedMessages.map((message) => (
                    <div key={message.id} className="px-3 py-2 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-medium">{message.authorName || '시스템'}</p>
                        <span className="text-xs text-muted-foreground">{formatDateTime(message.createdAt)}</span>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{message.message}</p>
                    </div>
                  )) : (
                    <p className="px-3 py-6 text-sm text-muted-foreground">아직 메모가 없습니다.</p>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <p className="p-4 text-sm text-muted-foreground">계정을 추가하면 메모 패널이 표시됩니다.</p>
          )}
        </aside>
      </div>
    </section>
  )
}
