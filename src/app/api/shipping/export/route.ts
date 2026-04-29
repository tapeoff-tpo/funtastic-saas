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
import { loadMappingLookup, loadSkuLookup, applyMappings, type MappingEntry } from '@/lib/products/apply-mappings'

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

    // Load product name mappings + SKU lookup for this user
    const [mappingLookup, skuLookup] = user
      ? await Promise.all([loadMappingLookup(user.id), loadSkuLookup(user.id)])
      : [new Map<string, MappingEntry>(), new Map<string, MappingEntry>()]

    // 쇼핑몰 displayName lookup (보내는분성명 = 쇼핑몰명)
    const connectionIds = [...new Set(orderRows.map((o) => o.connectionId).filter(Boolean) as string[])]
    const connectionRows = connectionIds.length > 0
      ? await db
          .select({ id: marketplaceConnections.id, displayName: marketplaceConnections.displayName })
          .from(marketplaceConnections)
          .where(inArray(marketplaceConnections.id, connectionIds))
      : []
    const connectionMap = new Map(connectionRows.map((c) => [c.id, c.displayName]))

    // SKU 기준 products(위치) + inventory(현재고) lookup
    const skuSet = [...new Set(itemRows.map((i) => i.sku).filter(Boolean) as string[])]
    const [productRows, inventoryRows] = user && skuSet.length > 0
      ? await Promise.all([
          db
            .select({ sku: products.internalSku, location: products.warehouseLocation })
            .from(products)
            .where(and(eq(products.userId, user.id), inArray(products.internalSku, skuSet))),
          db
            .select({ sku: inventory.sku, stock: inventory.availableStock })
            .from(inventory)
            .where(and(eq(inventory.userId, user.id), inArray(inventory.sku, skuSet))),
        ])
      : [[], []]
    const productMap = new Map(productRows.map((p) => [p.sku, p.location]))
    const inventoryMap = new Map(inventoryRows.map((i) => [i.sku, i.stock]))

    // 셀러 고정값은 이제 carrier_templates.columns[].fixedValue 로 관리
    // (boxCount, freightType, baseFreight, senderPhone, senderAddress 등)

    // Build flat order records for export
    const exportData: Record<string, unknown>[] = orderRows.map((order) => {
      const items = itemRows.filter((item) => item.orderId === order.id)
      const shipment = shipmentRows.find((s) => s.orderId === order.id)

      // 매핑 전 원본 (수집상품명/수집옵션명 용)
      const rawFirst = items[0]

      // Apply product name mappings — swaps marketplace names with internal names
      const mappedItems = applyMappings(
        items.map((i) => ({ ...i, marketplaceId: order.marketplaceId })),
        mappingLookup,
        skuLookup,
        order.marketplaceId,
      )
      const firstItem = mappedItems[0]
      const productName = firstItem?.productName ?? ''
      const optionText = firstItem?.optionText ?? ''
      const sku = (firstItem?.sku ?? rawFirst?.sku ?? '') as string

      return {
        orderId: order.id,
        marketplaceOrderId: order.marketplaceOrderId,
        marketplaceId: order.marketplaceId,
        buyerName: order.buyerName,
        buyerPhone: order.buyerPhone,
        recipientName: order.recipientName,
        recipientPhone: order.recipientPhone,
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
        stock: sku ? inventoryMap.get(sku) ?? '' : '',
        location: sku ? productMap.get(sku) ?? '' : '',
        senderName: order.connectionId ? connectionMap.get(order.connectionId) ?? '' : '',
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
