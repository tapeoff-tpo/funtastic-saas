/**
 * GET /api/shipping/kyungdong/export?orderIds=...
 *
 * 경동택배 송장등록 엑셀 다운로드.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { orders, orderItems, companySettings } from '@/lib/db/schema'
import { inArray, and, eq } from 'drizzle-orm'
import { generateKyungdongExcel, type KyungdongOrderRow } from '@/lib/shipping/excel/kyungdong-export'
import { loadMappingLookup, loadSkuLookup, applyMappings } from '@/lib/products/apply-mappings'
import { expandBundlesForExport } from '@/lib/products/expand-bundles'

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

  // 주문 → 매핑 → bundle 펼침. 송장 1행 = 박스 1개라 세트는 component 행으로 분리.
  const exportRows: KyungdongOrderRow[] = []
  for (const order of orderRows) {
    const items = itemRows.filter((i) => i.orderId === order.id)
    const mapped = applyMappings(
      items.map((i) => ({ ...i, marketplaceId: order.marketplaceId })),
      mappingLookup,
      skuLookup,
      order.marketplaceId,
    )
    const expanded = await expandBundlesForExport(user.id, mapped)
    const addr = order.shippingAddress

    if (expanded.length === 0) continue

    for (const item of expanded) {
      exportRows.push({
        orderId: order.id,
        recipientName: order.recipientName,
        // 기본 = 휴대폰(phone2) 우선, 없으면 일반전화(phone1)
        recipientPhone: order.recipientPhone2 || order.recipientPhone || '',
        // 보조 = 휴대폰이 phone2 에 있으면 phone1 이 보조전화
        recipientAltPhone: order.recipientPhone2 ? (order.recipientPhone ?? '') : '',
        recipientAddress: addr?.address1 ?? '',
        recipientDetailAddress: addr?.address2 ?? '',
        recipientZipCode: addr?.zipCode ?? '',
        productName: item.productName ?? '',
        quantity: item.quantity,
        deliveryMessage: undefined,
        senderName: senderSettings?.companyName ?? '',
        senderPhone: senderSettings?.phone ?? '',
        pickingLocation: item.pickingLocation ?? undefined,
        internalSku: item.sku ?? undefined,
      })
    }
  }

  const buffer = await generateKyungdongExcel(exportRows)
  const date = new Date().toISOString().slice(0, 10)

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`경동택배_${date}.xlsx`)}`,
    },
  })
}
