import { beforeEach, describe, expect, it, vi } from 'vitest'
import { products, purchaseRequestItems } from '@/lib/db/schema'

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  select: vi.fn(),
  transaction: vi.fn(),
  update: vi.fn(),
  productSet: vi.fn(),
  productWhere: vi.fn(),
  purchaseSet: vi.fn(),
  purchaseWhere: vi.fn(),
  purchaseReturning: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  db: {
    execute: mocks.execute,
    select: mocks.select,
    transaction: mocks.transaction,
  },
}))

import { applyDiscontinuedProductActions } from './discontinued-products'

function action(index: number) {
  return {
    sku: `SKU-${String(index).padStart(4, '0')}`,
    productName: null,
    optionName: null,
    sourceRowNumber: index + 1,
  }
}

describe('applyDiscontinuedProductActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.productWhere.mockResolvedValue(undefined)
    mocks.productSet.mockReturnValue({ where: mocks.productWhere })
    mocks.purchaseReturning.mockResolvedValue([])
    mocks.purchaseWhere.mockReturnValue({ returning: mocks.purchaseReturning })
    mocks.purchaseSet.mockReturnValue({ where: mocks.purchaseWhere })
    mocks.update.mockImplementation((table: unknown) => {
      if (table === products) return { set: mocks.productSet }
      if (table === purchaseRequestItems) return { set: mocks.purchaseSet }
      throw new Error('Unexpected table')
    })
    mocks.transaction.mockImplementation(async (callback: (tx: { update: typeof mocks.update; execute: typeof mocks.execute }) => unknown) => (
      callback({ update: mocks.update, execute: mocks.execute })
    ))
  })

  it('updates a large discontinued list in ordinary SKU chunks without a raw VALUES update', async () => {
    const actions = Array.from({ length: 401 }, (_, index) => action(index + 1))
    mocks.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(actions.map(({ sku }) => ({ sku }))),
      }),
    })

    const result = await applyDiscontinuedProductActions({
      userId: 'workspace-user',
      actions,
    })

    expect(result).toMatchObject({
      appliedSkuCount: 401,
      discontinuedSkuCount: 401,
      hiddenAutoRecommendationRows: 0,
    })
    expect(mocks.update).toHaveBeenCalledWith(products)
    expect(mocks.productSet).toHaveBeenCalledTimes(2)
    expect(mocks.productWhere).toHaveBeenCalledTimes(2)
    expect(mocks.purchaseSet).toHaveBeenCalledTimes(2)
    expect(mocks.execute).not.toHaveBeenCalled()
  })
})
