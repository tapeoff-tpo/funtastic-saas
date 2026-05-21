/**
 * GET /api/shipping/export
 *
 * Export orders to Excel format (carrier-specific or order-list).
 * Returns downloadable .xlsx file.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { orders, orderItems, shipments, marketplaceConnections, products, inventory } from '@/lib/db/schema'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { exportToCarrierExcel } from '@/lib/shipping/excel/export'
import { exportOrdersToExcel } from '@/lib/shipping/excel/order-export'
import { getCarrierTemplateById, getCarrierTemplates } from '@/lib/shipping/template-queries'
import { AVAILABLE_ORDER_FIELDS } from '@/lib/shipping/excel/templates'
import { expandOrderItemsWithMapping } from '@/lib/orders/mapping-expand'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { resolveMarketplaceDisplayName } from '@/lib/marketplace/collect-options'
import { getCombinedShipmentGroupIds } from '@/lib/shipping/combined-safety'

function getMarketplaceExportName(order: typeof orders.$inferSelect): string {
  const rawData = order.rawData
  if (rawData && typeof rawData === 'object' && !Array.isArray(rawData)) {
    const data = rawData as {
      mallName?: unknown
      empSiteName?: unknown
      SiteName?: unknown
      siteName?: unknown
    }
    const candidates = [data.mallName, data.empSiteName, data.SiteName, data.siteName]
    for (const candidate of candidates) {
      if (typeof candidate !== 'string') continue
      const trimmed = candidate.trim()
      if (trimmed) return resolveMarketplaceDisplayName(order.marketplaceId, trimmed)
    }
  }

  return resolveMarketplaceDisplayName(order.marketplaceId)
}

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const workspaceUserId = await getWorkspaceUserId(user.id)

  const searchParams = request.nextUrl.searchParams
  const orderIdsParam = searchParams.get('orderIds')
  const type = searchParams.get('type') ?? 'carrier'
  const templateId = searchParams.get('templateId')
  const columnsParam = searchParams.get('columns')

  if (!orderIdsParam) {
    return NextResponse.json(
      { error: 'orderIds parameter is required' },
      { status: 400 },
    )
  }

  const orderIds = orderIdsParam.split(',').filter(Boolean)
  if (orderIds.length === 0) {
    return NextResponse.json(
      { error: 'At least one order ID is required' },
      { status: 400 },
    )
  }

  try {
    // Fetch orders with items and shipment data
    const [orderRows, itemRows, shipmentRows, groupIdByOrder] = await Promise.all([
      db.select().from(orders).where(and(inArray(orders.id, orderIds), eq(orders.userId, workspaceUserId))),
      db.select().from(orderItems).where(inArray(orderItems.orderId, orderIds)),
      db.select().from(shipments).where(inArray(shipments.orderId, orderIds)),
      getCombinedShipmentGroupIds(workspaceUserId, orderIds),
    ])

    // 쇼핑몰 displayName lookup (보내는분성명 = 쇼핑몰명)
    const connectionIds = [...new Set(orderRows.map((o) => o.connectionId).filter(Boolean) as string[])]
    const connectionRows = connectionIds.length > 0
      ? await db
          .select({ id: marketplaceConnections.id, displayName: marketplaceConnections.displayName })
          .from(marketplaceConnections)
          .where(inArray(marketplaceConnections.id, connectionIds))
      : []
    const connectionMap = new Map(connectionRows.map((c) => [c.id, c.displayName]))

    // Phase C 매핑코드 확장: orderItems → mapping_components 의 SKU 행으로 전개.
    // 매핑 없으면 orderItems.sku 를 그대로 사용 (fallback).
    const expanded = await expandOrderItemsWithMapping(
      workspaceUserId,
      orderRows.map((o) => ({ id: o.id, marketplaceId: o.marketplaceId })),
      itemRows,
    )
    const expandedByOrder = new Map<string, typeof expanded>()
    for (const row of expanded) {
      const list = expandedByOrder.get(row.orderId) ?? []
      list.push(row)
      expandedByOrder.set(row.orderId, list)
    }

    // SKU 기준 products(원가) + inventory(현재고/로케이션/확정옵션명) lookup —
    // 매핑 확장 후 행들의 SKU 까지 모두 포함해야 함.
    const skuSet = [
      ...new Set([
        ...itemRows.map((i) => i.sku).filter(Boolean) as string[],
        ...expanded.map((r) => r.sku).filter(Boolean),
      ]),
    ]
    const [productRows, inventoryRows] = skuSet.length > 0
      ? await Promise.all([
          db
            .select({ sku: products.internalSku, location: products.warehouseLocation, costPrice: products.costPrice })
            .from(products)
            .where(and(eq(products.userId, workspaceUserId), inArray(products.internalSku, skuSet))),
          db
            .select({
              sku: inventory.sku,
              stock: sql<number>`COALESCE(SUM(${inventory.availableStock}), 0)::int`,
              sectorCode: sql<string | null>`MAX(${inventory.sectorCode})`,
              packagingUnit: sql<string | null>`MAX(${inventory.packagingUnit})`,
              optionName: sql<string | null>`MAX(${inventory.optionName})`,
            })
            .from(inventory)
            .where(and(eq(inventory.userId, workspaceUserId), inArray(inventory.sku, skuSet)))
            .groupBy(inventory.sku),
        ])
      : [[], []]
    const productMap = new Map(productRows.map((p) => [p.sku, { location: p.location, costPrice: p.costPrice }]))
    const inventoryMap = new Map(
      inventoryRows.map((i) => [
        i.sku,
        { stock: i.stock, sectorCode: i.sectorCode, packagingUnit: i.packagingUnit, optionName: i.optionName },
      ]),
    )

    // 셀러 고정값은 이제 carrier_templates.columns[].fixedValue 로 관리
    // (boxCount, freightType, baseFreight, senderPhone, senderAddress 등)

    // Build flat order records for export
    const exportData: Record<string, unknown>[] = orderRows.map((order) => {
      const items = itemRows.filter((item) => item.orderId === order.id)
      const shipment = shipmentRows.find((s) => s.orderId === order.id)
      const expandedRows = expandedByOrder.get(order.id) ?? []
      const shipmentGroupId = groupIdByOrder.get(order.id)

      // 매핑 전 원본 (수집상품명/수집옵션명 용)
      const rawFirst = items[0]

      // Phase C: 매핑 확장된 첫 행 기준으로 상품명/SKU/옵션 결정.
      // 매핑된 행이면 component SKU + inventory.optionName + inventory.productName.
      // 미매핑이면 expanded helper 가 원본을 fallback 으로 채워줌.
      const primary = expandedRows[0]
      const productName = primary?.productName ?? rawFirst?.productName ?? ''
      const sku: string = primary?.sku ?? rawFirst?.sku ?? ''
      const optionText = primary?.optionText ?? ''
      const marketplaceName = getMarketplaceExportName(order)

      return {
        // 사용자 노출용 8자리 내부 주문번호
        orderId: order.internalNo,
        internalNo: order.internalNo,
        marketplaceOrderId: order.marketplaceOrderId,
        shipmentGroupId: shipmentGroupId ?? '',
        isCombinedShipment: Boolean(shipmentGroupId),
        // 마켓 상품코드 — 쿠팡 vendorItemId / 네이버 productOrderId / Cafe24 item_no 등
        marketplaceItemId: rawFirst?.marketplaceItemId ?? '',
        marketplaceId: marketplaceName,
        marketplaceName,
        marketplaceCode: order.marketplaceId,
        buyerName: order.buyerName,
        // 기본 '구매자연락처' = 휴대폰(phone2) 우선, 없으면 일반전화(phone1)
        buyerPhone: order.buyerPhone2 || order.buyerPhone || '',
        recipientName: order.recipientName,
        // 기본 '수령인연락처' = 휴대폰(phone2) 우선, 없으면 일반전화(phone1)
        recipientPhone: order.recipientPhone2 || order.recipientPhone || '',
        shippingAddress: order.shippingAddress,
        productName,
        optionText,
        quantity: expandedRows.length > 0
          ? expandedRows.reduce((sum, r) => sum + r.quantity, 0)
          : items.reduce((sum, item) => sum + item.quantity, 0),
        unitPrice: rawFirst?.unitPrice ?? '0',
        totalAmount: order.totalAmount,
        trackingNumber: shipment?.trackingNumber ?? '',
        carrierName: shipment?.carrierName ?? '',
        orderedAt: order.orderedAt,
        status: order.status,
        // ─ 발주서 양식용 확장 필드 ─
        logisticsMessage: order.logisticsMessage ?? '',
        productCode: sku,
        productPlusOption: optionText ? `${productName} [${optionText}]` : productName,
        collectedProductName: rawFirst?.productName ?? '',
        collectedOption: rawFirst?.optionText ?? '',
        stock: sku ? inventoryMap.get(sku)?.stock ?? '' : '',
        // 위치 = 로케이션(inventory.sectorCode). 창고명(products.warehouseLocation)이 아니다.
        location: sku ? inventoryMap.get(sku)?.sectorCode ?? '' : '',
        costPrice: sku ? productMap.get(sku)?.costPrice ?? '' : '',
        // 피킹위치 (inventory.sectorCode) — 출력항목 '피킹위치'
        pickingLocation: sku ? inventoryMap.get(sku)?.sectorCode ?? '' : '',
        // 포장 박스 종류 (inventory.packagingUnit) — 출력항목 '포장'
        packaging: sku ? inventoryMap.get(sku)?.packagingUnit ?? '' : '',
        senderName: marketplaceName || (order.connectionId ? connectionMap.get(order.connectionId) ?? '' : ''),
        // 배송메세지 — 구매자가 마켓에서 입력한 배송 요청 (쿠팡 parcelPrintMessage 등)
        deliveryMessage: order.deliveryMessage ?? '',
        // 명시적 phone2 (휴대폰) 출력항목 — migration 020 이후 DB 에 직접 저장됨
        recipientPhone2: order.recipientPhone2 ?? '',
        buyerPhone2: order.buyerPhone2 ?? '',
        // ─ DB 컬럼 미존재 — 사용자가 fixedValue 로 채우거나 비워둠 ─
        supplyPrice: '',
        // 수집일자 — yyyy-mm-dd 포맷
        collectedAt: order.collectedAt ? new Date(order.collectedAt).toISOString().slice(0, 10) : '',
        // 기타1~10 — fixedValue 로 채우는 용도
        etc1: '',
        etc2: '',
        etc3: '',
        etc4: '',
        etc5: '',
        etc6: '',
        etc7: '',
        etc8: '',
        etc9: '',
        etc10: '',
      }
    })

    let buffer: Buffer
    let filename: string

    if (type === 'order-list') {
      // Export with selected columns or all columns
      const selectedFields = columnsParam
        ? columnsParam.split(',').map((field) => {
            const def = AVAILABLE_ORDER_FIELDS.find((f) => f.field === field)
            return def ?? { field, label: field }
          })
        : AVAILABLE_ORDER_FIELDS

      buffer = await exportOrdersToExcel(exportData, selectedFields)
      filename = `orders_${new Date().toISOString().slice(0, 10)}.xlsx`
    } else {
      // Carrier template export
      let template
      if (templateId) {
        template = await getCarrierTemplateById(templateId)
      } else {
        // Use first default template for this user
        const templates = await getCarrierTemplates(workspaceUserId)
        template = templates[0] ?? null
      }

      if (!template) {
        return NextResponse.json(
          { error: 'No carrier template found. Please create a template first.' },
          { status: 404 },
        )
      }

      buffer = await exportToCarrierExcel(exportData, template)
      filename = `${template.name}_${new Date().toISOString().slice(0, 10)}.xlsx`
    }

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
      },
    })
  } catch (error) {
    console.error('Excel export error:', error)
    return NextResponse.json(
      { error: 'Failed to generate Excel file' },
      { status: 500 },
    )
  }
}
