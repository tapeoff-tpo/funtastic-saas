/**
 * Ably (에이블리) API response types.
 *
 * Ably uses JSON API responses. Types are best-effort (per D-03).
 */

/** Generic Ably API response wrapper */
export interface AblyApiResponse<T> {
  success: boolean
  message?: string
  data: T
}

/** A single order from Ably orders API */
export interface AblyOrder {
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

/** A single claim from Ably claims API */
export interface AblyClaim {
  claimId: string
  orderId: string
  claimType: string
  claimStatus: string
  reason: string
  createdAt: string
}

/** A single product from Ably products API */
export interface AblyProduct {
  productId: string
  name: string
  price: number
  status: string
}
