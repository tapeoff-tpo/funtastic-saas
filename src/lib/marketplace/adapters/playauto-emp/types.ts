export interface PlayautoEmpOrder {
  UniqueId?: string | number
  Number?: string | number
  SiteCode?: string
  SiteName?: string
  SiteId?: string
  Userid?: string
  WriteDate?: string
  OrderDate?: string
  CashDate?: string
  DelivDate?: string
  StateDate?: string
  OrderState?: string
  OrderCode?: string
  ProdCode?: string
  ProdName?: string
  Option?: string
  OptionPrice?: string | number
  PlusOption?: string
  PlusOptionPrice?: string | number
  CostPrice?: string | number
  SupplyPrice?: string | number
  Price?: string | number
  Count?: string | number
  DelivMethod?: string
  DelivPrice?: string | number
  OrderId?: string
  OrderName?: string
  OrderTel?: string
  OrderHtel?: string
  OrderEmail?: string
  RecipientName?: string
  RecipientNameEng?: string
  RecipientTel?: string
  RecipientHtel?: string
  RecipientZip?: string
  RecipientAddress?: string
  Msg?: string
  Sender?: string
  SenderNo?: string
  MasterCode?: string
  SellerCode?: string
  NoticeMsg?: string
  CustomerId?: string
  Bonus?: string
  GprivateNo?: string
  Groupkey?: string
  Note?: string
  Delivno?: string
  Sku_code?: string
  [key: string]: unknown
}

export type PlayautoEmpListResponse =
  | PlayautoEmpOrder[]
  | {
      data?: PlayautoEmpOrder[] | PlayautoEmpOrder | { list?: PlayautoEmpOrder[]; orders?: PlayautoEmpOrder[] }
      list?: PlayautoEmpOrder[]
      orders?: PlayautoEmpOrder[]
      result?: PlayautoEmpOrder[]
      rows?: PlayautoEmpOrder[]
      message?: string
      msg?: string
      error?: string
      success?: boolean
    }

export interface PlayautoEmpSenderResponse {
  number?: string | number
  status?: string | boolean
  msg?: string
  message?: string
  error?: string
  data?: PlayautoEmpSenderResponse[] | PlayautoEmpSenderResponse
  result?: PlayautoEmpSenderResponse[] | PlayautoEmpSenderResponse
  [key: string]: unknown
}
