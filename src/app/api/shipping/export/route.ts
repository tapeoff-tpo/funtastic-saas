/**
 * GET /api/shipping/export
 *
 * Export orders to Excel format (carrier-specific or order-list).
 * Returns downloadable .xlsx file.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { orders, orderItems, shipments } from '@/lib/db/schema'
import { eq, inArray } from 'drizzle-orm'
import { exportToCarrierExcel } from '@/lib/shipping/excel/export'
import { exportOrdersToExcel } from '@/lib/shipping/excel/order-export'
import { getCarrierTemplateById, getCarrierTemplates } from '@/lib/shipping/template-queries'
import { AVAILABLE_ORDER_FIELDS } from '@/lib/shipping/excel/templates'

export async function GET(request: NextRequest) {
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
    const orderRows = await db
      .select()
      .from(orders)
      .where(inArray(orders.id, orderIds))

    const itemRows = await db
      .select()
      .from(orderItems)
      .where(inArray(orderItems.orderId, orderIds))

    const shipmentRows = await db
      .select()
      .from(shipments)
      .where(inArray(shipments.orderId, orderIds))

    // Build flat order records for export
    const exportData: Record<string, unknown>[] = orderRows.map((order) => {
      const items = itemRows.filter((item) => item.orderId === order.id)
      const shipment = shipmentRows.find((s) => s.orderId === order.id)
      const firstItem = items[0]

      return {
        orderId: order.id,
        marketplaceOrderId: order.marketplaceOrderId,
        marketplaceId: order.marketplaceId,
        buyerName: order.buyerName,
        buyerPhone: order.buyerPhone,
        recipientName: order.recipientName,
        recipientPhone: order.recipientPhone,
        shippingAddress: order.shippingAddress,
        productName: firstItem?.productName ?? '',
        optionText: firstItem?.optionText ?? '',
        quantity: items.reduce((sum, item) => sum + item.quantity, 0),
        unitPrice: firstItem?.unitPrice ?? '0',
        totalAmount: order.totalAmount,
        trackingNumber: shipment?.trackingNumber ?? '',
        carrierName: shipment?.carrierName ?? '',
        orderedAt: order.orderedAt,
        status: order.status,
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
        // Use first default template
        // TODO: Get userId from auth session
        const templates = await getCarrierTemplates('placeholder-user-id')
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
