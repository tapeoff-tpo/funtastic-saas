/**
 * Ecount's "주문서번호" cell is also used for purchase-channel/payment notes
 * such as "웨이신", "wechat", "알리페이", "ssj", or a buyer name. Keep that
 * non-empty source value so payment completion can be determined from it.
 */
export function normalizeSupplierOrderReference(value: string | null | undefined) {
  const normalized = value?.trim() ?? ''
  return normalized && normalized !== '0' ? normalized : null
}

const PURCHASE_REFERENCE_MARKER = /(?:웨이신|위챗|wechat|weixin|알리페이|alipay|ssj|신성진|已下单|이체\s*완료|구매|핀둬둬|pinduoduo|법인)/i
const NON_PURCHASE_NOTE = /(?:단종|품절|재소싱|반품|취소|체크\s*(?:필요|중)|확인\s*(?:필요|중|후)|진행중)/i

/**
 * The Ecount column is occasionally used for notes unrelated to an order
 * (for example "단종" or "재소싱필요"). Accept real/compound order numbers
 * and the purchase-channel markers used by the team, while leaving those
 * non-purchase notes in payment pending.
 */
export function normalizeEcountSupplierOrderReference(value: string | null | undefined) {
  const normalized = normalizeSupplierOrderReference(value)
  if (!normalized) return null
  if (/[1-9]\d{8,}/.test(normalized)) return normalized
  if (NON_PURCHASE_NOTE.test(normalized)) return null
  return PURCHASE_REFERENCE_MARKER.test(normalized) ? normalized : null
}

/**
 * Only a standalone long numeric value is safe as a cross-report order key.
 * Free-text references are valid evidence of purchase, but are often reused
 * for many unrelated orders and must not merge those orders together.
 */
export function isUniqueSupplierOrderIdentifier(value: string | null | undefined) {
  const normalized = normalizeSupplierOrderReference(value)
  return normalized !== null && /^[1-9]\d{8,}$/.test(normalized)
}
