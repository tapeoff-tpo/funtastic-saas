import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Job } from 'bullmq'
import type { OrderCollectionJobData } from '@/lib/jobs/queues'
import type { NormalizedClaim } from '@/lib/marketplace/types'

// Mock db module
const mockInsert = vi.fn().mockReturnValue({
  values: vi.fn().mockReturnValue({
    onConflictDoUpdate: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ id: 'order-uuid-1' }]),
    }),
  }),
})

const mockDelete = vi.fn().mockReturnValue({
  where: vi.fn().mockResolvedValue(undefined),
})

const mockSelectFrom = vi.fn().mockReturnValue({
  where: vi.fn().mockResolvedValue([{ id: 'order-uuid-1' }]),
})

vi.mock('@/lib/db', () => ({
  db: {
    insert: (...args: unknown[]) => mockInsert(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
    select: vi.fn().mockReturnValue({
      from: (...args: unknown[]) => mockSelectFrom(...args),
    }),
  },
}))

vi.mock('@/lib/db/schema', () => ({
  orders: { marketplaceId: 'marketplace_id', marketplaceOrderId: 'marketplace_order_id' },
  orderItems: { orderId: 'order_id' },
  claims: { marketplaceId: 'marketplace_id', marketplaceClaimId: 'marketplace_claim_id' },
  jobLogs: {},
}))

vi.mock('@/lib/supabase/admin', () => ({
  readCredential: vi.fn().mockResolvedValue('mock-credential-value'),
}))

vi.mock('@/lib/marketplace/registry', () => ({
  marketplaceRegistry: {
    get: vi.fn().mockReturnValue({
      config: {
        id: 'coupang',
        name: '쿠팡',
        authType: 'hmac',
        rateLimitPerSecond: 100,
        requiredCredentials: ['access_key', 'secret_key', 'vendor_id'],
      },
    }),
    has: vi.fn().mockReturnValue(true),
  },
}))

const sampleClaim: NormalizedClaim = {
  marketplaceClaimId: 'CLM-2024-001',
  marketplaceId: 'coupang',
  marketplaceOrderId: 'CP-2024-001',
  claimType: 'return',
  claimStatus: 'requested',
  reason: '상품 불량',
  requestedAt: new Date('2024-01-16T10:00:00Z'),
  rawData: { original: 'coupang-claim-raw' },
}

function createMockJob(
  data: OrderCollectionJobData
): Job<OrderCollectionJobData> {
  return {
    data,
    id: 'test-job-1',
    name: 'collect-coupang',
    updateProgress: vi.fn(),
    log: vi.fn(),
  } as unknown as Job<OrderCollectionJobData>
}

describe('claims collection in processOrderCollection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInsert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 'order-uuid-1' }]),
        }),
      }),
    })
    mockSelectFrom.mockReturnValue({
      where: vi.fn().mockResolvedValue([{ id: 'order-uuid-1' }]),
    })
  })

  it('should UPSERT claims with correct fields', async () => {
    const { processOrderCollection } = await import(
      '@/lib/jobs/workers/order-collector'
    )
    const mockAdapter = {
      config: { requiredCredentials: ['access_key'] },
      getOrders: vi.fn().mockResolvedValue([]),
      getClaimsOrders: vi.fn().mockResolvedValue([sampleClaim]),
    }
    vi.spyOn(
      await import('@/lib/jobs/workers/order-collector'),
      'createAdapter'
    ).mockReturnValue(mockAdapter as never)

    const job = createMockJob({
      marketplaceId: 'coupang',
      connectionId: 'conn-1',
      userId: 'user-1',
    })

    const result = await processOrderCollection(job)

    expect(result.claimsCollected).toBe(1)
    expect(mockAdapter.getClaimsOrders).toHaveBeenCalled()
  })

  it('should look up orderId from marketplace order ID for claims', async () => {
    const { processOrderCollection } = await import(
      '@/lib/jobs/workers/order-collector'
    )
    const mockAdapter = {
      config: { requiredCredentials: ['access_key'] },
      getOrders: vi.fn().mockResolvedValue([]),
      getClaimsOrders: vi.fn().mockResolvedValue([sampleClaim]),
    }
    vi.spyOn(
      await import('@/lib/jobs/workers/order-collector'),
      'createAdapter'
    ).mockReturnValue(mockAdapter as never)

    const job = createMockJob({
      marketplaceId: 'coupang',
      connectionId: 'conn-1',
      userId: 'user-1',
    })

    await processOrderCollection(job)

    // db.select().from() should have been called to look up the order
    expect(mockSelectFrom).toHaveBeenCalled()
  })

  it('should skip claims when order lookup fails', async () => {
    mockSelectFrom.mockReturnValue({
      where: vi.fn().mockResolvedValue([]),
    })

    const { processOrderCollection } = await import(
      '@/lib/jobs/workers/order-collector'
    )
    const mockAdapter = {
      config: { requiredCredentials: ['access_key'] },
      getOrders: vi.fn().mockResolvedValue([]),
      getClaimsOrders: vi.fn().mockResolvedValue([sampleClaim]),
    }
    vi.spyOn(
      await import('@/lib/jobs/workers/order-collector'),
      'createAdapter'
    ).mockReturnValue(mockAdapter as never)

    const job = createMockJob({
      marketplaceId: 'coupang',
      connectionId: 'conn-1',
      userId: 'user-1',
    })

    const result = await processOrderCollection(job)

    // Claim should be skipped (no matching order found)
    expect(result.claimsCollected).toBe(0)
  })
})
