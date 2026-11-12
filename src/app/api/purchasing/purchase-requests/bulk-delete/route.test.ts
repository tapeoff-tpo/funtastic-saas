import { describe, expect, it, vi } from 'vitest'
import { DELETE, purchaseRequestBulkDeleteBodySchema } from './route'

const mocks = vi.hoisted(() => ({ deleteItems: vi.fn() }))
vi.mock('@/lib/auth/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'staff' } } }) } }),
}))
vi.mock('@/lib/auth/menu-access', () => ({
  getUserMenuAccess: async () => ({ superAdmin: false, allowedMenus: null }),
}))
vi.mock('@/lib/purchasing/purchase-requests', () => ({
  deletePurchaseRequestItemsWithoutInventoryMovements: mocks.deleteItems,
}))

const itemId = '11111111-1111-4111-8111-111111111111'

describe('purchase request bulk delete validation', () => {
  it('accepts one or more purchase request ids', () => {
    expect(purchaseRequestBulkDeleteBodySchema.safeParse({ ids: [itemId] }).success).toBe(true)
  })

  it('rejects empty, invalid, excessive, and unrelated input', () => {
    expect(purchaseRequestBulkDeleteBodySchema.safeParse({ ids: [] }).success).toBe(false)
    expect(purchaseRequestBulkDeleteBodySchema.safeParse({ ids: ['not-an-id'] }).success).toBe(false)
    expect(purchaseRequestBulkDeleteBodySchema.safeParse({ ids: Array(201).fill(itemId) }).success).toBe(false)
    expect(purchaseRequestBulkDeleteBodySchema.safeParse({ ids: [itemId], userId: itemId }).success).toBe(false)
  })

  it('requires the separate delete permission even when all menus are allowed', async () => {
    const response = await DELETE({ json: async () => ({ ids: [itemId] }) } as never)
    expect(response.status).toBe(403)
    expect(mocks.deleteItems).not.toHaveBeenCalled()
  })
})
