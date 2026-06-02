import type ExcelJS from 'exceljs'

export const COMBINED_SHIPMENT_FILL_ARGB = 'FFD8E4BC'

const COMBINED_SHIPMENT_FILL: ExcelJS.FillPattern = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: COMBINED_SHIPMENT_FILL_ARGB },
}

export function getCombinedShipmentFill(groupId: unknown): ExcelJS.FillPattern | null {
  if (typeof groupId !== 'string' || groupId.length === 0) return null
  return COMBINED_SHIPMENT_FILL
}

function normalizeCombinedKeyPart(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, '').toLowerCase()
}

function getNestedValue(row: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.')
  let current: unknown = row
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

function getOrderKey(row: Record<string, unknown>): string {
  return String(
    getNestedValue(row, 'marketplaceOrderId')
      || getNestedValue(row, 'orderId')
      || getNestedValue(row, 'internalNo')
      || '',
  )
}

function getAddressKey(row: Record<string, unknown>): string {
  const recipientName = normalizeCombinedKeyPart(getNestedValue(row, 'recipientName'))
  if (!recipientName) return ''

  const shippingAddress = getNestedValue(row, 'shippingAddress')
  const address = shippingAddress && typeof shippingAddress === 'object'
    ? [
        getNestedValue(row, 'shippingAddress.zipCode'),
        getNestedValue(row, 'shippingAddress.address1'),
        getNestedValue(row, 'shippingAddress.address2'),
      ].map(normalizeCombinedKeyPart).join('')
    : [
        getNestedValue(row, 'recipientZipCode'),
        getNestedValue(row, 'recipientAddress'),
        getNestedValue(row, 'recipientDetailAddress'),
      ].map(normalizeCombinedKeyPart).join('')

  return address ? `${recipientName}::${address}` : ''
}

function getTrackingKey(row: Record<string, unknown>): string {
  const trackingNumber = normalizeCombinedKeyPart(getNestedValue(row, 'trackingNumber'))
  if (!trackingNumber) return ''
  const carrierName = normalizeCombinedKeyPart(getNestedValue(row, 'carrierName'))
  return `${carrierName}::${trackingNumber}`
}

export function getRepeatedCombinedKeys(rows: Record<string, unknown>[]): {
  addressKeys: Set<string>
  trackingKeys: Set<string>
} {
  const addressOrders = new Map<string, Set<string>>()
  const addressCounts = new Map<string, number>()
  const trackingCounts = new Map<string, number>()

  for (const row of rows) {
    const orderKey = getOrderKey(row)
    const addressKey = getAddressKey(row)
    if (addressKey) {
      const orderSet = addressOrders.get(addressKey) ?? new Set<string>()
      orderSet.add(orderKey)
      addressOrders.set(addressKey, orderSet)
      addressCounts.set(addressKey, (addressCounts.get(addressKey) ?? 0) + 1)
    }

    const trackingKey = getTrackingKey(row)
    if (trackingKey) {
      trackingCounts.set(trackingKey, (trackingCounts.get(trackingKey) ?? 0) + 1)
    }
  }

  return {
    addressKeys: new Set([...addressOrders.entries()]
      .filter(([key, orders]) => orders.size >= 2 || (addressCounts.get(key) ?? 0) >= 2)
      .map(([key]) => key)),
    trackingKeys: new Set([...trackingCounts.entries()].filter(([, count]) => count >= 2).map(([key]) => key)),
  }
}

export function shouldFillCombinedShipmentRow(
  row: Record<string, unknown>,
  combinedKeys: ReturnType<typeof getRepeatedCombinedKeys>,
): boolean {
  if (getCombinedShipmentFill(getNestedValue(row, 'shipmentGroupId'))) return true
  if (getNestedValue(row, 'isCombinedShipment') === true) return true

  const addressKey = getAddressKey(row)
  if (addressKey && combinedKeys.addressKeys.has(addressKey)) return true

  const trackingKey = getTrackingKey(row)
  return Boolean(trackingKey && combinedKeys.trackingKeys.has(trackingKey))
}

export function fillWholeRow(row: ExcelJS.Row, columnCount: number, fill: ExcelJS.FillPattern): void {
  for (let index = 1; index <= columnCount; index += 1) {
    row.getCell(index).fill = fill
  }
}
