import { redirect } from 'next/navigation'
import { createClient } from '@/lib/auth/server'
import { getProfile, getWorkspaceUserId, listAdmins } from '@/lib/admin-accounts/queries'
import { AccountsTable } from './accounts-table'
import { CreateAccountDialog } from './create-account-dialog'
import { db } from '@/lib/db'
import { userMenuPermissions } from '@/lib/db/schema'

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
  const workspaceOwnerId = await getWorkspaceUserId(me.id)
  const permissions = await db.select().from(userMenuPermissions)
  const menuPermissions = Object.fromEntries(permissions.map((row) => [row.userId, row.allowedMenus]))

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">계정관리</h1>
        </div>
        <CreateAccountDialog />
      </div>

      <AccountsTable accounts={accounts} currentUserId={me.id} workspaceOwnerId={workspaceOwnerId} canDeleteAccounts={process.env.AUTH_PROVIDER === 'local'} menuPermissions={menuPermissions} />
    </div>
  )
}
