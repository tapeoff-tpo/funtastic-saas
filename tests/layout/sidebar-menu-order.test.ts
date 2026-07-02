import { describe, expect, it } from 'vitest'
import { applySidebarMenuOrder, createSidebarMenuOrder } from '@/components/layout/sidebar-menu-order'
import { navSections } from '@/components/layout/sidebar'

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

  it('keeps new sections in their default position when they are missing from saved order', () => {
    const nextSections = [
      { id: 'dashboard', items: [{ href: '/dashboard' }] },
      { id: 'order-related', items: [{ href: '/orders' }, { href: '/orders/collect' }] },
      { id: 'purchasing', items: [{ href: '/purchasing/orders' }] },
      { id: 'admin', items: [{ href: '/settings' }] },
    ]

    const ordered = applySidebarMenuOrder(nextSections, {
      sections: ['dashboard', 'orders', 'cs', 'shipping', 'products', 'settings', 'purchasing', 'admin'],
      items: {
        dashboard: ['/dashboard'],
        orders: ['/orders'],
        settings: ['/settings'],
        purchasing: ['/purchasing/orders'],
      },
    })

    expect(ordered.map((section) => section.id)).toEqual([
      'dashboard',
      'order-related',
      'purchasing',
      'admin',
    ])
  })

  it('groups order-related menus under middle categories', () => {
    const orderRelated = navSections.find((section) => section.id === 'order-related')

    expect(orderRelated?.title).toBe('주문관련')
    expect(orderRelated?.groups?.map((group) => group.title)).toEqual([
      '주문',
      'CS',
      '출고작업',
      '상품',
      '설정',
    ])
    expect(orderRelated?.groups?.find((group) => group.title === '주문')?.items.map((item) => item.label)).toEqual([
      '전체 주문',
      '주문 수집',
      '미발송 관리',
    ])
    expect(orderRelated?.groups?.find((group) => group.title === '설정')?.items.map((item) => item.label)).toEqual([
      '마켓연동',
      '마켓설정',
    ])
  })
})
