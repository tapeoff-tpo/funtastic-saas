/**
 * 송장 export 용 bundle 전개 유틸.
 *
 * 정책 = 옵션 1 (세트 단위 분리):
 *   bundle SKU 1개 → component 행 N개로 펼침. component qty = componentQty × parentQty.
 *   같은 component SKU 가 다른 부모(세트) 에서 등장해도 합치지 않음.
 *   이유: 송장 1행 = 박스 1개 발송이라, 세트별 피킹 단위를 구분해서 보여주는 게 맞다.
 *
 * inventory/actions.ts 의 expandBundleItems 와 다른 점:
 *   - 그쪽은 재고 차감용이라 sku/qty 만 반환
 *   - 여기는 export 행에 productName/optionText/pickingLocation 등 표시 필드도 보존해야 함
 */

import { db } from '@/lib/db'
import { productBundleItems, products } from '@/lib/db/schema'
import { eq, inArray, and } from 'drizzle-orm'

export interface ExpandableItem {
  sku: string | null
  productName: string
  quantity: number
  optionText?: string | null
  pickingLocation?: string | null
  // 보존되는 임의 필드 (호출측 row 와 합치기용)
  [key: string]: unknown
}

export interface ExpandedItem extends ExpandableItem {
  /** 원본 부모 SKU — 펼친 결과면 set SKU, 단품이면 자기 자신 */
  parentSku: string | null
  /** 펼침 결과 여부 */
  expanded: boolean
}

/**
 * Bundle SKU 를 component 행으로 펼친다.
 * 단품(bundle 정의 없음)은 그대로 통과.
 *
 * @param userId  bundle 정의 조회용
 * @param items   주문 아이템들 (여러 주문에 걸쳐도 OK — sku 모으는 것만 사용)
 * @returns       펼친 결과. 호출측이 flatMap 처럼 사용
 */
export async function expandBundlesForExport<T extends ExpandableItem>(
  userId: string,
  items: T[],
): Promise<Array<T & { parentSku: string | null; expanded: boolean }>> {
  const skus = items
    .map((i) => i.sku)
    .filter((s): s is string => !!s && s.trim().length > 0)

  if (skus.length === 0) {
    return items.map((i) => ({ ...i, parentSku: i.sku, expanded: false }))
  }

  // 1) bundle 정의 일괄 조회
  const bundleRows = await db
    .select({
      bundleSku: productBundleItems.bundleSku,
      componentSku: productBundleItems.componentSku,
      quantity: productBundleItems.quantity,
    })
    .from(productBundleItems)
    .where(
      and(
        eq(productBundleItems.userId, userId),
        inArray(productBundleItems.bundleSku, skus),
      ),
    )

  if (bundleRows.length === 0) {
    return items.map((i) => ({ ...i, parentSku: i.sku, expanded: false }))
  }

  // 2) bundleSku → components[]
  const bundleMap = new Map<string, Array<{ componentSku: string; quantity: number }>>()
  for (const row of bundleRows) {
    const list = bundleMap.get(row.bundleSku) ?? []
    list.push({ componentSku: row.componentSku, quantity: row.quantity })
    bundleMap.set(row.bundleSku, list)
  }

  // 3) component SKU 들의 표시정보(상품명/창고위치) 조회
  const componentSkus = Array.from(
    new Set(bundleRows.map((r) => r.componentSku)),
  )
  const componentInfoRows = componentSkus.length === 0
    ? []
    : await db
        .select({
          internalSku: products.internalSku,
          name: products.name,
          warehouseLocation: products.warehouseLocation,
        })
        .from(products)
        .where(
          and(
            eq(products.userId, userId),
            inArray(products.internalSku, componentSkus),
          ),
        )
  const componentInfo = new Map<string, { name: string; warehouseLocation: string | null }>()
  for (const row of componentInfoRows) {
    componentInfo.set(row.internalSku, {
      name: row.name,
      warehouseLocation: row.warehouseLocation,
    })
  }

  // 4) 각 item 펼침
  const expanded: Array<T & { parentSku: string | null; expanded: boolean }> = []
  for (const item of items) {
    const components = item.sku ? bundleMap.get(item.sku) : undefined
    if (components && components.length > 0) {
      for (const comp of components) {
        const info = componentInfo.get(comp.componentSku)
        expanded.push({
          ...item,
          sku: comp.componentSku,
          productName: info?.name ?? item.productName,
          quantity: comp.quantity * item.quantity,
          // 옵션텍스트는 component 단위에서 의미 없으므로 비움 (세트 옵션 X)
          optionText: null,
          pickingLocation: info?.warehouseLocation ?? null,
          parentSku: item.sku,
          expanded: true,
        })
      }
    } else {
      expanded.push({ ...item, parentSku: item.sku, expanded: false })
    }
  }

  return expanded
}
