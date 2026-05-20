export interface HyundaiHmallXmlResponse {
  Response2XML?: {
    Dataset?: HyundaiHmallDataset | HyundaiHmallDataset[]
  }
  Dataset?: HyundaiHmallDataset | HyundaiHmallDataset[]
  error?: {
    code?: string
    message?: string
    detail?: string
  }
  [key: string]: unknown
}

export interface HyundaiHmallDataset {
  id?: string
  rows?: {
    row?: HyundaiHmallOrderRow | HyundaiHmallOrderRow[]
  }
  row?: HyundaiHmallOrderRow | HyundaiHmallOrderRow[]
  [key: string]: unknown
}

export interface HyundaiHmallOrderRow {
  dlvstNo?: string
  dlvstPtcSeq?: string
  ordNo?: string
  ordPtcSeq?: string
  ordQty?: string | number
  dlvstQty?: string | number
  prrgQty?: string | number
  slitmCd?: string
  uitmCd?: string
  uitmTotNm?: string
  slitmNm?: string
  lastDlvstPrgrGbcd?: string
  dlvstDsrvDlvcoCd?: string
  dlvTypeGbcd?: string
  dlvFormGbcd?: string
  invcNo?: string
  collectionPrgrGb?: string
  oshpReqnDt?: string
  oshpCnfmDtm?: string
  sellUprc?: string | number
  sellSum?: string | number
  prchUprcSum?: string | number
  dlvcAmt?: string | number
  dlvApltNm?: string
  dlvApltTel?: string
  rcvrNm?: string
  rcvrTel?: string
  rcvrHp?: string
  dstnPostNo?: string
  dstnAdr?: string
  dstnDtlAdr?: string
  ordCustNm?: string
  ordCustTel?: string
  ordCustHp?: string
  dlvMemo?: string
  venCd?: string
  ven2Cd?: string
  dlvCnclYn?: string
  [key: string]: unknown
}
