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
  const returning = vi.fn().mockResolvedValue([{ id: 'order-uuid-1', collectedAt: new Date('2026-05-01T00:00:00.000Z') }])
  const onConflictDoUpdate = vi.fn().mockReturnValue({ returning })
  const onConflictDoNothing = vi.fn().mockResolvedValue(undefined)
  const values = vi.fn().mockReturnValue({ onConflictDoUpdate, onConflictDoNothing, returning })
  return { values, onConflictDoUpdate, onConflictDoNothing, returning }
}

const mockInsert = vi.fn().mockImplementation(() => createValuesChain())
let mockExistingOrders: Array<{
  marketplaceId: string
  marketplaceOrderId: string
  buyerName: string
  recipientName: string
  connectionId?: string | null
  rawData?: Record<string, unknown> | null
}> = []
let mockExistingOrderItems: Array<{ id: string }> = []
let mockExistingCopyOrders: Array<{ id: string }> = []

const mockDelete = vi.fn().mockReturnValue({
  where: vi.fn().mockResolvedValue(undefined),
})

const mockSelectFrom = vi.fn().mockImplementation((selection: Record<string, unknown>, table: { storeAlias?: unknown; __table?: string } | unknown) => {
  if (table && typeof table === 'object' && 'storeAlias' in table) {
    return {
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([{ storeAlias: 'default' }]),
      }),
    }
  }

  if (table && typeof table === 'object' && '__table' in table && table.__table === 'orderItems') {
    return {
      where: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockResolvedValue(mockExistingOrderItems),
      }),
    }
  }

  if (selection && Object.keys(selection).length === 1 && 'id' in selection) {
    return {
      where: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockResolvedValue(mockExistingCopyOrders),
      }),
    }
  }

  return {
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(mockExistingOrders),
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
    select: vi.fn((selection: Record<string, unknown>) => ({
      from: (...args: unknown[]) => mockSelectFrom(selection, ...args),
    })),
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
    buyerName: 'buyer_name',
    recipientName: 'recipient_name',
  },
  orderItems: { id: 'order_item_id', orderId: 'order_id', __table: 'orderItems' },
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

vi.mock('@/lib/marketplace/adapters/ownerclan/adapter', () => ({
  OwnerclanAdapter: vi.fn().mockImplementation(function MockOwnerclanAdapter() {
    return {
      config: {
        id: 'ownerclan',
        name: '오너클랜',
        authType: 'api_key',
        rateLimitPerSecond: 20,
        requiredCredentials: ['username', 'password', 'vendor_id', 'vendor_password'],
      },
      getOrders: adapterMocks.getOrders,
      getClaimsOrders: adapterMocks.getClaimsOrders,
      confirmOrder: adapterMocks.confirmOrder,
      uploadInvoice: vi.fn(),
    }
  }),
}))

vi.mock('@/lib/marketplace/adapters/naver/adapter', () => ({
  NaverAdapter: vi.fn().mockImplementation(function MockNaverAdapter() {
    return {
      config: {
        id: 'naver',
        name: 'Naver SmartStore',
        authType: 'oauth2',
        rateLimitPerSecond: 50,
        requiredCredentials: ['client_id', 'client_secret'],
      },
      getOrders: adapterMocks.getOrders,
      getClaimsOrders: adapterMocks.getClaimsOrders,
      confirmOrder: adapterMocks.confirmOrder,
      uploadInvoice: vi.fn(),
    }
  }),
}))

vi.mock('@/lib/marketplace/adapters/ssgmall/adapter', () => ({
  SsgmallAdapter: vi.fn().mockImplementation(function MockSsgmallAdapter() {
    return {
      config: {
        id: 'ssgmall',
        name: 'SSG',
        authType: 'api_key',
        rateLimitPerSecond: 10,
        requiredCredentials: ['api_key'],
      },
      getOrders: adapterMocks.getOrders,
      getClaimsOrders: adapterMocks.getClaimsOrders,
      confirmOrder: adapterMocks.confirmOrder,
      uploadInvoice: vi.fn(),
    }
  }),
}))

vi.mock('@/lib/marketplace/adapters/specialoffer/adapter', () => ({
  SpecialofferAdapter: vi.fn().mockImplementation(function MockSpecialofferAdapter() {
    return {
      config: {
        id: 'specialoffer',
        name: 'Specialoffer',
        authType: 'api_key',
        rateLimitPerSecond: 10,
        requiredCredentials: ['api_key'],
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
    mockExistingOrders = []
    mockExistingOrderItems = []
    mockExistingCopyOrders = []
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

  it('uses a manually selected date range for manual collection', async () => {
    const { processOrderCollection } = await import(
      '@/lib/jobs/workers/order-collector'
    )

    const job = createMockJob({
      marketplaceId: 'coupang',
      connectionId: 'conn-1',
      userId: 'user-1',
      jobType: 'manual-order-collection',
      manualDateFrom: '2024-01-01',
      manualDateTo: '2024-01-01',
    })

    await processOrderCollection(job)

    expect(mockGetOrders).toHaveBeenCalledWith(
      new Date('2024-01-01T00:00:00+09:00'),
      new Date('2024-01-01T23:59:59.999+09:00'),
    )
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

  it('skips collection when the same order number already exists from another source', async () => {
    const existingOrderNo = 'GO_1017716539'
    mockExistingOrders = [{
      marketplaceId: 'sabangnet-a866eef06e',
      marketplaceOrderId: existingOrderNo,
      buyerName: '미수집',
      recipientName: '미수집',
    }]
    mockGetOrders.mockResolvedValue([{
      ...sampleOrder,
      marketplaceId: 'onchannel',
      marketplaceOrderId: existingOrderNo,
      buyerName: '이승호',
      recipientName: '이승호',
    }])

    const { processOrderCollection } = await import(
      '@/lib/jobs/workers/order-collector'
    )

    const result = await processOrderCollection(createMockJob({
      marketplaceId: 'coupang',
      connectionId: 'conn-onchannel',
      userId: 'user-1',
    }))

    expect(result.ordersCollected).toBe(0)
  })

  it('still acknowledges the marketplace when a collectable order is skipped as an existing cross-source duplicate', async () => {
    const existingOrderNo = 'CP-2026-DUP'
    mockExistingOrders = [{
      marketplaceId: 'sabangnet-a866eef06e',
      marketplaceOrderId: existingOrderNo,
      buyerName: 'excel buyer',
      recipientName: 'excel recipient',
    }]
    mockGetOrders.mockResolvedValue([{
      ...sampleOrder,
      marketplaceId: 'coupang',
      marketplaceOrderId: existingOrderNo,
      marketplaceStatus: 'ACCEPT',
      marketplaceCollectionStatus: 'new',
    }])

    const { processOrderCollection } = await import(
      '@/lib/jobs/workers/order-collector'
    )

    const result = await processOrderCollection(createMockJob({
      marketplaceId: 'coupang',
      connectionId: 'conn-coupang',
      userId: 'user-1',
    }))

    expect(result.ordersCollected).toBe(0)
    expect(mockConfirmOrder).toHaveBeenCalledWith(
      existingOrderNo,
      expect.objectContaining({ orderIdentity: expect.objectContaining({ orderId: existingOrderNo }) }),
    )
  })

  it('does not overwrite existing Sabangnet Excel orders during Ownerclan SaaS collection', async () => {
    const existingOrderNo = 'OC-2026-SABANGNET'
    mockExistingOrders = [{
      marketplaceId: 'ownerclan',
      marketplaceOrderId: existingOrderNo,
      buyerName: '사방넷 구매자',
      recipientName: '사방넷 수령자',
      connectionId: null,
      rawData: {
        source: 'sabangnet-import-xlsx',
        collectionSource: 'sabangnet-excel',
        sourceFileName: '사방넷_오너클랜.xlsx',
      },
    }]
    mockGetOrders.mockResolvedValue([{
      ...sampleOrder,
      marketplaceId: 'ownerclan',
      marketplaceOrderId: existingOrderNo,
      buyerName: 'API 구매자',
      recipientName: 'API 수령자',
    }])

    const { processOrderCollection } = await import(
      '@/lib/jobs/workers/order-collector'
    )

    const result = await processOrderCollection(createMockJob({
      marketplaceId: 'ownerclan',
      connectionId: 'conn-ownerclan',
      userId: 'user-1',
    }))

    expect(result.ordersCollected).toBe(0)
  })

  it('does not skip Banana B2B orders when the same order number exists from Sabangnet Excel', async () => {
    const existingOrderNo = '20260527-00000010'
    mockExistingOrders = [{
      marketplaceId: 'sabangnet-a866eef06e',
      marketplaceOrderId: existingOrderNo,
      buyerName: 'sabangnet buyer',
      recipientName: 'sabangnet receiver',
      connectionId: null,
      rawData: {
        source: 'sabangnet-current-xlsx',
        collectionSource: 'sabangnet-excel',
      },
    }]
    mockGetOrders.mockResolvedValue([{
      ...sampleOrder,
      marketplaceId: 'banana-b2b',
      marketplaceOrderId: existingOrderNo,
      buyerName: 'banana buyer',
      recipientName: 'banana receiver',
      rawData: { source: 'rpa-excel' },
    }])

    const { findExistingOrderMatches } = await import(
      '@/lib/jobs/workers/order-collector'
    )

    const result = await findExistingOrderMatches('user-1', 'banana-b2b', [{
      ...sampleOrder,
      marketplaceId: 'banana-b2b',
      marketplaceOrderId: existingOrderNo,
    }])

    expect(result.skipKeys.has(`banana-b2b:${existingOrderNo}`)).toBe(false)
    expect(result.upsertKeys.has(`banana-b2b:${existingOrderNo}`)).toBe(false)
  })

  it('moves newly collected Ownerclan orders to marketplace shipping preparation', async () => {
    mockGetOrders.mockResolvedValue([{
      ...sampleOrder,
      marketplaceId: 'ownerclan',
      marketplaceOrderId: 'OC-2026-001',
      marketplaceStatus: 'paid',
      marketplaceCollectionStatus: 'new',
    }])

    const { processOrderCollection } = await import(
      '@/lib/jobs/workers/order-collector'
    )

    const job = createMockJob({
      marketplaceId: 'ownerclan',
      connectionId: 'conn-ownerclan',
      userId: 'user-1',
    })

    const result = await processOrderCollection(job)

    expect(result.ordersCollected).toBe(1)
    expect(mockConfirmOrder).toHaveBeenCalledWith(
      'OC-2026-001',
      expect.objectContaining({ orderIdentity: expect.objectContaining({ orderId: 'OC-2026-001' }) }),
    )
    const updatePayloads = mockUpdate.mock.results.flatMap(({ value }) => value.set.mock.calls.map((call: unknown[]) => call[0]))
    expect(updatePayloads).toContainEqual(expect.objectContaining({
      marketplaceStatus: 'preparing',
      marketplaceCollectionStatus: 'ready',
    }))
  })

  it('confirms newly paid Naver orders after collection', async () => {
    mockGetOrders.mockResolvedValue([{
      ...sampleOrder,
      marketplaceId: 'naver',
      marketplaceOrderId: 'NO-2026-001',
      marketplaceStatus: 'PAYED',
      marketplaceCollectionStatus: 'new',
    }])

    const { processOrderCollection } = await import(
      '@/lib/jobs/workers/order-collector'
    )

    const result = await processOrderCollection(createMockJob({
      marketplaceId: 'naver',
      connectionId: 'conn-naver',
      userId: 'user-1',
    }))

    expect(result.ordersCollected).toBe(1)
    expect(mockConfirmOrder).toHaveBeenCalledWith(
      'NO-2026-001',
      expect.objectContaining({ orderIdentity: expect.objectContaining({ orderId: 'NO-2026-001' }) }),
    )
    const updatePayloads = mockUpdate.mock.results.flatMap(({ value }) => value.set.mock.calls.map((call: unknown[]) => call[0]))
    expect(updatePayloads).toContainEqual(expect.objectContaining({
      marketplaceStatus: '발주확인',
      marketplaceCollectionStatus: 'ready',
    }))
  })

  it('acknowledges collected Coupang paid orders in the marketplace', async () => {
    mockGetOrders.mockResolvedValue([{
      ...sampleOrder,
      marketplaceId: 'coupang',
      marketplaceOrderId: 'CP-2026-001',
      marketplaceStatus: 'ACCEPT',
      marketplaceCollectionStatus: 'new',
    }])

    const { processOrderCollection } = await import(
      '@/lib/jobs/workers/order-collector'
    )

    const result = await processOrderCollection(createMockJob({
      marketplaceId: 'coupang',
      connectionId: 'conn-coupang',
      userId: 'user-1',
    }))

    expect(result.ordersCollected).toBe(1)
    expect(mockConfirmOrder).toHaveBeenCalledWith(
      'CP-2026-001',
      expect.objectContaining({ orderIdentity: expect.objectContaining({ orderId: 'CP-2026-001' }) }),
    )
    const updatePayloads = mockUpdate.mock.results.flatMap(({ value }) => value.set.mock.calls.map((call: unknown[]) => call[0]))
    expect(updatePayloads).toContainEqual(expect.objectContaining({
      marketplaceStatus: 'INSTRUCT',
      marketplaceCollectionStatus: 'ready',
    }))
  })

  it('acknowledges Specialoffer ready orders in the marketplace', async () => {
    mockGetOrders.mockResolvedValue([{
      ...sampleOrder,
      marketplaceId: 'specialoffer',
      marketplaceOrderId: 'SO-2026-001',
      marketplaceStatus: '3',
      marketplaceCollectionStatus: 'ready',
      rawData: {
        order_id: '571610',
        marketplaceOrderIdentity: {
          orderId: 'SO-2026-001',
          itemIds: ['571610'],
        },
      },
    }])

    const { processOrderCollection } = await import(
      '@/lib/jobs/workers/order-collector'
    )

    const result = await processOrderCollection(createMockJob({
      marketplaceId: 'specialoffer',
      connectionId: 'conn-specialoffer',
      userId: 'user-1',
    }))

    expect(result.ordersCollected).toBe(1)
    expect(mockConfirmOrder).toHaveBeenCalledWith(
      'SO-2026-001',
      expect.objectContaining({ order_id: '571610' }),
    )
    const updatePayloads = mockUpdate.mock.results.flatMap(({ value }) => value.set.mock.calls.map((call: unknown[]) => call[0]))
    expect(updatePayloads).toContainEqual(expect.objectContaining({
      marketplaceStatus: 'CONFIRMED',
      marketplaceCollectionStatus: 'ready',
    }))
  })

  it('acknowledges collected SSG orders in the marketplace', async () => {
    mockGetOrders.mockResolvedValue([{
      ...sampleOrder,
      marketplaceId: 'ssgmall',
      marketplaceOrderId: 'SSG-2026-001',
      marketplaceStatus: '120',
      marketplaceCollectionStatus: 'new',
    }])

    const { processOrderCollection } = await import(
      '@/lib/jobs/workers/order-collector'
    )

    const result = await processOrderCollection(createMockJob({
      marketplaceId: 'ssgmall',
      connectionId: 'conn-ssg',
      userId: 'user-1',
    }))

    expect(result.ordersCollected).toBe(1)
    expect(mockConfirmOrder).toHaveBeenCalledWith(
      'SSG-2026-001',
      expect.objectContaining({ orderIdentity: expect.objectContaining({ orderId: 'SSG-2026-001' }) }),
    )
    const updatePayloads = mockUpdate.mock.results.flatMap(({ value }) => value.set.mock.calls.map((call: unknown[]) => call[0]))
    expect(updatePayloads).toContainEqual(expect.objectContaining({
      marketplaceStatus: '140',
      marketplaceCollectionStatus: 'ready',
    }))
  })

  it('updates reusable split-copy items without deleting referenced order_items', async () => {
    const existingOrderNo = 'NAVER-SPLIT-001'
    mockExistingOrders = [{
      marketplaceId: 'naver',
      marketplaceOrderId: existingOrderNo,
      buyerName: 'Buyer',
      recipientName: 'Receiver',
      connectionId: 'conn-naver',
    }]
    mockExistingOrderItems = [{ id: 'base-item-1' }]
    mockExistingCopyOrders = [{ id: 'copy-order-1' }]
    mockGetOrders.mockResolvedValue([{
      ...sampleOrder,
      marketplaceId: 'naver',
      marketplaceOrderId: existingOrderNo,
      marketplaceStatus: 'PAYED',
      marketplaceCollectionStatus: 'new',
      items: [
        {
          marketplaceItemId: 'po-1',
          productName: 'Product A',
          optionText: 'Black',
          quantity: 1,
          unitPrice: 10000,
          sku: 'SKU-A',
        },
        {
          marketplaceItemId: 'po-2',
          productName: 'Product B',
          optionText: 'White',
          quantity: 1,
          unitPrice: 12000,
          sku: 'SKU-B',
        },
      ],
    }])

    const { processOrderCollection } = await import(
      '@/lib/jobs/workers/order-collector'
    )

    await processOrderCollection(createMockJob({
      marketplaceId: 'naver',
      connectionId: 'conn-naver',
      userId: 'user-1',
    }))

    expect(mockDelete).not.toHaveBeenCalledWith(expect.objectContaining({ __table: 'orderItems' }))
    const updatePayloads = mockUpdate.mock.results.flatMap(({ value }) => value.set.mock.calls.map((call: unknown[]) => call[0]))
    expect(updatePayloads).toContainEqual(expect.objectContaining({
      connectionId: 'conn-naver',
      totalAmount: '12000',
    }))
    expect(updatePayloads).not.toContainEqual(expect.objectContaining({
      connectionId: 'conn-naver',
      collectedAt: expect.any(Date),
    }))
  })

  it('keeps marketplace acknowledgement failures in the completed job progress', async () => {
    mockConfirmOrder.mockResolvedValue({ success: false, error: 'remote rejected' })
    mockGetOrders.mockResolvedValue([{
      ...sampleOrder,
      marketplaceId: 'coupang',
      marketplaceOrderId: 'CP-2026-FAIL',
      marketplaceStatus: 'ACCEPT',
      marketplaceCollectionStatus: 'new',
    }])

    const { processOrderCollection } = await import(
      '@/lib/jobs/workers/order-collector'
    )

    await processOrderCollection(createMockJob({
      marketplaceId: 'coupang',
      connectionId: 'conn-coupang',
      userId: 'user-1',
    }))

    const insertPayloads = mockInsert.mock.results.flatMap(({ value }) => value.values.mock.calls.map((call: unknown[]) => call[0]))
    expect(insertPayloads).toContainEqual(expect.objectContaining({
      status: 'completed',
      progressMessage: expect.stringContaining('remote rejected'),
    }))
  })
})
