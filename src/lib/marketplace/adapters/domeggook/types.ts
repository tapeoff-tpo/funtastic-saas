/**
 * Domeggook (도매꾹) API response types.
 *
 * Domeggook has an OpenAPI supporting both XML and JSON endpoints.
 * These types represent the expected response structure (best-effort per D-03).
 */

/** Generic Domeggook API response wrapper (JSON) */
export interface DomeggookApiResponse<T> {
  result: 'success' | 'fail'
  message?: string
  data: T
}

/** XML-parsed response wrapper (from fast-xml-parser) */
export interface DomeggookXmlResponse<T> {
  response: {
    result: string
    message?: string
    data: T
  }
}

/** A single order from Domeggook orders API */
export interface DomeggookOrder {
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

/** A single claim from Domeggook claims API */
export interface DomeggookClaim {
  claimId: string
  orderId: string
  claimType: string
  claimStatus: string
  reason: string
  createdAt: string
}

/** A single product from Domeggook products API */
export interface DomeggookProduct {
  productId: string
  name: string
  price: number
  status: string
}
