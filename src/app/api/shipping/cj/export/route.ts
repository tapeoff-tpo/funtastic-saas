/**
 * GET /api/shipping/cj/export?orderIds=...
 *
 * CJ대한통운 발주서 엑셀 다운로드.
 * 선택된 주문들을 CJ 양식으로 변환해 반환.
 * 상품명은 product_name_mappings 적용 후 내부 상품명 사용.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { orders, orderItems, companySettings } from '@/lib/db/schema'
import { inArray, and, eq } from 'drizzle-orm'
import { generateCjExcel, type CjOrderRow } from '@/lib/shipping/excel/cj-export'
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

  const cjRows: CjOrderRow[] = orderRows.map((order) => {
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
      recipientAddress: fullAddress,
      productName: firstItem?.productName ?? '',
      optionText: firstItem?.optionText ?? undefined,
      quantity: items.reduce((s, i) => s + i.quantity, 0),
      marketplaceItemId: firstItem?.marketplaceItemId ?? undefined,
      senderName: senderSettings?.companyName ?? '',
      senderPhone: senderSettings?.phone ?? '',
      senderAddress: senderSettings?.address ?? '',
      originalProductName: items[0]?.productName,
      pickingLocation: firstItem?.pickingLocation ?? undefined,
    }
  })

  const buffer = await generateCjExcel(cjRows)
  const date = new Date().toISOString().slice(0, 10)

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="CJ발주서_${date}.xlsx"`,
    },
  })
}
