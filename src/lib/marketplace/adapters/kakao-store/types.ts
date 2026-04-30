export interface KakaoStoreChangedOrder {
  orderId: number
  paymentId?: number
  orderStatus: string
  createdAt?: string
  modifiedAt?: string
  paidAt?: string
  deliveryRequestAt?: string
}

export interface KakaoStoreChangedOrdersResponse {
  contents?: KakaoStoreChangedOrder[]
  content?: KakaoStoreChangedOrder[]
  token?: {
    lastOrderId?: number
    lastModifiedAt?: string
  }
}

export interface KakaoStoreOrderDetail {
  id: number
  orderBase?: {
    id?: number
    paymentId?: number
    channelType?: string
    status?: string
    createdAt?: string
    paidAt?: string
    modifiedAt?: string
  }
  orderer?: {
    phoneNumber?: string
  }
  orderProduct?: {
    id?: number
    name?: string
    sellerItemNo?: string
    optionContent?: string
    quantity?: number
    productPrice?: number
    optionPrice?: number
    deliveryAmount?: number
  }
  orderDelivery?: {
    deliveryRequestAt?: string
    confirmedAt?: string
    invoiceRegisteredAt?: string
    shippingMethod?: string
    deliveryCompanyCode?: string
    invoiceNumber?: string
  }
  orderDeliveryRequest?: {
    receiverName?: string
    receiverAddress?: string
    receiverAddress1?: string
    receiverAddress2?: string
    receiverPhoneNumber?: string
    receiverMobileNumber?: string
    zipcode?: string
    roadZipCode?: string
    requirement?: string
  }
  orderClaimCancel?: KakaoStoreClaimDetail
  orderClaimExchange?: KakaoStoreClaimDetail
  orderClaimReturn?: KakaoStoreClaimDetail
}

export interface KakaoStoreBulkOrdersResponse {
  content?: KakaoStoreOrderDetail[]
  fail?: number[]
}

export interface KakaoStoreClaimDetail {
  claimId?: number
  claimItemId?: number
  claimItemStatus?: string
  reasonCodeName?: string
  reasonComment?: string
  createdAt?: string
  modifiedAt?: string
}

/** A single product from 카카오톡스토어 products API */
export interface KakaoStoreProduct {
  product_id: string
  product_name: string
  price: number
  product_code: string
  image_url: string
  status: string
}

/** Wrapper for 카카오톡스토어 product list response */
export interface KakaoStoreProductResponse {
  products: KakaoStoreProduct[]
}
