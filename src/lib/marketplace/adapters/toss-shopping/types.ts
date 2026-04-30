export interface TossShoppingTokenResponse {
  access_token: string
  scope: string
  token_type: 'Bearer' | string
  expires_in: number
}

export interface TossShoppingApiError {
  errorCode?: string
  reason?: string
}

export interface TossShoppingApiResponse<T> {
  resultType?: 'SUCCESS' | 'FAIL'
  error?: TossShoppingApiError | null
  success?: T
}

export interface TossShoppingOrderProduct {
  orderedAt: string
  canceledAt?: string | null
  confirmedAt?: string | null
  shippingDeadlineAt?: string | null
  orderId: number | string
  orderProductId: number | string
  productId?: number | string
  stockId?: number | string
  ordererName?: string | null
  ordererPhone?: string | null
  ordererRealPhone?: string | null
  receiverName?: string | null
  receiverPhone?: string | null
  receiverRealPhone?: string | null
  address?: string | null
  detailAddress?: string | null
  zipCode?: string | null
  shippingNote?: string | null
  productName?: string | null
  optionName?: string | null
  quantity?: number | null
  price?: number | null
  originPrice?: number | null
  totalDiscountPrice?: number | null
  tossShoppingDiscount?: number | null
  tossPayDiscount?: number | null
  tossPayPoint?: number | null
  orderProductStatus: string
  deliveryCompanyCode?: string | null
  shippingTrackingNumber?: string | null
  deliveryFeeGroupId?: number | string | null
  deliveryFee?: number | null
  deliveryLocationType?: string | null
  normalDeliveryFee?: number | null
  jejuDeliveryFee?: number | null
  mountainDeliveryFee?: number | null
  productManagementCode?: string | null
  productItemManagementCode?: string | null
  [key: string]: unknown
}

export interface TossShoppingOrdersResponse {
  results?: TossShoppingOrderProduct[]
  nextCursor?: string | null
}

export interface TossShoppingStatusChangeResponse {
  totalCount?: number
  failedCount?: number
  failedReasons?: string[]
}
