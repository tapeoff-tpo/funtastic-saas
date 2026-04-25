import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NormalizedInquiry } from '@/lib/marketplace/types'

// Mock the ky-based client at module level. The mock factory is captured per
// test via the `coupangResponse` mutable holder so each test can dictate the
// response shape.
const coupangResponse: { current: unknown } = {
  current: { code: '200', data: [] },
}

vi.mock('@/lib/marketplace/adapters/coupang/client', () => ({
  createCoupangClient: () => ({
    get: (_path: string) => ({
      json: async <T,>() => coupangResponse.current as T,
    }),
    put: (_path: string) => ({
      json: async <T,>() => ({ code: '200', message: 'ok', data: null }) as T,
    }),
    post: (_path: string) => ({
      json: async <T,>() => ({ code: '200', message: 'ok', data: null }) as T,
    }),
  }),
  formatCoupangDatetime: (d: Date) => d.toISOString(),
  generateCoupangAuth: () => 'CEA test',
}))

beforeEach(() => {
  coupangResponse.current = { code: '200', data: [] }
})

describe('Coupang getInquiries', () => {
  it('returns NormalizedInquiry[] from online inquiries endpoint', async () => {
    coupangResponse.current = {
      code: '200',
      data: [
        {
          inquiryId: 'inq-1',
          content: '배송 언제 와요?',
          inquiryRegisteredAt: '2026-04-20T10:00:00',
          orderId: 'order-XYZ',
        },
      ],
    }

    const { CoupangAdapter } = await import('@/lib/marketplace/adapters/coupang/adapter')
    const adapter = new CoupangAdapter({
      access_key: 'k',
      secret_key: 's',
      vendor_id: 'V123',
    })
    const inquiries: NormalizedInquiry[] = await adapter.getInquiries(
      new Date('2026-04-19'),
    )

    expect(inquiries).toHaveLength(1)
    expect(inquiries[0].marketplaceInquiryId).toBe('inq-1')
    expect(inquiries[0].marketplaceId).toBe('coupang')
    expect(inquiries[0].inquiryType).toBe('online')
    expect(inquiries[0].marketplaceOrderId).toBe('order-XYZ')
    expect(inquiries[0].question).toBe('배송 언제 와요?')
    expect(inquiries[0].requestedAt).toBeInstanceOf(Date)
    expect(inquiries[0].rawData).toMatchObject({ inquiryId: 'inq-1' })
  })

  it('empty response → empty array', async () => {
    coupangResponse.current = { code: '200', data: [] }

    const { CoupangAdapter } = await import('@/lib/marketplace/adapters/coupang/adapter')
    const adapter = new CoupangAdapter({
      access_key: 'k',
      secret_key: 's',
      vendor_id: 'V123',
    })

    const inquiries = await adapter.getInquiries(new Date('2026-04-19'))
    expect(inquiries).toEqual([])
  })

  it('missing data field → empty array', async () => {
    coupangResponse.current = { code: '200' }

    const { CoupangAdapter } = await import('@/lib/marketplace/adapters/coupang/adapter')
    const adapter = new CoupangAdapter({
      access_key: 'k',
      secret_key: 's',
      vendor_id: 'V123',
    })

    const inquiries = await adapter.getInquiries(new Date('2026-04-19'))
    expect(inquiries).toEqual([])
  })

  it('falls back to title when content is missing', async () => {
    coupangResponse.current = {
      code: '200',
      data: [
        {
          inquiryId: 42,
          title: '문의 제목',
          inquiryRegisteredAt: '2026-04-20T10:00:00',
        },
      ],
    }

    const { CoupangAdapter } = await import('@/lib/marketplace/adapters/coupang/adapter')
    const adapter = new CoupangAdapter({
      access_key: 'k',
      secret_key: 's',
      vendor_id: 'V123',
    })

    const inquiries = await adapter.getInquiries(new Date('2026-04-19'))
    expect(inquiries[0].marketplaceInquiryId).toBe('42')
    expect(inquiries[0].question).toBe('문의 제목')
    expect(inquiries[0].marketplaceOrderId).toBeUndefined()
  })
})
