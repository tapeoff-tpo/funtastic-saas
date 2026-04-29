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

  const [mappingLookup, skuLookup] = await Promise.all([
    loadMappingLookup(user.id),
    loadSkuLookup(user.id),
  ])

  // 주문 → 매핑 적용 → bundle 펼침 → 행 생성.
  // 송장 1행 = 박스 1개 발송이라, 세트 SKU 는 component 행으로 펼쳐 출력한다.
  const cjRows: CjOrderRow[] = []
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
    const fullAddress = addr && typeof addr === 'object'
      ? [addr.zipCode, addr.address1, addr.address2].filter(Boolean).join(' ')
      : ''

    if (expanded.length === 0) continue

    for (const item of expanded) {
      const marketplaceItemIdRaw = item.marketplaceItemId
      const marketplaceItemId = typeof marketplaceItemIdRaw === 'string' ? marketplaceItemIdRaw : undefined
      // 펼친 행은 원본 수집상품명을 알 수 없으므로, 펼침 결과면 부모 sku 를 표기에 활용
      const originalRow = items.find((i) => i.sku === item.parentSku) ?? items[0]

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
        originalProductName: originalRow?.productName,
        pickingLocation: item.pickingLocation ?? undefined,
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
