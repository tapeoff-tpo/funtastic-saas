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
import { orders, orderItems, companySettings, inventory } from '@/lib/db/schema'
import { inArray, and, eq, sql } from 'drizzle-orm'
import { generateCjExcel, type CjOrderRow } from '@/lib/shipping/excel/cj-export'
import { expandOrderItemsWithMapping } from '@/lib/orders/mapping-expand'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'

function resolveMarketplaceProductCode(
  marketplaceId: string,
  source: { marketplaceItemId: string | null; sku: string | null },
): string | undefined {
  if (marketplaceId === 'funtastic-b2b') {
    return source.sku ?? source.marketplaceItemId ?? undefined
  }
  return source.marketplaceItemId ?? undefined
}

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

  try {
  const [senderSettings] = await db
    .select()
    .from(companySettings)
    .where(eq(companySettings.userId, workspaceUserId))
    .limit(1)

  const [orderRows, itemRows] = await Promise.all([
    db.select().from(orders).where(
      and(inArray(orders.id, orderIds), eq(orders.userId, workspaceUserId))
    ),
    db.select().from(orderItems).where(inArray(orderItems.orderId, orderIds)),
  ])

  // Phase C 매핑코드 확장: orderItems → mapping_components 의 SKU 행으로 전개.
  // 매핑 없으면 원본 1 행 유지.
  const expanded = await expandOrderItemsWithMapping(
    workspaceUserId,
    orderRows.map((o) => ({ id: o.id, marketplaceId: o.marketplaceId })),
    itemRows,
  )
  const expandedByOrder = new Map<string, typeof expanded>()
  for (const row of expanded) {
    const list = expandedByOrder.get(row.orderId) ?? []
    list.push(row)
    expandedByOrder.set(row.orderId, list)
  }

  const skuSet = [...new Set(expanded.map((row) => row.sku).filter(Boolean))]
  const inventoryRows = skuSet.length > 0
    ? await db
        .select({
          sku: inventory.sku,
          sectorCode: sql<string | null>`MAX(${inventory.sectorCode})`,
        })
        .from(inventory)
        .where(and(eq(inventory.userId, workspaceUserId), inArray(inventory.sku, skuSet)))
        .groupBy(inventory.sku)
    : []
  const locationBySku = new Map(inventoryRows.map((row) => [row.sku, row.sectorCode ?? '']))

  const cjRows: CjOrderRow[] = []
  for (const order of orderRows) {
    const rows = expandedByOrder.get(order.id) ?? []

    const addr = order.shippingAddress
    const fullAddress = addr && typeof addr === 'object'
      ? [addr.zipCode, addr.address1, addr.address2].filter(Boolean).join(' ')
      : ''

    if (rows.length === 0) continue

    for (const row of rows) {
      const marketplaceProductCode = resolveMarketplaceProductCode(order.marketplaceId, row.source)

      cjRows.push({
        orderId: order.id,
        marketplaceOrderId: order.marketplaceOrderId,
        recipientName: order.recipientName ?? '',
        // 기본 = 휴대폰(phone2) 우선, 없으면 일반전화(phone1)
        recipientPhone: order.recipientPhone2 || order.recipientPhone || '',
        recipientAddress: fullAddress,
        productName: row.productName,
        optionText: row.optionText || undefined,
        quantity: row.quantity,
        internalSku: row.fromMapping ? row.sku : undefined,
        marketplaceItemId: marketplaceProductCode,
        senderName: senderSettings?.companyName ?? '',
        senderPhone: senderSettings?.phone ?? '',
        senderAddress: senderSettings?.address ?? '',
        originalProductName: row.source.productName ?? undefined,
        pickingLocation: row.sku ? locationBySku.get(row.sku) || undefined : undefined,
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
