import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

const mocks = vi.hoisted(() => ({ user: vi.fn(), owner: vi.fn(), list: vi.fn(), access: vi.fn(), detail: vi.fn() }))
vi.mock('@/lib/auth/current-user', () => ({ getCurrentUser: mocks.user }))
vi.mock('@/lib/admin-accounts/queries', () => ({ getWorkspaceUserId: mocks.owner }))
vi.mock('@/lib/auth/menu-access', () => ({ assertMenuAccess: mocks.access }))
vi.mock('@/lib/analytics/price-table', () => ({ listPriceTableRows: mocks.list }))
vi.mock('./linked-price-registration', () => ({
  LinkedPriceRegistration: (props: { rowId: string }) => {
    mocks.detail(props)
    return <div>상품 {props.rowId}</div>
  },
}))
import Page from './workspace-content'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.user.mockResolvedValue({ id: 'staff' })
  mocks.owner.mockResolvedValue('owner')
  mocks.access.mockResolvedValue(undefined)
  mocks.list.mockResolvedValue({
    total: 1, pageSize: 100,
    rows: [{ id: 'row-1', productCode: 'SKU-01', productName: '상품', optionName: '옵션', registeredProductName: null }],
  })
})
afterEach(cleanup)

it('uses the price-table workspace data for the registration menu and links to the shared detail', async () => {
  render(await Page({ searchParams: Promise.resolve({ q: 'SKU-01' }) }))
  expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ userId: 'owner', search: 'SKU-01', sheetName: '상품등록', sortKey: 'createdAt' }))
  const link = screen.getByRole('link', { name: '번호 관리' })
  expect(link).toHaveAttribute('href', '/operations/marketplace-registration?row=row-1&q=SKU-01')
  expect(screen.queryByText('B2B 동기화')).not.toBeInTheDocument()
})

it('opens the same detail for row links from either entry point', async () => {
  render(await Page({ searchParams: Promise.resolve({ row: 'row-1', mall: 'coupang' }) }))
  expect(mocks.detail).toHaveBeenCalledWith(expect.objectContaining({ userId: 'owner', rowId: 'row-1', mallId: 'coupang' }))
  expect(mocks.list).not.toHaveBeenCalled()
})
