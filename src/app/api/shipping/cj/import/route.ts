/**
 * POST /api/shipping/cj/import
 *
 * CJ 송장등록양식 엑셀 업로드 → 운송장번호를 주문에 연결.
 * 고객주문번호(col 19) = orders.id 기준으로 매칭.
 * 매칭 성공 시 shipments 테이블에 upsert.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { revalidatePath, revalidateTag } from 'next/cache'
import { db } from '@/lib/db'
import { shipments, orders } from '@/lib/db/schema'
import { eq, and, inArray } from 'drizzle-orm'
import { parseCjInvoiceExcel } from '@/lib/shipping/excel/cj-import'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'

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

  // Verify orders belong to this user
  const orderIds = [...new Set(rows.map((r) => r.orderId).filter(Boolean))]
  const validOrders = orderIds.length > 0
    ? await db.select({ id: orders.id, status: orders.status, mappedAt: orders.mappedAt }).from(orders).where(
        and(inArray(orders.id, orderIds), eq(orders.userId, workspaceUserId))
      )
    : []
  const validOrderIdSet = new Set(
    validOrders
      .filter((order) => order.status === 'confirmed' && order.mappedAt)
      .map((o) => o.id),
  )

  let matched = 0
  let unmatched = 0
  const unmatchedRows: { rowNum: number; orderId: string; trackingNumber: string }[] = []

  for (const row of rows) {
    if (!validOrderIdSet.has(row.orderId)) {
      unmatched++
      unmatchedRows.push({ rowNum: row.rowNum, orderId: row.orderId, trackingNumber: row.trackingNumber })
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
      orderId: row.orderId,
      userId: workspaceUserId,
      trackingNumber: row.trackingNumber,
      carrierId: 'cj',
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
      .where(and(eq(orders.id, row.orderId), eq(orders.userId, workspaceUserId), eq(orders.status, 'confirmed')))
    matched++
  }

  revalidatePath('/orders')
  revalidateTag('orders', 'max')

  return NextResponse.json({ matched, unmatched, skipped, unmatchedRows })
}
