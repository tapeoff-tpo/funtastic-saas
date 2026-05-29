/**
 * Cafe24 API response types.
 *
 * Cafe24 uses a well-documented REST API with JSON responses.
 * These types represent the parsed response structures.
 */

/** A single order from Cafe24 orders API */
export interface Cafe24Order {
  order_id: string
  order_date: string
  order_status?: string
  buyer_name?: string
  buyer_cellphone?: string
  billing_name?: string
  member_id?: string
  member_email?: string
  receiver_name?: string
  receiver_cellphone?: string
  receiver_zipcode?: string
  receiver_address1?: string
  receiver_address2?: string
  items?: Cafe24OrderItem[]
  total_amount?: number | string
  payment_amount?: number | string
  actual_order_amount?: {
    payment_amount?: number | string
    order_price_amount?: number | string
  }
}

/** An order item within a Cafe24 order */
export interface Cafe24OrderItem {
  item_no: string
  product_name: string
  option_value: string
  quantity: number
  product_price: number
  sku?: string
}

/** Wrapper for Cafe24 order list response */
export interface Cafe24OrderResponse {
  orders: Cafe24Order[]
}

/** Wrapper for Cafe24 order detail response */
export interface Cafe24OrderDetailResponse {
  order?: Cafe24Order
}

/** A claim from Cafe24 API (cancellation, return, exchange) */
export interface Cafe24Claim {
  claim_id: string
  order_id: string
  claim_type: string
  claim_status: string
  claim_reason: string
  claim_date: string
}

/** Wrapper for Cafe24 claims responses */
export interface Cafe24ClaimResponse {
  cancellations?: Cafe24Claim[]
  returns?: Cafe24Claim[]
  exchanges?: Cafe24Claim[]
}

/** A single product from Cafe24 products API */
export interface Cafe24Product {
  product_no: string
  product_name: string
  selling_price: string | number | null
  product_code: string
  custom_product_code: string | null
  detail_image: string
  display: string
}

/** Wrapper for Cafe24 product list response */
export interface Cafe24ProductResponse {
  products: Cafe24Product[]
}

/** A single variant (옵션) from Cafe24 variants API */
export interface Cafe24Variant {
  variant_code: string
  custom_variant_code: string | null
  options: Array<{ name: string; value: string }>
  price: string | number | null
  stock_quantity: number | null
}

/** Wrapper for Cafe24 variants response */
export interface Cafe24VariantsResponse {
  variants: Cafe24Variant[]
}
