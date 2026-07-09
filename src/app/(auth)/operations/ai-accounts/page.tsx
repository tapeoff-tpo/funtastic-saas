import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { Activity, AtSign, Clock3, UsersRound } from 'lucide-react'
import { AiAccountForm } from './ai-account-form'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getCurrentUser } from '@/lib/auth/current-user'
import { cn } from '@/lib/utils'
import {
  AI_ACCOUNT_STATUS_LABELS,
  listAiAccounts,
  listRecentAiAccountMessages,
} from '@/lib/operations/ai-accounts'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'AI 계정공유',
}

function statusClassName(status: string) {
  if (status === 'in_use') return 'border-blue-200 bg-blue-50 text-blue-700'
  if (status === 'limit_warning') return 'border-amber-200 bg-amber-50 text-amber-700'
  if (status === 'limit_reached' || status === 'needs_check') return 'border-red-200 bg-red-50 text-red-700'
  return 'border-emerald-200 bg-emerald-50 text-emerald-700'
}

function formatDateTime(value: Date | string) {
  return new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value))
}

export default async function AiAccountsPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const workspaceUserId = await getWorkspaceUserId(user.id)
  const [accounts, messages] = await Promise.all([
    listAiAccounts(workspaceUserId),
    listRecentAiAccountMessages(workspaceUserId),
  ])
  const availableCount = accounts.filter((account) => account.status === 'available').length
  const inUseCount = accounts.filter((account) => account.status === 'in_use').length
  const attentionCount = accounts.filter((account) => account.status === 'limit_warning' || account.status === 'limit_reached' || account.status === 'needs_check').length

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">AI 계정공유</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            공용 GPT 계정별 아이디와 사용 상태를 한 화면에서 관리합니다.
          </p>
        </div>
      </header>

      <section className="grid gap-3 md:grid-cols-3">
        <Card size="sm" className="rounded-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <UsersRound className="h-4 w-4 text-muted-foreground" />
              전체 계정
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{accounts.length}</p>
          </CardContent>
        </Card>
        <Card size="sm" className="rounded-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Activity className="h-4 w-4 text-muted-foreground" />
              사용 가능
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold text-emerald-700">{availableCount}</p>
          </CardContent>
        </Card>
        <Card size="sm" className="rounded-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Clock3 className="h-4 w-4 text-muted-foreground" />
              사용 중 / 확인
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{inUseCount} / {attentionCount}</p>
          </CardContent>
        </Card>
      </section>

      <AiAccountForm />

      <section className="rounded-md border bg-background">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <h2 className="text-base font-semibold">계정 목록</h2>
            <p className="text-xs text-muted-foreground">총 {accounts.length}개</p>
          </div>
        </div>
        <div className="divide-y">
          {accounts.map((account) => (
            <article key={account.id} className="grid gap-3 px-4 py-3 md:grid-cols-[160px_minmax(220px,1fr)_120px_140px] md:items-center">
              <div className="min-w-0">
                <p className="font-semibold">{account.name}</p>
                <p className="text-xs text-muted-foreground">계정명</p>
              </div>
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <AtSign className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate font-medium">{account.email || '-'}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">계정 아이디</p>
              </div>
              <div>
                <Badge variant="outline" className={cn('rounded-full', statusClassName(account.status))}>
                  {AI_ACCOUNT_STATUS_LABELS[account.status] || account.status}
                </Badge>
              </div>
              <div className="text-sm">
                <p className="font-medium">{account.currentUserName || '-'}</p>
                <p className="text-xs text-muted-foreground">현재 사용자</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="rounded-md border bg-background">
        <div className="border-b px-4 py-3">
          <h2 className="text-base font-semibold">최근 기록</h2>
        </div>
        <div className="divide-y">
          {messages.length ? messages.map((message) => (
            <div key={message.id} className="flex flex-col gap-1 px-4 py-3 text-sm md:flex-row md:items-center md:justify-between">
              <p>{message.message}</p>
              <span className="text-xs text-muted-foreground">{formatDateTime(message.createdAt)}</span>
            </div>
          )) : (
            <p className="px-4 py-6 text-sm text-muted-foreground">아직 기록이 없습니다.</p>
          )}
        </div>
      </section>
    </div>
  )
}
