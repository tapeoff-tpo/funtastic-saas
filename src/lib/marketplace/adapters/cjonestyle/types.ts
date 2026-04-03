/**
 * CJ온스타일 API response types.
 *
 * CJ온스타일 uses a JSON REST API with API key authentication.
 * These types represent the parsed response structures.
 */

/** A single order from CJ온스타일 orders API */
export interface CjOnestyleOrder {
  order_id: string
  order_date: string
  order_status: string
  buyer_name: string
  buyer_phone: string
  receiver_name: string
  receiver_phone: string
  receiver_zipcode: string
  receiver_address: string
  receiver_address_detail: string
  items: CjOnestyleOrderItem[]
  total_amount: number
}

/** An order item within a CJ온스타일 order */
export interface CjOnestyleOrderItem {
  item_id: string
  product_name: string
  option_name: string
  quantity: number
  price: number
  sku?: string
}

/** Wrapper for CJ온스타일 order list response */
export interface CjOnestyleOrderResponse {
  orders: CjOnestyleOrder[]
}

/** A claim from CJ온스타일 API */
export interface CjOnestyleClaim {
  claim_id: string
  order_id: string
  claim_type: string
  claim_status: string
  claim_reason: string
  claim_date: string
}

/** Wrapper for CJ온스타일 claims response */
export interface CjOnestyleClaimResponse {
  claims: CjOnestyleClaim[]
}

/** A single product from CJ온스타일 products API */
export interface CjOnestyleProduct {
  product_id: string
  product_name: string
  price: number
  product_code: string
  image_url: string
  status: string
}

/** Wrapper for CJ온스타일 product list response */
export interface CjOnestyleProductResponse {
  products: CjOnestyleProduct[]
}
