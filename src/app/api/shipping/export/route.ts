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
import { and, eq, inArray } from 'drizzle-orm'
import { exportToCarrierExcel } from '@/lib/shipping/excel/export'
import { exportOrdersToExcel } from '@/lib/shipping/excel/order-export'
import { getCarrierTemplateById, getCarrierTemplates } from '@/lib/shipping/template-queries'
import { AVAILABLE_ORDER_FIELDS } from '@/lib/shipping/excel/templates'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

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
    const [orderRows, itemRows, shipmentRows] = await Promise.all([
      db.select().from(orders).where(inArray(orders.id, orderIds)),
      db.select().from(orderItems).where(inArray(orderItems.orderId, orderIds)),
      db.select().from(shipments).where(inArray(shipments.orderId, orderIds)),
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

    // Phase A 매핑 재설계: option-level 매핑 제거. 확정 SKU 는 orderItems.sku 그대로 사용.
    const confirmedSkuByItem = new Map<string, string>()
    for (const item of itemRows) {
      const sku = (item.sku ?? '').trim()
      if (sku) confirmedSkuByItem.set(item.id, sku)
    }

    // SKU 기준 products(위치) + inventory(현재고/확정옵션명) lookup
    const skuSet = [
      ...new Set(itemRows.map((i) => i.sku).filter(Boolean) as string[]),
    ]
    const [productRows, inventoryRows] = user && skuSet.length > 0
      ? await Promise.all([
          db
            .select({ sku: products.internalSku, location: products.warehouseLocation, costPrice: products.costPrice })
            .from(products)
            .where(and(eq(products.userId, user.id), inArray(products.internalSku, skuSet))),
          db
            .select({
              sku: inventory.sku,
              stock: inventory.availableStock,
              sectorCode: inventory.sectorCode,
              packagingUnit: inventory.packagingUnit,
              optionName: inventory.optionName,
            })
            .from(inventory)
            .where(and(eq(inventory.userId, user.id), inArray(inventory.sku, skuSet))),
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

      // 매핑 전 원본 (수집상품명/수집옵션명 용)
      const rawFirst = items[0]

      // Phase A 매핑 재설계: name/option mapping 제거. 상품명은 marketplace 원본 사용.
      // (신규 매핑코드 시스템 도입 시 Phase C 에서 다시 연결 예정.)
      const firstItem = rawFirst
      const productName = firstItem?.productName ?? ''
      const sku: string = (rawFirst ? confirmedSkuByItem.get(rawFirst.id) : undefined) ?? rawFirst?.sku ?? ''
      // 확정 옵션명 = inventory.optionName (재고관리에 등록된 옵션명)
      // → 마켓 원본(optionText) 이 아니라 우리 내부에서 정리한 옵션명을 출력
      const optionText = (sku ? inventoryMap.get(sku)?.optionName : '') ?? ''

      return {
        // 사용자 노출용 8자리 내부 주문번호
        orderId: order.internalNo,
        internalNo: order.internalNo,
        marketplaceOrderId: order.marketplaceOrderId,
        // 마켓 상품코드 — 쿠팡 vendorItemId / 네이버 productOrderId / Cafe24 item_no 등
        marketplaceItemId: rawFirst?.marketplaceItemId ?? '',
        marketplaceId: order.marketplaceId,
        buyerName: order.buyerName,
        // 기본 '구매자연락처' = 휴대폰(phone2) 우선, 없으면 일반전화(phone1)
        buyerPhone: order.buyerPhone2 || order.buyerPhone || '',
        recipientName: order.recipientName,
        // 기본 '수령인연락처' = 휴대폰(phone2) 우선, 없으면 일반전화(phone1)
        recipientPhone: order.recipientPhone2 || order.recipientPhone || '',
        shippingAddress: order.shippingAddress,
        productName,
        optionText,
        quantity: items.reduce((sum, item) => sum + item.quantity, 0),
        unitPrice: firstItem?.unitPrice ?? '0',
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
        location: sku ? productMap.get(sku)?.location ?? '' : '',
        costPrice: sku ? productMap.get(sku)?.costPrice ?? '' : '',
        // 피킹위치 (inventory.sectorCode) — 출력항목 'Location'
        pickingLocation: sku ? inventoryMap.get(sku)?.sectorCode ?? '' : '',
        // 포장 박스 종류 (inventory.packagingUnit) — 출력항목 '포장'
        packaging: sku ? inventoryMap.get(sku)?.packagingUnit ?? '' : '',
        senderName: order.connectionId ? connectionMap.get(order.connectionId) ?? '' : '',
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
        const templates = user ? await getCarrierTemplates(user.id) : []
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
