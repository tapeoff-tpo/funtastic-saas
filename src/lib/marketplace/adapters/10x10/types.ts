/**
 * TenByTen (텐바이텐) API response types.
 *
 * // TODO: Update types when API documentation becomes available
 */

/** Placeholder order type */
export interface TenByTenOrder {
  orderId: string
  status: string
  rawData: Record<string, unknown>
}

/** Placeholder claim type */
export interface TenByTenClaim {
  claimId: string
  orderId: string
  status: string
  rawData: Record<string, unknown>
}

/** Placeholder product type */
export interface TenByTenProduct {
  productId: string
  name: string
  price: number
  status: string
}
