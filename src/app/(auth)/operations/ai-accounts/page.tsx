import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { Activity, Clock3, UsersRound } from 'lucide-react'
import { AiAccountBoard } from './ai-account-board'
import { AiAccountForm } from './ai-account-form'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getCurrentUser } from '@/lib/auth/current-user'
import {
  AI_ACCOUNT_STATUS_LABELS,
  listAiAccountMessages,
  listAiAccounts,
  listAiAccountUserCandidates,
} from '@/lib/operations/ai-accounts'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'AI 계정공유',
}

export default async function AiAccountsPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const workspaceUserId = await getWorkspaceUserId(user.id)
  const [accounts, messages, userCandidates] = await Promise.all([
    listAiAccounts(workspaceUserId),
    listAiAccountMessages(workspaceUserId),
    listAiAccountUserCandidates(workspaceUserId),
  ])
  const availableCount = accounts.filter((account) => account.status === 'available').length
  const inUseCount = accounts.filter((account) => account.status === 'in_use').length
  const attentionCount = accounts.filter((account) => account.status === 'limit_warning' || account.status === 'limit_reached' || account.status === 'weekly_limit_reached' || account.status === 'needs_check').length

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">AI 계정공유</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            공용 GPT/Codex 계정의 사용자 배정과 주간 한도 상태를 관리합니다.
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

      <AiAccountForm
        userCandidates={userCandidates.map((candidate) => ({
          id: candidate.id,
          name: candidate.name,
        }))}
      />

      <AiAccountBoard
        accounts={accounts.map((account) => ({
          id: account.id,
          name: account.name,
          email: account.email,
          secondaryEmail: account.secondaryEmail,
          status: account.status,
          currentUserName: account.currentUserName,
          weeklyLimit: account.weeklyLimit,
          weeklyResetAt: account.weeklyResetAt?.toISOString() || null,
        }))}
        messages={messages.map((message) => ({
          id: message.id,
          accountId: message.accountId,
          authorName: message.authorName,
          eventType: message.eventType,
          message: message.message,
          createdAt: message.createdAt.toISOString(),
        }))}
        userCandidates={userCandidates.map((candidate) => ({
          id: candidate.id,
          name: candidate.name,
        }))}
        statusLabels={AI_ACCOUNT_STATUS_LABELS}
      />
    </div>
  )
}
