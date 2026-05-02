export interface OwnerclanOrderProduct {
  quantity?: number | null
  price?: number | null
  shippingType?: string | null
  itemKey?: string | null
  productName?: string | null
  itemOptionInfo?: {
    optionAttributes?: Array<{ name?: string | null; value?: string | null }> | null
    price?: number | null
  } | null
  trackingNumber?: string | null
  shippingCompanyCode?: string | null
  shippingCompanyName?: string | null
  shippedDate?: number | null
  additionalAttributes?: Array<{ key?: string | null; value?: string | null }> | null
  taxFree?: boolean | null
  sellerNote?: string | null
}

export interface OwnerclanOrder {
  key: string
  id?: string | null
  products?: OwnerclanOrderProduct[] | null
  status?: string | null
  shippingInfo?: {
    sender?: {
      name?: string | null
      phoneNumber?: string | null
      email?: string | null
    } | null
    recipient?: {
      name?: string | null
      phoneNumber?: string | null
      destinationAddress?: {
        addr1?: string | null
        addr2?: string | null
        postalCode?: string | null
      } | null
    } | null
    shippingFee?: number | null
  } | null
  createdAt?: number | null
  updatedAt?: number | null
  note?: string | null
  ordererNote?: string | null
  sellerNote?: string | null
  isBeingMediated?: boolean | null
}

export interface OwnerclanAllOrdersResponse {
  allOrders: {
    pageInfo: {
      hasNextPage: boolean
      endCursor?: string | null
    }
    edges: Array<{
      cursor?: string | null
      node: OwnerclanOrder
    }>
  }
}

export interface OwnerclanOrderResponse {
  order: OwnerclanOrder | null
}
