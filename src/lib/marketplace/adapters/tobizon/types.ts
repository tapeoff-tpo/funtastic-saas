/**
 * Tobizon (투비즈온) API response types.
 *
 * // TODO: Update types when API documentation becomes available
 */

/** Placeholder order type */
export interface TobizonOrder {
  orderId: string
  status: string
  rawData: Record<string, unknown>
}

/** Placeholder claim type */
export interface TobizonClaim {
  claimId: string
  orderId: string
  status: string
  rawData: Record<string, unknown>
}

/** Placeholder product type */
export interface TobizonProduct {
  productId: string
  name: string
  price: number
  status: string
}
