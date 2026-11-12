import { describe, expect, it } from 'vitest'
import { canAccessApi, canAccessPage, MENU_PATHS } from '@/lib/auth/menu-permissions'

describe('Coupang registration permissions', () => {
  it('exposes the dedicated menu and restricts its page, exports and drafts together', () => {
    expect(MENU_PATHS).toContain('/operations/coupang-registration')
    const access = { superAdmin: false, allowedMenus: ['/operations/coupang-registration'] }
    expect(canAccessPage(access, '/operations/coupang-registration')).toBe(true)
    expect(canAccessApi(access, '/api/operations/coupang-registration/export', 'POST')).toBe(true)
    expect(canAccessApi(access, '/api/operations/coupang-registration/drafts', 'POST')).toBe(true)
    expect(canAccessApi(access, '/api/products/export')).toBe(false)
    expect(canAccessPage({ superAdmin: false, allowedMenus: ['/operations/marketplace-registration'] }, '/operations/coupang-registration')).toBe(false)
  })
})
