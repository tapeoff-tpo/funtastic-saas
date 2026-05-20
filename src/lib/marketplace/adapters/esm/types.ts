/**
 * ESM Trading API response types.
 *
 * Based on the unified ESM Trading API at etapi.ebaykorea.com
 * that serves both Gmarket and Auction marketplaces.
 */

/** Standard ESM API response wrapper */
export interface EsmApiResponse<T> {
  resultCode?: string | number
  ResultCode?: string | number
  resultMessage?: string
  Message?: string
  data?: T
  Data?: T
  TotalCount?: number
}

export interface EsmOrderListData {
  SiteType?: number
  PageIndex?: number
  PageSize?: number
  TotalCount?: number
  SellerId?: string
  RequestOrders?: EsmOrder[]
}

/** Site type discriminator: 'G' for Gmarket, 'A' for Auction */
export type EsmSiteType = 'G' | 'A'

/** A single order from the ESM Trading API */
export interface EsmOrder {
  orderNo?: string
  OrderNo?: number | string
  siteType?: EsmSiteType
  SiteType?: number
  orderItemSeq?: string
  OrderSeqNo?: number | string
  itemName?: string
  GoodsName?: string
  orderQty?: number
  OrderQty?: number
  ContrAmount?: number
  buyerName?: string
  BuyerName?: string
  buyerPhone?: string
  BuyerTelNo?: string
  BuyerMobileTel?: string
  BuyerTel?: string
  receiverName?: string
  ReceiverName?: string
  receiverPhone?: string
  ReceiverTelNo?: string
  HpNo?: string
  TelNo?: string
  receiverZipcode?: string
  ZipCode?: string
  receiverAddress?: string
  Address?: string
  DelFrontAddress?: string
  DelFullAddress?: string
  receiverAddressDetail?: string
  AddressDetail?: string
  DelBackAddress?: string
  DelMemo?: string
  orderDate?: string
  OrderDate?: string
  PayDate?: string
  orderStatus?: string
  OrderStatus?: string | number
  sellPrice?: number
  SellPrice?: number
  SalePrice?: string | number
  payAmount?: number
  BuyerPayAmt?: number
  AcntMoney?: string | number
  OrderAmount?: string | number
  ShippingFee?: string | number
  sellerItemCode?: string
  SellerCustNo?: string
  OutGoodsNo?: string
  SiteGoodsNo?: string
  optionInfo?: string
  OptionInfo?: string
  ItemOptionSelectList?: Array<{
    ItemOptionValue?: string
    ItemOptionOrderCnt?: number
    ItemOptionCode?: string
  }>
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
