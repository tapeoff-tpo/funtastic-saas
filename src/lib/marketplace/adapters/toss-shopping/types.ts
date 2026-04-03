/**
 * Toss Shopping (토스쇼핑) API response types.
 *
 * // TODO: Update types when API documentation becomes available
 */

/** Placeholder order type */
export interface TossShoppingOrder {
  orderId: string
  status: string
  rawData: Record<string, unknown>
}

/** Placeholder claim type */
export interface TossShoppingClaim {
  claimId: string
  orderId: string
  status: string
  rawData: Record<string, unknown>
}

/** Placeholder product type */
export interface TossShoppingProduct {
  productId: string
  name: string
  price: number
  status: string
}
