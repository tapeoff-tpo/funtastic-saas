import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ user: vi.fn(), authorization: vi.fn(), signOut: vi.fn() }))
vi.mock('@/lib/auth/current-user', () => ({ getCurrentUser: mocks.user }))
vi.mock('@/lib/auth/menu-access', () => ({ getUserAuthorization: mocks.authorization }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { signOut: mocks.signOut } }) }))
vi.mock('@/components/layout/app-shell', () => ({ AppShell: () => null }))
vi.mock('next/navigation', () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`) } }))
import AuthLayout from './layout'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.user.mockResolvedValue({ id: 'staff', mustChangePassword: false })
  mocks.authorization.mockResolvedValue({ deactivatedAt: null, access: { superAdmin: false, allowedMenus: ['/inventory'] } })
})
describe('single-query authenticated layout guard', () => {
  it('passes current permissions with one authorization lookup', async () => {
    const view = await AuthLayout({ children: 'content' })
    expect(view.props.menuAccess).toEqual({ superAdmin: false, allowedMenus: ['/inventory'] })
    expect(mocks.authorization).toHaveBeenCalledExactlyOnceWith('staff')
  })
  it('still signs out deactivated users and fails closed for missing authorization', async () => {
    mocks.authorization.mockResolvedValue({ deactivatedAt: new Date(), access: null })
    await expect(AuthLayout({ children: null })).rejects.toThrow('redirect:/login?reason=deactivated')
    expect(mocks.signOut).toHaveBeenCalledTimes(1)
    mocks.authorization.mockResolvedValue(null)
    await expect(AuthLayout({ children: null })).rejects.toThrow('redirect:/login')
  })
  it('retains forced password changes and anonymous redirects', async () => {
    mocks.user.mockResolvedValue({ id: 'staff', mustChangePassword: true })
    await expect(AuthLayout({ children: null })).rejects.toThrow('redirect:/change-password')
    mocks.user.mockResolvedValue(null)
    await expect(AuthLayout({ children: null })).rejects.toThrow('redirect:/login')
  })
})
