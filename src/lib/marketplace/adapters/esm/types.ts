/**
 * ESM Trading API response types.
 *
 * Based on the unified ESM Trading API at etapi.ebaykorea.com
 * that serves both Gmarket and Auction marketplaces.
 */

/** Standard ESM API response wrapper */
export interface EsmApiResponse<T> {
  resultCode: string
  resultMessage: string
  data: T
}

/** Site type discriminator: 'G' for Gmarket, 'A' for Auction */
export type EsmSiteType = 'G' | 'A'

/** A single order from the ESM Trading API */
export interface EsmOrder {
  orderNo: string
  siteType: EsmSiteType
  orderItemSeq: string
  itemName: string
  orderQty: number
  buyerName: string
  buyerPhone: string
  receiverName: string
  receiverPhone: string
  receiverZipcode: string
  receiverAddress: string
  receiverAddressDetail: string
  orderDate: string
  orderStatus: string
  sellPrice: number
  payAmount: number
  sellerItemCode?: string
  optionInfo?: string
}

/** A single claim from the ESM Trading API */
export interface EsmClaim {
  claimNo: string
  orderNo: string
  siteType: EsmSiteType
  claimType: string // CANCEL | RETURN | EXCHANGE
  claimStatus: string
  claimReason: string
  claimDate: string
}

/** A single product from the ESM Trading API */
export interface EsmProduct {
  itemNo: string
  siteType: EsmSiteType
  itemName: string
  sellPrice: number
  stockQty: number
  itemStatus: string
  categoryCode?: string
  categoryName?: string
  imageUrl?: string
  sellerItemCode?: string
  options?: EsmProductOption[]
}

/** Product option within an ESM product */
export interface EsmProductOption {
  optionNo: string
  optionName: string
  optionValue: string
  optionPrice: number
  stockQty: number
  sellerItemCode?: string
}

/** Payload for invoice upload */
export interface EsmInvoicePayload {
  orderNo: string
  orderItemSeq: string
  deliveryCompanyCode: string
  invoiceNo: string
}
