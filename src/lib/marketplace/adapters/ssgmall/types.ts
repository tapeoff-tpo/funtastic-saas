export interface SsgmallApiResponse {
  resultCode?: string
  resultMessage?: string
  resultDesc?: string
  result?: {
    resultCode?: string
    resultMessage?: string
    resultDesc?: string
  }
  shppDirections?: SsgmallDirectionOrder[] | { shppDirection?: SsgmallDirectionOrder[] | SsgmallDirectionOrder }
  shppDirection?: SsgmallDirectionOrder[] | SsgmallDirectionOrder
  warehouseOuts?: SsgmallDirectionOrder[] | { warehouseOut?: SsgmallDirectionOrder[] | SsgmallDirectionOrder }
  warehouseOut?: SsgmallDirectionOrder[] | SsgmallDirectionOrder
  resultList?: SsgmallDirectionOrder[] | SsgmallDirectionOrder
  data?: SsgmallApiResponse
  response?: SsgmallApiResponse
  body?: SsgmallApiResponse
}

export interface SsgmallDirectionRequest {
  requestShppDirection: {
    perdType: '01' | '02' | '03'
    perdStrDts: string
    perdEndDts: string
    commType?: '01' | '02'
    commValue?: string
    infloSiteNo?: string
    shppDivDtlCd?: string
    ordStatCd?: string
    shppStatCd?: '10' | '30'
    rsvtItemYn?: string
    frgShppYn?: string
    reOrderYns?: string
    itemNm?: string
    itemDiv?: string
    itemId?: string
    splVenItemId?: string
    rcptpeNm?: string
    ordpeNm?: string
    mbrId?: string
    mallTypeCd?: string
  }
}

export interface SsgmallWarehouseOutRequest {
  requestWarehouseOut: {
    perdType: '01' | '02' | '03' | '04'
    perdStrDts: string
    perdEndDts: string
    commType?: '01' | '02'
    commValue?: string
    infloSiteNo?: string
    shppDivDtlCd?: string
    shppStatCd?: '10' | '30'
    shppProgStatDtl?: '22' | '42'
    frgShppYn?: string
    reOrderYns?: string
    itemNm?: string
    shppItemDivCd?: string
    wblNoRegYn?: string
    weightInfoRegYn?: string
    itemDiv?: string
    itemId?: string
    splVenItemId?: string
    rcptpeNm?: string
    ordpeNm?: string
    mbrId?: string
    mallTypeCd?: string
    shppExptDivCd?: string
    shppRsvtTypeCd?: string
  }
}

export interface SsgmallDirectionOrder {
  ordNo?: string
  ordItemSeq?: number | string
  orordNo?: string
  orordItemSeq?: number | string
  shppNo?: string
  shppSeq?: number | string
  ordStatCd?: string
  shppStatCd?: string
  shppStatNm?: string
  shppTabProgStatCd?: string
  lastShppProgStatDtlCd?: string
  lastShppProgStatDtlNm?: string
  shppDivDtlCd?: string
  shppDivDtlNm?: string
  shppProgStatDtlCd?: string
  ordItemStatCd?: string
  shppRsvtDt?: string
  ordRcpDts?: string
  ordCmplDts?: string
  ordCmplDt?: string
  paymtCmplDt?: string
  siteNo?: string
  siteNm?: string
  shppVenId?: string
  shppVenNm?: string
  itemNm?: string
  itemId?: string
  uitemId?: string
  uitemNm?: string
  splVenItemId?: string
  uSplVenItemId?: string
  mdlNm?: string
  dircItemQty?: number | string
  cnclItemQty?: number | string
  ordQty?: number | string
  rlordQty?: number | string
  cnclQty?: number | string
  dircQty?: number | string
  splprc?: number | string
  splPrc?: number | string
  sellprc?: number | string
  rlordAmt?: number | string
  dcAmt?: number | string
  ordpeNm?: string
  ordpeHpno?: string
  rcptpeNm?: string
  rcptpeHpno?: string
  rcptpeTelno?: string
  shpplocZipcd?: string
  shpplocOldZipcd?: string
  shpplocAddr?: string
  shpplocRoadAddr?: string
  ordpeRoadAddr?: string
  shpplocBascAddr?: string
  shpplocDtlAddr?: string
  shppcst?: number | string
  shppcstCodYn?: 'Y' | 'N'
  ordMemoCntt?: string
  memoCntt?: string
  itemDiv?: string
  ordItemDivNm?: string
  mallTypeCd?: string
  mbrLoginId?: string
  mbrNm?: string
  splVenNm?: string
  [key: string]: unknown
}
