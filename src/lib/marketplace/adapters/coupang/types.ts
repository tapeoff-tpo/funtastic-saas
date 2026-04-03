/**
 * Coupang-specific API response types.
 *
 * Based on Coupang WING API documentation for PO list query
 * and return/cancellation request endpoints.
 */

/** A single order sheet from Coupang PO list query */
export interface CoupangOrderSheet {
  orderId: number
  orderSheetId: number
  vendorItemId: number
  vendorItemName: string
  shippingCount: number
  orderer: {
    name: string
    email: string
  }
  receiver: {
    name: string
    phone: string
    addr1: string
    addr2: string
    postCode: string
    zipCode: string
  }
  paidAt: string
  status: string
  paymentPrice: number
  orderPrice: number
  sellerProductId: number
  sellerProductItemId?: string
  shippingPrice: number
  overseaShippingPrice: number
  vendorItemPackageId: number
  vendorItemPackageName: string
  vendorHoldCode?: string
}

/** Response from GET /v2/providers/openapi/apis/api/v5/vendors/{vendorId}/ordersheets */
export interface CoupangOrderSheetsResponse {
  code: string
  message: string
  data: CoupangOrderSheet[]
}

/** A single return request from Coupang */
export interface CoupangReturnRequest {
  returnId: number
  orderId: number
  returnStatus: string
  returnReason: string
  createdAt: string
  vendorItemId: number
  vendorItemName: string
  returnDeliveryCompany?: string
  returnDeliveryNumber?: string
}

/** Response from GET /v2/providers/openapi/apis/api/v4/vendors/{vendorId}/returnRequests */
export interface CoupangReturnRequestsResponse {
  code: string
  message: string
  data: CoupangReturnRequest[]
}

// ─── Product API Types ──────────────────────────────────────────

/** Option info for a Coupang product item */
export interface CoupangItemOption {
  attributeTypeName: string  // e.g., "색상", "사이즈"
  valueName: string          // e.g., "빨강", "L"
}

/** A single item (variant) within a Coupang seller product */
export interface CoupangSellerProductItem {
  vendorItemId: number
  itemName: string
  originalPrice: number
  salePrice: number
  maximumBuyCount?: number
  maximumBuyForPerson?: number
  outboundShippingPlaceCode?: string
  vendorItemPackageId?: number
  vendorItemPackageName?: string
  images?: Array<{ imageOrder: number; imageType: string; cdnPath: string; vendorPath?: string }>
  notices?: Array<{ noticeCategoryName: string; content: string }>
  attributes?: CoupangItemOption[]
  barcode?: string
  modelNo?: string
  externalVendorSku?: string
  unitCount?: number
  adultOnly?: string
  taxType?: string
  parallelImported?: string
  overseasPurchased?: string
  contents?: Array<{ contentsType: string; contentDetails: Array<{ content: string; detailType: string }> }>
}

/** A single seller product from Coupang product list API */
export interface CoupangSellerProduct {
  sellerProductId: number
  sellerProductName: string
  displayCategoryCode?: number
  categoryId?: number
  productionDate?: string
  brandName?: string
  generalProductName?: string
  deliveryChargeType?: string
  deliveryCharge?: number
  freeShipOverAmount?: number
  deliveryChargeOnReturn?: number
  returnCenterCode?: string
  outboundShippingPlaceCode?: string
  vendorUserId?: string
  requested?: boolean
  items: CoupangSellerProductItem[]
  statusName: string
  createdAt?: string
  updatedAt?: string
}

/** Response from GET /v2/providers/seller_api/apis/api/v1/marketplace/seller-products */
export interface CoupangSellerProductsResponse {
  code: string
  message: string
  data: CoupangSellerProduct[]
  nextToken?: string
}
