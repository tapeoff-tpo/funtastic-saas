/**
 * Ohouse (오늘의집) API response types.
 *
 * Ohouse Open API uses JSON responses. These types represent
 * the expected response structure (TBD -- based on Korean marketplace patterns).
 */

/** Generic Ohouse API response wrapper */
export interface OhouseApiResponse<T> {
  success: boolean
  message?: string
  data: T
}

/** A single order from Ohouse orders API */
export interface OhouseOrder {
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

/** A single claim from Ohouse claims API */
export interface OhouseClaim {
  claimId: string
  orderId: string
  claimType: string
  claimStatus: string
  reason: string
  createdAt: string
}

/** A single product from Ohouse products API */
export interface OhouseProduct {
  productId: string
  name: string
  price: number
  status: string
}
