/**
 * Ownerclan (오너클랜) API response types.
 *
 * Ownerclan uses JSON API responses. Types are best-effort (per D-03).
 */

/** Generic Ownerclan API response wrapper */
export interface OwnerclanApiResponse<T> {
  success: boolean
  message?: string
  data: T
}

/** A single order from Ownerclan orders API */
export interface OwnerclanOrder {
  orderId: string
  productName: string
  quantity: number
  buyerName: string
  buyerPhone: string
  receiverName: string
  receiverPhone: string
  receiverZipcode: string
  receiverAddress: string
  receiverAddressDetail?: string
  orderDate: string
  orderStatus: string
  paymentAmount: number
  options?: string
  sellerItemCode?: string
}

/** A single claim from Ownerclan claims API */
export interface OwnerclanClaim {
  claimId: string
  orderId: string
  claimType: string
  claimStatus: string
  reason: string
  createdAt: string
}

/** A single product from Ownerclan products API */
export interface OwnerclanProduct {
  productId: string
  name: string
  price: number
  status: string
}
