/**
 * Default carrier template definitions and available order fields.
 *
 * Provides 5 default carrier templates for primary Korean carriers
 * and the full list of exportable order fields with Korean labels.
 */

import type { CarrierTemplateColumn } from '../types'

/** Exportable order field definition */
export interface OrderFieldDef {
  field: string
  label: string
}

/** Carrier template blueprint (without id/userId -- used for seeding) */
export interface CarrierTemplateDef {
  carrierId: string
  name: string
  columns: CarrierTemplateColumn[]
  isDefault: boolean
}

/** Built-in export template available to every user without DB seeding. */
export interface BuiltInCarrierTemplateDef {
  id: string
  carrierId: string | null
  name: string
  columns: CarrierTemplateColumn[]
  isDefault: boolean
}

/**
 * All fields available for order export.
 * Korean labels match the standard Korean e-commerce terminology.
 */
export const AVAILABLE_ORDER_FIELDS: OrderFieldDef[] = [
  { field: 'internalNo', label: '내부 주문번호' },
  { field: 'marketplaceOrderId', label: '마켓 주문번호' },
  { field: 'marketplaceItemId', label: '마켓 상품코드' },
  { field: 'marketplaceId', label: '마켓플레이스' },
  { field: 'marketplaceCode', label: '마켓플레이스 코드' },
  { field: 'productCode', label: '내부 상품코드' },
  { field: 'buyerName', label: '구매자' },
  { field: 'recipientName', label: '수령인' },
  { field: 'recipientPhone', label: '수령인연락처' },
  { field: 'shippingAddress.zipCode', label: '우편번호' },
  { field: 'shippingAddress.address1', label: '주소' },
  { field: 'shippingAddress.address2', label: '상세주소' },
  { field: 'productName', label: '상품명' },
  { field: 'optionText', label: '옵션(확정)' },
  { field: 'quantity', label: '수량' },
  { field: 'unitPrice', label: '단가' },
  { field: 'totalAmount', label: '합계금액' },
  { field: 'trackingNumber', label: '송장번호' },
  { field: 'carrierName', label: '택배사' },
  { field: 'orderedAt', label: '주문일' },
  { field: 'status', label: '주문상태' },
  { field: 'marketplaceStatus', label: '마켓 주문상태' },
  { field: 'buyerPhone', label: '구매자연락처' },
  // ─ 추가 출력 항목 ─
  { field: 'recipientPhone2', label: '수령인연락처2' },
  { field: 'buyerPhone2', label: '구매자연락처2' },
  { field: 'stock', label: '현재고' },
  { field: 'logisticsMessage', label: '물류메세지' },
  { field: 'deliveryMessage', label: '배송메세지' },
  { field: 'senderName', label: '발화주명' },
  { field: 'supplyPrice', label: '공급단가' },
  { field: 'costPrice', label: '원가' },
  { field: 'collectedAt', label: '수집일자(yyyy-mm-dd)' },
  { field: 'collectedDateYmd', label: '수집일자(YYYYMMDD)' },
  { field: 'collectedOption', label: '옵션(수집)' },
  { field: 'location', label: '로케이션' },
  { field: 'pickingLocation', label: '피킹위치' },
  { field: 'packaging', label: '포장' },
  { field: 'etc1', label: '기타1' },
  { field: 'etc2', label: '기타2' },
  { field: 'etc3', label: '기타3' },
  { field: 'etc4', label: '기타4' },
  { field: 'etc5', label: '기타5' },
  { field: 'etc6', label: '기타6' },
  { field: 'etc7', label: '기타7' },
  { field: 'etc8', label: '기타8' },
  { field: 'etc9', label: '기타9' },
  { field: 'etc10', label: '기타10' },
]

export const BUILT_IN_CARRIER_TEMPLATES: BuiltInCarrierTemplateDef[] = [
  {
    id: 'builtin:held-order-filter',
    carrierId: null,
    name: '미발송 필터양식',
    isDefault: true,
    columns: [
      { header: '주문상태', field: 'status', width: 8, required: false, fixedValue: '미발송' },
      { header: '쇼핑몰', field: 'marketplaceId', width: 18, required: false },
      { header: '사방넷 주문번호', field: 'internalNo', width: 13, required: true },
      { header: '수집일자(YYYYMMDD)', field: 'collectedDateYmd', width: 19, required: false },
      { header: '쇼핑몰 주문번호', field: 'marketplaceOrderId', width: 26, required: false },
      { header: '택배사', field: 'carrierName', width: 9, required: false },
      { header: '송장번호', field: 'trackingNumber', width: 13, required: false },
      { header: '수취인명', field: 'recipientName', width: 18, required: false },
      { header: '상품약어', field: 'productName', width: 27, required: false },
      { header: '옵션명(확정)', field: 'optionText', width: 20, required: false },
      { header: '수량', field: 'quantity', width: 5, required: false },
      { header: '주문자명', field: 'buyerName', width: 18, required: false },
      { header: '상품코드(사방넷)', field: 'productCode', width: 14, required: true },
      { header: '물류메세지', field: 'logisticsMessage', width: 13, required: false },
      { header: '위치', field: 'location', width: 16, required: false },
    ],
  },
]

/**
 * Default carrier templates for the 5 primary Korean carriers.
 * Column layouts match each carrier's standard Excel import format.
 */
export const DEFAULT_CARRIER_TEMPLATES: CarrierTemplateDef[] = [
  {
    carrierId: 'CJGLS',
    name: 'CJ대한통운',
    isDefault: true,
    columns: [
      { header: '수령인', field: 'recipientName', width: 15, required: true },
      { header: '수령인연락처', field: 'recipientPhone', width: 15, required: true },
      { header: '우편번호', field: 'shippingAddress.zipCode', width: 10, required: true },
      { header: '주소', field: 'shippingAddress.address1', width: 30, required: true },
      { header: '상세주소', field: 'shippingAddress.address2', width: 30, required: false },
      { header: '상품명', field: 'productName', width: 25, required: true },
      { header: '수량', field: 'quantity', width: 8, required: true },
      { header: '주문번호', field: 'marketplaceOrderId', width: 15, required: false },
      { header: '비고', field: 'optionText', width: 15, required: false },
    ],
  },
  {
    carrierId: 'HANJIN',
    name: '한진택배',
    isDefault: true,
    columns: [
      { header: '수령인', field: 'recipientName', width: 15, required: true },
      { header: '수령인연락처', field: 'recipientPhone', width: 15, required: true },
      { header: '우편번호', field: 'shippingAddress.zipCode', width: 10, required: true },
      { header: '주소', field: 'shippingAddress.address1', width: 30, required: true },
      { header: '상세주소', field: 'shippingAddress.address2', width: 30, required: false },
      { header: '상품명', field: 'productName', width: 25, required: true },
      { header: '수량', field: 'quantity', width: 8, required: true },
      { header: '주문번호', field: 'marketplaceOrderId', width: 15, required: false },
    ],
  },
  {
    carrierId: 'HYUNDAI',
    name: '롯데택배',
    isDefault: true,
    columns: [
      { header: '수령인', field: 'recipientName', width: 15, required: true },
      { header: '수령인연락처', field: 'recipientPhone', width: 15, required: true },
      { header: '우편번호', field: 'shippingAddress.zipCode', width: 10, required: true },
      { header: '주소', field: 'shippingAddress.address1', width: 30, required: true },
      { header: '상세주소', field: 'shippingAddress.address2', width: 30, required: false },
      { header: '상품명', field: 'productName', width: 25, required: true },
      { header: '수량', field: 'quantity', width: 8, required: true },
      { header: '비고', field: 'optionText', width: 15, required: false },
    ],
  },
  {
    carrierId: 'EPOST',
    name: '우체국택배',
    isDefault: true,
    columns: [
      { header: '수령인', field: 'recipientName', width: 15, required: true },
      { header: '수령인연락처', field: 'recipientPhone', width: 15, required: true },
      { header: '우편번호', field: 'shippingAddress.zipCode', width: 10, required: true },
      { header: '주소', field: 'shippingAddress.address1', width: 30, required: true },
      { header: '상세주소', field: 'shippingAddress.address2', width: 30, required: false },
      { header: '상품명', field: 'productName', width: 25, required: true },
      { header: '수량', field: 'quantity', width: 8, required: true },
      { header: '중량(g)', field: 'weight', width: 15, required: false },
    ],
  },
  {
    carrierId: 'KGB',
    name: '로젠택배',
    isDefault: true,
    columns: [
      { header: '수령인', field: 'recipientName', width: 15, required: true },
      { header: '수령인연락처', field: 'recipientPhone', width: 15, required: true },
      { header: '우편번호', field: 'shippingAddress.zipCode', width: 10, required: true },
      { header: '주소', field: 'shippingAddress.address1', width: 30, required: true },
      { header: '상세주소', field: 'shippingAddress.address2', width: 30, required: false },
      { header: '상품명', field: 'productName', width: 25, required: true },
      { header: '수량', field: 'quantity', width: 8, required: true },
      { header: '주문번호', field: 'marketplaceOrderId', width: 15, required: false },
    ],
  },
  {
    carrierId: 'KYUNGDONG',
    name: '경동택배 발주서 양식',
    isDefault: true,
    columns: [
      { header: '받는분', field: 'recipientName', width: 16, required: true },
      { header: '주소', field: 'shippingAddress.address1', width: 28, required: true },
      { header: '상세주소', field: 'shippingAddress.address2', width: 36, required: false },
      { header: '운송장번호', field: 'trackingNumber', width: 16, required: false },
      { header: '고객사주문번호', field: 'internalNo', width: 18, required: false },
      { header: '우편번호', field: 'shippingAddress.zipCode', width: 10, required: true },
      { header: '도착영업소', field: 'etc1', width: 12, required: false },
      { header: '전화번호', field: 'recipientPhone', width: 16, required: false },
      { header: '기타전화번호', field: 'recipientPhone2', width: 16, required: false },
      { header: '품목명', field: 'productName', width: 36, required: true },
      { header: '수량', field: 'quantity', width: 8, required: true },
      { header: '포장상태', field: 'packaging', width: 12, required: false },
      { header: '가로', field: 'etc2', width: 8, required: false },
      { header: '세로', field: 'etc3', width: 8, required: false },
      { header: '높이', field: 'etc4', width: 8, required: false },
      { header: '무게', field: 'etc5', width: 8, required: false },
      { header: '개별단가', field: 'etc6', width: 10, required: false, fixedValue: '100' },
      { header: '배송운임', field: 'etc7', width: 10, required: false },
      { header: '기타운임', field: 'etc8', width: 10, required: false, fixedValue: '100' },
      { header: '별도운임', field: 'etc9', width: 10, required: false },
      { header: '할증운임', field: 'etc10', width: 10, required: false },
      { header: '도서운임', field: 'etc1', width: 10, required: false },
      { header: '메모', field: 'deliveryMessage', width: 30, required: false },
      { header: '상품코드(사방넷)', field: 'productCode', width: 16, required: false },
    ],
  },
  {
    carrierId: 'DAESIN',
    name: '대신택배 발주서 양식',
    isDefault: true,
    columns: [
      { header: '수화주전화1', field: 'recipientPhone', width: 16, required: false },
      { header: '수화주전화2', field: 'recipientPhone2', width: 16, required: false },
      { header: '수화주명', field: 'recipientName', width: 16, required: true },
      {
        header: '주소',
        field: 'shippingAddress.address1',
        extraFields: ['shippingAddress.address2'],
        joinSeparator: ' ',
        width: 48,
        required: true,
      },
      { header: '수량 ', field: 'quantity', width: 8, required: true },
      { header: '품명', field: 'internalNo', width: 18, required: false },
      { header: '포장', field: 'packaging', width: 12, required: false, fixedValue: '박스' },
      { header: '운임구분', field: 'etc1', width: 10, required: false, fixedValue: '현불' },
      { header: '운송상품', field: 'etc2', width: 10, required: false, fixedValue: '택배' },
      { header: '우편번호', field: 'shippingAddress.zipCode', width: 10, required: true },
      { header: '도착영업소', field: 'etc3', width: 12, required: false },
      { header: '발화주명', field: 'senderName', width: 18, required: false },
      { header: '발화주전화번호', field: 'etc4', width: 16, required: false, fixedValue: '07075257771' },
      { header: '발송제비용', field: 'etc5', width: 10, required: false, fixedValue: '0' },
      { header: '운임', field: 'etc6', width: 10, required: false, fixedValue: '0' },
      { header: '도착제비용', field: 'etc7', width: 10, required: false, fixedValue: '0' },
      { header: '총운임', field: 'etc8', width: 10, required: false },
      { header: '특기사항', field: 'productName', width: 36, required: false },
      { header: '사방넷상품코드', field: 'productCode', width: 16, required: false },
      { header: '쇼핑몰 주문번호', field: 'marketplaceOrderId', width: 22, required: false },
      { header: '물류메시지', field: 'logisticsMessage', width: 24, required: false },
    ],
  },
]
