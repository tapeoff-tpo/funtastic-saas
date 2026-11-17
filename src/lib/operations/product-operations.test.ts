import { describe, expect, it } from 'vitest'
import { canAccessPage } from '@/lib/auth/menu-permissions'
import { PRODUCT_OPERATIONS_PATH, PRODUCT_OPERATIONS_TABS, productOperationsHref } from './product-operations'

describe('product operations', () => {
  it('carries the exact SKU across every tab', () => {
    for (const tab of PRODUCT_OPERATIONS_TABS) {
      const url = new URL(productOperationsHref(tab.id, 'SKU / #가+'), 'https://test.invalid')
      expect(url.pathname).toBe(PRODUCT_OPERATIONS_PATH)
      expect(url.searchParams.get('tab')).toBe(tab.id)
      expect(url.searchParams.get('sku')).toBe('SKU / #가+')
    }
  })

  it('requires at least one corresponding menu permission', () => {
    expect(canAccessPage({ superAdmin: false, allowedMenus: ['/orders'] }, PRODUCT_OPERATIONS_PATH)).toBe(false)
    for (const tab of PRODUCT_OPERATIONS_TABS) {
      for (const menu of tab.menus) {
        expect(canAccessPage({ superAdmin: false, allowedMenus: [menu] }, PRODUCT_OPERATIONS_PATH)).toBe(true)
      }
    }
  })
})
