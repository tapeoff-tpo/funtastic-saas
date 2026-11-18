import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  access: vi.fn(), user: vi.fn(), owner: vi.fn(), existing: vi.fn(), items: vi.fn(), write: vi.fn(),
}))
vi.mock('@/lib/auth/menu-access', () => ({ assertMenuAccess: mocks.access }))
vi.mock('@/lib/auth/current-user', () => ({ getCurrentUser: mocks.user }))
vi.mock('@/lib/admin-accounts/queries', () => ({ getWorkspaceUserId: mocks.owner }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/db', () => ({
  db: {
    transaction: async (fn: (tx: unknown) => unknown) => fn({
      execute: vi.fn(),
      select: () => ({ from: () => ({ where: () => ({ orderBy: () =>
        Object.assign(Promise.resolve(mocks.items()), { limit: mocks.existing }),
      }) }) }),
      insert: () => ({ values: (rows: unknown) => { mocks.write(rows); return { returning: async () => [{ id: 'linked-row' }] } } }),
    }),
  },
}))
import { ensureManualRegistrationGroup } from './group-actions'
beforeEach(() => {
  vi.clearAllMocks()
  mocks.access.mockResolvedValue(undefined)
  mocks.user.mockResolvedValue({ id: 'staff' })
  mocks.owner.mockResolvedValue('owner')
  mocks.existing.mockResolvedValue([])
  mocks.items.mockReturnValue([
    { internalSku: '112001', name: '상품', metadata: {} },
    { internalSku: '112001-0001', name: '상품', metadata: { esa009m: { 규격정보: '빨강' } } },
    { internalSku: '112001-0002', name: '상품', metadata: { esa009m: { 규격정보: '파랑' } } },
  ])
})

it('links the real options to price-table rows under the canonical workspace', async () => {
  expect(await ensureManualRegistrationGroup('112001')).toEqual({ rowId: 'linked-row' })
  expect(mocks.write).toHaveBeenCalledWith([
    expect.objectContaining({ userId: 'owner', productCode: '112001-0001', optionName: '빨강' }),
    expect.objectContaining({ userId: 'owner', productCode: '112001-0002', optionName: '파랑' }),
  ])
})

it('reuses an existing registration row instead of creating a duplicate', async () => {
  mocks.existing.mockResolvedValue([{ id: 'already-linked' }])
  expect(await ensureManualRegistrationGroup('112001-0002')).toEqual({ rowId: 'already-linked' })
  expect(mocks.write).not.toHaveBeenCalled()
})

it('does not link a product outside the workspace', async () => {
  mocks.items.mockReturnValue([])
  expect(await ensureManualRegistrationGroup('112001')).toEqual({ error: '품목을 찾을 수 없습니다.' })
  expect(mocks.write).not.toHaveBeenCalled()
})
