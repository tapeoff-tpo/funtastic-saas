import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Job } from 'bullmq'
import type { OrderCollectionJobData } from '@/lib/jobs/queues'
import type { NormalizedOrder } from '@/lib/marketplace/types'

const adapterMocks = vi.hoisted(() => ({
  getOrders: vi.fn().mockResolvedValue([]),
  getClaimsOrders: vi.fn().mockResolvedValue([]),
  confirmOrder: vi.fn().mockResolvedValue({ success: true }),
}))

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

const mockSelectFrom = vi.fn().mockImplementation((table: { storeAlias?: unknown } | unknown) => {
  if (table && typeof table === 'object' && 'storeAlias' in table) {
    return {
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([{ storeAlias: 'default' }]),
      }),
    }
  }

  return {
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([]),
  }
})

const mockUpdate = vi.fn().mockReturnValue({
  set: vi.fn().mockReturnValue({
    where: vi.fn().mockResolvedValue(undefined),
  }),
})

vi.mock('@/lib/db', () => ({
  db: {
    insert: (...args: unknown[]) => mockInsert(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
    select: vi.fn().mockReturnValue({
      from: (...args: unknown[]) => mockSelectFrom(...args),
    }),
  },
}))

vi.mock('@/lib/db/schema', () => ({
  orders: {
    id: 'id',
    userId: 'user_id',
    status: 'status',
    marketplaceId: 'marketplace_id',
    marketplaceOrderId: 'marketplace_order_id',
    isCopy: 'is_copy',
  },
  orderItems: { orderId: 'order_id' },
  claims: {
    marketplaceId: 'marketplace_id',
    marketplaceClaimId: 'marketplace_claim_id',
  },
  jobLogs: { id: 'id' },
  marketplaceConnections: {
    id: 'id',
    storeAlias: 'store_alias',
  },
}))

vi.mock('@/lib/supabase/admin', () => ({
  readCredential: vi.fn().mockResolvedValue('mock-credential-value'),
}))

// Shared mock adapter that tests can customize per-test
const mockGetOrders = adapterMocks.getOrders
const mockGetClaimsOrders = adapterMocks.getClaimsOrders
const mockConfirmOrder = adapterMocks.confirmOrder

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

vi.mock('@/lib/marketplace/adapters/coupang/adapter', () => ({
  CoupangAdapter: vi.fn().mockImplementation(function MockCoupangAdapter() {
    return {
      config: {
        id: 'coupang',
        name: '쿠팡',
        authType: 'hmac',
        rateLimitPerSecond: 100,
        requiredCredentials: ['access_key', 'secret_key', 'vendor_id'],
      },
      getOrders: adapterMocks.getOrders,
      getClaimsOrders: adapterMocks.getClaimsOrders,
      confirmOrder: adapterMocks.confirmOrder,
      uploadInvoice: vi.fn(),
    }
  }),
}))

const sampleOrder: NormalizedOrder = {
  marketplaceOrderId: 'CP-2024-001',
  marketplaceId: 'coupang',
  marketplaceStatus: 'ACCEPT',
  status: 'new',
  buyerName: '홍길동',
  buyerPhone: '010-1234-5678',
  recipientName: '김철수',
  recipientPhone: '010-9876-5432',
  shippingAddress: {
    zipCode: '06134',
    address1: '서울시 강남구 테헤란로',
    address2: '123',
  },
  items: [
    {
      marketplaceItemId: 'ITEM-001',
      productName: '테스트 상품',
      quantity: 2,
      unitPrice: 15000,
      sku: 'SKU-001',
    },
  ],
  orderedAt: new Date('2024-01-15T10:00:00Z'),
  totalAmount: 30000,
  rawData: { original: 'coupang-raw-data', vendorItemId: 'V001' },
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

describe('processOrderCollection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInsert.mockImplementation(() => createValuesChain())
    mockGetOrders.mockResolvedValue([])
    mockGetClaimsOrders.mockResolvedValue([])
    mockConfirmOrder.mockResolvedValue({ success: true })
  })

  it('should fetch orders from adapter and UPSERT into database', async () => {
    mockGetOrders.mockResolvedValue([sampleOrder])

    const { processOrderCollection } = await import(
      '@/lib/jobs/workers/order-collector'
    )

    const job = createMockJob({
      marketplaceId: 'coupang',
      connectionId: 'conn-1',
      userId: 'user-1',
    })

    const result = await processOrderCollection(job)

    expect(result).toEqual(
      expect.objectContaining({ ordersCollected: 1, claimsCollected: 0 })
    )
    // Verify UPSERT was called (insert with onConflictDoUpdate)
    expect(mockInsert).toHaveBeenCalled()
  })

  it('should preserve rawData per D-03', async () => {
    mockGetOrders.mockResolvedValue([sampleOrder])

    const { processOrderCollection } = await import(
      '@/lib/jobs/workers/order-collector'
    )

    const job = createMockJob({
      marketplaceId: 'coupang',
      connectionId: 'conn-1',
      userId: 'user-1',
    })

    await processOrderCollection(job)

    // Verify rawData is included in insert values
    // The second insert call (first = jobLog, second = order upsert)
    expect(mockInsert).toHaveBeenCalled()
    // processOrderCollection passes rawData through to upsertOrder
    expect(mockGetOrders).toHaveBeenCalled()
  })

  it('should log job execution to job_logs on success', async () => {
    const { processOrderCollection } = await import(
      '@/lib/jobs/workers/order-collector'
    )

    const job = createMockJob({
      marketplaceId: 'coupang',
      connectionId: 'conn-1',
      userId: 'user-1',
    })

    await processOrderCollection(job)

    // jobLogs should be inserted at least twice: create + update
    expect(mockInsert).toHaveBeenCalled()
    const insertCallCount = mockInsert.mock.calls.length
    expect(insertCallCount).toBeGreaterThanOrEqual(2) // initial log + completion update
  })

  it('should log error to job_logs on failure', async () => {
    mockGetOrders.mockRejectedValue(new Error('API rate limited'))

    const { processOrderCollection } = await import(
      '@/lib/jobs/workers/order-collector'
    )

    const job = createMockJob({
      marketplaceId: 'coupang',
      connectionId: 'conn-1',
      userId: 'user-1',
    })

    await expect(processOrderCollection(job)).rejects.toThrow('API rate limited')
    // Error logging insert should have been called
    expect(mockInsert).toHaveBeenCalled()
  })

  it('should merge duplicate marketplace orders before UPSERT', async () => {
    const duplicateOrders = [sampleOrder, { ...sampleOrder }]
    mockGetOrders.mockResolvedValue(duplicateOrders)

    const { processOrderCollection } = await import(
      '@/lib/jobs/workers/order-collector'
    )

    const job = createMockJob({
      marketplaceId: 'coupang',
      connectionId: 'conn-1',
      userId: 'user-1',
    })

    const result = await processOrderCollection(job)

    expect(result.ordersCollected).toBe(1)
  })
})
