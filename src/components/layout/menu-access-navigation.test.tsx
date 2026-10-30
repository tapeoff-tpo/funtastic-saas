import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { Sidebar, navSections } from './sidebar'
import { TabBar } from './tab-bar'
import { MENU_PATHS } from '@/lib/auth/menu-permissions'

const mocks = vi.hoisted(() => ({ access: { superAdmin: false, allowedMenus: ['/purchasing/china-shipments'] as string[] | null } }))
vi.mock('./menu-access-provider', () => ({ useMenuAccess: () => mocks.access }))
vi.mock('next/navigation', () => ({ usePathname: () => '/purchasing/china-shipments', useRouter: () => ({ prefetch: vi.fn() }) }))
vi.mock('@/app/(auth)/actions', () => ({ signOut: vi.fn() }))
vi.mock('./nav-state', async () => ({
  ...(await vi.importActual<typeof import('./nav-state')>('./nav-state')),
  useNavState: () => ({ favorites: ['/costs', '/purchasing/china-shipments'], toggleFavorite: vi.fn(), isFavorite: () => false,
    tabs: [{ href: '/costs', label: '품목' }, { href: '/purchasing/china-shipments', label: '중국출고' }], closeTab: vi.fn() }),
}))
vi.mock('./sidebar-menu-order', () => ({ applySidebarMenuOrder: (sections: unknown) => sections, readSidebarMenuOrder: () => null, fetchSidebarMenuOrder: async () => null, SIDEBAR_MENU_ORDER_EVENT: 'test-menu-order' }))

describe('permission-aware navigation', () => {
  beforeEach(() => { mocks.access = { superAdmin: false, allowedMenus: ['/purchasing/china-shipments'] } })
  it('filters desktop and mobile menus, including saved favorites', () => {
    const { rerender } = render(<Sidebar />)
    expect(screen.getAllByRole('link', { name: '중국출고' }).length).toBeGreaterThan(0)
    expect(screen.queryByText('품목')).not.toBeInTheDocument()
    expect(screen.queryByText('계정관리')).not.toBeInTheDocument()
    expect(screen.queryByText('매출분석')).not.toBeInTheDocument()
    rerender(<Sidebar mobile />)
    expect(screen.queryByText('품목')).not.toBeInTheDocument()
  })
  it('filters persisted tabs and sends Home to an allowed page', () => {
    render(<TabBar />)
    expect(screen.queryByText('품목')).not.toBeInTheDocument()
    expect(screen.getAllByTitle('중국출고')[0]).toHaveAttribute('href', '/purchasing/china-shipments')
  })
  it('never loses known sidebar menu entries from the permission catalogue', () => {
    for (const item of navSections.flatMap((section) => section.items)) {
      if (item.href.startsWith('/admin/')) continue
      expect(MENU_PATHS).toContain(item.href)
    }
  })
  it('keeps selected children visible when their parent menu is not granted', () => {
    mocks.access.allowedMenus = ['/products/mapping-codes']
    render(<Sidebar />)
    fireEvent.click(screen.getByRole('button', { name: '주문관련' }))
    expect(screen.getByText('매핑코드 마스터')).toBeInTheDocument()
    expect(screen.queryByText('상품 관리')).not.toBeInTheDocument()
  })
})
