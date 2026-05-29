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
import { expandOrderItemsWithMapping } from '@/lib/orders/mapping-expand'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getCombinedShipmentGroupIds } from '@/lib/shipping/combined-safety'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const workspaceUserId = await getWorkspaceUserId(user.id)

  const orderIdsParam = req.nextUrl.searchParams.get('orderIds') ?? ''
  const orderIds = orderIdsParam.split(',').filter(Boolean)
  if (orderIds.length === 0) {
    return NextResponse.json({ error: 'orderIds 필수' }, { status: 400 })
  }

  const [senderSettings] = await db
    .select()
    .from(companySettings)
    .where(eq(companySettings.userId, workspaceUserId))
    .limit(1)

  const [orderRows, itemRows, groupIdByOrder] = await Promise.all([
    db.select().from(orders).where(
      and(inArray(orders.id, orderIds), eq(orders.userId, workspaceUserId))
    ),
    db.select().from(orderItems).where(inArray(orderItems.orderId, orderIds)),
    getCombinedShipmentGroupIds(workspaceUserId, orderIds),
  ])

  // Phase C 매핑코드 확장: orderItems → mapping_components 의 SKU 행으로 전개.
  const expanded = await expandOrderItemsWithMapping(
    workspaceUserId,
    orderRows.map((o) => ({ id: o.id, marketplaceId: o.marketplaceId, rawData: o.rawData })),
    itemRows,
  )
  const expandedByOrder = new Map<string, typeof expanded>()
  for (const row of expanded) {
    const list = expandedByOrder.get(row.orderId) ?? []
    list.push(row)
    expandedByOrder.set(row.orderId, list)
  }

  const exportRows: KyungdongOrderRow[] = []
  for (const order of orderRows) {
    const rows = expandedByOrder.get(order.id) ?? []
    const addr = order.shippingAddress

    if (rows.length === 0) continue

    for (const row of rows) {
      exportRows.push({
        orderId: order.id,
        marketplaceOrderId: order.marketplaceOrderId,
        shipmentGroupId: groupIdByOrder.get(order.id),
        recipientName: order.recipientName,
        // 기본 = 휴대폰(phone2) 우선, 없으면 일반전화(phone1)
        recipientPhone: order.recipientPhone2 || order.recipientPhone || '',
        // 보조 = 휴대폰이 phone2 에 있으면 phone1 이 보조전화
        recipientAltPhone: order.recipientPhone2 ? (order.recipientPhone ?? '') : '',
        recipientAddress: addr?.address1 ?? '',
        recipientDetailAddress: addr?.address2 ?? '',
        recipientZipCode: addr?.zipCode ?? '',
        productName: row.productName,
        quantity: row.quantity,
        deliveryMessage: undefined,
        senderName: senderSettings?.companyName ?? '',
        senderPhone: senderSettings?.phone ?? '',
        pickingLocation: undefined,
        internalSku: row.sku || undefined,
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
