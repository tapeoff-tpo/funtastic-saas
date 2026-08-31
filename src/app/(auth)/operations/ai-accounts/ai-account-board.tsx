'use client'

import { useMemo, useState, useTransition } from 'react'
import { Copy, Eye, EyeOff, MessageSquare, Save, Trash2 } from 'lucide-react'
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
  updateAiAccountAvailabilityAction,
  updateAiAccountLimitsAction,
  updateAiAccountOperationalStateAction,
} from './actions'

type AiAccountRow = {
  id: string
  name: string
  email: string | null
  secondaryEmail: string | null
  status: string
  currentUserName: string | null
  dailyLimit: string | null
  dailyResetTime: string | null
  weeklyLimit: string | null
  weeklyResetAt: string | null
  notes: string | null
  renewalDueOn: string | null
  resetAvailableCount: number
  sharedUse: boolean
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
  if (status === 'daily_limit_reached' || status === 'weekly_limit_reached') return 'border-red-200 bg-red-50 text-red-700'
  if (status === 'in_use') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  return 'border-slate-200 bg-slate-50 text-slate-600'
}

function normalizeStatus(status: string) {
  if (status === 'daily_limit_reached' || status === 'weekly_limit_reached' || status === 'in_use' || status === 'unselected') return status
  return 'unselected'
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

function limitPercent(value: string | null) {
  return value?.match(/(\d{1,3})\s*%/)?.[1] || ''
}

function toDateTimeLocal(value: string | null) {
  if (!value) return ''
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value)).replace(' ', 'T')
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
  const [bulkRenewalDueOn, setBulkRenewalDueOn] = useState('')
  const [bulkMessage, setBulkMessage] = useState('')
  const [bulkPending, startBulkTransition] = useTransition()
  const [inlineLimits, setInlineLimits] = useState<Record<string, {
    dailyLimit: string | null
    dailyResetTime: string | null
    weeklyLimit: string | null
    weeklyResetAt: string | null
  }>>({})
  const [savingLimitIds, setSavingLimitIds] = useState<string[]>([])
  const [limitErrors, setLimitErrors] = useState<Record<string, string>>({})
  const selectedAccount = accounts.find((account) => account.id === selectedAccountId) || accounts[0] || null
  const messagesByAccount = useMemo(() => {
    return messages.reduce<Record<string, AiAccountMessage[]>>((acc, message) => {
      acc[message.accountId] = acc[message.accountId] || []
      acc[message.accountId].push(message)
      return acc
    }, {})
  }, [messages])
  const selectedMessages = selectedAccount ? messagesByAccount[selectedAccount.id] || [] : []
  const sortedAccounts = useMemo(() => accounts
    .map((account, index) => ({ account, index }))
    .sort((left, right) => Number(right.account.sharedUse) - Number(left.account.sharedUse)
      || right.account.resetAvailableCount - left.account.resetAvailableCount
      || left.index - right.index)
    .map(({ account }) => account), [accounts])
  const sharedAccountCount = accounts.filter((account) => account.sharedUse).length
  const resetAvailableTotal = accounts.reduce((total, account) => total + account.resetAvailableCount, 0)
  const selectedDisplayStatus = normalizeStatus(selectedAccount?.status || 'unselected')
  const selectedDisplayLabel = selectedAccount
    ? statusLabels[selectedDisplayStatus]
    : '선택 안 함'

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

  function applyBulkRenewal(renewalDueOn: string) {
    setBulkRenewalDueOn(renewalDueOn)
    if (!accounts.length || !renewalDueOn) return
    setBulkMessage('')
    startBulkTransition(async () => {
      const result = await bulkUpdateAiAccountRenewalAction({
        accountIds: accounts.map((account) => account.id),
        renewalDueOn,
      })
      if ('error' in result) {
        setBulkMessage(result.error || '갱신 예정일을 변경하지 못했습니다.')
        return
      }
      setBulkMessage(`${result.count}개 계정의 갱신 예정일을 변경하고 사용자/상태를 초기화했습니다.`)
    })
  }

  function saveInlineLimits(account: AiAccountRow, formData: FormData) {
    const dailyRemainingPercent = String(formData.get('dailyRemainingPercent') || '').trim()
    const dailyResetTime = String(formData.get('dailyResetTime') || '').trim()
    const weeklyRemainingPercent = String(formData.get('weeklyRemainingPercent') || '').trim()
    const weeklyResetAt = String(formData.get('weeklyResetAt') || '').trim()
    setInlineLimits((current) => ({
      ...current,
      [account.id]: {
        dailyLimit: dailyRemainingPercent ? `잔여 ${dailyRemainingPercent}%` : null,
        dailyResetTime: dailyResetTime || null,
        weeklyLimit: weeklyRemainingPercent ? `잔여 ${weeklyRemainingPercent}%` : null,
        weeklyResetAt: weeklyResetAt ? new Date(`${weeklyResetAt}:00+09:00`).toISOString() : null,
      },
    }))
    setLimitErrors((current) => ({ ...current, [account.id]: '' }))
    setSavingLimitIds((current) => [...current, account.id])
    startBulkTransition(async () => {
      const result = await updateAiAccountLimitsAction(formData)
      setSavingLimitIds((current) => current.filter((id) => id !== account.id))
      if ('error' in result) {
        setLimitErrors((current) => ({ ...current, [account.id]: result.error || '한도를 저장하지 못했습니다.' }))
      }
    })
  }

  return (
    <section className="rounded-md border bg-background">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div>
          <h2 className="text-base font-semibold">계정 목록</h2>
          <p className="text-xs text-muted-foreground">총 {accounts.length}개 · 공유 사용 {sharedAccountCount}개 · 초기화 가능 {resetAvailableTotal}개</p>
        </div>
      </div>

      <div className="grid gap-0 xl:grid-cols-[minmax(950px,1fr)_minmax(400px,1fr)]">
        <div className="min-w-0 border-b xl:border-b-0 xl:border-r">
          <div className="border-b bg-muted/20 p-3">
            <div className="flex flex-wrap items-end gap-2">
              <label className="space-y-1">
                <span className="block text-xs font-medium text-muted-foreground">전체 계정 갱신 예정일</span>
                <Input
                  type="date"
                  value={bulkRenewalDueOn}
                  onChange={(event) => applyBulkRenewal(event.target.value)}
                  disabled={bulkPending || accounts.length === 0}
                  className="h-9 w-40 bg-background"
                />
              </label>
              <p className="pb-2 text-xs text-muted-foreground">갱신 예정일을 선택하면 {accounts.length}개 계정의 사용자와 상태도 초기화됩니다.</p>
            </div>
            {bulkMessage ? <p className="mt-2 text-xs text-muted-foreground">{bulkMessage}</p> : null}
          </div>

          <div className="overflow-x-auto">
            <div className="min-w-[950px]">
              <div className="hidden border-b bg-muted/40 px-3 py-2 text-xs font-semibold text-muted-foreground md:grid md:grid-cols-[72px_94px_90px_300px_132px_62px_74px] md:items-center md:gap-2">
                <div>계정명</div>
                <div>상태</div>
                <div>사용자</div>
                <div>갱신 예정일</div>
                <div>일/주 사용 한도 및 초기화</div>
                <div>초기화</div>
                <div>공유 사용</div>
              </div>

              <div className="divide-y">
            {sortedAccounts.map((account) => {
              const isSelected = selectedAccount?.id === account.id
              const displayStatus = normalizeStatus(account.status)
              const candidateNames = userCandidates.map((candidate) => candidate.name)
              return (
                <div
                  key={account.id}
                  role="button"
                  tabIndex={0}
                  className={cn(
                    'cursor-pointer',
                    'grid w-full gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/50 md:grid-cols-[72px_94px_90px_300px_132px_62px_74px] md:items-center md:gap-2',
                    account.sharedUse && 'bg-emerald-50/50',
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
                  <div className="min-w-0">
                    <p className="truncate whitespace-nowrap text-sm font-semibold" title={account.name}>{account.name}</p>
                    <p className="text-xs text-muted-foreground md:hidden">계정명</p>
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
                    <div className="min-w-0">
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
                        className="h-9 w-full bg-background px-2 text-xs"
                      />
                    </div>
                  </form>
                  <form
                    key={`${account.id}-${inlineLimits[account.id]?.dailyLimit || ''}-${inlineLimits[account.id]?.dailyResetTime || ''}-${inlineLimits[account.id]?.weeklyLimit || ''}-${inlineLimits[account.id]?.weeklyResetAt || ''}`}
                    className="grid grid-cols-[auto_58px_84px] items-center gap-1.5"
                    onClick={(event) => event.stopPropagation()}
                    onSubmit={(event) => {
                      event.preventDefault()
                      saveInlineLimits(account, new FormData(event.currentTarget))
                    }}
                  >
                    <input type="hidden" name="accountId" value={account.id} />
                    <span className="text-xs font-medium text-muted-foreground">일</span>
                    <div className="relative">
                      <Input name="dailyRemainingPercent" type="number" min="0" max="100" defaultValue={limitPercent(inlineLimits[account.id]?.dailyLimit ?? account.dailyLimit)} aria-label={`${account.name} 일 사용 잔여율`} className="h-8 px-2 pr-5 text-xs" />
                      <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">%</span>
                    </div>
                    <Input name="dailyResetTime" type="time" defaultValue={inlineLimits[account.id]?.dailyResetTime ?? account.dailyResetTime ?? ''} aria-label={`${account.name} 일 초기화 시각`} className="h-8 px-1.5 text-xs" />
                    <span className="text-xs font-medium text-muted-foreground">주</span>
                    <div className="relative">
                      <Input name="weeklyRemainingPercent" type="number" min="0" max="100" defaultValue={limitPercent(inlineLimits[account.id]?.weeklyLimit ?? account.weeklyLimit)} aria-label={`${account.name} 주간 사용 잔여율`} className="h-8 px-2 pr-5 text-xs" />
                      <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">%</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Input name="weeklyResetAt" type="datetime-local" defaultValue={toDateTimeLocal(inlineLimits[account.id]?.weeklyResetAt ?? account.weeklyResetAt)} aria-label={`${account.name} 주간 초기화 일시`} className="h-8 min-w-0 px-1.5 text-xs" />
                      <Button type="submit" variant="outline" size="icon" className="h-8 w-8 shrink-0" title={`${account.name} 한도 저장`} disabled={savingLimitIds.includes(account.id)}>
                        <Save className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    {limitErrors[account.id] ? <p className="col-span-3 text-xs text-destructive">{limitErrors[account.id]}</p> : null}
                  </form>
                  <form action={updateAiAccountAvailabilityAction} className="contents" onClick={(event) => event.stopPropagation()}>
                    <input type="hidden" name="accountId" value={account.id} />
                    <input type="hidden" name="changedField" value="" />
                    <select
                      name="resetAvailableCount"
                      defaultValue={String(account.resetAvailableCount)}
                      onChange={(event) => {
                        const form = event.currentTarget.form
                        const changedField = form?.elements.namedItem('changedField')
                        if (changedField instanceof HTMLInputElement) changedField.value = 'resetAvailableCount'
                        form?.requestSubmit()
                      }}
                      aria-label={`${account.name} 초기화 가능 수`}
                      className="h-9 w-full rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {[0, 1, 2, 3].map((count) => <option key={count} value={count}>{count}개</option>)}
                    </select>
                    <label className="flex h-9 items-center gap-2 rounded-md border bg-background px-2 text-xs font-medium">
                      <input
                        type="checkbox"
                        name="sharedUse"
                        value="true"
                        defaultChecked={account.sharedUse}
                        disabled={account.sharedUse}
                        onChange={(event) => {
                          const form = event.currentTarget.form
                          const changedField = form?.elements.namedItem('changedField')
                          if (changedField instanceof HTMLInputElement) changedField.value = 'sharedUse'
                          form?.requestSubmit()
                        }}
                        className="h-4 w-4"
                      />
                      {account.sharedUse ? '고정됨' : '사용 중'}
                    </label>
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
                    <label className="space-y-1">
                      <span className="text-xs font-medium text-muted-foreground">초기화 가능</span>
                      <select name="resetAvailableCount" defaultValue={String(selectedAccount.resetAvailableCount)} className="h-9 w-full rounded-md border bg-background px-3 text-sm">
                        {[0, 1, 2, 3].map((count) => <option key={count} value={count}>{count}개</option>)}
                      </select>
                    </label>
                    <label className="flex h-9 items-center gap-2 self-end rounded-md border px-3 text-sm">
                      <input type="checkbox" name="sharedUse" defaultChecked={selectedAccount.sharedUse} disabled={selectedAccount.sharedUse} className="h-4 w-4" />
                      {selectedAccount.sharedUse ? '공유 사용 고정' : '공유 사용 중'}
                    </label>
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
