'use client'

import { useState, useTransition } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createAccount } from '@/lib/admin-accounts/actions'
import type { UserRole } from '@/lib/db/schema'

export function CreateAccountDialog() {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  function onSubmit(formData: FormData) {
    const email = String(formData.get('email') ?? '').trim()
    const role = String(formData.get('role') ?? 'admin') as UserRole
    const displayName = String(formData.get('displayName') ?? '').trim()

    startTransition(async () => {
      const res = await createAccount({
        email,
        role,
        displayName: displayName || undefined,
      })
      if (res.success) {
        toast.success(`계정 생성 완료: ${email}`)
        setOpen(false)
      } else {
        toast.error(res.error)
      }
    })
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger
        render={(props) => (
          <Button {...props}>+ 새 관리자 추가</Button>
        )}
      />
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 bg-black/40" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[420px] rounded-lg bg-white p-6 shadow-xl">
          <Dialog.Title className="text-lg font-semibold mb-1">새 관리자 추가</Dialog.Title>
          <Dialog.Description className="text-sm text-muted-foreground mb-4">
            초기 비밀번호는 환경변수 <code className="rounded bg-muted px-1">INITIAL_USER_PASSWORD</code>로 자동 적용됩니다.
          </Dialog.Description>

          <form action={onSubmit} className="space-y-4">
            <div>
              <Label htmlFor="email">이메일</Label>
              <Input id="email" name="email" type="email" required placeholder="staff@tapeoff.kr" />
            </div>
            <div>
              <Label htmlFor="displayName">표시명 (선택)</Label>
              <Input id="displayName" name="displayName" placeholder="홍길동" />
            </div>
            <div>
              <Label htmlFor="role">역할</Label>
              <select
                id="role"
                name="role"
                defaultValue="admin"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="admin">admin (일반 관리자)</option>
                <option value="super_admin">super_admin (최고 관리자)</option>
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Dialog.Close
                render={(props) => (
                  <Button {...props} type="button" variant="outline">취소</Button>
                )}
              />
              <Button type="submit" disabled={pending}>
                {pending ? '생성 중...' : '생성'}
              </Button>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
