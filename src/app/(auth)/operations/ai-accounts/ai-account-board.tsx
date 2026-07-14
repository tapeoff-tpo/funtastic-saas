'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, Copy, Eye, EyeOff, MessageSquare, Save, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import {
  addAiAccountMessageAction,
  deleteAiAccountAction,
  readAiAccountPasswordAction,
  updateAiAccountAction,
} from './actions'

const CHAT_MESSAGE_TYPES = ['사용시작', '사용종료', '사용종료(주간소진)', '직접입력'] as const

type AiAccountRow = {
  id: string
  name: string
  email: string | null
  secondaryEmail: string | null
  status: string
  currentUserName: string | null
  weeklyResetAt: string | null
  notes: string | null
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
  if (status === 'in_use') return 'border-blue-200 bg-blue-50 text-blue-700'
  if (status === 'limit_warning') return 'border-amber-200 bg-amber-50 text-amber-700'
  if (status === 'limit_reached' || status === 'five_hour_limit_reached' || status === 'weekly_limit_reached' || status === 'needs_check') return 'border-red-200 bg-red-50 text-red-700'
  return 'border-emerald-200 bg-emerald-50 text-emerald-700'
}

function isAvailableAfterWeeklyReset(account: AiAccountRow, now: Date | null) {
  if (account.status === 'five_hour_limit_reached') return true
  if (!now || account.status !== 'weekly_limit_reached' || !account.weeklyResetAt) return false
  return now.getTime() >= new Date(account.weeklyResetAt).getTime()
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
  const [selectedUsersByAccount, setSelectedUsersByAccount] = useState<Record<string, string[]>>({})
  useEffect(() => {
    const initial = window.setTimeout(() => setNow(new Date()), 0)
    const interval = window.setInterval(() => setNow(new Date()), 60_000)
    return () => {
      window.clearTimeout(initial)
      window.clearInterval(interval)
    }
  }, [])

  const selectedAccount = accounts.find((account) => account.id === selectedAccountId) || accounts[0] || null
  const selectedUsers = selectedAccount ? selectedUsersByAccount[selectedAccount.id] || [] : []
  const messagesByAccount = useMemo(() => {
    return messages.reduce<Record<string, AiAccountMessage[]>>((acc, message) => {
      acc[message.accountId] = acc[message.accountId] || []
      acc[message.accountId].push(message)
      return acc
    }, {})
  }, [messages])
  const selectedMessages = selectedAccount ? messagesByAccount[selectedAccount.id] || [] : []
  const selectedReleased = selectedAccount ? isAvailableAfterWeeklyReset(selectedAccount, now) : false
  const selectedDisplayStatus = selectedAccount
    ? selectedReleased ? 'available' : selectedAccount.status
    : 'available'
  const selectedDisplayLabel = selectedAccount
    ? selectedReleased ? '사용가능' : statusLabels[selectedAccount.status] || selectedAccount.status
    : '사용가능'

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
      setPasswordError(result.error)
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

  function toggleSelectedUser(accountId: string, name: string) {
    setSelectedUsersByAccount((current) => {
      const selected = current[accountId] || []
      const next = selected.includes(name)
        ? selected.filter((item) => item !== name)
        : [...selected, name]
      return { ...current, [accountId]: next }
    })
  }

  function clearSelectedUsers(accountId: string) {
    window.setTimeout(() => {
      setSelectedUsersByAccount((current) => ({ ...current, [accountId]: [] }))
    }, 0)
  }

  return (
    <section className="rounded-md border bg-background">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div>
          <h2 className="text-base font-semibold">계정 목록</h2>
          <p className="text-xs text-muted-foreground">총 {accounts.length}개</p>
        </div>
      </div>

      <div className="grid gap-0 xl:grid-cols-[minmax(720px,760px)_minmax(480px,1fr)]">
        <div className="min-w-0 border-b xl:border-b-0 xl:border-r">
          <div className="hidden border-b bg-muted/40 px-3 py-2 text-xs font-semibold text-muted-foreground md:grid md:grid-cols-[96px_minmax(210px,1fr)_86px_110px_minmax(180px,1fr)] md:items-center md:gap-2">
            <div>계정명</div>
            <div>계정아이디</div>
            <div>상태</div>
            <div>현재사용자</div>
            <div>비고 / 로그인 방법</div>
          </div>

          <div className="divide-y">
            {accounts.map((account) => {
              const isSelected = selectedAccount?.id === account.id
              const isReleased = isAvailableAfterWeeklyReset(account, now)
              const displayStatus = isReleased ? 'available' : account.status
              const displayLabel = isReleased ? '사용가능' : statusLabels[account.status] || account.status
              return (
                <div
                  key={account.id}
                  role="button"
                  tabIndex={0}
                  className={cn(
                    'cursor-pointer',
                    'grid w-full gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/50 md:grid-cols-[96px_minmax(210px,1fr)_86px_110px_minmax(180px,1fr)] md:items-center md:gap-2',
                    isReleased && 'bg-emerald-50/60 hover:bg-emerald-50',
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
                    <p className="font-semibold">{account.name}</p>
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
                  <div>
                    <Badge variant="outline" className={cn('rounded-full', statusClassName(displayStatus))}>
                      {displayLabel}
                    </Badge>
                  </div>
                  <div className="text-sm">
                    <p className="font-medium">{account.currentUserName || '-'}</p>
                    <p className="text-xs text-muted-foreground md:hidden">현재사용자</p>
                  </div>
                  <div className="min-w-0 text-xs text-muted-foreground">
                    <p className="line-clamp-2 whitespace-pre-line">{account.notes || '-'}</p>
                    <p className="mt-1 md:hidden">비고 / 로그인 방법</p>
                  </div>
                </div>
              )
            })}
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

              <form action={addAiAccountMessageAction} className="rounded-md border bg-background p-3" onSubmit={() => clearSelectedUsers(selectedAccount.id)}>
                <input type="hidden" name="accountId" value={selectedAccount.id} />
                <h3 className="mb-3 text-sm font-semibold">메모 남기기</h3>
                <div className="grid gap-2">
                  <div className="grid gap-2 xl:grid-cols-[minmax(320px,520px)_150px_auto] xl:items-end">
                    <div className="space-y-1">
                      <span className="text-xs font-medium text-muted-foreground">사용자</span>
                      <details className="group relative">
                        <summary className="flex h-9 cursor-pointer list-none items-center justify-between rounded-md border bg-background px-3 text-sm">
                          <span className={cn('truncate', !selectedUsers.length && 'text-muted-foreground')}>
                            {selectedUsers.length ? selectedUsers.join(', ') : '사용자 선택'}
                          </span>
                          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
                        </summary>
                        <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-md border bg-background p-2 shadow-lg">
                          {userCandidates.map((candidate) => (
                            <div key={candidate.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted">
                              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                                <input
                                  type="checkbox"
                                  name="authorNames"
                                  value={candidate.name}
                                  checked={selectedUsers.includes(candidate.name)}
                                  onChange={(event) => {
                                    toggleSelectedUser(selectedAccount.id, candidate.name)
                                    event.currentTarget.closest('details')?.removeAttribute('open')
                                  }}
                                  className="h-4 w-4"
                                />
                                <span className="truncate">{candidate.name}</span>
                              </label>
                            </div>
                          ))}
                        </div>
                      </details>
                    </div>
                    <label className="space-y-1">
                      <span className="text-xs font-medium text-muted-foreground">상태변경</span>
                      <select
                        name="messageType"
                        defaultValue="사용시작"
                        className="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                      >
                        {CHAT_MESSAGE_TYPES.map((type) => (
                          <option key={type} value={type}>{type}</option>
                        ))}
                      </select>
                    </label>
                    <Button type="submit" className="h-9">
                      <MessageSquare className="h-4 w-4" />
                      등록
                    </Button>
                  </div>
                  <label className="space-y-1">
                    <span className="text-xs font-medium text-muted-foreground">직접 입력</span>
                    <textarea
                      name="message"
                      rows={3}
                      placeholder="필요한 내용을 수기로 입력"
                      className="min-h-20 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    />
                  </label>
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
