import { describe, expect, it } from 'vitest'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { canAccessApi, canAccessPage, canUseMenu, MENU_PATHS, type MenuAccess } from './menu-permissions'

const restricted: MenuAccess = { superAdmin: false, allowedMenus: ['/purchasing/china-shipments'] }
describe('menu authorization policy', () => {
  it('preserves existing admin business access and reserves account administration for super admins', () => {
    expect(MENU_PATHS.every((path) => canAccessPage({ superAdmin: false, allowedMenus: null }, path))).toBe(true)
    expect(canAccessPage({ superAdmin: false, allowedMenus: null }, '/admin/accounts')).toBe(false)
    expect(canAccessPage({ superAdmin: true, allowedMenus: [] }, '/admin/accounts')).toBe(true)
  })
  it('allows chosen menus and their details, not neighboring menus or APIs', () => {
    expect(canAccessPage(restricted, '/purchasing/china-shipments?shipmentId=1')).toBe(true)
    expect(canAccessApi(restricted, '/api/purchasing/china-shipments/1/import-documents', 'POST')).toBe(true)
    expect(canAccessApi(restricted, '/api/purchasing/items/export')).toBe(false)
    expect(canAccessPage(restricted, '/purchasing/saas-china-inventory')).toBe(false)
    expect(canAccessPage(restricted, '/dashboard')).toBe(false)
  })
  it('does not let parent menus grant separately listed children', () => {
    const access = { superAdmin: false, allowedMenus: ['/products', '/analytics', '/inventory'] }
    expect(canAccessPage(access, '/products/new')).toBe(true)
    expect(canAccessPage(access, '/products/mapping-codes')).toBe(false)
    expect(canAccessApi(access, '/api/products/mapping-codes/unmapped')).toBe(false)
    expect(canAccessPage(access, '/analytics/price-table')).toBe(false)
    expect(canAccessApi(access, '/api/inventory/adjustments/confirm', 'POST')).toBe(false)
  })
  it('rejects encoded sibling routes, traversal, prefix lookalikes and unknown future routes', () => {
    expect(canAccessPage(restricted, '/purchasing/china-shipments-old')).toBe(false)
    expect(canAccessPage(restricted, '/purchasing/china-shipments/../payment-flow')).toBe(false)
    expect(canAccessPage(restricted, '/purchasing/china-shipments%2f..%2fpayment-flow')).toBe(false)
    expect(canAccessPage(restricted, '//example.com/purchasing/china-shipments')).toBe(false)
    expect(canAccessApi(restricted, '/api/new-feature')).toBe(false)
  })
  it('keeps own account and the denial screen reachable with no business permissions', () => {
    const access = { superAdmin: false, allowedMenus: [] }
    expect(canAccessPage(access, '/settings/account')).toBe(true)
    expect(canAccessPage(access, '/access-denied')).toBe(true)
    expect(MENU_PATHS.some((path) => canUseMenu(access, path))).toBe(false)
  })
  it('shares only APIs that have legitimate consumers and keeps read-only lookups distinct', () => {
    const mapping = { superAdmin: false, allowedMenus: ['/products/mapping'] }
    expect(canAccessApi(mapping, '/api/products/mapping-codes/1', 'PATCH')).toBe(true)
    expect(canAccessApi(mapping, '/api/orders/lookup')).toBe(true)
    expect(canAccessApi(mapping, '/api/orders/1', 'DELETE')).toBe(false)
    const orders = { superAdmin: false, allowedMenus: ['/orders'] }
    expect(canAccessApi(orders, '/api/products/search', 'GET')).toBe(true)
    expect(canAccessApi(orders, '/api/products/search', 'POST')).toBe(false)
  })
  it('covers every current API family for an explicitly selected full menu list', () => {
    const root = join(process.cwd(), 'src/app/api')
    const uncovered: string[] = []
    function walk(folder: string, segments: string[]) {
      for (const entry of readdirSync(folder, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(join(folder, entry.name), [...segments, entry.name.startsWith('[') ? 'sample-id' : entry.name])
        else if (entry.name === 'route.ts') {
          const path = `/api/${segments.join('/')}`
          if (path === '/api/health' || path.startsWith('/api/debug/')) continue
          if (!canAccessApi({ superAdmin: false, allowedMenus: [...MENU_PATHS] }, path)) uncovered.push(path)
        }
      }
    }
    walk(root, [])
    expect(uncovered).toEqual([])
  })
  it('keeps shared order tools and deposit entry usable without granting their management screens', () => {
    const orders = { superAdmin: false, allowedMenus: ['/orders'] }
    expect(canAccessApi(orders, '/api/shipping/templates')).toBe(true)
    expect(canAccessPage(orders, '/shipping/templates')).toBe(false)
    expect(canAccessApi(orders, '/api/orders/collect/status')).toBe(true)
    expect(canAccessApi(orders, '/api/orders/collect', 'POST')).toBe(false)
    expect(canAccessApi(orders, '/api/products/mapping-codes', 'POST')).toBe(true)
    expect(canAccessApi(orders, '/api/products/mapping-codes/1', 'DELETE')).toBe(false)
    const finance = { superAdmin: false, allowedMenus: ['/purchasing/payment-flow'] }
    expect(canAccessApi(finance, '/api/purchasing/purchase-requests/1/bulk-payment-deposit', 'PATCH')).toBe(true)
    expect(canAccessApi(finance, '/api/purchasing/purchase-requests/bulk-delete', 'POST')).toBe(false)
  })
})
