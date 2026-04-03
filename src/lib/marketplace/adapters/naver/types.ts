/**
 * Naver Commerce API response types.
 *
 * Based on Naver Commerce API documentation for order collection
 * using the lastChangedStatuses and product order detail endpoints.
 */

/** OAuth2 token response from Naver Commerce API */
export interface NaverTokenResponse {
  access_token: string
  expires_in: number
  token_type: string
}

/** Product order from Naver Commerce API detail query */
export interface NaverProductOrder {
  productOrderId: string
  orderId: string
  productOrderStatus: string
  quantity: number
  unitPrice: number
  productName: string
  optionInfo?: string
  ordererName: string
  ordererTel?: string
  shippingAddress: {
    zipCode: string
    baseAddress: string
    detailedAddress?: string
  }
  paymentDate: string
  totalPaymentAmount: number
  claimType?: string
  claimStatus?: string
  claimReason?: string
}

/** Response from GET /v1/pay-order/seller/product-orders/last-changed-statuses */
export interface NaverLastChangedStatusesResponse {
  data: {
    lastChangeStatuses: Array<{
      productOrderId: string
      lastChangedType: string
      lastChangedDate: string
    }>
  }
}

/** Response from POST /v1/pay-order/seller/product-orders/query */
export interface NaverProductOrderDetailResponse {
  data: NaverProductOrder[]
}
