import { describe, expect, it } from 'vitest'
import {
  isPurchasingItemIgnored,
  purchasingItemIdentity,
  purchasingItemOrderIdentity,
  purchasingOutboundComponentIdentity,
} from './ignored-purchasing-items'

describe('purchasing item ignore identity', () => {
  it('keeps the legacy durable identity when a management or order reference exists', () => {
    expect(purchasingItemIdentity({
      source: 'request',
      sku: '100001-0001',
      purchaseManagementCode: 'M-1',
      supplierOrderNumber: null,
      fallbackDiscriminator: 'row-1',
    })).toBe('request|100001-0001|M-1|')
  })

  it('separates otherwise-identical rows with no management or order reference', () => {
    const base = {
      source: 'china-arrived',
      sku: '100001-0001',
      purchaseManagementCode: null,
      supplierOrderNumber: null,
    }
    expect(purchasingItemIdentity({ ...base, fallbackDiscriminator: 'date-row-1' }))
      .not.toBe(purchasingItemIdentity({ ...base, fallbackDiscriminator: 'date-row-2' }))
  })

  it('can keep split outbound shipments separate even with the same management code', () => {
    const base = {
      source: 'outbound',
      sku: '100001-0001',
      purchaseManagementCode: 'M-1',
      supplierOrderNumber: null,
      includeFallbackDiscriminator: true,
    }
    expect(purchasingItemIdentity({ ...base, fallbackDiscriminator: 'shipment-1' }))
      .not.toBe(purchasingItemIdentity({ ...base, fallbackDiscriminator: 'shipment-2' }))
  })

  it('keeps a managed outbound shipment stable when a supplier reference is filled later', () => {
    const base = {
      source: 'ecount_purchasing_snapshot_outbound',
      sku: '100001-0001',
      purchaseManagementCode: 'M-1',
      fallbackDiscriminator: '2026-09-24',
      includeFallbackDiscriminator: true,
    }
    expect(purchasingItemIdentity({ ...base, supplierOrderNumber: null }))
      .toBe(purchasingItemIdentity({ ...base, supplierOrderNumber: '3316362603001063953' }))
  })

  it('uses an order identity to ignore the same managed purchase across pipeline stages', () => {
    const orderIdentity = purchasingItemOrderIdentity({
      sku: '100001-0001',
      purchaseManagementCode: 'M-1',
      supplierOrderNumber: null,
    })!
    expect(isPurchasingItemIgnored(new Set([orderIdentity]), {
      source: 'ecount_purchasing_snapshot_china_arrived',
      sku: '100001-0001',
      purchaseManagementCode: 'M-1',
      supplierOrderNumber: '3316362603001063953',
    })).toBe(true)
  })

  it('keeps a fallback identity stable when a reusable payment marker is filled later', () => {
    const base = {
      source: 'ecount_purchasing_snapshot_china_arrived',
      sku: '100001-0001',
      purchaseManagementCode: null,
      fallbackDiscriminator: 'purchase-history-bridge',
    }
    expect(purchasingItemIdentity({ ...base, supplierOrderNumber: null }))
      .toBe(purchasingItemIdentity({ ...base, supplierOrderNumber: 'wechat' }))
  })

  it('keeps an outbound component stable when a unique supplier order is filled later', () => {
    const componentIdentity = purchasingOutboundComponentIdentity({
      source: 'ecount_purchasing_snapshot_outbound',
      sku: '100001-0001',
      purchaseManagementCode: null,
      componentMatchKey: 'outbound-row:stable-hash',
    })
    expect(componentIdentity).toBe(
      purchasingItemIdentity({
        source: 'ecount_purchasing_snapshot_outbound',
        sku: '100001-0001',
        purchaseManagementCode: null,
        supplierOrderNumber: null,
        fallbackDiscriminator: 'outbound-row:stable-hash',
        includeFallbackDiscriminator: true,
      }),
    )
  })
})
