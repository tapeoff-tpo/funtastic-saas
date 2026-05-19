/**
 * CJ OnStyle standard API response types.
 */

export interface CjOnestyleDeliveryOrder {
  deliveryStatus?: string | null
  deliveryMethodName?: string | null
  deliveryInstructionDate?: string | null
  deliveryInstructionCheck?: string | null
  orderNo: string
  orderItemSequence?: string | null
  orderDetailSequence?: string | null
  orderProcessingSequence?: string | null
  courierCompany?: string | null
  waybillNo?: string | null
  itemName?: string | null
  webItemName?: string | null
  waybillName?: string | null
  optionName?: string | null
  count?: string | number | null
  recipient?: string | null
  expectedDeliveryDate?: string | null
  paymentDate?: string | null
  ordererTelephoneNo?: string | null
  recipientTelephoneNo?: string | null
  recipientMobilePhoneNo?: string | null
  postalCode?: string | null
  address?: string | null
  recipientName?: string | null
  ordererName?: string | null
  waybillIdentifierNo?: string | null
  itemCode?: string | number | null
  optionCode?: string | number | null
  supplyPrice?: string | number | null
  salesPrice?: string | number | null
  paymentPrice?: string | number | null
  deliveryNote?: string | null
  vendorItemCode?: string | null
  customerResponsibilityCost?: string | number | null
}

export interface CjOnestyleDeliveryListResponse {
  returnStatus?: number
  returnCode?: string
  returnMessage?: string
  error?: boolean
  data?: CjOnestyleDeliveryOrder[]
}

export interface CjOnestyleStandardResponse {
  returnStatus?: number
  returnCode?: string
  returnMessage?: string
  error?: boolean
  data?: unknown
}
