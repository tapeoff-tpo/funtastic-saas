import { beforeEach, describe, expect, it, vi } from 'vitest'
import { validateLocalSession } from './local-session'
import { getUserMenuAccess } from './menu-access'

const mocks = vi.hoisted(() => ({ query: vi.fn(), select: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({ client: mocks.query, db: { select: mocks.select } }))
vi.mock('@/lib/db/connection-lifecycle', () => ({ keepDatabaseAliveUntilIdle: vi.fn() }))

describe('session authorization database round trips', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.query.mockResolvedValue([{ id: 'staff-id', email: 'login@example.com', profileEmail: 'staff@example.com', role: 'admin', allowedMenus: ['/inventory'], canDeletePurchases: true }])
  })

  it('validates the session and obtains current account permissions in one database query', async () => {
    const session = await validateLocalSession('a'.repeat(43))
    expect(session).toMatchObject({ id: 'staff-id', email: 'login@example.com', mustChangePassword: false, authorization: { email: 'staff@example.com' } })
    expect(await getUserMenuAccess(session!.id, session!)).toEqual({ superAdmin: false, allowedMenus: ['/inventory'], canDeletePurchases: true })
    expect(mocks.query).toHaveBeenCalledOnce()
    expect(mocks.select).not.toHaveBeenCalled()
    const query = (mocks.query.mock.calls[0][0] as TemplateStringsArray).join('?')
    expect(query).toContain('LEFT JOIN user_menu_permissions')
    expect(query).toContain('s.expires_at > now()')
    expect(query).toContain("a.approval_status = 'approved'")
    expect(query).toContain('p.deactivated_at IS NULL')
  })

  it('preserves unrestricted legacy menus and super-admin permissions', async () => {
    mocks.query.mockResolvedValue([{ id: 'owner-id', email: 'owner@example.com', profileEmail: 'owner@example.com', role: 'super_admin', allowedMenus: null, canDeletePurchases: null }])
    const session = await validateLocalSession('b'.repeat(43))
    expect(session?.authorization.access).toEqual({ superAdmin: true, allowedMenus: null, canDeletePurchases: false })
  })

  it('fails closed when the database no longer returns an active session', async () => {
    mocks.query.mockResolvedValue([])
    expect(await validateLocalSession('c'.repeat(43))).toBeNull()
    expect(mocks.query).toHaveBeenCalledOnce()
  })

  it('does not query the database for absent or malformed tokens', async () => {
    expect(await validateLocalSession()).toBeNull()
    expect(await validateLocalSession('invalid')).toBeNull()
    expect(mocks.query).not.toHaveBeenCalled()
  })
})
