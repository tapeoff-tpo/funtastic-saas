import { describe, expect, it } from 'vitest'
import { applySidebarMenuOrder, createSidebarMenuOrder } from '@/components/layout/sidebar-menu-order'

const sections = [
  { id: 'dashboard', items: [{ href: '/dashboard' }] },
  { id: 'orders', items: [{ href: '/orders' }, { href: '/orders/collect' }] },
  { id: 'settings', items: [{ href: '/settings' }, { href: '/settings/menu' }] },
]

describe('sidebar menu order', () => {
  it('applies saved section and item order', () => {
    const ordered = applySidebarMenuOrder(sections, {
      sections: ['dashboard', 'settings', 'orders'],
      items: {
        settings: ['/settings/menu', '/settings'],
        orders: ['/orders/collect', '/orders'],
      },
    })

    expect(ordered.map((section) => section.id)).toEqual(['dashboard', 'settings', 'orders'])
    expect(ordered[1].items.map((item) => item.href)).toEqual(['/settings/menu', '/settings'])
  })

  it('creates a complete order snapshot', () => {
    expect(createSidebarMenuOrder(sections)).toEqual({
      sections: ['dashboard', 'orders', 'settings'],
      items: {
        dashboard: ['/dashboard'],
        orders: ['/orders', '/orders/collect'],
        settings: ['/settings', '/settings/menu'],
      },
    })
  })
})
