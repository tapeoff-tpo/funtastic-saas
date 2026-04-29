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

/**
 * All fields available for order export.
 * Korean labels match the standard Korean e-commerce terminology.
 */
export const AVAILABLE_ORDER_FIELDS: OrderFieldDef[] = [
  { field: 'orderId', label: '내부 주문번호' },
  { field: 'internalNo', label: '내부 주문번호' },
  { field: 'marketplaceOrderId', label: '마켓주문번호' },
  { field: 'marketplaceId', label: '마켓플레이스' },
  { field: 'buyerName', label: '구매자' },
  { field: 'recipientName', label: '수령인' },
  { field: 'recipientPhone', label: '수령인연락처' },
  { field: 'shippingAddress.zipCode', label: '우편번호' },
  { field: 'shippingAddress.address1', label: '주소' },
  { field: 'shippingAddress.address2', label: '상세주소' },
  { field: 'productName', label: '상품명' },
  { field: 'optionText', label: '옵션' },
  { field: 'quantity', label: '수량' },
  { field: 'unitPrice', label: '단가' },
  { field: 'totalAmount', label: '합계금액' },
  { field: 'trackingNumber', label: '송장번호' },
  { field: 'carrierName', label: '택배사' },
  { field: 'orderedAt', label: '주문일' },
  { field: 'status', label: '주문상태' },
  { field: 'buyerPhone', label: '구매자연락처' },
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
]
