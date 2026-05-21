/**
 * POST /api/shipping/cj/import
 *
 * CJ 송장등록양식 엑셀 업로드 → 운송장번호를 주문에 연결.
 * 고객주문번호(col 19) = 내부주문번호/주문 UUID 기준으로 매칭.
 * 매칭 성공 시 shipments 테이블에 upsert.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { revalidatePath, revalidateTag } from 'next/cache'
import { db } from '@/lib/db'
import { shipments, orders } from '@/lib/db/schema'
import { eq, and, inArray, or, sql } from 'drizzle-orm'
import { parseCjInvoiceExcel } from '@/lib/shipping/excel/cj-import'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { releaseShipmentGroupsWithConflictingShipments } from '@/lib/shipping/combined-safety'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const workspaceUserId = await getWorkspaceUserId(user.id)

  let buffer: Buffer
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'file 필드 없음' }, { status: 400 })
    const arrayBuffer = await file.arrayBuffer()
    buffer = Buffer.from(arrayBuffer)
  } catch {
    return NextResponse.json({ error: '파일 읽기 실패' }, { status: 400 })
  }

  const { rows, skipped } = await parseCjInvoiceExcel(buffer)
  if (rows.length === 0) {
    return NextResponse.json({ error: '운송장 데이터가 없습니다' }, { status: 400 })
  }

  // Verify orders belong to this user. CJ 파일에는 8자리 내부주문번호가 들어오는 경우가 많다.
  const orderIdentifiers = [...new Set(rows.map((r) => r.orderId).filter(Boolean))]
  const fullUuidIdentifiers = orderIdentifiers.filter((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
  const shortUuidPrefixes = orderIdentifiers.filter((id) => /^[0-9a-f]{8}$/i.test(id))
  const validOrders = orderIdentifiers.length > 0
    ? await db
        .select({
          id: orders.id,
          internalNo: orders.internalNo,
          status: orders.status,
          mappedAt: orders.mappedAt,
        })
        .from(orders)
        .where(
          and(
            eq(orders.userId, workspaceUserId),
            or(
              inArray(orders.internalNo, orderIdentifiers),
              fullUuidIdentifiers.length > 0 ? inArray(orders.id, fullUuidIdentifiers) : undefined,
              shortUuidPrefixes.length > 0 ? inArray(sql<string>`left(${orders.id}::text, 8)`, shortUuidPrefixes) : undefined,
            )!,
          ),
        )
    : []

  const orderByIdentifier = new Map<string, typeof validOrders[number]>()
  for (const order of validOrders) {
    orderByIdentifier.set(order.internalNo, order)
    orderByIdentifier.set(order.id, order)
    orderByIdentifier.set(order.id.slice(0, 8), order)
  }

  let matched = 0
  let unmatched = 0
  const touchedOrderIds: string[] = []
  const unmatchedRows: { rowNum: number; orderId: string; trackingNumber: string; reason: string }[] = []

  for (const row of rows) {
    const order = orderByIdentifier.get(row.orderId)
    if (!order) {
      unmatched++
      unmatchedRows.push({ rowNum: row.rowNum, orderId: row.orderId, trackingNumber: row.trackingNumber, reason: '주문을 찾을 수 없음' })
      continue
    }
    if (order.status !== 'confirmed' || !order.mappedAt) {
      unmatched++
      unmatchedRows.push({
        rowNum: row.rowNum,
        orderId: row.orderId,
        trackingNumber: row.trackingNumber,
        reason: !order.mappedAt ? '매핑 미확정' : `확인 상태 아님(${order.status})`,
      })
      continue
    }

    // Upsert shipment: if tracking already exists update, else insert
    const existing = await db
      .select({ id: shipments.id })
      .from(shipments)
      .where(eq(shipments.trackingNumber, row.trackingNumber))
      .limit(1)

    if (existing.length > 0) {
      matched++
      continue
    }

    await db.insert(shipments).values({
      orderId: order.id,
      userId: workspaceUserId,
      trackingNumber: row.trackingNumber,
      carrierId: 'CJGLS',
      carrierName: 'CJ대한통운',
      uploadStatus: 'pending',
    })
    await db
      .update(orders)
      .set({
        status: 'preparing',
        preparingAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(orders.id, order.id), eq(orders.userId, workspaceUserId), eq(orders.status, 'confirmed')))
    matched++
    touchedOrderIds.push(order.id)
  }

  await releaseShipmentGroupsWithConflictingShipments(workspaceUserId, touchedOrderIds)

  revalidatePath('/orders')
  revalidateTag('orders', 'max')

  return NextResponse.json({ matched, unmatched, skipped, unmatchedRows })
}
