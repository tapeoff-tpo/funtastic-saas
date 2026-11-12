import { getCurrentUser } from '@/lib/auth/current-user'
import { getUserMenuAccess } from '@/lib/auth/menu-access'
import { canUseMenu } from '@/lib/auth/menu-permissions'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'

export async function registrationWorkspace() {
  const user = await getCurrentUser()
  if (!user || user.mustChangePassword) return null
  const access = await getUserMenuAccess(user.id)
  if (!access || !canUseMenu(access, '/operations/coupang-registration')) return null
  return getWorkspaceUserId(user.id)
}
