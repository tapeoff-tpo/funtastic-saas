import { describe, expect, it } from 'vitest'

import { OwnerclanAdapter } from '@/lib/marketplace/adapters/ownerclan/adapter'

function makeAdapter() {
  return new OwnerclanAdapter({
    username: 'seller',
    password: 'seller-password',
    vendor_id: 'vendor',
    vendor_password: 'vendor-password',
  })
}

describe('Ownerclan uploadInvoice', () => {
  it('treats an already-registered matching product tracking number as success', async () => {
    const adapter = makeAdapter()

    const result = await adapter.uploadInvoice('OC-ORDER-1', {
      carrierId: 'CJGLS',
      trackingNumber: '698264612204',
      rawData: {
        key: 'OC-ORDER-1',
        products: [
          {
            itemKey: 'ITEM-1',
            trackingNumber: '698-2646-12204',
            shippingCompanyCode: 'CJGLS',
          },
        ],
      },
    })

    expect(result).toEqual({ success: true })
  })

  it('keeps unsupported Ownerclan invoice uploads failed when no matching tracking number is present', async () => {
    const adapter = makeAdapter()

    const result = await adapter.uploadInvoice('OC-ORDER-1', {
      carrierId: 'CJGLS',
      trackingNumber: '698264612204',
      rawData: {
        key: 'OC-ORDER-1',
        products: [{ itemKey: 'ITEM-1' }],
      },
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('오너클랜 송장 업로드 API')
  })
})
