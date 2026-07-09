'use client'

import { useMemo, useState } from 'react'
import { ChevronDown, Copy, MessageSquare, Save, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import {
  addAiAccountMessageAction,
  deleteAiAccountUserCandidateAction,
  updateAiAccountLimitsAction,
} from './actions'

const CHAT_MESSAGE_TYPES = ['사용시작', '사용종료', '사용종료(5시간초과)', '사용종료(주간초과)', '직접입력'] as const

type AiAccountRow = {
  id: string
  name: string
  email: string | null
  status: string
  currentUserName: string | null
  fiveHourLimit: string | null
  fiveHourLimitPeriod: string | null
  weeklyLimit: string | null
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

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value))
}

function parseFiveHourLimit(value: string | null) {
  const match = value?.match(/(\d{1,2})\s*:\s*(\d{1,2})/)
  return {
    hour: match?.[1]?.padStart(2, '0') || '',
    minute: match?.[2]?.padStart(2, '0') || '',
  }
}

function parseWeeklyLimit(value: string | null) {
  const percent = value?.match(/(\d{1,3})\s*%/)?.[1] || ''
  const date = value?.match(/\d{4}-\d{2}-\d{2}/)?.[0] || ''
  return { percent, date }
}

export function AiAccountBoard({
  accounts,
  messages,
  userCandidates,
  statusLabels,
}: Props) {
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(accounts[0]?.id ?? null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [selectedUsersByAccount, setSelectedUsersByAccount] = useState<Record<string, string[]>>({})
  const [periodByAccount, setPeriodByAccount] = useState<Record<string, 'AM' | 'PM'>>(() => {
    return accounts.reduce<Record<string, 'AM' | 'PM'>>((acc, account) => {
      acc[account.id] = account.fiveHourLimitPeriod === 'AM' ? 'AM' : 'PM'
      return acc
    }, {})
  })

  const selectedAccount = accounts.find((account) => account.id === selectedAccountId) || accounts[0] || null
  const selectedUsers = selectedAccount ? selectedUsersByAccount[selectedAccount.id] || [] : []
  const selectedPeriod = selectedAccount ? periodByAccount[selectedAccount.id] || 'PM' : 'PM'
  const selectedFiveHourLimit = parseFiveHourLimit(selectedAccount?.fiveHourLimit || null)
  const selectedWeeklyLimit = parseWeeklyLimit(selectedAccount?.weeklyLimit || null)
  const messagesByAccount = useMemo(() => {
    return messages.reduce<Record<string, AiAccountMessage[]>>((acc, message) => {
      acc[message.accountId] = acc[message.accountId] || []
      acc[message.accountId].push(message)
      return acc
    }, {})
  }, [messages])
  const selectedMessages = selectedAccount ? messagesByAccount[selectedAccount.id] || [] : []

  async function copyAccountId(account: AiAccountRow) {
    if (!account.email) return
    await navigator.clipboard.writeText(account.email)
    setCopiedId(account.id)
    window.setTimeout(() => setCopiedId((current) => current === account.id ? null : current), 1200)
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

      {userCandidates.map((candidate) => (
        <form key={candidate.id} id={`delete-ai-user-${candidate.id}`} action={deleteAiAccountUserCandidateAction} className="hidden">
          <input type="hidden" name="id" value={candidate.id} />
        </form>
      ))}

      <div className="grid gap-0 xl:grid-cols-[minmax(720px,760px)_minmax(480px,1fr)]">
        <div className="min-w-0 border-b xl:border-b-0 xl:border-r">
          <div className="hidden border-b bg-muted/40 px-3 py-2 text-xs font-semibold text-muted-foreground md:grid md:grid-cols-[96px_minmax(230px,1fr)_86px_110px_128px] md:items-center md:gap-2">
            <div>계정명</div>
            <div>계정아이디</div>
            <div>상태</div>
            <div>현재사용자</div>
            <div>한도</div>
          </div>

          <div className="divide-y">
            {accounts.map((account) => {
              const isSelected = selectedAccount?.id === account.id

              return (
                <div
                  key={account.id}
                  role="button"
                  tabIndex={0}
                  className={cn(
                    'cursor-pointer',
                    'grid w-full gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/50 md:grid-cols-[96px_minmax(230px,1fr)_86px_110px_128px] md:items-center md:gap-2',
                    isSelected && 'bg-muted',
                  )}
                  onClick={() => setSelectedAccountId(account.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      setSelectedAccountId(account.id)
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
                    <Badge variant="outline" className={cn('rounded-full', statusClassName(account.status))}>
                      {statusLabels[account.status] || account.status}
                    </Badge>
                  </div>
                  <div className="text-sm">
                    <p className="font-medium">{account.currentUserName || '-'}</p>
                    <p className="text-xs text-muted-foreground md:hidden">현재사용자</p>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    <p>{account.fiveHourLimit ? `${account.fiveHourLimitPeriod || 'PM'} ${account.fiveHourLimit}` : '5시간 한도 미설정'}</p>
                    <p>{account.weeklyLimit || '1주일 한도 미설정'}</p>
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
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-base font-semibold">{selectedAccount.name}</h3>
                    <p className="truncate text-sm text-muted-foreground">{selectedAccount.email || '-'}</p>
                  </div>
                  <Badge variant="outline" className={cn('rounded-full', statusClassName(selectedAccount.status))}>
                    {statusLabels[selectedAccount.status] || selectedAccount.status}
                  </Badge>
                </div>
              </div>

              <form key={`limits-${selectedAccount.id}`} action={updateAiAccountLimitsAction} className="rounded-md border bg-background p-3">
                <input type="hidden" name="accountId" value={selectedAccount.id} />
                <input type="hidden" name="fiveHourLimitPeriod" value={selectedPeriod} />
                <h3 className="mb-3 text-sm font-semibold">한도 설정</h3>
                <div className="grid gap-2 xl:grid-cols-[max-content_minmax(360px,1fr)_auto] xl:items-end">
                  <label className="space-y-1">
                    <span className="text-xs font-medium text-muted-foreground">5시간 한도</span>
                    <div className="flex gap-2">
                      <div className="grid grid-cols-2 overflow-hidden rounded-md border">
                        {(['AM', 'PM'] as const).map((period) => (
                          <button
                            key={period}
                            type="button"
                            className={cn(
                              'h-9 px-3 text-xs font-semibold transition-colors',
                              selectedPeriod === period ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:bg-muted',
                            )}
                            onClick={() => setPeriodByAccount((current) => ({ ...current, [selectedAccount.id]: period }))}
                          >
                            {period}
                          </button>
                        ))}
                      </div>
                      <div className="flex items-center gap-1">
                        <Input
                          name="fiveHourHour"
                          defaultValue={selectedFiveHourLimit.hour}
                          type="number"
                          min="0"
                          max="23"
                          placeholder="00"
                          className="h-9 w-14 text-center"
                        />
                        <span className="text-sm font-semibold text-muted-foreground">:</span>
                        <Input
                          name="fiveHourMinute"
                          defaultValue={selectedFiveHourLimit.minute}
                          type="number"
                          min="0"
                          max="59"
                          placeholder="00"
                          className="h-9 w-14 text-center"
                        />
                      </div>
                    </div>
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-medium text-muted-foreground">1주일 한도</span>
                    <div className="grid grid-cols-[90px_minmax(0,1fr)] gap-2">
                      <div className="relative">
                        <Input
                          name="weeklyRemainingPercent"
                          defaultValue={selectedWeeklyLimit.percent}
                          type="number"
                          min="0"
                          max="100"
                          placeholder="잔여"
                          className="h-9 pr-7"
                        />
                        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
                      </div>
                      <Input name="weeklyLimitDate" type="date" defaultValue={selectedWeeklyLimit.date} className="h-9" />
                    </div>
                  </label>
                  <Button type="submit" className="h-9 justify-self-start">
                    <Save className="h-4 w-4" />
                    한도 저장
                  </Button>
                </div>
              </form>

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
                              <Button
                                type="submit"
                                form={`delete-ai-user-${candidate.id}`}
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                                title="사용자 삭제"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
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
