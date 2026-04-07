/**
 * Coupang WING API type definitions.
 *
 * Based on v5 ordersheets API and v4 returnRequests API.
 * v5 returns data at the shipmentBox level with nested orderItems.
 */

/** A single order item within a shipment box (v5 ordersheets) */
export interface CoupangOrderItem {
  vendorItemPackageId: number
  vendorItemPackageName: string
  productId: number
  vendorItemId: number
  vendorItemName: string
  shippingCount: number
  salesPrice: { currencyCode: string; units: number; nanos: number }
  orderPrice: { currencyCode: string; units: number; nanos: number }
  discountPrice: { currencyCode: string; units: number; nanos: number }
  instantCouponDiscount: { currencyCode: string; units: number; nanos: number }
  downloadableCouponDiscount: { currencyCode: string; units: number; nanos: number }
  coupangDiscount: { currencyCode: string; units: number; nanos: number }
  externalVendorSkuCode: string
  sellerProductId: number
  sellerProductName: string
  sellerProductItemName: string
  firstSellerProductItemName: string
  cancelCount: number
  holdCountForCancel: number
  estimatedShippingDate: string
  canceled: boolean
  confirmDate: string | null
  deliveryChargeTypeName: string
  pricingBadge: boolean
  usedProduct: boolean
  extraProperties?: Record<string, string>
}

/** A shipment box from GET v5 ordersheets */
export interface CoupangOrderSheet {
  shipmentBoxId: number
  orderId: number
  orderedAt: string
  orderer: {
    name: string
    email: string
    safeNumber: string
    ordererNumber: string | null
  }
  paidAt: string
  status: string
  shippingPrice: { currencyCode: string; units: number; nanos: number }
  remotePrice: { currencyCode: string; units: number; nanos: number }
  remoteArea: boolean
  parcelPrintMessage: string
  splitShipping: boolean
  ableSplitShipping: boolean
  receiver: {
    name: string
    safeNumber: string
    receiverNumber: string | null
    addr1: string
    addr2: string
    postCode: string
  }
  orderItems: CoupangOrderItem[]
  deliveryCompanyName: string
  invoiceNumber: string
  inTrasitDateTime: string | null
  deliveredDate: string | null
  refer: string
  shipmentType: string
  isCod: boolean
  overseaShippingInfoDto?: {
    personalCustomsClearanceCode: string
    ordererSsn: string
    ordererPhoneNumber: string
  }
  extraProperties?: Record<string, string> | null
}

/** Response from GET /v2/providers/openapi/apis/api/v5/vendors/{vendorId}/ordersheets */
export interface CoupangOrderSheetsResponse {
  code: number | string
  message: string
  data: CoupangOrderSheet[]
}

/** A single return request from Coupang */
export interface CoupangReturnRequest {
  returnId: number
  orderId: number
  vendorItemId: number
  returnStatus: string
  returnReason: string
  createdAt: string
}

/** Response from GET /v4 returnRequests */
export interface CoupangReturnRequestsResponse {
  code: number | string
  message: string
  data: CoupangReturnRequest[]
}
