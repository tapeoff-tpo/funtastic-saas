import Link from 'next/link'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getUserMenuAccess } from '@/lib/auth/menu-access'
import { MENU_PATHS, canAccessPage } from '@/lib/auth/menu-permissions'

export default async function AccessDeniedPage() {
  const user = await getCurrentUser()
  const access = user ? await getUserMenuAccess(user.id) : null
  const destination = access ? MENU_PATHS.find((path) => canAccessPage(access, path)) : null
  return <div className="mx-auto max-w-lg space-y-4 rounded-xl border p-6">
    <h1 className="text-xl font-semibold">접근 권한이 없습니다</h1>
    <p className="text-sm text-muted-foreground">이 메뉴를 사용하려면 최고관리자에게 메뉴 권한을 요청해주세요.</p>
    <Link href={destination ?? '/settings/account'} className="inline-block rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">
      {destination ? '허용된 메뉴로 이동' : '내 계정 설정'}
    </Link>
  </div>
}
