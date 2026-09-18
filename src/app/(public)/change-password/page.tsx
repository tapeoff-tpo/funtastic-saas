import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getProfile } from '@/lib/admin-accounts/queries'
import { ChangePasswordForm } from '@/app/(auth)/settings/account/change-password-form'

export const dynamic = 'force-dynamic'

export default async function ForcedPasswordChangePage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const profile = await getProfile(user.id)
  if (!profile || profile.deactivatedAt) {
    const supabase = await createClient()
    await supabase.auth.signOut()
    redirect('/login?reason=deactivated')
  }

  if (!user.mustChangePassword) redirect('/dashboard')

  return (
    <div className="w-full max-w-md rounded-lg bg-white p-8 shadow-md">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">비밀번호 변경 필요</h1>
        <p className="mt-2 text-sm text-gray-500">
          관리자 초기화 후 첫 로그인입니다. 계속하려면 새 비밀번호를 설정해주세요.
        </p>
      </div>
      <ChangePasswordForm forceChange />
    </div>
  )
}
