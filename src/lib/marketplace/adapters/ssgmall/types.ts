/**
 * Ssgmall (신세계몰) API response types.
 *
 * Ssgmall uses JSON API responses. Types are best-effort (per D-03).
 */

/** Generic Ssgmall API response wrapper */
export interface SsgmallApiResponse<T> {
  success: boolean
  message?: string
  data: T
}

/** A single order from Ssgmall orders API */
export interface SsgmallOrder {
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

/** A single claim from Ssgmall claims API */
export interface SsgmallClaim {
  claimId: string
  orderId: string
  claimType: string
  claimStatus: string
  reason: string
  createdAt: string
}

/** A single product from Ssgmall products API */
export interface SsgmallProduct {
  productId: string
  name: string
  price: number
  status: string
}
