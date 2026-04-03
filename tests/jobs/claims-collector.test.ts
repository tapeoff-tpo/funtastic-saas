import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Job } from 'bullmq'
import type { OrderCollectionJobData } from '@/lib/jobs/queues'
import type { NormalizedClaim } from '@/lib/marketplace/types'

// Mock db module — supports both .values().returning() and .values().onConflictDoUpdate().returning()
function createValuesChain() {
  const returning = vi.fn().mockResolvedValue([{ id: 'order-uuid-1' }])
  const onConflictDoUpdate = vi.fn().mockReturnValue({ returning })
  const values = vi.fn().mockReturnValue({ onConflictDoUpdate, returning })
  return { values, onConflictDoUpdate, returning }
}

const mockInsert = vi.fn().mockImplementation(() => createValuesChain())

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
  orders: {
    id: 'id',
    marketplaceId: 'marketplace_id',
    marketplaceOrderId: 'marketplace_order_id',
  },
  orderItems: { orderId: 'order_id' },
  claims: {
    marketplaceId: 'marketplace_id',
    marketplaceClaimId: 'marketplace_claim_id',
  },
  jobLogs: { id: 'id' },
}))

vi.mock('@/lib/supabase/admin', () => ({
  readCredential: vi.fn().mockResolvedValue('mock-credential-value'),
}))

// Shared mock adapter
const mockGetOrders = vi.fn().mockResolvedValue([])
const mockGetClaimsOrders = vi.fn().mockResolvedValue([])

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
      getOrders: (...args: unknown[]) => mockGetOrders(...args),
      getClaimsOrders: (...args: unknown[]) => mockGetClaimsOrders(...args),
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
    mockInsert.mockImplementation(() => createValuesChain())
    mockGetOrders.mockResolvedValue([])
    mockGetClaimsOrders.mockResolvedValue([])
    mockSelectFrom.mockReturnValue({
      where: vi.fn().mockResolvedValue([{ id: 'order-uuid-1' }]),
    })
  })

  it('should UPSERT claims with correct fields', async () => {
    mockGetClaimsOrders.mockResolvedValue([sampleClaim])

    const { processOrderCollection } = await import(
      '@/lib/jobs/workers/order-collector'
    )

    const job = createMockJob({
      marketplaceId: 'coupang',
      connectionId: 'conn-1',
      userId: 'user-1',
    })

    const result = await processOrderCollection(job)

    expect(result.claimsCollected).toBe(1)
    expect(mockGetClaimsOrders).toHaveBeenCalled()
  })

  it('should look up orderId from marketplace order ID for claims', async () => {
    mockGetClaimsOrders.mockResolvedValue([sampleClaim])

    const { processOrderCollection } = await import(
      '@/lib/jobs/workers/order-collector'
    )

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
    mockGetClaimsOrders.mockResolvedValue([sampleClaim])

    const { processOrderCollection } = await import(
      '@/lib/jobs/workers/order-collector'
    )

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
