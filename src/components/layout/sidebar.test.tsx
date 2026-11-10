import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Sidebar } from './sidebar'

const { prefetch, saveOrder } = vi.hoisted(() => ({ prefetch: vi.fn(), saveOrder: vi.fn() }))
vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useRouter: () => ({ prefetch }),
}))
vi.mock('@/app/(auth)/actions', () => ({ signOut: vi.fn() }))
vi.mock('./nav-state', () => ({
  useNavState: () => ({ favorites: [], toggleFavorite: vi.fn(), isFavorite: () => false }),
}))
vi.mock('./sidebar-menu-order', async (importOriginal) => ({
  ...await importOriginal<typeof import('./sidebar-menu-order')>(),
  readSidebarMenuOrder: () => null,
  fetchSidebarMenuOrder: async () => null,
  SIDEBAR_MENU_ORDER_EVENT: 'test-menu-order',
  saveSidebarMenuOrderRemote: saveOrder,
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

it('drags a menu item within its category and saves the new account order', async () => {
  saveOrder.mockReset().mockResolvedValue(undefined)
  render(<Sidebar />)
  const grip = await screen.findByRole('button', { name: '발주 순서 변경' })
  const first = screen.getByRole('link', { name: '발주검토' })
  const moved = screen.getByRole('link', { name: '발주', exact: true })
  const dataTransfer = { setData: vi.fn(), effectAllowed: 'none', dropEffect: 'none' }
  fireEvent.dragStart(grip, { dataTransfer })
  fireEvent.dragOver(first, { dataTransfer })
  fireEvent.drop(first, { dataTransfer })

  expect(moved.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(saveOrder).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    items: expect.objectContaining({
      purchasing: ['/purchasing/orders', '/purchasing/purchases', '/purchasing/payment-flow', '/purchasing/raw-data', '/purchasing/overdue'],
    }),
  }))
  await waitFor(() => expect(grip).toHaveAttribute('aria-disabled', 'false'))
})

it('moves a category with the grip arrow keys and restores its order if saving fails', async () => {
  saveOrder.mockReset().mockRejectedValue(new Error('저장 실패'))
  render(<Sidebar />)
  const grip = await screen.findByRole('button', { name: '발주·입고 순서 변경' })
  const before = screen.getByRole('link', { name: '소싱' })
  const moved = screen.getByRole('link', { name: '발주검토' })
  fireEvent.keyDown(grip, { key: 'ArrowUp' })

  expect(moved.compareDocumentPosition(before) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(saveOrder).toHaveBeenCalledOnce()
  expect(saveOrder.mock.calls[0][0].sections.slice(0, 2)).toEqual(['purchasing', 'product-preparation'])
  await waitFor(() => expect(before.compareDocumentPosition(moved) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy())
})

it('reorders items inside a nested menu group without moving them to another group', async () => {
  saveOrder.mockReset().mockResolvedValue(undefined)
  render(<Sidebar />)
  fireEvent.click(screen.getByRole('button', { name: '주문관련', exact: true }))
  const grip = await screen.findByRole('button', { name: '주문 수집 순서 변경' })
  const first = screen.getByRole('link', { name: '전체 주문' })
  const otherGroup = screen.getByRole('link', { name: '상품검수/CS' })
  const dataTransfer = { setData: vi.fn(), effectAllowed: 'none', dropEffect: 'none' }
  fireEvent.dragStart(grip, { dataTransfer })
  fireEvent.drop(otherGroup, { dataTransfer })
  expect(saveOrder).not.toHaveBeenCalled()
  fireEvent.drop(first, { dataTransfer })

  expect(screen.getByRole('link', { name: '주문 수집' }).compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(saveOrder.mock.calls[0][0].items['order-related'].slice(0, 4)).toEqual(['/orders/collect', '/orders', '/shipping/held', '/cs'])
  await waitFor(() => expect(grip).toHaveAttribute('aria-disabled', 'false'))
})
