import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
  beforeEach(() => prefetch.mockReset())

  it('re-fetches an expired route on hover instead of disabling prefetch forever', async () => {
    render(<Sidebar />)
    const link = screen.getByRole('link', { name: '대시보드' })
    fireEvent.mouseEnter(link)
    fireEvent.focus(link)
    expect(prefetch).toHaveBeenCalledTimes(1)
    const [href, options] = prefetch.mock.calls[0]
    expect(href).toBe('/dashboard')
    act(() => options.onInvalidate())
    fireEvent.mouseEnter(link)
    expect(prefetch).toHaveBeenCalledTimes(2)
  })

  it('starts loading a mobile destination when it is touched', () => {
    render(<Sidebar mobile />)
    fireEvent.touchStart(screen.getByRole('link', { name: '대시보드' }))
    expect(prefetch).toHaveBeenCalledWith('/dashboard', expect.objectContaining({ onInvalidate: expect.any(Function) }))
  })
})
