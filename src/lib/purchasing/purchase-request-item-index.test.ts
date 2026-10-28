import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ db: mocks }))

import { ensurePurchaseRequestManagementCodeSkuLookupIndex } from './purchase-request-item-index'

describe('ensurePurchaseRequestManagementCodeSkuLookupIndex', () => {
  it('runs the schema check as a promise when the lookup index is already non-unique', async () => {
    mocks.execute.mockResolvedValueOnce([{ isUnique: false }])

    const result = ensurePurchaseRequestManagementCodeSkuLookupIndex()

    await expect(result).resolves.toBeUndefined()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
})
