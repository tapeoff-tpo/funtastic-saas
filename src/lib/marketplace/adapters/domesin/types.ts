export interface DomesinBaseResponse {
  code: string
  message?: string
}

export interface DomesinCashResponse extends DomesinBaseResponse {
  cash?: number | string
}

export interface DomesinProductListResponse extends DomesinBaseResponse {
  total_count?: number
  total_page?: number
  current_page?: number
  items?: DomesinProduct[]
}

export interface DomesinProduct {
  icode: string
  iname: string
  price?: number | string
  price_consumer?: number | string
  delivery_type?: number | string
  delivery_amount?: number | string
  status?: number | string
  img?: string[]
  content?: string
  brand?: string
  model?: string
  keyword?: string
}
