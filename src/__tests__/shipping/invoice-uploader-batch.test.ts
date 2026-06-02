import { describe, expect, it, vi } from 'vitest'
import type { MarketplaceAdapter } from '@/lib/marketplace/types'
import type { InvoiceUploadJobData } from '@/lib/shipping/types'

vi.mock('@/lib/db', () => ({
  db: {},
}))

vi.mock('@/lib/shipping/queries', () => ({
  updateShipmentStatus: vi.fn(),
}))

const mocks = vi.hoisted(() => ({
  markUploaded: vi.fn(),
  markFailed: vi.fn(),
}))

vi.mock('@/lib/shipping/upload-status', () => ({
  markShipmentUploadedAndOrderShipped: mocks.markUploaded,
  markShipmentUploadFailed: mocks.markFailed,
}))

vi.mock('@/lib/jobs/connection', () => ({
  getConnection: vi.fn(() => ({})),
}))

vi.mock('@/lib/marketplace/registry', () => ({
  marketplaceRegistry: {
    get: vi.fn(),
  },
}))

vi.mock('@/lib/supabase/admin', () => ({
  readCredential: vi.fn(),
}))

vi.mock('@/lib/jobs/workers/order-collector', () => ({
  createAdapter: vi.fn(),
}))

import { executePreparedInvoiceUpload } from '@/lib/jobs/workers/invoice-uploader'

function createJob(overrides: Partial<InvoiceUploadJobData>): InvoiceUploadJobData {
  return {
    orderId: 'order-1',
    shipmentId: 'shipment-1',
    userId: 'user-1',
    marketplaceId: 'naver',
    marketplaceOrderId: 'market-order-1',
    connectionId: 'connection-1',
    trackingNumber: '1234567890',
    carrierId: 'cj',
    attempt: 1,
    ...overrides,
  }
}

describe('executePreparedInvoiceUpload', () => {
  it('reuses a prepared adapter for multiple invoice uploads', async () => {
    const uploadInvoice = vi.fn().mockResolvedValue({ success: true })
    const adapter = {
      uploadInvoice,
    } as unknown as MarketplaceAdapter

    await executePreparedInvoiceUpload(
      createJob({
        orderId: 'order-1',
        shipmentId: 'shipment-1',
        marketplaceOrderId: 'market-order-1',
        trackingNumber: '111',
      }),
      1,
      adapter,
      { rawData: { orderItems: [] }, recipientName: 'A' },
    )

    await executePreparedInvoiceUpload(
      createJob({
        orderId: 'order-2',
        shipmentId: 'shipment-2',
        marketplaceOrderId: 'market-order-2',
        trackingNumber: '222',
      }),
      1,
      adapter,
      { rawData: { orderItems: [] }, recipientName: 'B' },
    )

    expect(uploadInvoice).toHaveBeenCalledTimes(2)
    expect(uploadInvoice).toHaveBeenNthCalledWith(
      1,
      'market-order-1',
      expect.objectContaining({ trackingNumber: '111', carrierId: 'cj', recipientName: 'A' }),
    )
    expect(uploadInvoice).toHaveBeenNthCalledWith(
      2,
      'market-order-2',
      expect.objectContaining({ trackingNumber: '222', carrierId: 'cj', recipientName: 'B' }),
    )
    expect(mocks.markUploaded).toHaveBeenCalledTimes(2)
    expect(mocks.markFailed).not.toHaveBeenCalled()
  })
})
