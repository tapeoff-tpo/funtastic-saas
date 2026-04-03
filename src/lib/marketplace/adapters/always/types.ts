/**
 * Always (올웨이즈) API response types.
 *
 * // TODO: Update types when API documentation becomes available
 */

/** Placeholder order type */
export interface AlwaysOrder {
  orderId: string
  status: string
  rawData: Record<string, unknown>
}

/** Placeholder claim type */
export interface AlwaysClaim {
  claimId: string
  orderId: string
  status: string
  rawData: Record<string, unknown>
}

/** Placeholder product type */
export interface AlwaysProduct {
  productId: string
  name: string
  price: number
  status: string
}
