'use client'

import { useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  changeRole,
  resetAccountPassword,
  deactivateAccount,
  reactivateAccount,
} from '@/lib/admin-accounts/actions'
import type { UserProfile } from '@/lib/db/schema'

interface Props {
  accounts: UserProfile[]
  currentUserId: string
}

export function AccountsTable({ accounts, currentUserId }: Props) {
  const [pending, startTransition] = useTransition()

  function handleChangeRole(targetId: string, currentRole: 'admin' | 'super_admin') {
    const newRole = currentRole === 'admin' ? 'super_admin' : 'admin'
    if (!confirm(`역할을 ${currentRole} → ${newRole} 로 변경하시겠습니까?`)) return
    startTransition(async () => {
      const res = await changeRole({ targetId, newRole })
      if (res.success) toast.success('역할 변경 완료')
      else toast.error(res.error)
    })
  }

  function handleReset(targetId: string, email: string) {
    if (!confirm(`${email} 의 비밀번호를 0000으로 초기화하시겠습니까?\n다음 로그인 시 새 비밀번호를 설정해야 합니다.`)) return
    startTransition(async () => {
      const res = await resetAccountPassword({ targetId })
      if (res.success) toast.success('비밀번호가 0000으로 초기화되었습니다. 다음 로그인 시 새 비밀번호를 설정해야 합니다.')
      else toast.error(res.error)
    })
  }

  function handleDeactivate(targetId: string, email: string) {
    if (!confirm(`${email} 계정을 비활성화하시겠습니까?\n로그인이 차단됩니다.`)) return
    startTransition(async () => {
      const res = await deactivateAccount({ targetId })
      if (res.success) toast.success('비활성화 완료')
      else toast.error(res.error)
    })
  }

  function handleReactivate(targetId: string, email: string) {
    if (!confirm(`${email} 계정을 다시 활성화하시겠습니까?`)) return
    startTransition(async () => {
      const res = await reactivateAccount({ targetId })
      if (res.success) toast.success('활성화 완료')
      else toast.error(res.error)
    })
  }

  return (
    <>
      <div className="space-y-3 md:hidden">
        {accounts.map((a) => {
          const isSelf = a.id === currentUserId
          const isActive = !a.deactivatedAt
          return (
            <article key={a.id} className="rounded-lg border bg-card p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-mono text-sm font-medium">{a.email}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{a.displayName ?? '-' }{isSelf ? ' · 나' : ''}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Badge variant={a.role === 'super_admin' ? 'default' : 'secondary'}>{a.role}</Badge>
                  <Badge variant="outline" className={isActive ? 'border-green-200 text-green-700' : 'border-red-200 text-red-700'}>{isActive ? '활성' : '비활성'}</Badge>
                </div>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">생성일 {new Date(a.createdAt).toLocaleDateString('ko-KR')}</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button size="sm" variant="outline" className="h-10" disabled={pending || isSelf} onClick={() => handleChangeRole(a.id, a.role)}>역할변경</Button>
                <Button size="sm" variant="outline" className="h-10" disabled={pending || !isActive} onClick={() => handleReset(a.id, a.email)}>비번초기화</Button>
                {isActive ? (
                  <Button size="sm" variant="outline" className="col-span-2 h-10 text-red-600 hover:text-red-700" disabled={pending || isSelf} onClick={() => handleDeactivate(a.id, a.email)}>비활성화</Button>
                ) : (
                  <Button size="sm" variant="outline" className="col-span-2 h-10" disabled={pending} onClick={() => handleReactivate(a.id, a.email)}>재활성화</Button>
                )}
              </div>
            </article>
          )
        })}
        {accounts.length === 0 && <p className="rounded-lg border px-4 py-8 text-center text-sm text-muted-foreground">계정 없음</p>}
      </div>
      <div className="hidden overflow-x-auto rounded-lg border md:block">
        <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left">
          <tr>
            <th className="px-4 py-2 font-medium">이메일</th>
            <th className="px-4 py-2 font-medium">표시명</th>
            <th className="px-4 py-2 font-medium">역할</th>
            <th className="px-4 py-2 font-medium">상태</th>
            <th className="px-4 py-2 font-medium">생성일</th>
            <th className="px-4 py-2 font-medium text-right">액션</th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((a) => {
            const isSelf = a.id === currentUserId
            const isActive = !a.deactivatedAt
            return (
              <tr key={a.id} className="border-t">
                <td className="px-4 py-2 font-mono text-xs">{a.email}</td>
                <td className="px-4 py-2">{a.displayName ?? <span className="text-muted-foreground">-</span>}</td>
                <td className="px-4 py-2">
                  <Badge variant={a.role === 'super_admin' ? 'default' : 'secondary'}>
                    {a.role}
                  </Badge>
                </td>
                <td className="px-4 py-2">
                  {isActive ? (
                    <Badge variant="outline" className="text-green-700 border-green-200">활성</Badge>
                  ) : (
                    <Badge variant="outline" className="text-red-700 border-red-200">비활성</Badge>
                  )}
                  {isSelf && <span className="ml-2 text-xs text-muted-foreground">(나)</span>}
                </td>
                <td className="px-4 py-2 text-muted-foreground">
                  {new Date(a.createdAt).toLocaleDateString('ko-KR')}
                </td>
                <td className="px-4 py-2">
                  <div className="flex gap-1 justify-end flex-wrap">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending || isSelf}
                      onClick={() => handleChangeRole(a.id, a.role)}
                    >
                      역할변경
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending || !isActive}
                      onClick={() => handleReset(a.id, a.email)}
                    >
                      비번초기화
                    </Button>
                    {isActive ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending || isSelf}
                        onClick={() => handleDeactivate(a.id, a.email)}
                        className="text-red-600 hover:text-red-700"
                      >
                        비활성화
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() => handleReactivate(a.id, a.email)}
                      >
                        재활성화
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            )
          })}
          {accounts.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                계정 없음
              </td>
            </tr>
          )}
        </tbody>
        </table>
      </div>
    </>
  )
}
