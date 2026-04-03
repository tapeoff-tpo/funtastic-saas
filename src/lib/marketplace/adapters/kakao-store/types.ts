/**
 * 카카오톡스토어 API response types.
 *
 * 카카오톡스토어 uses a JSON REST API with API key authentication.
 * These types represent the parsed response structures.
 */

/** A single order from 카카오톡스토어 orders API */
export interface KakaoStoreOrder {
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
  items: KakaoStoreOrderItem[]
  total_amount: number
}

/** An order item within a 카카오톡스토어 order */
export interface KakaoStoreOrderItem {
  item_id: string
  product_name: string
  option_text: string
  quantity: number
  price: number
  sku?: string
}

/** Wrapper for 카카오톡스토어 order list response */
export interface KakaoStoreOrderResponse {
  orders: KakaoStoreOrder[]
}

/** A claim from 카카오톡스토어 API */
export interface KakaoStoreClaim {
  claim_id: string
  order_no: string
  claim_type: string
  claim_status: string
  claim_reason: string
  claimed_at: string
}

/** Wrapper for 카카오톡스토어 claims response */
export interface KakaoStoreClaimResponse {
  claims: KakaoStoreClaim[]
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
