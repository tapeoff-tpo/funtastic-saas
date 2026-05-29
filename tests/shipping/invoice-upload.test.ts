/**
 * Tests for Coupang and Naver uploadInvoice() adapter methods.
 *
 * Mocks the ky HTTP client to verify request shapes without hitting real APIs.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock ky before importing adapters
const mockJsonResponse = vi.fn()
const mockPut = vi.fn(() => ({ json: mockJsonResponse }))
const mockPost = vi.fn(() => ({ json: mockJsonResponse }))
const mockGet = vi.fn(() => ({ json: mockJsonResponse }))

vi.mock('ky', () => ({
  default: {
    create: () => ({
      get: mockGet,
      put: mockPut,
      post: mockPost,
    }),
    post: vi.fn(() => ({
      json: vi.fn().mockResolvedValue({
        access_token: 'test-token',
        expires_in: 3600,
        token_type: 'Bearer',
      }),
    })),
  },
}))

import { CoupangAdapter } from '@/lib/marketplace/adapters/coupang/adapter'
import { NaverAdapter } from '@/lib/marketplace/adapters/naver/adapter'

describe('Coupang uploadInvoice', () => {
  let adapter: CoupangAdapter

  beforeEach(() => {
    vi.clearAllMocks()
    adapter = new CoupangAdapter({
      access_key: 'test-access',
      secret_key: 'test-secret',
      vendor_id: 'A00000001',
    })
  })

  it('sends PUT to correct invoice endpoint with correct body shape', async () => {
    mockJsonResponse.mockResolvedValueOnce({ code: 'SUCCESS', message: 'OK' })

    await adapter.uploadInvoice('order-123', {
      trackingNumber: '1234567890',
      carrierId: 'CJGLS',
      shipmentBoxId: 99001,
      vendorItemId: 55001,
    })

    expect(mockPost).toHaveBeenCalledTimes(1)
    const [path, options] = mockPost.mock.calls[0]
    expect(path).toContain('v2/providers/openapi/apis/api/v4/vendors/A00000001/orders/invoices')

    const body = options.json
    expect(body.vendorId).toBe('A00000001')
    expect(body.orderSheetInvoiceApplyDtos).toBeInstanceOf(Array)
    expect(body.orderSheetInvoiceApplyDtos[0]).toMatchObject({
      shipmentBoxId: 99001,
      orderId: 'order-123',
      vendorItemId: 55001,
      deliveryCompanyCode: 'CJGLS',
      invoiceNumber: '1234567890',
    })
  })

  it('returns { success: true } on 200/SUCCESS response', async () => {
    mockJsonResponse.mockResolvedValueOnce({ code: 'SUCCESS', message: 'OK' })

    const result = await adapter.uploadInvoice('order-123', {
      trackingNumber: '1234567890',
      carrierId: 'CJGLS',
      shipmentBoxId: 99001,
      vendorItemId: 55001,
    })

    expect(result).toEqual({ success: true })
  })

  it('returns success when Coupang sends a numeric 200 code', async () => {
    mockJsonResponse.mockResolvedValueOnce({ code: 200, message: 'OK' })

    const result = await adapter.uploadInvoice('order-123', {
      trackingNumber: '1234567890',
      carrierId: 'CJGLS',
      shipmentBoxId: 99001,
      vendorItemId: 55001,
    })

    expect(result).toEqual({ success: true })
  })

  it('returns success when Coupang sends OK as the code', async () => {
    mockJsonResponse.mockResolvedValueOnce({ code: 'OK', message: 'OK' })

    const result = await adapter.uploadInvoice('order-123', {
      trackingNumber: '1234567890',
      carrierId: 'CJGLS',
      shipmentBoxId: 99001,
      vendorItemId: 55001,
    })

    expect(result).toEqual({ success: true })
  })

  it('returns failure when Coupang top-level response is OK but invoice result failed', async () => {
    mockJsonResponse.mockResolvedValueOnce({
      code: '200',
      message: 'OK',
      data: {
        responseCode: 99,
        responseMessage: 'FAILED',
        responseList: [
          {
            shipmentBoxId: 99001,
            succeed: false,
            resultCode: 'INVALID_STATUS',
            resultMessage: '배송진행상태가 유효하지 않습니다.',
            retryRequired: false,
          },
        ],
      },
    })

    const result = await adapter.uploadInvoice('order-123', {
      trackingNumber: '1234567890',
      carrierId: 'CJGLS',
      shipmentBoxId: 99001,
      vendorItemId: 55001,
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('INVALID_STATUS')
    expect(result.error).toContain('배송진행상태가 유효하지 않습니다.')
  })

  it('returns { success: false, error } on non-200 response', async () => {
    mockJsonResponse.mockResolvedValueOnce({ code: '400', message: 'Invalid invoice number' })

    const result = await adapter.uploadInvoice('order-123', {
      trackingNumber: 'BAD',
      carrierId: 'CJGLS',
      shipmentBoxId: 99001,
      vendorItemId: 55001,
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid invoice number')
  })

  it('returns { success: false, error } on network error', async () => {
    mockJsonResponse.mockRejectedValueOnce(new Error('Network timeout'))

    const result = await adapter.uploadInvoice('order-123', {
      trackingNumber: '1234567890',
      carrierId: 'CJGLS',
      shipmentBoxId: 99001,
      vendorItemId: 55001,
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('Network timeout')
  })

  it('uses Coupang invoice identifiers from rawData when route does not pass explicit fields', async () => {
    mockJsonResponse.mockResolvedValueOnce({ code: 'SUCCESS', message: 'OK' })

    await adapter.uploadInvoice('order-123', {
      trackingNumber: '1234567890',
      carrierId: 'CJGLS',
      rawData: {
        shipmentBoxId: 99001,
        orderItems: [{ vendorItemId: 55001 }],
      },
    })

    const [, options] = mockPost.mock.calls[0]
    expect(options.json.orderSheetInvoiceApplyDtos[0]).toMatchObject({
      shipmentBoxId: 99001,
      vendorItemId: 55001,
    })
  })

  it('uploads invoices for every Coupang order item when rawData has multiple vendor items', async () => {
    mockJsonResponse.mockResolvedValueOnce({ code: 'SUCCESS', message: 'OK' })

    await adapter.uploadInvoice('order-123', {
      trackingNumber: '1234567890',
      carrierId: 'CJGLS',
      rawData: {
        shipmentBoxId: 99001,
        orderItems: [
          { vendorItemId: 55001 },
          { vendorItemId: 55002 },
        ],
      },
    })

    const [, options] = mockPost.mock.calls[0]
    expect(options.json.orderSheetInvoiceApplyDtos).toHaveLength(2)
    expect(options.json.orderSheetInvoiceApplyDtos).toEqual([
      expect.objectContaining({ shipmentBoxId: 99001, vendorItemId: 55001 }),
      expect.objectContaining({ shipmentBoxId: 99001, vendorItemId: 55002 }),
    ])
  })
})

describe('Naver uploadInvoice', () => {
  let adapter: NaverAdapter

  beforeEach(() => {
    vi.clearAllMocks()
    adapter = new NaverAdapter({
      client_id: 'test-client',
      client_secret: 'test-secret',
    })
  })

  it('calls order confirmation first when requiresConfirmation is true', async () => {
    // First call: order confirmation
    mockJsonResponse.mockResolvedValueOnce({
      data: { successProductOrderIds: ['order-123'], failProductOrderIds: [] },
    })
    // Second call: dispatch
    mockJsonResponse.mockResolvedValueOnce({
      data: { successProductOrderIds: ['order-123'], failProductOrderIds: [] },
    })

    await adapter.uploadInvoice('order-123', {
      trackingNumber: '9876543210',
      carrierId: 'CJGLS',
      requiresConfirmation: true,
    })

    expect(mockPost).toHaveBeenCalledTimes(2)

    const [firstPath] = mockPost.mock.calls[0]
    expect(firstPath).toContain('confirm')

    const [secondPath, secondOptions] = mockPost.mock.calls[1]
    expect(secondPath).toContain('dispatch')
    expect(secondOptions.json.dispatchProductOrders[0]).toMatchObject({
      productOrderId: 'order-123',
      deliveryMethod: 'DELIVERY',
      deliveryCompanyCode: 'CJGLS',
      trackingNumber: '9876543210',
    })
  })

  it('skips place-order if requiresConfirmation is false', async () => {
    // Only dispatch call
    mockJsonResponse.mockResolvedValueOnce({
      data: { successProductOrderIds: ['order-123'], failProductOrderIds: [] },
    })

    await adapter.uploadInvoice('order-123', {
      trackingNumber: '9876543210',
      carrierId: 'CJGLS',
      requiresConfirmation: false,
    })

    expect(mockPost).toHaveBeenCalledTimes(1)
    const [path] = mockPost.mock.calls[0]
    expect(path).toContain('dispatch')
  })

  it('calls dispatch endpoint with correct deliveryCompanyCode and trackingNumber', async () => {
    mockJsonResponse.mockResolvedValueOnce({
      data: { successProductOrderIds: ['order-456'], failProductOrderIds: [] },
    })

    await adapter.uploadInvoice('order-456', {
      trackingNumber: '5555555555',
      carrierId: 'HANJIN',
    })

    const [, options] = mockPost.mock.calls[0]
    expect(options.json.dispatchProductOrders[0]).toMatchObject({
      productOrderId: 'order-456',
      deliveryCompanyCode: 'HANJIN',
      trackingNumber: '5555555555',
    })
  })

  it('returns { success: false } when orderId is in failProductOrderIds', async () => {
    mockJsonResponse.mockResolvedValueOnce({
      data: {
        successProductOrderIds: [],
        failProductOrderIds: ['order-123'],
      },
    })

    const result = await adapter.uploadInvoice('order-123', {
      trackingNumber: '9876543210',
      carrierId: 'CJGLS',
    })

    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('returns { success: false } on network error', async () => {
    mockJsonResponse.mockRejectedValueOnce(new Error('Connection refused'))

    const result = await adapter.uploadInvoice('order-123', {
      trackingNumber: '9876543210',
      carrierId: 'CJGLS',
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('Connection refused')
  })
})
