/**
 * POST /api/shipping/upload/rpa
 *
 * Queue RPA invoice upload jobs for selected orders.
 */

import { NextRequest, NextResponse } from 'next/server'
import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { db } from '@/lib/db'
import { jobLogs, marketplaceConnections, orders, shipments } from '@/lib/db/schema'
import { getMarketplaceScrapeQueue } from '@/lib/jobs/queues'
import { getIntegrationMethod } from '@/lib/marketplace/integration-methods'
import { logOrderChange } from '@/lib/orders/change-log'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const workspaceUserId = await getWorkspaceUserId(user.id)

  let body: { orderIds?: string[] } = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'orderIds is required' }, { status: 400 })
  }

  if (!Array.isArray(body.orderIds) || body.orderIds.length === 0) {
    return NextResponse.json({ error: 'orderIds must be a non-empty array' }, { status: 400 })
  }

  const targetRows = await db
    .select({
      shipmentId: shipments.id,
      orderId: orders.id,
      marketplaceId: orders.marketplaceId,
      marketplaceOrderId: orders.marketplaceOrderId,
      connectionId: orders.connectionId,
      rawData: orders.rawData,
      recipientName: orders.recipientName,
      trackingNumber: shipments.trackingNumber,
      carrierId: shipments.carrierId,
      authType: marketplaceConnections.authType,
      isManual: marketplaceConnections.isManual,
    })
    .from(shipments)
    .innerJoin(orders, eq(shipments.orderId, orders.id))
    .innerJoin(marketplaceConnections, eq(orders.connectionId, marketplaceConnections.id))
    .where(and(
      eq(shipments.userId, workspaceUserId),
      eq(orders.userId, workspaceUserId),
      inArray(orders.id, body.orderIds),
      isNotNull(shipments.trackingNumber),
      eq(orders.isHeld, false),
    ))

  if (targetRows.length === 0) {
    return NextResponse.json({ message: 'RPA 전송할 송장번호가 없습니다.', queued: 0, skipped: body.orderIds.length })
  }

  const queue = getMarketplaceScrapeQueue()
  let queued = 0
  const results: Array<{ orderId: string; shipmentId: string; queued: boolean; error?: string }> = []
  const jobLogIds: string[] = []

  for (const row of targetRows) {
    if (!row.connectionId) {
      results.push({ orderId: row.orderId, shipmentId: row.shipmentId, queued: false, error: '마켓 연동 정보가 없습니다.' })
      continue
    }

    const integrationMethod = getIntegrationMethod(row.marketplaceId, {
      authType: row.authType,
      isManual: row.isManual,
    })
    if (integrationMethod !== 'rpa') {
      results.push({ orderId: row.orderId, shipmentId: row.shipmentId, queued: false, error: 'API 연동 주문은 기존 송장 전송 버튼을 사용하세요.' })
      continue
    }

    const [logRow] = await db
      .insert(jobLogs)
      .values({
        jobType: 'scrape-upload-invoice',
        marketplaceId: row.marketplaceId,
        connectionId: row.connectionId,
        status: 'queued',
      })
      .returning({ id: jobLogs.id })
    jobLogIds.push(logRow.id)

    await db.update(shipments).set({
      uploadStatus: 'uploading',
      marketplaceUploadError: null,
      updatedAt: new Date(),
    }).where(eq(shipments.id, row.shipmentId))
    await logOrderChange({
      orderId: row.orderId,
      userId: workspaceUserId,
      actorId: user.id,
      action: 'invoice.send_requested',
      title: 'RPA 송장 송신시작',
      description: row.trackingNumber,
      after: { uploadStatus: 'uploading', trackingNumber: row.trackingNumber },
      metadata: { shipmentId: row.shipmentId, marketplaceId: row.marketplaceId },
    })

    await queue.add(
      `manual-scrape-invoice-${row.marketplaceId}-${Date.now()}`,
      {
        marketplaceId: row.marketplaceId,
        connectionId: row.connectionId,
        userId: workspaceUserId,
        jobType: 'upload-invoice',
        jobLogId: logRow.id,
        orderId: row.marketplaceOrderId,
        shipmentId: row.shipmentId,
        invoice: {
          trackingNumber: row.trackingNumber,
          carrierId: row.carrierId,
          recipientName: row.recipientName,
          rawData: row.rawData,
        },
      },
      {
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 100 },
      },
    )

    queued += 1
    results.push({ orderId: row.orderId, shipmentId: row.shipmentId, queued: true })
  }

  return NextResponse.json({ queued, skipped: results.length - queued, total: results.length, results, jobLogIds })
}
