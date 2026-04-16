/**
 * GET /api/shipping/daesin/export?orderIds=...
 *
 * 대신택배 송장등록 엑셀 다운로드.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { orders, orderItems, companySettings } from '@/lib/db/schema'
import { inArray, and, eq } from 'drizzle-orm'
import { generateDaesinExcel, type DaesinOrderRow } from '@/lib/shipping/excel/daesin-export'
import { loadMappingLookup, loadSkuLookup, applyMappings } from '@/lib/products/apply-mappings'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const orderIdsParam = req.nextUrl.searchParams.get('orderIds') ?? ''
  const orderIds = orderIdsParam.split(',').filter(Boolean)
  if (orderIds.length === 0) {
    return NextResponse.json({ error: 'orderIds 필수' }, { status: 400 })
  }

  const [senderSettings] = await db
    .select()
    .from(companySettings)
    .where(eq(companySettings.userId, user.id))
    .limit(1)

  const [orderRows, itemRows] = await Promise.all([
    db.select().from(orders).where(
      and(inArray(orders.id, orderIds), eq(orders.userId, user.id))
    ),
    db.select().from(orderItems).where(inArray(orderItems.orderId, orderIds)),
  ])

  const [mappingLookup, skuLookup] = await Promise.all([
    loadMappingLookup(user.id),
    loadSkuLookup(user.id),
  ])

  const exportRows: DaesinOrderRow[] = orderRows.map((order) => {
    const items = itemRows.filter((i) => i.orderId === order.id)
    const mapped = applyMappings(
      items.map((i) => ({ ...i, marketplaceId: order.marketplaceId })),
      mappingLookup,
      skuLookup,
      order.marketplaceId,
    )
    const firstItem = mapped[0]
    const addr = order.shippingAddress
    const fullAddress = addr
      ? [addr.zipCode, addr.address1, addr.address2].filter(Boolean).join(' ')
      : ''

    return {
      orderId: order.id,
      marketplaceOrderId: order.marketplaceOrderId,
      recipientName: order.recipientName,
      recipientPhone: order.recipientPhone ?? '',
      recipientAltPhone: '',
      recipientAddress: fullAddress,
      recipientZipCode: addr?.zipCode ?? '',
      productName: firstItem?.productName ?? '',
      quantity: items.reduce((s, i) => s + i.quantity, 0),
      deliveryMessage: undefined,
      senderName: senderSettings?.companyName ?? '',
      senderPhone: senderSettings?.phone ?? '',
      pickingLocation: firstItem?.pickingLocation ?? undefined,
      internalSku: firstItem?.sku ?? undefined,
    }
  })

  const buffer = await generateDaesinExcel(exportRows)
  const date = new Date().toISOString().slice(0, 10)

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="대신택배_${date}.xlsx"`,
    },
  })
}
