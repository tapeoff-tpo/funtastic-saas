/**
 * Onchannel (온채널) API response types.
 *
 * Onchannel uses JSON API responses. Types are best-effort (per D-03).
 */

/** Generic Onchannel API response wrapper */
export interface OnchannelApiResponse<T> {
  success: boolean
  message?: string
  data: T
}

/** A single order from Onchannel orders API */
export interface OnchannelOrder {
  orderId: string
  productId?: string
  productCode?: string
  itemId?: string
  orderProductId?: string
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

/** A single claim from Onchannel claims API */
export interface OnchannelClaim {
  claimId: string
  orderId: string
  claimType: string
  claimStatus: string
  reason: string
  createdAt: string
}

/** A single product from Onchannel products API */
export interface OnchannelProduct {
  productId: string
  name: string
  price: number
  status: string
}
