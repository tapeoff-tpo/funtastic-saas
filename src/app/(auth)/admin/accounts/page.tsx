import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getProfile, listAdmins } from '@/lib/admin-accounts/queries'
import { AccountsTable } from './accounts-table'
import { CreateAccountDialog } from './create-account-dialog'

export const dynamic = 'force-dynamic'

export default async function AccountsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const me = await getProfile(user.id)
  if (!me || me.role !== 'super_admin' || me.deactivatedAt) {
    redirect('/dashboard')
  }

  const accounts = await listAdmins()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">계정관리</h1>
          <p className="text-sm text-muted-foreground">
            관리자 계정 생성/역할 변경/비활성화
          </p>
        </div>
        <CreateAccountDialog />
      </div>

      <AccountsTable accounts={accounts} currentUserId={me.id} />
    </div>
  )
}
