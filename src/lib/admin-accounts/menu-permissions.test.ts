import { beforeEach, describe, expect, it, vi } from 'vitest'
import { saveMenuPermissions } from './actions'

const mocks = vi.hoisted(() => ({
  actorRole: 'super_admin', actorInactive: false, targetRole: 'admin',
  targetId: '00000000-0000-4000-8000-000000000002',
  writes: [] as Array<Record<string, unknown>>,
  transaction: vi.fn(), revalidate: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'owner-id' } } }) } }) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }))
vi.mock('@/lib/db', () => ({ db: {
  select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ role: mocks.actorRole, deactivatedAt: mocks.actorInactive ? new Date() : null }] }) }) }),
  transaction: mocks.transaction,
} }))

describe('menu permission management', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.actorRole = 'super_admin'; mocks.actorInactive = false; mocks.targetRole = 'admin'; mocks.writes = []
    mocks.transaction.mockImplementation(async (operation) => {
      let reads = 0
      const tx = {
        select: () => {
          const rows = reads++ === 0 ? [{ id: mocks.targetId, role: mocks.targetRole }] : [{ allowedMenus: ['/orders'] }]
          return { from: () => ({ where: () => ({ for: async () => rows, then: (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve) }) }) }
        },
        insert: () => ({ values: (data: Record<string, unknown>) => {
          mocks.writes.push(data)
          return { onConflictDoUpdate: async () => undefined, then: (resolve: (value: unknown) => unknown) => Promise.resolve(undefined).then(resolve) }
        } }),
      }
      return operation(tx)
    })
  })
  it('rejects an ordinary admin and an inactive super admin before any write', async () => {
    mocks.actorRole = 'admin'
    expect((await saveMenuPermissions({ targetId: mocks.targetId, allowedMenus: null })).success).toBe(false)
    mocks.actorRole = 'super_admin'; mocks.actorInactive = true
    expect((await saveMenuPermissions({ targetId: mocks.targetId, allowedMenus: null })).success).toBe(false)
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
  it('rejects unknown menu paths and cannot restrict the super admin', async () => {
    expect((await saveMenuPermissions({ targetId: mocks.targetId, allowedMenus: ['/admin/accounts'] })).success).toBe(false)
    expect(mocks.transaction).not.toHaveBeenCalled()
    mocks.targetRole = 'super_admin'
    expect((await saveMenuPermissions({ targetId: mocks.targetId, allowedMenus: [] })).success).toBe(false)
    expect(mocks.writes).toHaveLength(0)
  })
  it('saves an identity-specific allowlist and records its before/after audit', async () => {
    expect(await saveMenuPermissions({ targetId: mocks.targetId, allowedMenus: ['/purchasing/china-shipments', '/purchasing/china-shipments'] })).toEqual({ success: true })
    expect(mocks.writes[0]).toMatchObject({ userId: mocks.targetId, updatedBy: 'owner-id', allowedMenus: ['/purchasing/china-shipments'] })
    expect(mocks.writes[1]).toMatchObject({ actorId: 'owner-id', targetId: mocks.targetId, action: 'account.menu_permissions_change', metadata: { before: ['/orders'], after: ['/purchasing/china-shipments'] } })
    expect(mocks.revalidate).toHaveBeenCalledWith('/', 'layout')
  })
  it('distinguishes zero allowed menus from unrestricted access', async () => {
    await saveMenuPermissions({ targetId: mocks.targetId, allowedMenus: [] })
    expect(mocks.writes[0].allowedMenus).toEqual([])
    mocks.writes = []
    await saveMenuPermissions({ targetId: mocks.targetId, allowedMenus: null })
    expect(mocks.writes[0].allowedMenus).toBeNull()
  })
})
