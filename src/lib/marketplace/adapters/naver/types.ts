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

/** Product order from Naver Commerce API detail query (nested structure) */
export interface NaverProductOrder {
  order: {
    orderId: string
    orderDate: string
    ordererName: string
    ordererTel?: string
    paymentDate?: string
  }
  productOrder: {
    productOrderId: string
    productOrderStatus: string
    quantity: number
    unitPrice: number
    productName: string
    productOption?: string
    totalPaymentAmount: number
    shippingAddress?: {
      name?: string
      tel1?: string
      zipCode: string
      baseAddress: string
      detailedAddress?: string
    }
    claimType?: string
    claimStatus?: string
    claimReason?: string
  }
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

// ─── Product API Types ──────────────────────────────────────────

/** Option combination for a Naver channel product */
export interface NaverProductOptionCombination {
  id: number
  optionName1: string
  optionName2?: string
  optionName3?: string
  stockQuantity: number
  price: number
  usable: boolean
  sellerManagerCode?: string  // seller's SKU
}

/** Image info from Naver product */
export interface NaverProductImage {
  url: string
  imageOrder: number
}

/** A single channel product from Naver Commerce API */
export interface NaverChannelProduct {
  originProductNo: number
  channelProductNo: number
  name: string
  statusType: string  // SALE, SUSPENSION, CLOSE, PROHIBITION, DELETE, WAIT
  salePrice: number
  stockQuantity: number
  channelProductDisplayStatusType?: string
  categoryId?: string
  wholeCategoryName?: string
  representativeImage?: NaverProductImage
  optionalImages?: NaverProductImage[]
  detailContent?: string
  sellerManagementCode?: string
  optionCombinations?: NaverProductOptionCombination[]
  createdDate?: string
  lastModifiedDate?: string
}

/** Response from GET /v2/products (Naver Commerce API) */
export interface NaverProductsResponse {
  contents: NaverChannelProduct[]
  totalElements: number
  totalPages: number
  size: number
  page: number
}
