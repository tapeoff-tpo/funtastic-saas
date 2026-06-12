import { eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { sidebarMenuSettings } from '@/lib/db/schema'
import type { SidebarMenuOrder } from '@/components/layout/sidebar-menu-order'

function isSidebarMenuOrder(value: unknown): value is SidebarMenuOrder {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<SidebarMenuOrder>
  return (
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
    sections: value.sections,
    items: value.items,
  }
}

export async function ensureSidebarMenuSettingsTable() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS sidebar_menu_settings (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL,
      menu_order jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `)
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS sidebar_menu_settings_user_id
    ON sidebar_menu_settings (user_id)
  `)
}

export async function getSidebarMenuOrder(userId: string): Promise<SidebarMenuOrder | null> {
  await ensureSidebarMenuSettingsTable()
  const [row] = await db
    .select({ menuOrder: sidebarMenuSettings.menuOrder })
    .from(sidebarMenuSettings)
    .where(eq(sidebarMenuSettings.userId, userId))
    .limit(1)
  return row?.menuOrder ?? null
}

export async function saveSidebarMenuOrderForUser(userId: string, order: SidebarMenuOrder) {
  await ensureSidebarMenuSettingsTable()
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
  await ensureSidebarMenuSettingsTable()
  await db
    .delete(sidebarMenuSettings)
    .where(eq(sidebarMenuSettings.userId, userId))
}
