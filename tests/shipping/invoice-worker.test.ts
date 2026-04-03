/**
 * Tests for invoice upload worker, queue, and server actions.
 *
 * Mocks BullMQ, database, and marketplace adapters to test the
 * invoice upload pipeline in isolation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock BullMQ
const mockAdd = vi.fn().mockResolvedValue({ id: 'job-1' })
vi.mock('bullmq', () => {
  const _mockAdd = vi.fn().mockResolvedValue({ id: 'job-1' })
  return {
    Queue: class MockQueue {
      add = _mockAdd
      constructor() {}
    },
    Worker: class MockWorker {
      on = vi.fn()
      close = vi.fn()
      constructor() {}
    },
    __mockAdd: _mockAdd,
  }
})

// Mock Redis connection
vi.mock('@/lib/jobs/connection', () => ({
  connection: {},
}))

// Mock DB
const mockDbInsert = vi.fn()
const mockDbSelect = vi.fn()
const mockDbUpdate = vi.fn()
vi.mock('@/lib/db', () => ({
  db: {
    insert: mockDbInsert,
    select: mockDbSelect,
    update: mockDbUpdate,
  },
}))

vi.mock('@/lib/db/schema', () => ({
  orders: { id: 'id', marketplaceId: 'marketplace_id', marketplaceOrderId: 'marketplace_order_id', connectionId: 'connection_id', userId: 'user_id' },
  shipments: { id: 'id', uploadStatus: 'upload_status', uploadAttempts: 'upload_attempts', lastUploadAt: 'last_upload_at', marketplaceUploadError: 'marketplace_upload_error', updatedAt: 'updated_at' },
  shipmentItems: {},
}))

// Mock drizzle-orm
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((a, b) => ({ eq: [a, b] })),
  and: vi.fn((...args: unknown[]) => ({ and: args })),
  inArray: vi.fn(),
  sql: vi.fn(),
  desc: vi.fn(),
  lt: vi.fn(),
}))

// Mock shipping queries
const mockUpdateShipmentStatus = vi.fn().mockResolvedValue(undefined)
const mockCreateShipment = vi.fn().mockResolvedValue({
  id: 'shipment-1',
  orderId: 'order-1',
  userId: 'user-1',
  trackingNumber: '1234567890',
  carrierId: 'CJGLS',
  carrierName: 'CJ대한통운',
  uploadStatus: 'pending',
})
vi.mock('@/lib/shipping/queries', () => ({
  updateShipmentStatus: (...args: unknown[]) => mockUpdateShipmentStatus(...args),
  createShipment: (...args: unknown[]) => mockCreateShipment(...args),
  getShipmentById: vi.fn(),
  getShipmentsByOrderId: vi.fn(),
  getPendingUploads: vi.fn(),
  createShipmentWithItems: vi.fn(),
}))

// Mock carrier codes
vi.mock('@/lib/shipping/carrier-codes', () => ({
  getCarrierName: (code: string) => code === 'CJGLS' ? 'CJ대한통운' : code,
  mapCarrierCode: (_mp: string, code: string) => code,
  CARRIERS: [],
  PRIMARY_CARRIERS: [],
}))

// Mock marketplace registry -- inline to avoid hoisting issues
vi.mock('@/lib/marketplace/registry', () => {
  const mockUploadInvoice = vi.fn()
  return {
    marketplaceRegistry: {
      get: vi.fn().mockReturnValue({
        config: { id: 'coupang', requiredCredentials: ['access_key', 'secret_key', 'vendor_id'] },
        uploadInvoice: mockUploadInvoice,
      }),
    },
    MarketplaceRegistry: vi.fn(),
    __mockUploadInvoice: mockUploadInvoice,
  }
})

import { processInvoiceUpload } from '@/lib/jobs/workers/invoice-uploader'
import type { InvoiceUploadJobData } from '@/lib/shipping/types'

// Get mock refs after import
const registryModule = await import('@/lib/marketplace/registry') as any
const mockUploadInvoice = registryModule.__mockUploadInvoice as ReturnType<typeof vi.fn>
const bullmqModule = await import('bullmq') as any
const mockQueueAdd = bullmqModule.__mockAdd as ReturnType<typeof vi.fn>

function makeJob(overrides: Partial<InvoiceUploadJobData> = {}) {
  return {
    data: {
      orderId: 'order-1',
      shipmentId: 'shipment-1',
      marketplaceId: 'coupang',
      marketplaceOrderId: 'mkt-order-1',
      connectionId: 'conn-1',
      trackingNumber: '1234567890',
      carrierId: 'CJGLS',
      attempt: 1,
      ...overrides,
    },
    id: 'job-1',
    attemptsMade: 0,
  } as any
}

describe('Invoice Upload Worker (processInvoiceUpload)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls adapter.uploadInvoice() with correct params', async () => {
    mockUploadInvoice.mockResolvedValueOnce({ success: true })

    await processInvoiceUpload(makeJob())

    expect(mockUploadInvoice).toHaveBeenCalledWith(
      'mkt-order-1',
      expect.objectContaining({
        trackingNumber: '1234567890',
        carrierId: 'CJGLS',
      }),
    )
  })

  it('sets status to "uploading" before calling adapter', async () => {
    mockUploadInvoice.mockResolvedValueOnce({ success: true })

    await processInvoiceUpload(makeJob())

    // First call should be 'uploading'
    expect(mockUpdateShipmentStatus).toHaveBeenCalledWith('shipment-1', 'uploading')
  })

  it('updates shipment status to "uploaded" on success', async () => {
    mockUploadInvoice.mockResolvedValueOnce({ success: true })

    await processInvoiceUpload(makeJob())

    expect(mockUpdateShipmentStatus).toHaveBeenCalledWith('shipment-1', 'uploaded')
  })

  it('updates shipment status to "failed" with error message on failure', async () => {
    mockUploadInvoice.mockResolvedValueOnce({ success: false, error: 'Invalid tracking number' })

    await expect(processInvoiceUpload(makeJob())).rejects.toThrow('Invalid tracking number')

    expect(mockUpdateShipmentStatus).toHaveBeenCalledWith(
      'shipment-1',
      'failed',
      'Invalid tracking number',
    )
  })
})

describe('Invoice Upload Queue and Server Actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('queueInvoiceUpload creates a shipment record and adds a job to the queue', async () => {
    // Mock order lookup
    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{
          id: 'order-1',
          marketplaceId: 'coupang',
          marketplaceOrderId: 'mkt-order-1',
          connectionId: 'conn-1',
          userId: 'user-1',
        }]),
      }),
    })

    const { queueInvoiceUpload } = await import('@/lib/shipping/actions')
    const result = await queueInvoiceUpload('order-1', '1234567890', 'CJGLS', 'user-1')

    expect(result.success).toBe(true)
    expect(mockCreateShipment).toHaveBeenCalledWith(expect.objectContaining({
      orderId: 'order-1',
      trackingNumber: '1234567890',
      carrierId: 'CJGLS',
    }))
    expect(mockQueueAdd).toHaveBeenCalled()
  })

  it('bulkQueueInvoiceUpload queues multiple jobs from an array of orders', async () => {
    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn()
          .mockResolvedValueOnce([{
            id: 'order-1',
            marketplaceId: 'coupang',
            marketplaceOrderId: 'mkt-order-1',
            connectionId: 'conn-1',
            userId: 'user-1',
          }])
          .mockResolvedValueOnce([{
            id: 'order-2',
            marketplaceId: 'naver',
            marketplaceOrderId: 'mkt-order-2',
            connectionId: 'conn-2',
            userId: 'user-1',
          }]),
      }),
    })

    const { bulkQueueInvoiceUpload } = await import('@/lib/shipping/actions')
    const result = await bulkQueueInvoiceUpload([
      { orderId: 'order-1', trackingNumber: '111', carrierId: 'CJGLS' },
      { orderId: 'order-2', trackingNumber: '222', carrierId: 'HANJIN' },
    ], 'user-1')

    expect(result.queued).toBe(2)
    expect(result.errors).toHaveLength(0)
  })
})
