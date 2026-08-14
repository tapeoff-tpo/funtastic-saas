import { eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { sidebarMenuSettings } from '@/lib/db/schema'
import { SIDEBAR_MENU_ORDER_VERSION, type SidebarMenuOrder } from '@/components/layout/sidebar-menu-order'

function isSidebarMenuOrder(value: unknown): value is SidebarMenuOrder {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<SidebarMenuOrder>
  return (
    candidate.version === SIDEBAR_MENU_ORDER_VERSION &&
    Array.isArray(candidate.sections) &&
    candidate.sections.every((section) => typeof section === 'string') &&
    Boolean(candidate.items) &&
    typeof candidate.items === 'object' &&
    Object.values(candidate.items ?? {}).every((items) => (
      Array.isArray(items) && items.every((href) => typeof href === 'string')
    ))
  )
}

export function parseSidebarMenuOrder(value: unknown): SidebarMenuOrder {
  if (!isSidebarMenuOrder(value)) {
    throw new Error('메뉴 순서 형식이 올바르지 않습니다.')
  }
  return {
    version: value.version,
    sections: value.sections,
    items: value.items,
  }
}

export async function getSidebarMenuOrder(userId: string): Promise<SidebarMenuOrder | null> {
  const [row] = await db
    .select({ menuOrder: sidebarMenuSettings.menuOrder })
    .from(sidebarMenuSettings)
    .where(eq(sidebarMenuSettings.userId, userId))
    .limit(1)
  return isSidebarMenuOrder(row?.menuOrder) ? row.menuOrder : null
}

export async function saveSidebarMenuOrderForUser(userId: string, order: SidebarMenuOrder) {
  await db
    .insert(sidebarMenuSettings)
    .values({ userId, menuOrder: order })
    .onConflictDoUpdate({
      target: sidebarMenuSettings.userId,
      set: {
        menuOrder: order,
        updatedAt: sql`now()`,
      },
    })
}

export async function deleteSidebarMenuOrderForUser(userId: string) {
  await db
    .delete(sidebarMenuSettings)
    .where(eq(sidebarMenuSettings.userId, userId))
}
