/**
 * 11st (11번가) API response types.
 *
 * 11st Open API uses XML responses. These types represent
 * the parsed XML structure after fast-xml-parser processing.
 */

/** A single order from 11st order list API */
export interface ElevenstOrder {
  ordNo: string
  ordPrdSeq: string
  prdNm: string
  ordQty: number
  buyerNm: string
  buyerPhone: string
  rcvrNm: string
  rcvrPhone: string
  rcvrZipCd: string
  rcvrBaseAddr: string
  rcvrDtlAddr: string
  ordDt: string
  ordStCd: string
  selPrice: number
  dlvNo: string
  optNm?: string
}

/** Wrapper for 11st order list XML response */
export interface ElevenstOrderResponse {
  orders: {
    order: ElevenstOrder | ElevenstOrder[]
  }
}

/** A single claim from 11st claims API */
export interface ElevenstClaim {
  clmNo: string
  ordNo: string
  clmTypCd: string // CNC (cancel), RTN (return), EXC (exchange)
  clmStCd: string
  clmRsnCont: string
  clmDt: string
}

/** Wrapper for 11st claims XML response */
export interface ElevenstClaimResponse {
  claims: {
    claim: ElevenstClaim | ElevenstClaim[]
  }
}

/** A single product from 11st products API */
export interface ElevenstProduct {
  prdNo: string
  prdNm: string
  prdStatCd: string
  selPrice: number
  prdImage01: string
}

/** Wrapper for 11st product list XML response */
export interface ElevenstProductResponse {
  products: {
    product: ElevenstProduct | ElevenstProduct[]
  }
}

/** Invoice upload request body for 11st */
export interface ElevenstInvoiceRequest {
  ordNo: string
  ordPrdSeq: string
  dlvMthdCd: string
  dlvCpnyCd: string
  invoiceNo: string
}
