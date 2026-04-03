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
