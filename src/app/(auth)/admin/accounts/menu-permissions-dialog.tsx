'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { MENU_PATHS, MENU_PERMISSION_GROUPS } from '@/lib/auth/menu-permissions'
import { saveMenuPermissions } from '@/lib/admin-accounts/actions'

export function MenuPermissionsDialog({ account, onClose }: {
  account: { id: string; email: string; allowedMenus: string[] | null }
  onClose: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const router = useRouter()
  const [unrestricted, setUnrestricted] = useState(account.allowedMenus === null)
  const [selected, setSelected] = useState<string[]>(account.allowedMenus ?? [...MENU_PATHS])
  const [pending, startTransition] = useTransition()
  useEffect(() => { ref.current?.showModal() }, [])

  function toggle(path: string, checked: boolean) {
    setSelected((current) => checked ? [...new Set([...current, path])] : current.filter((item) => item !== path))
  }

  return <dialog ref={ref} onCancel={(event) => { if (pending) event.preventDefault() }} onClose={onClose}
    aria-labelledby="menu-permissions-title" className="fixed inset-0 m-auto max-h-[90dvh] w-[min(48rem,95vw)] rounded-xl border bg-background p-0 text-foreground shadow-xl backdrop:bg-black/40">
    <form onSubmit={(event) => {
      event.preventDefault()
      startTransition(async () => {
        try {
          const result = await saveMenuPermissions({ targetId: account.id, allowedMenus: unrestricted ? null : selected })
          if (!result.success) { toast.error(result.error); return }
          toast.success('메뉴 권한을 저장했습니다.')
          router.refresh()
          ref.current?.close()
        } catch { toast.error('권한 저장에 실패했습니다. 다시 시도해주세요.') }
      })
    }}>
      <div className="sticky top-0 z-10 space-y-2 border-b bg-background p-4">
        <h2 id="menu-permissions-title" className="text-lg font-semibold">메뉴 권한</h2>
        <p className="break-all text-sm text-muted-foreground">{account.email}</p>
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={unrestricted} disabled={pending} onChange={(event) => setUnrestricted(event.target.checked)} />
          전체 메뉴 허용 · 앞으로 추가되는 메뉴 포함
        </label>
        <p className="text-xs text-muted-foreground">체크한 메뉴의 조회·등록·수정을 허용합니다. 계정관리와 권한 변경은 최고관리자 전용입니다.</p>
      </div>
      <fieldset disabled={pending || unrestricted} className="space-y-4 p-4 disabled:opacity-50">
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setSelected([...MENU_PATHS])}>모두 선택</Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setSelected([])}>선택 해제</Button>
          <span className="self-center text-xs text-muted-foreground">{selected.length}개 선택</span>
        </div>
        {MENU_PERMISSION_GROUPS.map((group) => <div key={group.title} className="rounded-lg border p-3">
          <label className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" checked={group.items.every(([path]) => selected.includes(path))}
              onChange={(event) => {
                const paths = group.items.map(([path]) => path as string)
                setSelected((current) => event.target.checked ? [...new Set([...current, ...paths])] : current.filter((path) => !paths.includes(path)))
              }} />{group.title}
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            {group.items.map(([path, label]) => <label key={path} className="flex min-h-8 items-center gap-2 text-sm">
              <input type="checkbox" checked={selected.includes(path)} onChange={(event) => toggle(path, event.target.checked)} />{label}
            </label>)}
          </div>
        </div>)}
      </fieldset>
      <div className="sticky bottom-0 flex justify-end gap-2 border-t bg-background p-4">
        <Button type="button" variant="outline" disabled={pending} onClick={() => ref.current?.close()}>취소</Button>
        <Button type="submit" disabled={pending}>{pending ? '저장 중…' : '권한 저장'}</Button>
      </div>
    </form>
  </dialog>
}
