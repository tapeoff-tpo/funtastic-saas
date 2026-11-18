import { beforeEach, expect, it, vi } from 'vitest'
import { registrationPriceKey } from '@/lib/analytics/price-registration-values'

const mocks = vi.hoisted(() => ({
  access: vi.fn(), user: vi.fn(), owner: vi.fn(), row: vi.fn(), write: vi.fn(), revalidate: vi.fn(),
}))
vi.mock('@/lib/auth/menu-access', () => ({ assertMenuAccess: mocks.access }))
vi.mock('@/lib/auth/current-user', () => ({ getCurrentUser: mocks.user }))
vi.mock('@/lib/admin-accounts/queries', () => ({ getWorkspaceUserId: mocks.owner }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }))
vi.mock('@/lib/db', () => ({
  db: {
    transaction: async (fn: (tx: unknown) => unknown) => fn({
      select: () => ({ from: () => ({ where: () => ({ for: mocks.row }) }) }),
      update: () => ({ set: (value: unknown) => { mocks.write(value); return { where: vi.fn() } } }),
    }),
  },
}))
import { saveMallPrice } from './price-registration-actions'
const input = { rowId: '11111111-1111-4111-8111-111111111111', mallId: 'coupang', price: '16000', previousPrice: null }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.access.mockResolvedValue(undefined)
  mocks.user.mockResolvedValue({ id: 'staff' })
  mocks.owner.mockResolvedValue('workspace')
  mocks.row.mockResolvedValue([{ sourceSheetName: '상품등록', rawData: { '쿠팡 상품번호': '12345', 'B2B 판매가': '12000' } }])
})

it('preserves product numbers and base prices when recording a manual price', async () => {
  expect(await saveMallPrice(input)).toEqual({ saved: true })
  expect(mocks.owner).toHaveBeenCalledWith('staff')
  expect(mocks.write).toHaveBeenCalledWith(expect.objectContaining({ rawData: expect.objectContaining({
    '쿠팡 상품번호': '12345', 'B2B 판매가': '12000',
    [registrationPriceKey('coupang')]: '16000',
    '__registrationEdit:priceActor:coupang': 'staff',
  }) }))
})

it('rejects a stale price without overwriting the other staff edit', async () => {
  mocks.row.mockResolvedValue([{ sourceSheetName: '상품등록', rawData: { [registrationPriceKey('coupang')]: '17000' } }])
  expect(await saveMallPrice(input)).toEqual({ error: expect.stringContaining('다른 사용자') })
  expect(mocks.write).not.toHaveBeenCalled()
})

it('does not save if menu access is denied', async () => {
  mocks.access.mockRejectedValue(new Error('접근 권한 없음'))
  expect(await saveMallPrice(input)).toEqual({ error: '접근 권한 없음' })
  expect(mocks.write).not.toHaveBeenCalled()
})
