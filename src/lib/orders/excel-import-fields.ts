export const ORDER_IMPORT_FIELDS = [
  { field: 'orderNumber', label: '주문번호', required: true },
  { field: 'buyerName', label: '주문자명', required: true },
  { field: 'buyerPhone', label: '주문자전화', required: false },
  { field: 'recipientName', label: '수령자명', required: true },
  { field: 'recipientAddress', label: '수령자주소', required: true },
  { field: 'recipientPhone', label: '수령자전화', required: false },
  { field: 'zipCode', label: '우편번호', required: false },
  { field: 'orderedAt', label: '주문일시', required: true },
  { field: 'productName', label: '상품명', required: true },
  { field: 'optionText', label: '옵션', required: false },
  { field: 'quantity', label: '수량', required: true },
  { field: 'totalAmount', label: '금액(원)', required: true },
  { field: 'sku', label: 'SKU', required: false },
  { field: 'marketplaceItemId', label: '마켓상품주문번호', required: false },
  { field: 'deliveryMessage', label: '배송메시지', required: false },
  { field: 'shippingFee', label: '배송비', required: false },
] as const

export type OrderImportField = (typeof ORDER_IMPORT_FIELDS)[number]['field']

export interface OrderImportMapping {
  field: string
  excelColumn: string
  fixedValue?: string
  extraColumns?: string[]
  joinSeparator?: string
}

export const ORDER_IMPORT_FIELD_LABELS: Record<string, string> = Object.fromEntries(
  ORDER_IMPORT_FIELDS.map((field) => [field.field, field.label]),
)

export const REQUIRED_ORDER_IMPORT_FIELDS = ORDER_IMPORT_FIELDS
  .filter((field) => field.required)
  .map((field) => field.field)
