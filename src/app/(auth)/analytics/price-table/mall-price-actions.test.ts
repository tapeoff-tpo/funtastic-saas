import { beforeEach, expect, it, vi } from 'vitest'
import { registrationPriceKey, registrationIdentifiersKey } from '@/lib/analytics/price-registration-values'

const mocks = vi.hoisted(() => ({
  access: vi.fn(), user: vi.fn(), owner: vi.fn(), row: vi.fn(), write: vi.fn(), revalidate: vi.fn(), execute: vi.fn(),
}))
vi.mock('@/lib/auth/menu-access', () => ({ assertMenuAccess: mocks.access }))
vi.mock('@/lib/auth/current-user', () => ({ getCurrentUser: mocks.user }))
vi.mock('@/lib/admin-accounts/queries', () => ({ getWorkspaceUserId: mocks.owner }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }))
vi.mock('@/lib/db', () => ({
  db: {
    transaction: async (fn: (tx: unknown) => unknown) => fn({
      execute: mocks.execute,
      select: () => ({ from: () => ({ where: () => ({ for: mocks.row }) }) }),
      update: () => ({ set: (value: unknown) => { mocks.write(value); return { where: vi.fn() } } }),
    }),
  },
}))
import { getManualRegistrationTargets } from './price-table-columns'
import { registrationGroupSnapshot } from '@/lib/operations/registration-groups'
import { saveMallPrice, saveManualRegistrationNumber, saveMallDisplayedPrice } from './price-registration-actions'
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


it('updates only the chosen number while preserving other identifiers and prices', async () => {
  mocks.row.mockResolvedValue([{ sourceSheetName: '상품등록', rawData: {
    '퍼스트몰 상품번호 A': '167', '퍼스트몰 상품번호 B': '65', 'B2B 판매가': '12000',
  } }])
  const result = await saveManualRegistrationNumber({
    rowId: input.rowId, mallId: 'firstmall', identifierKey: '퍼스트몰 상품번호 A', previousValue: '167', number: '999',
  })
  expect(result).toEqual({ saved: true })
  const raw = mocks.write.mock.calls[0][0].rawData
  expect(raw['B2B 판매가']).toBe('12000')
  expect(raw['퍼스트몰 상품번호 A']).toBe('167')
  expect(JSON.parse(raw[registrationIdentifiersKey('firstmall')])).toEqual([
    { key: '__registrationEdit:number:firstmall:퍼스트몰 상품번호 A', value: '999' },
    { key: '퍼스트몰 상품번호 B', value: '65' },
  ])
})

it('rejects a stale product number and does not touch the row', async () => {
  const result = await saveManualRegistrationNumber({
    rowId: input.rowId, mallId: 'coupang', identifierKey: '쿠팡 상품번호', previousValue: 'outdated', number: '999',
  })
  expect(result).toEqual({ error: expect.stringContaining('다른 사용자') })
  expect(mocks.write).not.toHaveBeenCalled()
})

it('requires a valid marketplace and product number', async () => {
  expect(await saveManualRegistrationNumber({
    rowId: input.rowId, mallId: 'coupang', identifierKey: null, previousValue: null, number: '확인필요',
  })).toEqual({ error: expect.any(String) })
  expect(mocks.write).not.toHaveBeenCalled()
})


it('saves one parent registration number atomically without merging option prices', async () => {
  const target = getManualRegistrationTargets('상품등록').find((mall) => mall.id === 'coupang')!
  const rows = [
    { id: input.rowId, rawData: { '쿠팡 상품번호': '12345', 'B2B 판매가': '12000' } },
    { id: '22222222-2222-4222-8222-222222222222', rawData: { '쿠팡 상품번호': '12345', 'B2B 판매가': '14000' } },
  ]
  mocks.row.mockResolvedValue([{ ...rows[0], productCode: '112001-0001', sourceSheetName: '상품등록' }])
  mocks.execute.mockResolvedValueOnce([]).mockResolvedValueOnce(rows)
  expect(await saveManualRegistrationNumber({
    rowId: input.rowId, mallId: 'coupang', identifierKey: '쿠팡 상품번호', previousValue: '12345', number: '99999',
    groupSnapshot: registrationGroupSnapshot(rows, target),
  })).toEqual({ saved: true })
  expect(mocks.write).toHaveBeenCalledTimes(2)
  const raw = mocks.write.mock.calls.map(([update]) => update.rawData)
  expect(raw.map((entry) => entry['B2B 판매가'])).toEqual(['12000', '14000'])
  expect(raw.map((entry) => JSON.parse(entry[registrationIdentifiersKey('coupang')])[0].value)).toEqual(['99999', '99999'])
})


it('keeps the registered price and number when recording a confirmed storefront amount', async () => {
  mocks.row.mockResolvedValue([{ id: input.rowId, sourceSheetName: '상품등록', rawData: {
    '쿠팡 상품번호': '12345', [registrationPriceKey('coupang')]: '15000',
  } }])
  expect(await saveMallDisplayedPrice({ rowId: input.rowId, mallId: 'coupang', price: '15900', previousPrice: null })).toEqual({ saved: true })
  expect(mocks.write.mock.calls[0][0].rawData).toMatchObject({
    '쿠팡 상품번호': '12345', [registrationPriceKey('coupang')]: '15000', '__registrationEdit:displayPrice:coupang': '15900',
  })
})

it('rejects a changed group snapshot before changing any option numbers', async () => {
  mocks.row.mockResolvedValue([{ id: input.rowId, productCode: '112001-0001', sourceSheetName: '상품등록', rawData: {} }])
  mocks.execute.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: input.rowId, rawData: {} }])
  expect(await saveManualRegistrationNumber({
    rowId: input.rowId, mallId: 'coupang', identifierKey: null, previousValue: null, number: '12345', groupSnapshot: '0'.repeat(64),
  })).toEqual({ error: expect.stringContaining('변경되었습니다') })
  expect(mocks.write).not.toHaveBeenCalled()
})
