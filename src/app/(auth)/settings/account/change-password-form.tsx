'use client'

import { useTransition, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { changeOwnPassword } from '@/lib/admin-accounts/actions'

export function ChangePasswordForm() {
  const [pending, startTransition] = useTransition()
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')

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
        toast.success('비밀번호 변경 완료')
        setPw('')
        setPw2('')
      } else {
        toast.error(res.error)
      }
    })
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-lg border p-4">
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
