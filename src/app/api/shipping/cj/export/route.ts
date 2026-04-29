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

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const orderIdsParam = req.nextUrl.searchParams.get('orderIds') ?? ''
  const orderIds = orderIdsParam.split(',').filter(Boolean)
  if (orderIds.length === 0) {
    return NextResponse.json({ error: 'orderIds 필수' }, { status: 400 })
  }

  try {
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

  // Phase A 매핑 재설계: name/sku/option 매핑 + bundle 펼침 제거.
  // orderItems 를 원본 그대로 출력. (Phase C 신규 매핑코드 시스템 도입 시 재연결.)
  const cjRows: CjOrderRow[] = []
  for (const order of orderRows) {
    const items = itemRows.filter((i) => i.orderId === order.id)

    const addr = order.shippingAddress
    const fullAddress = addr && typeof addr === 'object'
      ? [addr.zipCode, addr.address1, addr.address2].filter(Boolean).join(' ')
      : ''

    if (items.length === 0) continue

    for (const item of items) {
      const marketplaceItemId = item.marketplaceItemId ?? undefined

      cjRows.push({
        orderId: order.id,
        marketplaceOrderId: order.marketplaceOrderId,
        recipientName: order.recipientName ?? '',
        // 기본 = 휴대폰(phone2) 우선, 없으면 일반전화(phone1)
        recipientPhone: order.recipientPhone2 || order.recipientPhone || '',
        recipientAddress: fullAddress,
        productName: item.productName ?? '',
        optionText: item.optionText ?? undefined,
        quantity: item.quantity,
        marketplaceItemId,
        senderName: senderSettings?.companyName ?? '',
        senderPhone: senderSettings?.phone ?? '',
        senderAddress: senderSettings?.address ?? '',
        originalProductName: item.productName,
        pickingLocation: undefined,
      })
    }
  }

  const buffer = await generateCjExcel(cjRows)
  const date = new Date().toISOString().slice(0, 10)

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`CJ발주서_${date}.xlsx`)}`,
    },
  })
  } catch (err) {
    console.error('[cj/export] failed:', err, { orderIds })
    const msg = err instanceof Error ? `${err.message}\n${err.stack}` : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
