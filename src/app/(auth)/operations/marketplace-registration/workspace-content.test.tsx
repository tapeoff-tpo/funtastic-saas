import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

const mocks = vi.hoisted(() => ({ user: vi.fn(), owner: vi.fn(), list: vi.fn(), access: vi.fn(), detail: vi.fn() }))
vi.mock('@/lib/auth/current-user', () => ({ getCurrentUser: mocks.user }))
vi.mock('@/lib/admin-accounts/queries', () => ({ getWorkspaceUserId: mocks.owner }))
vi.mock('@/lib/auth/menu-access', () => ({ assertMenuAccess: mocks.access }))
vi.mock('@/lib/operations/registration-groups', () => ({ getRegistrationCatalog: mocks.list }))
vi.mock('./catalog-controls', () => ({
  RegistrationFilters: () => <div>필터</div>,
  RegistrationProductLink: (props: { href: string; label: string; selected: boolean }) =>
    <a href={props.href} aria-current={props.selected ? 'true' : undefined}>{props.label}</a>,
}))
vi.mock('./linked-price-registration', () => ({
  LinkedPriceRegistration: (props: { rowId: string }) => {
    mocks.detail(props)
    return <div>상품 {props.rowId}</div>
  },
}))
import Page from './workspace-content'

function catalogRow(index = 1) {
  return { key: 'group-' + index, code: 'SKU-01', name: index === 1 ? '상품' : '다른 상품 ' + index,
    sku: 'SKU-01', rowId: 'row-' + index, skus: new Set(['SKU-01']), optionCount: 2, missingMalls: ['coupang'],
    rows: [{ id: 'row-' + index, productName: '상품', optionName: '옵션', rawData: {} }] }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.user.mockResolvedValue({ id: 'staff' })
  mocks.owner.mockResolvedValue('owner')
  mocks.access.mockResolvedValue(undefined)
  mocks.list.mockResolvedValue([catalogRow()])

})
afterEach(cleanup)

it('uses the price-table workspace data for the registration menu and links to the shared detail', async () => {
  render(await Page({ searchParams: Promise.resolve({ q: 'SKU-01' }) }))
  expect(mocks.list).toHaveBeenCalledWith('owner')
  const link = screen.getByRole('link', { name: '상품' })
  expect(link).toHaveAttribute('href', '/operations/marketplace-registration?q=SKU-01&row=row-1')
  expect(screen.queryByText('B2B 동기화')).not.toBeInTheDocument()
})

it('opens the same detail for row links from either entry point', async () => {
  render(await Page({ searchParams: Promise.resolve({ row: 'row-1', mall: 'coupang' }) }))
  expect(mocks.detail).toHaveBeenCalledWith(expect.objectContaining({ userId: 'owner', rowId: 'row-1', mallId: 'coupang' }))
  expect(mocks.list).toHaveBeenCalled()
  expect(screen.getByRole('region', { name: '상품 목록' })).toBeVisible()
  expect(screen.getByRole('complementary', { name: '상품 상세' })).toHaveClass('overflow-y-auto')
  expect(screen.getByRole('link', { name: '상품' })).toHaveAttribute('aria-current', 'true')
})


it('keeps the current list page when selecting a product', async () => {
  const catalog = Array.from({ length: 101 }, (_, index) => catalogRow(index + 2))
  catalog[50] = catalogRow()
  mocks.list.mockResolvedValue(catalog)
  render(await Page({ searchParams: Promise.resolve({ page: '2', q: 'SKU' }) }))
  const url = new URL(screen.getByRole('link', { name: '상품' }).getAttribute('href')!, 'https://example.com')
  expect(url.searchParams.get('page')).toBe('2')
  expect(url.searchParams.get('q')).toBe('SKU')
  expect(url.searchParams.get('row')).toBe('row-1')
})
