export const PURCHASE_ARRIVAL_WAREHOUSES = ['중국창고', '쿠팡창고', '대량창고'] as const

export type PurchaseArrivalWarehouse = (typeof PURCHASE_ARRIVAL_WAREHOUSES)[number]

export function purchaseArrivalWarehouse(rawData: Record<string, unknown>): PurchaseArrivalWarehouse | undefined {
  return PURCHASE_ARRIVAL_WAREHOUSES.find((warehouse) => warehouse === rawData.arrivalWarehouseCode)
}
