import { describe, it, expect } from 'vitest'
import {
  chinaOutboundBoxItems,
  chinaOutboundBoxes,
  chinaOutboundPallets,
  chinaOutboundShipmentItems,
  chinaOutboundShipments,
  inquiries,
  orders,
  products,
  saasChinaInventory,
  saasChinaInventoryMovements,
} from '@/lib/db/schema'

describe('schema: phase 8 columns', () => {
  it('orders has shippingType column', () => {
    // Compile-only assertion: typeof orders.shippingType resolves to 'object' only when the column is defined.
    // Removing the column will cause tsc to fail BEFORE runtime (RED). No unsafe casts (W-2).
    expect(typeof orders.shippingType).toBe('object')
  })
  it('orders has shippingFee column', () => {
    expect(typeof orders.shippingFee).toBe('object')
  })
  it('products has shippingCost column', () => {
    expect(typeof products.shippingCost).toBe('object')
  })
  it('inquiries table is exported', () => {
    expect(inquiries).toBeDefined()
    expect(typeof inquiries.marketplaceInquiryId).toBe('object')
  })

  it('keeps the SaaS China workflow separate from the raw China inventory table', () => {
    expect(typeof saasChinaInventory.availableQuantity).toBe('object')
    expect(typeof saasChinaInventory.reservedQuantity).toBe('object')
    expect(typeof saasChinaInventoryMovements.movementType).toBe('object')
    expect(typeof chinaOutboundShipments.shipmentNo).toBe('object')
    expect(typeof chinaOutboundShipmentItems.inventoryId).toBe('object')
    expect(typeof chinaOutboundPallets.palletNo).toBe('object')
    expect(typeof chinaOutboundBoxes.boxNo).toBe('object')
    expect(typeof chinaOutboundBoxItems.shipmentId).toBe('object')
    expect(typeof chinaOutboundBoxItems.shipmentItemId).toBe('object')
  })
})
