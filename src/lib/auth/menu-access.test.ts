import { beforeEach, describe, expect, it, vi } from 'vitest'
import { assertMenuAccess, getUserMenuAccess } from './menu-access'
import { setStockAction } from '@/app/(auth)/inventory/actions'

const mocks = vi.hoisted(() => ({ user: vi.fn(), select: vi.fn(), rows: [] as Array<{ role: string; deactivatedAt: Date | null; allowedMenus: string[] | null }>, setStock: vi.fn(), client: vi.fn() }))
vi.mock('./current-user', () => ({ getCurrentUser: mocks.user }))
vi.mock('@/lib/db', () => ({ db: { select: () => {
  mocks.select()
  const builder = { from: () => builder, leftJoin: () => builder, where: () => builder, limit: async () => mocks.rows }
  return builder
} } }))
vi.mock('@/lib/auth/server', () => ({ createClient: mocks.client }))
vi.mock('@/lib/inventory/actions', () => ({ setStock: mocks.setStock }))
vi.mock('@/lib/inventory/queries', () => ({ getInventoryHistory: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), unstable_cache: (fn: unknown) => fn }))

describe('server menu guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.user.mockResolvedValue({ id: 'staff-id', mustChangePassword: false })
    mocks.rows = [{ role: 'admin', deactivatedAt: null, allowedMenus: ['/purchasing/china-shipments'] }]
  })
  it('uses the signing-in identity permissions, not the shared workspace owner', async () => {
    await expect(assertMenuAccess('/purchasing/china-shipments')).resolves.toBeUndefined()
    await expect(assertMenuAccess('/inventory')).rejects.toThrow('권한')
  })
  it('rejects a cross-page Server Action before any business mutation or auth client work', async () => {
    await expect(setStockAction(new FormData())).rejects.toThrow('권한')
    expect(mocks.setStock).not.toHaveBeenCalled()
    expect(mocks.client).not.toHaveBeenCalled()
  })
  it('fails closed for absent, deactivated or password-reset identities', async () => {
    mocks.rows = []
    await expect(assertMenuAccess('/inventory')).rejects.toThrow('권한')
    mocks.rows = [{ role: 'admin', deactivatedAt: new Date(), allowedMenus: null }]
    expect(await getUserMenuAccess('staff-id')).toBeNull()
    mocks.rows[0].deactivatedAt = null
    mocks.user.mockResolvedValue({ id: 'staff-id', mustChangePassword: true })
    await expect(assertMenuAccess('/inventory')).rejects.toThrow('권한')
  })
  it('keeps super admin access even when an old restricted list exists', async () => {
    mocks.rows = [{ role: 'super_admin', deactivatedAt: null, allowedMenus: [] }]
    await expect(assertMenuAccess('/admin/accounts')).resolves.toBeUndefined()
  })
  it('reuses permissions from the matching validated session without another database read', async () => {
    const access = { superAdmin: false, allowedMenus: ['/inventory'], canDeletePurchases: true }
    const user = { id: 'staff-id', mustChangePassword: false, authorization: { deactivatedAt: null, email: 'staff@example.com', access } }
    mocks.user.mockResolvedValue(user)
    expect(await getUserMenuAccess(user.id, user)).toEqual(access)
    await expect(assertMenuAccess('/inventory')).resolves.toBeUndefined()
    await expect(assertMenuAccess('/admin/accounts')).rejects.toThrow('권한')
    expect(mocks.select).not.toHaveBeenCalled()
  })
  it('does not reuse another identity permissions when an explicit user is queried', async () => {
    const other = {
      id: 'owner-id', mustChangePassword: false,
      authorization: { deactivatedAt: null, email: 'owner@example.com', access: { superAdmin: true, allowedMenus: null } },
    }
    const access = await getUserMenuAccess('staff-id', other)
    expect(access?.superAdmin).toBe(false)
    expect(access?.allowedMenus).toEqual(['/purchasing/china-shipments'])
    expect(mocks.select).toHaveBeenCalledOnce()
  })
})
