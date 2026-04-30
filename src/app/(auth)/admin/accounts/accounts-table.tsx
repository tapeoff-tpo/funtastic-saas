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
    if (!confirm(`${email} 의 비밀번호를 초기 비밀번호로 리셋하시겠습니까?`)) return
    startTransition(async () => {
      const res = await resetAccountPassword({ targetId })
      if (res.success) toast.success('비밀번호 초기화 완료')
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
    <div className="rounded-lg border">
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
  )
}
