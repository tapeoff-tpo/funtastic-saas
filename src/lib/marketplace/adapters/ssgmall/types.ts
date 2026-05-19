export interface SsgmallApiResponse {
  resultCode?: string
  resultMessage?: string
  resultDesc?: string
  shppDirections?: SsgmallDirectionOrder[] | { shppDirection?: SsgmallDirectionOrder[] | SsgmallDirectionOrder }
}

export interface SsgmallDirectionRequest {
  requestShppDirection: {
    perdType: '01' | '02' | '03'
    perdStrDts: string
    perdEndDts: string
    shppStatCd?: '10' | '30'
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
  shppDivDtlCd?: string
  shppDivDtlNm?: string
  shppProgStatDtlCd?: string
  shppRsvtDt?: string
  ordRcpDts?: string
  ordCmplDts?: string
  siteNo?: string
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
  splprc?: number | string
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
  [key: string]: unknown
}
