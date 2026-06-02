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
import { mappingCodes, mappingSources, mappingComponents, inventory } from '@/lib/db/schema'
import { eq, and, inArray, sql } from 'drizzle-orm'
import {
  buildMappingIndex,
  getRawMappingCandidateIdsForItem,
  lookupCompatibleMappingRef,
  lookupMappingRef,
  type MappingSource,
} from './mapping-match'

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
  lockedSku?: string | null
  lockedProductName?: string | null
  lockedOptionName?: string | null
  lockedQuantity?: number | null
  lockedMappingCodeId?: string | null
  lockedMappingCode?: string | null
  lockedAt?: Date | string | null
}

type OrderInput = {
  id: string
  marketplaceId: string
  rawData?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasSetSplit(rawData: unknown): boolean {
  return isRecord(rawData) && isRecord(rawData.setSplit)
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

  // mapping_sources + components join (userId 스코프) — 사방넷 품번/단품 둘 다.
  const mappingRows = await db
    .select({
      mappingCodeId: mappingSources.mappingCodeId,
      marketplaceId: mappingSources.marketplaceId,
      marketplaceProductId: mappingSources.marketplaceProductId,
      marketplaceOptionId: mappingSources.marketplaceOptionId,
      productNameSnapshot: mappingSources.productNameSnapshot,
      optionNameSnapshot: mappingSources.optionNameSnapshot,
      componentSku: mappingComponents.sku,
      componentQuantity: mappingComponents.quantity,
    })
    .from(mappingSources)
    .innerJoin(mappingCodes, eq(mappingCodes.id, mappingSources.mappingCodeId))
    .innerJoin(mappingComponents, eq(mappingComponents.mappingCodeId, mappingSources.mappingCodeId))
    .where(and(eq(mappingSources.userId, userId), eq(mappingCodes.isActive, true)))

  // mappingCodeId 별 components 모음 (중복 제거)
  const componentsByCode = new Map<string, Array<{ sku: string; quantity: number }>>()
  for (const m of mappingRows) {
    const list = componentsByCode.get(m.mappingCodeId) ?? []
    if (!list.some((c) => c.sku === m.componentSku && c.quantity === m.componentQuantity)) {
      list.push({ sku: m.componentSku, quantity: m.componentQuantity })
    }
    componentsByCode.set(m.mappingCodeId, list)
  }

  const componentSignatureByCode = new Map<string, string>()
  for (const [mappingCodeId, components] of componentsByCode) {
    componentSignatureByCode.set(
      mappingCodeId,
      components
        .map((component) => `${component.sku}:${component.quantity}`)
        .sort()
        .join('|'),
    )
  }

  // sources index (단품/품번 매칭)
  const sourcesForIndex: MappingSource[] = []
  const seenSrc = new Set<string>()
  for (const m of mappingRows) {
    const key = `${m.marketplaceId}:${m.marketplaceProductId}:${m.marketplaceOptionId}`
    if (seenSrc.has(key)) continue
    seenSrc.add(key)
    sourcesForIndex.push({
      marketplaceId: m.marketplaceId,
      marketplaceProductId: m.marketplaceProductId,
      marketplaceOptionId: m.marketplaceOptionId,
      productNameSnapshot: m.productNameSnapshot,
      optionNameSnapshot: m.optionNameSnapshot,
      ref: m.mappingCodeId,
    })
  }
  const mappingIndex = buildMappingIndex(sourcesForIndex)

  const resolveSameComponentMappingCode = (
    marketplaceId: string,
    candidateIds: string[],
    optionText: string | null,
  ): string | null => {
    const normalizedOptionText = optionText?.trim().slice(0, 100)
    const candidateSet = new Set(candidateIds)
    const matchedSources = sourcesForIndex.filter((source) => {
      if (source.marketplaceId !== marketplaceId) return false
      if (!candidateSet.has(source.marketplaceProductId)) return false
      if (normalizedOptionText) {
        return source.marketplaceOptionId === normalizedOptionText
      }
      return source.marketplaceOptionId === ''
    })
    const signatures = new Map<string, string>()
    for (const source of matchedSources) {
      const signature = componentSignatureByCode.get(source.ref)
      if (!signature) continue
      signatures.set(signature, source.ref)
    }
    return signatures.size === 1 ? Array.from(signatures.values())[0] : null
  }

  // 출력 SKU 모두 모아서 inventory 메타 한번에 lookup
  const allSkus = new Set<string>()
  for (const it of items) {
    if (it.sku) allSkus.add(it.sku)
  }
  for (const list of componentsByCode.values()) {
    for (const c of list) allSkus.add(c.sku)
  }

  const inventoryRows = allSkus.size > 0
    ? await db
        .select({
          sku: inventory.sku,
          optionName: sql<string | null>`MAX(${inventory.optionName})`,
          productName: sql<string | null>`MAX(${inventory.productName})`,
        })
        .from(inventory)
        .where(and(eq(inventory.userId, userId), inArray(inventory.sku, Array.from(allSkus))))
        .groupBy(inventory.sku)
    : []
  const invMap = new Map(inventoryRows.map((r) => [r.sku, r]))

  const result: ExpandedRow[] = []

  const pushFallbackRow = (it: OrderItemInput, fromMapping: boolean): void => {
    const orderQty = it.quantity * (it.skuMultiplier ?? 1)
    const fallbackSku = it.lockedSku ?? it.sku ?? ''
    const inv = fallbackSku ? invMap.get(fallbackSku) : undefined
    result.push({
      orderItemId: it.id,
      orderId: it.orderId,
      sku: fallbackSku,
      quantity: it.lockedQuantity ?? orderQty,
      optionText: it.lockedOptionName ?? inv?.optionName ?? it.optionText ?? '',
      productName: it.lockedProductName ?? inv?.productName ?? it.productName ?? '',
      source: {
        productName: it.productName,
        optionText: it.optionText,
        sku: it.sku,
        quantity: it.quantity,
        marketplaceItemId: it.marketplaceItemId,
        skuMultiplier: it.skuMultiplier,
        unitPrice: it.unitPrice,
      },
      fromMapping,
    })
  }

  for (const it of items) {
    if (it.lockedAt) {
      const lockedComponents = it.lockedMappingCodeId ? componentsByCode.get(it.lockedMappingCodeId) : null
      if (lockedComponents && lockedComponents.length > 0) {
        const orderQty = it.quantity * (it.skuMultiplier ?? 1)
        for (const c of lockedComponents) {
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
        continue
      }

      pushFallbackRow(it, Boolean(it.lockedSku))
      continue
    }

    const ord = orderById.get(it.orderId)
    const orderQty = it.quantity * (it.skuMultiplier ?? 1)
    if (hasSetSplit(ord?.rawData)) {
      pushFallbackRow(it, false)
      continue
    }

    const candidateIds = Array.from(new Set(
      [it.marketplaceItemId, it.sku, ...getRawMappingCandidateIdsForItem(ord?.rawData, it.marketplaceItemId)]
        .map((id) => id?.trim())
        .filter((id): id is string => Boolean(id)),
    ))
    const mappingCodeId = ord
      ? lookupCompatibleMappingRef(
          sourcesForIndex,
          ord.marketplaceId,
          candidateIds,
          it.optionText,
          it.productName,
        )
        ?? candidateIds
          .map((candidateId) => lookupMappingRef(mappingIndex, ord.marketplaceId, candidateId, it.optionText))
          .find((ref): ref is string => !!ref) ?? null
      : null
    const resolvedMappingCodeId = mappingCodeId
      ?? (ord ? resolveSameComponentMappingCode(ord.marketplaceId, candidateIds, it.optionText) : null)
    const components = resolvedMappingCodeId ? componentsByCode.get(resolvedMappingCodeId) : null

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
      // 매핑 없음 → 원본 1 행 유지.
      // 단, 주문 SKU가 재고관리코드와 직접 맞으면 발주서의 "확정상품명"은 내부 재고명을 쓴다.
      pushFallbackRow(it, false)
    }
  }

  return result
}
