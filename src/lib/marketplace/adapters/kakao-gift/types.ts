/**
 * 카카오선물하기 API response types.
 *
 * 카카오선물하기 uses a JSON REST API with API key authentication.
 * These types represent the parsed response structures.
 */

/** A single order from 카카오선물하기 orders API */
export interface KakaoGiftOrder {
  order_no: string
  ordered_at: string
  status: string
  buyer_name: string
  buyer_phone: string
  receiver_name: string
  receiver_phone: string
  receiver_zipcode: string
  receiver_address: string
  receiver_address_detail: string
  items: KakaoGiftOrderItem[]
  total_amount: number
}

/** An order item within a 카카오선물하기 order */
export interface KakaoGiftOrderItem {
  item_id: string
  product_name: string
  option_text: string
  quantity: number
  price: number
  sku?: string
}

/** Wrapper for 카카오선물하기 order list response */
export interface KakaoGiftOrderResponse {
  orders: KakaoGiftOrder[]
}

/** A claim from 카카오선물하기 API */
export interface KakaoGiftClaim {
  claim_id: string
  order_no: string
  claim_type: string
  claim_status: string
  claim_reason: string
  claimed_at: string
}

/** Wrapper for 카카오선물하기 claims response */
export interface KakaoGiftClaimResponse {
  claims: KakaoGiftClaim[]
}

/** A single product from 카카오선물하기 products API */
export interface KakaoGiftProduct {
  product_id: string
  product_name: string
  price: number
  product_code: string
  image_url: string
  status: string
}

/** Wrapper for 카카오선물하기 product list response */
export interface KakaoGiftProductResponse {
  products: KakaoGiftProduct[]
}
