import Link from 'next/link'
import { createClient } from '@/lib/auth/server'
import { getProfile } from '@/lib/admin-accounts/queries'
import { ChangePasswordForm } from './change-password-form'

export const dynamic = 'force-dynamic'

export default async function AccountSettingsPage() {
  const auth = await createClient()
  const { data: { user } } = await auth.auth.getUser()
  const profile = user ? await getProfile(user.id) : null

  return (
    <div className="space-y-6 max-w-md">
      <div>
        <h1 className="text-2xl font-bold">내 계정</h1>
      </div>
      <ChangePasswordForm />
      {profile?.role === 'super_admin' && !profile.deactivatedAt && (
        <Link href="/admin/accounts" className="inline-block text-sm font-medium underline underline-offset-4">계정관리</Link>
      )}
    </div>
  )
}
