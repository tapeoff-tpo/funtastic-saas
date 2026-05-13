export interface DomeggookApiErrorResponse {
  code?: string | number
  message?: string
  dcode?: string | number
  dmessage?: string
  date?: string
}

export interface DomeggookListResponse<T> extends DomeggookApiErrorResponse {
  header?: {
    numberOfItems?: number
    currentPage?: number
    itemsPerPage?: number
    numberOfPages?: number
  }
  items?: T[] | { item?: T | T[] }
}

export interface DomeggookXmlResponse<T> {
  response: {
    result: string
    message?: string
    data: T
  }
}

export interface DomeggookOrder {
  orderNo?: string | number
  orderUid?: string
  status?: string
  statusMode?: string
  itemNo?: string | number
  itemTitle?: string
  item?: {
    no?: string | number
    title?: string
    itemCustomCode?: string
  }
  orderQty?: string | number
  orderAmt?: string | number
  orderAmtPay?: string | number
  orderAmount?: string | number
  pay?: {
    payAmount?: string | number
    datePay?: string
  }
  buyerInfo?: {
    buyerName?: string
    buyerPhone?: string
    buyerMobile?: string
    buyerZipcode?: string
    buyerAddress?: string
  }
  consumer?: {
    name?: string
    phone?: string
    mobile?: string
    zipcode?: string
    address?: string
    deliReq?: string
  }
  delivery?: {
    fee?: string | number
    who?: string
    method?: string
  }
  selectOpt?: {
    opt?: DomeggookOrderOption | DomeggookOrderOption[]
  }
  date?: string
}

export interface DomeggookOrderOption {
  name?: string
  add?: string | number
  price?: string | number
  amt?: string | number
  qty?: string | number
  code?: string
}

export interface DomeggookClaim {
  claimId: string
  orderId: string
  claimType: string
  claimStatus: string
  reason: string
  createdAt: string
}

export interface DomeggookProduct {
  productId?: string
  name?: string
  price?: number
  status?: string
}
