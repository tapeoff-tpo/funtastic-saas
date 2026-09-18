'use client'

import { useTransition, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { changeOwnPassword } from '@/lib/admin-accounts/actions'

export function ChangePasswordForm({ forceChange = false }: { forceChange?: boolean }) {
  const [pending, startTransition] = useTransition()
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const router = useRouter()

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (pw.length < 8) {
      toast.error('비밀번호는 최소 8자 이상이어야 합니다')
      return
    }
    if (pw !== pw2) {
      toast.error('비밀번호 확인이 일치하지 않습니다')
      return
    }
    startTransition(async () => {
      const res = await changeOwnPassword({ newPassword: pw })
      if (res.success) {
        setPw('')
        setPw2('')
        if (res.data?.requiresFreshLogin) {
          toast.success('비밀번호가 변경되었습니다. 새 비밀번호로 다시 로그인해주세요.')
          router.replace('/login?reason=password_changed')
          return
        }

        toast.success('비밀번호 변경 완료')
        if (forceChange) router.replace('/dashboard')
      } else {
        toast.error(res.error)
      }
    })
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-lg border p-4">
      {forceChange && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          초기화 비밀번호는 계속 사용할 수 없습니다. 새 비밀번호를 설정해주세요.
        </p>
      )}
      <div>
        <Label htmlFor="pw">새 비밀번호</Label>
        <Input
          id="pw"
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          required
          minLength={8}
          autoComplete="new-password"
        />
        <p className="mt-1 text-xs text-muted-foreground">최소 8자</p>
      </div>
      <div>
        <Label htmlFor="pw2">비밀번호 확인</Label>
        <Input
          id="pw2"
          type="password"
          value={pw2}
          onChange={(e) => setPw2(e.target.value)}
          required
          autoComplete="new-password"
        />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? '변경 중...' : '비밀번호 변경'}
      </Button>
    </form>
  )
}
