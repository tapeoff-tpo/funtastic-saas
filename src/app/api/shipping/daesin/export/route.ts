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

  // Phase A 매핑 재설계: name/sku 매핑 + bundle 펼침 제거.
  // orderItems 원본 그대로 출력. (Phase C 신규 매핑코드 도입 시 재연결.)
  const exportRows: DaesinOrderRow[] = []
  for (const order of orderRows) {
    const items = itemRows.filter((i) => i.orderId === order.id)
    const addr = order.shippingAddress
    const fullAddress = addr
      ? [addr.zipCode, addr.address1, addr.address2].filter(Boolean).join(' ')
      : ''

    if (items.length === 0) continue

    for (const item of items) {
      exportRows.push({
        orderId: order.id,
        marketplaceOrderId: order.marketplaceOrderId,
        recipientName: order.recipientName,
        // 기본 = 휴대폰(phone2) 우선, 없으면 일반전화(phone1)
        recipientPhone: order.recipientPhone2 || order.recipientPhone || '',
        // 보조 = 휴대폰이 phone2 에 있으면 phone1 이 보조전화
        recipientAltPhone: order.recipientPhone2 ? (order.recipientPhone ?? '') : '',
        recipientAddress: fullAddress,
        recipientZipCode: addr?.zipCode ?? '',
        productName: item.productName ?? '',
        quantity: item.quantity,
        deliveryMessage: undefined,
        senderName: senderSettings?.companyName ?? '',
        senderPhone: senderSettings?.phone ?? '',
        pickingLocation: undefined,
        internalSku: item.sku ?? undefined,
      })
    }
  }

  const buffer = await generateDaesinExcel(exportRows)
  const date = new Date().toISOString().slice(0, 10)

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`대신택배_${date}.xlsx`)}`,
    },
  })
}
