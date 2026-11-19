import { expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ select: vi.fn(), cache: new Map<string, string>() }))
vi.mock('@/lib/db', () => ({ db: { select: mocks.select } }))
vi.mock('next/cache', () => ({
  unstable_cache: (read: (owner: string) => Promise<string>, keys: string[]) => async (owner: string) => {
    const key = JSON.stringify([keys, owner])
    if (!mocks.cache.has(key)) mocks.cache.set(key, await read(owner))
    return mocks.cache.get(key)
  },
}))
import { getRegistrationCatalog } from './registration-groups'

it('reuses compressed catalogues by owner and reconstructs independent SKU sets', async () => {
  function result(value: unknown[]) {
    const query = { from: () => query, where: () => query, orderBy: async () => value }
    return query
  }
  mocks.select.mockReturnValueOnce(result([])).mockReturnValueOnce(result([
    { sku: '112001', name: '첫 상품', createdAt: new Date('2026-11-18') },
  ])).mockReturnValueOnce(result([])).mockReturnValueOnce(result([
    { sku: '112002', name: '다른 공간 상품', createdAt: new Date('2026-11-19') },
  ]))
  const first = await getRegistrationCatalog('owner-a')
  expect(first[0].skus.has('112001')).toBe(true)
  first[0].skus.clear()
  const second = await getRegistrationCatalog('owner-a')
  expect(second[0].skus.has('112001')).toBe(true)
  expect(mocks.select).toHaveBeenCalledTimes(2)
  const other = await getRegistrationCatalog('owner-b')
  expect(other[0].name).toBe('다른 공간 상품')
  expect(mocks.select).toHaveBeenCalledTimes(4)
})
