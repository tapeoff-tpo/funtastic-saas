export interface FuntasticB2bListResponse<T> {
  orders?: T[]
  returns?: T[]
  data?: T[] | { orders?: T[]; returns?: T[]; items?: T[] }
  items?: T[]
  success?: boolean
  message?: string
  error?: string
}

export interface FuntasticB2bOrderItem {
  id?: string | number
  itemId?: string | number
  productCode?: string | number
  sku?: string
  productName?: string
  name?: string
  optionText?: string
  optionName?: string
  quantity?: number | string
  qty?: number | string
  unitPrice?: number | string
  price?: number | string
}

export interface FuntasticB2bOrder {
  orderId?: string
  orderNo?: string
  id?: string | number
  status?: string
  shipmentStatus?: string
  orderedAt?: string
  orderDate?: string
  createdAt?: string
  buyerName?: string
  buyerPhone?: string
  buyerPhone2?: string
  recipientName?: string
  receiverName?: string
  recipientPhone?: string
  receiverPhone?: string
  recipientPhone2?: string
  zipCode?: string
  zipcode?: string
  postalCode?: string
  address?: string
  address1?: string
  address2?: string
  detailAddress?: string
  items?: FuntasticB2bOrderItem[]
  orderItems?: FuntasticB2bOrderItem[]
  products?: FuntasticB2bOrderItem[]
  totalAmount?: number | string
  amount?: number | string
  paymentAmount?: number | string
  deliveryMessage?: string
  memo?: string
  shippingFee?: number | string
  referenceNo?: string
}

export interface FuntasticB2bReturnItem {
  productCode?: string | number
  sku?: string
  quantity?: number | string
}

export interface FuntasticB2bReturn {
  id?: string | number
  returnId?: string | number
  claimId?: string | number
  orderNo?: string
  orderId?: string
  type?: string
  status?: string
  reason?: string
  createdAt?: string
  requestedAt?: string
  items?: FuntasticB2bReturnItem[]
}

export interface FuntasticB2bMutationResponse {
  success?: boolean
  ok?: boolean
  message?: string
  error?: string
}
