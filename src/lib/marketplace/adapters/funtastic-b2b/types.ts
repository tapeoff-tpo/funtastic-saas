export interface FuntasticB2bOrderItem {
  itemId: string | number
  productName: string
  optionText?: string | null
  quantity: number
  unitPrice: number
  sku?: string | null
}

export interface FuntasticB2bOrder {
  orderId: string | number
  status: string
  buyerName: string
  buyerPhone?: string | null
  buyerPhone2?: string | null
  recipientName: string
  recipientPhone?: string | null
  recipientPhone2?: string | null
  zipCode: string
  address1: string
  address2?: string | null
  orderedAt: string
  totalAmount?: number | null
  deliveryMessage?: string | null
  shippingFee?: number | null
  items: FuntasticB2bOrderItem[]
  [key: string]: unknown
}

export interface FuntasticB2bOrdersResponse {
  success?: boolean
  orders?: FuntasticB2bOrder[]
  error?: string
}

export interface FuntasticB2bInvoiceResponse {
  success?: boolean
  error?: string
}
