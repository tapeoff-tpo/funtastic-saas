import { cache } from 'react'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { userMenuPermissions, userProfiles } from '@/lib/db/schema'
import { getCurrentUser } from './current-user'
import { canUseMenu, type MenuAccess } from './menu-permissions'

export const getUserMenuAccess = cache(async (userId: string): Promise<MenuAccess | null> => {
  const [row] = await db.select({
    role: userProfiles.role, deactivatedAt: userProfiles.deactivatedAt,
    allowedMenus: userMenuPermissions.allowedMenus,
  }).from(userProfiles)
    .leftJoin(userMenuPermissions, eq(userMenuPermissions.userId, userProfiles.id))
    .where(eq(userProfiles.id, userId)).limit(1)
  if (!row || row.deactivatedAt) return null
  return { superAdmin: row.role === 'super_admin', allowedMenus: row.allowedMenus ?? null }
})

/** Check inside the action as well: Server Action IDs can be posted to other pages. */
export async function assertMenuAccess(...menus: string[]): Promise<void> {
  const user = await getCurrentUser()
  const access = user && !user.mustChangePassword ? await getUserMenuAccess(user.id) : null
  if (!access || !menus.some((menu) => canUseMenu(access, menu))) {
    throw new Error('이 메뉴에 접근할 권한이 없습니다. 최고관리자에게 문의해주세요.')
  }
}
