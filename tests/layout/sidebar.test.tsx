import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Sidebar } from '@/components/layout/sidebar'

let pathname = '/orders'

vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { signOut: vi.fn() },
  }),
}))

vi.mock('@/components/layout/nav-state', () => ({
  useNavState: () => ({
    favorites: [],
    toggleFavorite: vi.fn(),
    isFavorite: () => false,
  }),
}))

vi.mock('@/components/layout/sidebar-menu-order', async () => {
  const actual = await vi.importActual<typeof import('@/components/layout/sidebar-menu-order')>(
    '@/components/layout/sidebar-menu-order',
  )
  return {
    ...actual,
    fetchSidebarMenuOrder: vi.fn(async () => null),
    readSidebarMenuOrder: vi.fn(() => null),
  }
})

describe('Sidebar', () => {
  it('lets users close an active collapsible section', () => {
    pathname = '/orders'
    render(<Sidebar />)

    expect(screen.getByText('전체 주문')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '주문관련' }))

    expect(screen.queryByText('전체 주문')).not.toBeInTheDocument()
  })

  it('opens a collapsed order-related section', () => {
    pathname = '/dashboard'
    render(<Sidebar />)

    expect(screen.queryByText('전체 주문')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '주문관련' }))

    expect(screen.getByText('전체 주문')).toBeInTheDocument()
  })
})
