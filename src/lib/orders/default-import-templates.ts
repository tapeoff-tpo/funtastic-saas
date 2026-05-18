import type { OrderImportMapping } from './excel-import-fields'

export interface DefaultOrderImportTemplate {
  id: string
  name: string
  mappings: OrderImportMapping[]
  isDefault: true
  aliases: string[]
}

export const DEFAULT_ORDER_IMPORT_TEMPLATES: DefaultOrderImportTemplate[] = [
  {
    id: 'default:ownerclan',
    name: '오너클랜 주문수집',
    isDefault: true,
    aliases: ['ownerclan', '오너클랜'],
    mappings: [
      { field: 'orderNumber', excelColumn: '주문번호' },
      { field: 'marketplaceItemId', excelColumn: '상품코드' },
      { field: 'orderedAt', excelColumn: '일자' },
      { field: 'buyerName', excelColumn: '보내는사람' },
      { field: 'buyerPhone', excelColumn: '보내는사람 핸드폰', extraColumns: ['보내는사람 연락처'], joinSeparator: ' ' },
      { field: 'recipientName', excelColumn: '받는사람' },
      { field: 'recipientPhone', excelColumn: '받는사람 핸드폰', extraColumns: ['받는사람 전화번호'], joinSeparator: ' ' },
      { field: 'zipCode', excelColumn: '우편번호' },
      { field: 'recipientAddress', excelColumn: '주소' },
      { field: 'productName', excelColumn: '상품명' },
      { field: 'optionText', excelColumn: '옵션' },
      { field: 'quantity', excelColumn: '수량' },
      { field: 'totalAmount', excelColumn: '합계' },
      { field: 'sku', excelColumn: '공급사 관리코드1', extraColumns: ['공급사 관리코드2'], joinSeparator: ' ' },
      { field: 'deliveryMessage', excelColumn: '배송메세지' },
      { field: 'shippingFee', excelColumn: '배송비' },
    ],
  },
  {
    id: 'default:specialoffer',
    name: '스페셜오퍼 주문수집',
    isDefault: true,
    aliases: ['specialoffer', '스페셜오퍼'],
    mappings: [
      { field: 'orderNumber', excelColumn: '주문번호' },
      { field: 'marketplaceItemId', excelColumn: '상품코드' },
      { field: 'orderedAt', excelColumn: '주문일' },
      { field: 'buyerName', excelColumn: '수취인명' },
      { field: 'buyerPhone', excelColumn: '수취인연락처1', extraColumns: ['수취인연락처2'], joinSeparator: ' ' },
      { field: 'recipientName', excelColumn: '수취인명' },
      { field: 'recipientPhone', excelColumn: '수취인연락처1', extraColumns: ['수취인연락처2'], joinSeparator: ' ' },
      { field: 'zipCode', excelColumn: '우편번호' },
      { field: 'recipientAddress', excelColumn: '주소' },
      { field: 'productName', excelColumn: '상품명' },
      { field: 'optionText', excelColumn: '주문옵션1', extraColumns: ['주문옵션2', '입력옵션'], joinSeparator: ' ' },
      { field: 'quantity', excelColumn: '구매수량' },
      { field: 'totalAmount', excelColumn: '상품합계' },
      { field: 'sku', excelColumn: '공급사 전용 상품코드' },
      { field: 'deliveryMessage', excelColumn: '주문자 요청사항' },
      { field: 'shippingFee', excelColumn: '배송비' },
    ],
  },
  {
    id: 'default:domesin',
    name: '도매의신 주문수집',
    isDefault: true,
    aliases: ['domesin', '도매의신'],
    mappings: [
      { field: 'orderNumber', excelColumn: '주문코드' },
      { field: 'marketplaceItemId', excelColumn: '상품코드' },
      { field: 'orderedAt', excelColumn: '주문일시' },
      { field: 'buyerName', excelColumn: '수취인' },
      { field: 'buyerPhone', excelColumn: '수취인휴대폰', extraColumns: ['수취인전화'], joinSeparator: ' ' },
      { field: 'recipientName', excelColumn: '수취인' },
      { field: 'recipientPhone', excelColumn: '수취인휴대폰', extraColumns: ['수취인전화'], joinSeparator: ' ' },
      { field: 'zipCode', excelColumn: '우편번호' },
      { field: 'recipientAddress', excelColumn: '주소' },
      { field: 'productName', excelColumn: '상품명' },
      { field: 'optionText', excelColumn: '선택옵션', extraColumns: ['입력옵션'], joinSeparator: ' ' },
      { field: 'quantity', excelColumn: '수량' },
      { field: 'totalAmount', excelColumn: '공급가' },
      { field: 'sku', excelColumn: '업체상품코드' },
      { field: 'deliveryMessage', excelColumn: '주문요청사항' },
      { field: 'shippingFee', excelColumn: '배송비' },
    ],
  },
  {
    id: 'default:onchannel',
    name: '온채널 주문수집',
    isDefault: true,
    aliases: ['onchannel', '온채널'],
    mappings: [
      { field: 'orderNumber', excelColumn: '주문코드' },
      { field: 'marketplaceItemId', excelColumn: '상품코드' },
      { field: 'orderedAt', excelColumn: '일자' },
      { field: 'buyerName', excelColumn: '고객명' },
      { field: 'buyerPhone', excelColumn: '연락처', extraColumns: ['비상연락처'], joinSeparator: ' ' },
      { field: 'recipientName', excelColumn: '고객명' },
      { field: 'recipientPhone', excelColumn: '연락처', extraColumns: ['비상연락처'], joinSeparator: ' ' },
      { field: 'zipCode', excelColumn: '우편번호' },
      { field: 'recipientAddress', excelColumn: '배송지주소' },
      { field: 'productName', excelColumn: '상품명' },
      { field: 'optionText', excelColumn: '옵션' },
      { field: 'quantity', excelColumn: '수량' },
      { field: 'totalAmount', excelColumn: '가격' },
      { field: 'sku', excelColumn: '자체코드' },
      { field: 'deliveryMessage', excelColumn: '남김말' },
    ],
  },
]

function normalizeImportTemplateKey(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '')
}

export function findDefaultOrderImportTemplate(
  marketplaceId: string,
  marketplaceName?: string,
): DefaultOrderImportTemplate | null {
  const keys = [marketplaceId, marketplaceName ?? ''].map(normalizeImportTemplateKey).filter(Boolean)
  return DEFAULT_ORDER_IMPORT_TEMPLATES.find((template) =>
    template.aliases.some((alias) => keys.some((key) => key.includes(normalizeImportTemplateKey(alias)))),
  ) ?? null
}
