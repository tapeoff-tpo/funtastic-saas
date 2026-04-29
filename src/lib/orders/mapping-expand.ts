/**
 * Phase C 매핑코드 확장 helper.
 *
 * orderItems(원본) → 매핑된 SKU 행으로 전개.
 * - mapping_sources 에 매칭되면: components 의 SKU 들로 N 행 생성 (quantity = item.qty * component.qty)
 * - 매칭 없으면: 원본 1 행 유지 (sku 는 orderItems.sku 그대로)
 *
 * Shipping export 용 — productName/optionText 등 부가 정보를 inventory.optionName 으로 채움.
 * Inventory 차감용은 별도 helper(`expandOrderItemsForDeduction`) 가 있으니 그것을 사용.
 */

import { db } from '@/lib/db'
import { mappingSources, mappingComponents, inventory } from '@/lib/db/schema'
import { eq, and, inArray } from 'drizzle-orm'

export type ExpandedRow = {
  /** 원본 orderItem id (참조용) */
  orderItemId: string
  /** 원본 order id */
  orderId: string
  /** 차감/출력 대상 SKU (매핑된 component SKU 또는 원본 sku) */
  sku: string
  /** 출력 수량 = orderItem.quantity * component.quantity (매핑 없으면 orderItem.quantity) */
  quantity: number
  /** 매핑된 경우 component 의 옵션명(inventory.optionName), 없으면 원본 optionText */
  optionText: string
  /** 매핑된 경우 component 의 productName(inventory.productName), 없으면 원본 productName */
  productName: string
  /** 원본 orderItem 정보 (단가/마켓상품ID 등 부가필드 접근용) */
  source: {
    productName: string | null
    optionText: string | null
    sku: string | null
    quantity: number
    marketplaceItemId: string | null
    skuMultiplier: number | null
    unitPrice: string | null
  }
  /** 매핑코드로 확장된 행인지 (true) 단순 fallback 인지 (false) */
  fromMapping: boolean
}

type OrderItemInput = {
  id: string
  orderId: string
  marketplaceItemId: string | null
  sku: string | null
  productName: string | null
  optionText: string | null
  quantity: number
  skuMultiplier: number | null
  unitPrice: string | null
}

type OrderInput = {
  id: string
  marketplaceId: string
}

/**
 * 매핑 확장 + inventory 메타 lookup 을 한 번에 수행.
 *
 * @param userId   현재 로그인 사용자 id (mapping_sources 스코프)
 * @param orders   orderId → marketplaceId 매핑용 주문 메타
 * @param items    전개할 orderItem 들
 * @returns 매핑 확장된 행들 (orderId 그대로 유지)
 */
export async function expandOrderItemsWithMapping(
  userId: string,
  orders: OrderInput[],
  items: OrderItemInput[],
): Promise<ExpandedRow[]> {
  if (items.length === 0) return []

  const orderById = new Map(orders.map((o) => [o.id, o]))

  // 매핑 lookup 키 수집: (marketplaceId, marketplaceItemId)
  const sourceKeys = new Set<string>()
  for (const it of items) {
    if (!it.marketplaceItemId) continue
    const ord = orderById.get(it.orderId)
    if (!ord) continue
    sourceKeys.add(`${ord.marketplaceId}:${it.marketplaceItemId}`)
  }

  // mapping_sources + components join (userId 스코프)
  const mappingRows = sourceKeys.size > 0
    ? await db
        .select({
          marketplaceId: mappingSources.marketplaceId,
          marketplaceProductId: mappingSources.marketplaceProductId,
          componentSku: mappingComponents.sku,
          componentQuantity: mappingComponents.quantity,
        })
        .from(mappingSources)
        .innerJoin(mappingComponents, eq(mappingComponents.mappingCodeId, mappingSources.mappingCodeId))
        .where(eq(mappingSources.userId, userId))
    : []

  const mappingByKey = new Map<string, Array<{ sku: string; quantity: number }>>()
  for (const row of mappingRows) {
    const key = `${row.marketplaceId}:${row.marketplaceProductId}`
    if (!sourceKeys.has(key)) continue
    const list = mappingByKey.get(key) ?? []
    list.push({ sku: row.componentSku, quantity: row.componentQuantity })
    mappingByKey.set(key, list)
  }

  // 출력 SKU 모두 모아서 inventory 메타 한번에 lookup
  const allSkus = new Set<string>()
  for (const it of items) {
    if (it.sku) allSkus.add(it.sku)
  }
  for (const list of mappingByKey.values()) {
    for (const c of list) allSkus.add(c.sku)
  }

  const inventoryRows = allSkus.size > 0
    ? await db
        .select({
          sku: inventory.sku,
          optionName: inventory.optionName,
          productName: inventory.productName,
        })
        .from(inventory)
        .where(and(eq(inventory.userId, userId), inArray(inventory.sku, Array.from(allSkus))))
    : []
  const invMap = new Map(inventoryRows.map((r) => [r.sku, r]))

  const result: ExpandedRow[] = []

  for (const it of items) {
    const ord = orderById.get(it.orderId)
    const orderQty = it.quantity * (it.skuMultiplier ?? 1)
    const key = it.marketplaceItemId && ord
      ? `${ord.marketplaceId}:${it.marketplaceItemId}`
      : null
    const components = key ? mappingByKey.get(key) : null

    if (components && components.length > 0) {
      for (const c of components) {
        const inv = invMap.get(c.sku)
        result.push({
          orderItemId: it.id,
          orderId: it.orderId,
          sku: c.sku,
          quantity: orderQty * c.quantity,
          optionText: inv?.optionName ?? '',
          productName: inv?.productName ?? c.sku,
          source: {
            productName: it.productName,
            optionText: it.optionText,
            sku: it.sku,
            quantity: it.quantity,
            marketplaceItemId: it.marketplaceItemId,
            skuMultiplier: it.skuMultiplier,
            unitPrice: it.unitPrice,
          },
          fromMapping: true,
        })
      }
    } else {
      // 매핑 없음 → 원본 1 행 유지
      const fallbackSku = it.sku ?? ''
      const inv = fallbackSku ? invMap.get(fallbackSku) : undefined
      result.push({
        orderItemId: it.id,
        orderId: it.orderId,
        sku: fallbackSku,
        quantity: orderQty,
        optionText: inv?.optionName ?? it.optionText ?? '',
        productName: it.productName ?? '',
        source: {
          productName: it.productName,
          optionText: it.optionText,
          sku: it.sku,
          quantity: it.quantity,
          marketplaceItemId: it.marketplaceItemId,
          skuMultiplier: it.skuMultiplier,
          unitPrice: it.unitPrice,
        },
        fromMapping: false,
      })
    }
  }

  return result
}
