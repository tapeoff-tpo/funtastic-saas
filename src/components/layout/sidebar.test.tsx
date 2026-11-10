import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Sidebar } from './sidebar'

const prefetch = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useRouter: () => ({ prefetch }),
}))
vi.mock('@/app/(auth)/actions', () => ({ signOut: vi.fn() }))
vi.mock('./nav-state', () => ({
  useNavState: () => ({ favorites: [], toggleFavorite: vi.fn(), isFavorite: () => false }),
}))
vi.mock('./sidebar-menu-order', () => ({
  applySidebarMenuOrder: (sections: unknown) => sections,
  readSidebarMenuOrder: () => null,
  fetchSidebarMenuOrder: async () => null,
  SIDEBAR_MENU_ORDER_EVENT: 'test-menu-order',
}))

describe('Sidebar navigation prefetch', () => {
  beforeEach(() => { prefetch.mockReset(); vi.useFakeTimers() })
  afterEach(() => vi.useRealTimers())

  it('waits for intent and warms again after expiry', () => {
    render(<Sidebar />)
    const link = screen.getByRole('link', { name: '대시보드' })
    fireEvent.mouseEnter(link); fireEvent.focus(link)
    expect(prefetch).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(120))
    expect(prefetch).toHaveBeenCalledExactlyOnceWith('/analytics/overview')
    act(() => vi.advanceTimersByTime(15_000))
    fireEvent.mouseEnter(link)
    act(() => vi.advanceTimersByTime(120))
    expect(prefetch).toHaveBeenCalledTimes(2)
  })

  it('does not load routes when the pointer briefly crosses them', () => {
    render(<Sidebar />)
    const link = screen.getByRole('link', { name: '대시보드' })
    fireEvent.mouseEnter(link); fireEvent.mouseLeave(link)
    act(() => vi.advanceTimersByTime(200))
    expect(prefetch).not.toHaveBeenCalled()
  })
})

it('follows the sourcing-to-sales workflow without duplicate menu destinations', async () => {
  const { navSections } = await import('./sidebar')
  const routes = navSections.flatMap(section => section.items.map(item => item.href))
  const flow = ['/operations/sourcing', '/purchasing/orders', '/purchasing/china-inventory', '/inventory', '/costs', '/analytics/price-table', '/operations/detail-pages', '/operations/marketplace-registration', '/operations/coupang-registration', '/analytics/channels']
  for (let i = 1; i < flow.length; i++) expect(routes.indexOf(flow[i])).toBeGreaterThan(routes.indexOf(flow[i - 1]))
  expect(new Set(routes).size).toBe(routes.length)
})
