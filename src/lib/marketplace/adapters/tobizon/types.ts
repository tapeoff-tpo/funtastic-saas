export interface TobizonCredentials {
  api_key: string
  secure_key: string
  client_server_ip: string
}

export interface TobizonOptionItem {
  opt1?: string
  opt2?: string
  price_consumer: number
  price_supply: number
  runout: 'Y' | 'N'
}

export interface TobizonInputOption {
  cont: string
  ind: 'Y' | 'N'
}

export interface TobizonCertification {
  certnm: string
  num: string
}

export interface TobizonGosi {
  code: string
  item: string[]
}

export interface TobizonGoodsPayload {
  catecode: number
  goodsnm: string
  goodssm: string
  vgoodscd: string
  tax: 'Y' | 'N'
  maker: string
  origin: string
  brand?: string
  model?: string
  keyword: string
  consumer_keep: 'Y' | 'N'
  consumer_print: 'Y' | 'N'
  price_consumer: string | number
  price_supply: number
  useoption: 'Y' | 'N'
  optionnm?: string
  option_items?: TobizonOptionItem[]
  inpuseoption: 'Y' | 'N'
  inpoption?: TobizonInputOption[]
  delivery_type: 'FE' | 'FR' | 'FC'
  delivery_fee_type: 'SC' | 'S' | 'C'
  delivery_price: number
  box_unit?: number
  foreign_delivery: 'Y' | 'N'
  returnyn: 'Y' | 'N'
  return_price: number
  exchange_price: number
  extra_price: number
  extra_price2: number
  image: string[]
  runout: 'S' | 'P' | 'D'
  gstatus: 'N' | 'O' | 'D'
  gtype: 'B' | 'H' | 'M'
  adult: 'Y' | 'N'
  certtype: 'A' | 'B' | 'C'
  cert?: TobizonCertification[]
  longdesc: string
  gosi: TobizonGosi[]
  [key: string]: unknown
}

export interface TobizonGoodsResponse {
  code: 'success' | 'error' | string
  mag?: string
  msg?: string
  message?: string
  partnercd?: string
  goodscd?: string
  [key: string]: unknown
}
