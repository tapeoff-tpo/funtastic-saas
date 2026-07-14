import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { AiAccountBoard } from './ai-account-board'
import { AiAccountForm } from './ai-account-form'
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
  const mappedUsers = userCandidates.map((candidate) => ({
    id: candidate.id,
    name: candidate.name,
  }))

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">AI 계정공유</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            공용 GPT/Codex 계정의 로그인 정보와 사용자를 관리합니다.
          </p>
        </div>
        <AiAccountForm userCandidates={mappedUsers} />
      </header>

      <AiAccountBoard
        accounts={accounts.map((account) => ({
          id: account.id,
          name: account.name,
          email: account.email,
          secondaryEmail: account.secondaryEmail,
          status: account.status,
          currentUserName: account.currentUserName,
          weeklyResetAt: account.weeklyResetAt?.toISOString() || null,
          notes: account.notes,
        }))}
        messages={messages.map((message) => ({
          id: message.id,
          accountId: message.accountId,
          authorName: message.authorName,
          eventType: message.eventType,
          message: message.message,
          createdAt: message.createdAt.toISOString(),
        }))}
        userCandidates={mappedUsers}
        statusLabels={AI_ACCOUNT_STATUS_LABELS}
      />
    </div>
  )
}
