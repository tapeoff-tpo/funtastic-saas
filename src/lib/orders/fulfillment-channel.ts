export const COUPANG_MARKETPLACE_ID = 'coupang'
export const COUPANG_STANDARD_FILTER_ID = 'coupang-standard'
export const COUPANG_ROCKET_FILTER_ID = 'coupang-rocket'
export const COUPANG_ROCKET_DISPLAY_NAME = '로켓배송'
export const COUPANG_ROCKET_WAREHOUSE_ZONE = '쿠팡'

type OrderSource = {
  marketplaceId: string
  rawData?: unknown
}

const MARKETPLACE_NAME_KEYS = ['쇼핑몰명', '마켓명', '쇼핑몰', '마켓', '사이트명', '판매처', 'mallName', 'empSiteName', 'SiteName', 'siteName']

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/**
 * 사방넷 검수 원본의 쇼핑몰명을 읽는다. 주문 매핑은 coupang 키를 계속 사용하고,
 * 출고 채널만 이 원본값으로 구분해 기존 매핑을 깨지 않게 한다.
 */
export function getOrderMarketplaceSourceNames(rawData: unknown): string[] {
  if (!isRecord(rawData)) return []

  const records = [
    rawData,
    isRecord(rawData.sabangnetRaw) ? rawData.sabangnetRaw : null,
    isRecord(rawData.sabangnetSync) ? rawData.sabangnetSync : null,
    ...(Array.isArray(rawData.rawLines) ? rawData.rawLines.filter(isRecord) : []),
  ].filter((value): value is Record<string, unknown> => value !== null)

  return Array.from(new Set(records.flatMap((record) => MARKETPLACE_NAME_KEYS.flatMap((key) => {
    const value = record[key]
    return typeof value === 'string' && value.trim() ? [value.trim()] : []
  }))))
}

export function isCoupangRocketOrder(order: OrderSource): boolean {
  return order.marketplaceId === COUPANG_MARKETPLACE_ID
    && getOrderMarketplaceSourceNames(order.rawData).some((name) => name.replace(/\s+/g, '').includes('로켓배송'))
}

export function getOrderChannelDisplayName(order: OrderSource): string | null {
  return isCoupangRocketOrder(order) ? COUPANG_ROCKET_DISPLAY_NAME : null
}

/** 로켓배송 주문은 일반 출고 창고가 아니라 쿠팡 전용 재고에서만 처리한다. */
export function getOrderInventoryWarehouseZone(order: OrderSource): string | null {
  return isCoupangRocketOrder(order) ? COUPANG_ROCKET_WAREHOUSE_ZONE : null
}
