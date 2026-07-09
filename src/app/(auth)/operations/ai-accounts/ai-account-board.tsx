'use client'

import { useMemo, useState } from 'react'
import { ChevronDown, Copy, MessageSquare, Plus, Save, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import {
  addAiAccountMessageAction,
  addAiAccountUserCandidateAction,
  deleteAiAccountUserCandidateAction,
  updateAiAccountLimitsAction,
} from './actions'

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
  if (status === 'limit_reached' || status === 'needs_check') return 'border-red-200 bg-red-50 text-red-700'
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

export function AiAccountBoard({
  accounts,
  messages,
  userCandidates,
  statusLabels,
}: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(accounts[0]?.id ?? null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [periodByAccount, setPeriodByAccount] = useState<Record<string, 'AM' | 'PM'>>(() => {
    return accounts.reduce<Record<string, 'AM' | 'PM'>>((acc, account) => {
      acc[account.id] = account.fiveHourLimitPeriod === 'AM' ? 'AM' : 'PM'
      return acc
    }, {})
  })
  const userCandidateNames = useMemo(() => userCandidates.map((candidate) => candidate.name), [userCandidates])
  const messagesByAccount = useMemo(() => {
    return messages.reduce<Record<string, AiAccountMessage[]>>((acc, message) => {
      acc[message.accountId] = acc[message.accountId] || []
      acc[message.accountId].push(message)
      return acc
    }, {})
  }, [messages])

  async function copyAccountId(account: AiAccountRow) {
    if (!account.email) return
    await navigator.clipboard.writeText(account.email)
    setCopiedId(account.id)
    window.setTimeout(() => setCopiedId((current) => current === account.id ? null : current), 1200)
  }

  return (
    <section className="rounded-md border bg-background">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div>
          <h2 className="text-base font-semibold">계정 목록</h2>
          <p className="text-xs text-muted-foreground">총 {accounts.length}개</p>
        </div>
      </div>

      <div className="border-b px-4 py-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h3 className="text-sm font-semibold">사용자 후보</h3>
            <p className="text-xs text-muted-foreground">채팅 입력창 자동완성에 표시됩니다.</p>
          </div>
          <form action={addAiAccountUserCandidateAction} className="flex gap-2">
            <Input name="name" placeholder="사용자 이름" className="h-9 w-44" required />
            <Button type="submit" className="h-9">
              <Plus className="h-4 w-4" />
              추가
            </Button>
          </form>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {userCandidates.map((candidate) => (
            <form key={candidate.id} action={deleteAiAccountUserCandidateAction} className="inline-flex items-center gap-1 rounded-full border bg-background px-2 py-1 text-xs">
              <input type="hidden" name="id" value={candidate.id} />
              <span className="font-medium">{candidate.name}</span>
              <Button type="submit" variant="ghost" size="icon" className="h-5 w-5 text-muted-foreground hover:text-destructive" title="사용자 삭제">
                <Trash2 className="h-3 w-3" />
              </Button>
            </form>
          ))}
        </div>
      </div>

      <div className="hidden border-b bg-muted/40 px-4 py-2 text-xs font-semibold text-muted-foreground md:grid md:grid-cols-[150px_minmax(220px,1fr)_120px_130px_160px_110px] md:items-center md:gap-3">
        <div>계정명</div>
        <div>계정아이디</div>
        <div>상태</div>
        <div>현재사용자</div>
        <div>한도</div>
        <div className="text-right">관리</div>
      </div>

      <div className="divide-y">
        {accounts.map((account) => {
          const isExpanded = expandedId === account.id
          const accountMessages = messagesByAccount[account.id] || []
          const datalistId = `ai-account-users-${account.id}`
          const selectedPeriod = periodByAccount[account.id] || 'PM'

          return (
            <article key={account.id}>
              <div className="grid gap-3 px-4 py-3 md:grid-cols-[150px_minmax(220px,1fr)_120px_130px_160px_110px] md:items-center md:gap-3">
                <div className="min-w-0">
                  <p className="font-semibold">{account.name}</p>
                  <p className="text-xs text-muted-foreground md:hidden">계정명</p>
                </div>
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-medium">{account.email || '-'}</span>
                    {account.email ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        title="계정 아이디 복사"
                        onClick={() => copyAccountId(account)}
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
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
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-8 gap-1"
                    onClick={() => setExpandedId(isExpanded ? null : account.id)}
                  >
                    <MessageSquare className="h-4 w-4" />
                    채팅
                    <ChevronDown className={cn('h-4 w-4 transition-transform', isExpanded && 'rotate-180')} />
                  </Button>
                </div>
              </div>

              {isExpanded ? (
                <div className="border-t bg-muted/20 px-4 py-4">
                  <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
                    <div className="space-y-3">
                      <form action={updateAiAccountLimitsAction} className="rounded-md border bg-background p-3">
                        <input type="hidden" name="accountId" value={account.id} />
                        <input type="hidden" name="fiveHourLimitPeriod" value={selectedPeriod} />
                        <h3 className="mb-3 text-sm font-semibold">한도 설정</h3>
                        <div className="grid gap-2">
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
                                    onClick={() => setPeriodByAccount((current) => ({ ...current, [account.id]: period }))}
                                  >
                                    {period}
                                  </button>
                                ))}
                              </div>
                              <Input name="fiveHourLimit" defaultValue={account.fiveHourLimit || ''} placeholder="예: Codex 5시간 한도" className="h-9" />
                            </div>
                          </label>
                          <label className="space-y-1">
                            <span className="text-xs font-medium text-muted-foreground">1주일 한도</span>
                            <Input name="weeklyLimit" defaultValue={account.weeklyLimit || ''} placeholder="예: 주간 한도" className="h-9" />
                          </label>
                          <Button type="submit" className="h-9 justify-self-start">
                            <Save className="h-4 w-4" />
                            한도 저장
                          </Button>
                        </div>
                      </form>

                      <form action={addAiAccountMessageAction} className="rounded-md border bg-background p-3">
                        <input type="hidden" name="accountId" value={account.id} />
                        <h3 className="mb-3 text-sm font-semibold">채팅 남기기</h3>
                        <div className="grid gap-2">
                          <label className="space-y-1">
                            <span className="text-xs font-medium text-muted-foreground">사용자</span>
                            <Input name="authorName" list={datalistId} placeholder="이름 선택 또는 직접 입력" className="h-9" required />
                            <datalist id={datalistId}>
                              {userCandidateNames.map((name) => (
                                <option key={name} value={name} />
                              ))}
                            </datalist>
                          </label>
                          <label className="space-y-1">
                            <span className="text-xs font-medium text-muted-foreground">내용</span>
                            <textarea
                              name="message"
                              rows={3}
                              placeholder="사용 시작, 한도 도달, 반납 예정 등 필요한 내용을 입력"
                              className="min-h-20 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                              required
                            />
                          </label>
                          <Button type="submit" className="h-9 justify-self-start">
                            <MessageSquare className="h-4 w-4" />
                            채팅 등록
                          </Button>
                        </div>
                      </form>
                    </div>

                    <div className="rounded-md border bg-background">
                      <div className="border-b px-3 py-2">
                        <h3 className="text-sm font-semibold">계정별 채팅</h3>
                      </div>
                      <div className="max-h-96 overflow-y-auto divide-y">
                        {accountMessages.length ? accountMessages.map((message) => (
                          <div key={message.id} className="px-3 py-2 text-sm">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="font-medium">{message.authorName || '시스템'}</p>
                              <span className="text-xs text-muted-foreground">{formatDateTime(message.createdAt)}</span>
                            </div>
                            <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{message.message}</p>
                          </div>
                        )) : (
                          <p className="px-3 py-6 text-sm text-muted-foreground">아직 채팅이 없습니다.</p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
            </article>
          )
        })}
      </div>
    </section>
  )
}
