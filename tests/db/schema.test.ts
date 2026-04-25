import { describe, it, expect } from 'vitest'
import { orders, products, inquiries } from '@/lib/db/schema'

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
})
