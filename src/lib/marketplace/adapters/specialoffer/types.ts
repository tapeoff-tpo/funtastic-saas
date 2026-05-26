export interface SpecialofferMeta {
  current_page?: number
  from?: number
  last_page?: number
  per_page?: number | string
  to?: number
  total?: number
}

export interface SpecialofferListResponse<T> {
  data?: T[]
  meta?: SpecialofferMeta
  message?: string
  error?: string
}

export interface SpecialofferItemResponse<T> {
  data?: T
  message?: string
  error?: string
}

export interface SpecialofferMutationResponse {
  data?: {
    goods_no?: string | number
    no?: string | number
    id?: string | number
    [key: string]: unknown
  }
  goods_no?: string | number
  no?: string | number
  id?: string | number
  success?: boolean
  result?: boolean | string
  message?: string
  error?: string
}

export interface SpecialofferProductOption {
  values?: string[]
  option_price?: number | string
  supply_price?: number | string
  stock_quantity?: number | string
  stock_qty?: number | string
}

export interface SpecialofferProduct {
  goods_no?: string | number
  goods_code?: string
  no?: string | number
  code?: string
  category_code?: string
  smartstore_category_code?: string
  seller_code?: string
  name?: string
  keywords?: string
  brand_name?: string
  model_name?: string
  origin?: string
  maker?: string
  order_end_at?: string
  tax_type?: string | number
  is_taxation?: string | number
  state?: string | number
  option_titles?: string[]
  option_values?: SpecialofferProductOption[]
  add_supply_values?: SpecialofferProductOption[]
  price_type?: string | number
  supply_price?: number | string
  price?: number | string
  origin_price?: number | string
  stock_type?: string | number
  stock_qty?: number | string
  sale_start_date?: string
  sale_end_date?: string
  shipping_fee_type?: number | string
  shipping_fee_payment?: number | string
  shipping_fee?: number | string
  shipping_etc?: string
  image_1?: string | null
  image_2?: string | null
  image_3?: string | null
  image_4?: string | null
  image_5?: string | null
  image_6?: string | null
  contents?: string
  content?: string
  seller_notice?: string
  cert_type?: string
  cert_flag?: string
  cert_info?: unknown
  info_code?: string
  info_gubun?: string
  is_medical?: string
  is_healthfood?: string
  is_refundable?: string | number
  non_refundable_conditions?: string
  is_overseas_shipping?: string
  is_bundled_shipping?: string
  seller_goods_code?: string
  goods_info_url?: string
  detail_url?: string
  created_at?: string
  updated_at?: string
  [key: `info_value${number}`]: string | undefined
}

export interface SpecialofferPointResponse {
  data?: {
    summary?: {
      point?: number | string
    }
    lists?: Array<Record<string, unknown>>
  }
  meta?: SpecialofferMeta
  message?: string
  error?: string
}

export interface SpecialofferBuyerOrderRequest {
  goods_no: string | number
  options?: string[]
  qty: number
  add_supply?: string[]
  shipping_fee_type: 0 | 1
  receiver_name?: string
  receiver_telephone?: string
  receiver_cellphone?: string
  receiver_zip?: string
  receiver_addr?: string
  memo?: string
  external_key?: string
}

export interface SpecialofferBuyerOrder {
  order_id?: string | number
  order_no?: string
  order_state?: string | number
  goods_name?: string
  options?: unknown
  option?: unknown
  option_name?: unknown
  option_text?: unknown
  option_values?: unknown
  add_supply?: unknown
  add_supply_values?: unknown
  선택?: unknown
  '추가 선택'?: unknown
  delivery_company?: string
  delivery_no?: string
  delivery_date?: string | null
  shop_memo?: string
  sum_qty?: string | number
  goods_price?: string | number
  shipping_fee?: string | number
  total_price?: string | number
  receiver_name?: string
  receiver_telephone?: string
  receiver_cellphone?: string
  receiver_zip?: string
  receiver_addr?: string
  receiver_addr1?: string
  receiver_addr2?: string
  receiver_addr3?: string
  option?: string
  option_name?: string
  option_text?: string
  option_values?: unknown
  memo?: string
  order_date?: string
  updated_at?: string
  [key: string]: unknown
}

export type SpecialofferProductPayload = Record<string, unknown>
