import { describe, expect, it } from 'vitest'
import {
  COUPANG_ROCKET_DISPLAY_NAME,
  COUPANG_ROCKET_RECIPIENT_NAME,
  COUPANG_ROCKET_WAREHOUSE_ZONE,
  COUPANG_STANDARD_WAREHOUSE_ZONE,
  getOrderChannelDisplayName,
  getImportedOrderPartyNames,
  getOrderInventoryWarehouseZone,
  isCoupangRocketOrder,
} from './fulfillment-channel'

describe('Coupang rocket fulfillment channel', () => {
  const rocketOrder = {
    marketplaceId: 'coupang',
    rawData: {
      source: 'sabangnet-review',
      rawLines: [{ 쇼핑몰명: '쿠팡 로켓배송(신)' }],
    },
  }

  it('recognizes the Sabangnet rocket delivery mall name', () => {
    expect(isCoupangRocketOrder(rocketOrder)).toBe(true)
    expect(getOrderChannelDisplayName(rocketOrder)).toBe(COUPANG_ROCKET_DISPLAY_NAME)
    expect(getOrderInventoryWarehouseZone(rocketOrder)).toBe(COUPANG_ROCKET_WAREHOUSE_ZONE)
    expect(getImportedOrderPartyNames(rocketOrder, {
      buyerName: '사방넷',
      recipientName: '사방넷',
    })).toEqual({
      buyerName: COUPANG_ROCKET_DISPLAY_NAME,
      recipientName: COUPANG_ROCKET_RECIPIENT_NAME,
    })
  })

  it('keeps standard Coupang orders on the regular fulfillment path', () => {
    const standardOrder = { marketplaceId: 'coupang', rawData: { rawLines: [{ 쇼핑몰명: '쿠팡' }] } }
    expect(isCoupangRocketOrder(standardOrder)).toBe(false)
    expect(getOrderChannelDisplayName(standardOrder)).toBeNull()
    expect(getOrderInventoryWarehouseZone(standardOrder)).toBe(COUPANG_STANDARD_WAREHOUSE_ZONE)
    expect(getImportedOrderPartyNames(standardOrder, {
      buyerName: '사방넷',
      recipientName: '사방넷',
    })).toEqual({ buyerName: '사방넷', recipientName: '사방넷' })
  })
})
