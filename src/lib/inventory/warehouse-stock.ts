export const PURCHASING_STOCK_WAREHOUSES = ['1창고', '쿠팡창고', '쿠팡', '2창고'] as const

export type PurchasingStockWarehouse = typeof PURCHASING_STOCK_WAREHOUSES[number]

export type PurchasingWarehouseStockBreakdown = {
  oneWarehouse: number
  coupangWarehouse: number
  twoWarehouse: number
}

export function isPurchasingStockWarehouse(value: string | null | undefined): value is PurchasingStockWarehouse {
  return PURCHASING_STOCK_WAREHOUSES.includes((value ?? '').trim() as PurchasingStockWarehouse)
}

export function purchasingStockTotal(stock: PurchasingWarehouseStockBreakdown) {
  return stock.oneWarehouse + stock.coupangWarehouse + stock.twoWarehouse
}
