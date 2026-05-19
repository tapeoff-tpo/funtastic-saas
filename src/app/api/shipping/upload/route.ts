/**
 * POST /api/shipping/upload
 *
 * 스캔 완료된 shipments를 각 마켓플레이스 API로 운송장 전송.
 * body: { shipmentIds?: string[] }  — 없으면 오늘 pending 전체 처리
 *
 * 각 shipment → order → adapter.uploadInvoice() 순으로 처리.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { shipments, orders, marketplaceConnections } from '@/lib/db/schema'
import { eq, and, inArray, isNotNull, gte } from 'drizzle-orm'
import { readCredential } from '@/lib/supabase/admin'
import { createAdapter } from '@/lib/jobs/workers/order-collector'
import { marketplaceRegistry } from '@/lib/marketplace/registry'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getIntegrationMethod } from '@/lib/marketplace/integration-methods'
import { markShipmentUploadedAndOrderShipped } from '@/lib/shipping/upload-status'
import { logOrderChange } from '@/lib/orders/change-log'
import '@/lib/marketplace/adapters/configs'
import { startOfDay } from 'date-fns'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const workspaceUserId = await getWorkspaceUserId(user.id)

  let body: { shipmentIds?: string[]; orderIds?: string[] } = {}
  try { body = await req.json() } catch { /* empty body = upload all today's pending */ }

  // Fetch target shipments
  const todayStart = startOfDay(new Date())
  const targetConditions = [
    eq(shipments.userId, workspaceUserId),
    isNotNull(shipments.trackingNumber),
    eq(orders.isHeld, false),
  ]

  if (body.shipmentIds?.length) {
    targetConditions.push(inArray(shipments.id, body.shipmentIds))
  } else if (body.orderIds?.length) {
    targetConditions.push(inArray(shipments.orderId, body.orderIds))
  } else {
    targetConditions.push(isNotNull(shipments.shippedAt))
    targetConditions.push(gte(shipments.shippedAt, todayStart))
    targetConditions.push(eq(shipments.uploadStatus, 'pending'))
  }

  const targetShipments = await db
    .select({
      id: shipments.id,
      orderId: shipments.orderId,
      trackingNumber: shipments.trackingNumber,
      carrierId: shipments.carrierId,
      uploadStatus: shipments.uploadStatus,
      uploadAttempts: shipments.uploadAttempts,
    })
    .from(shipments)
    .innerJoin(orders, eq(shipments.orderId, orders.id))
    .where(and(...targetConditions))

  if (targetShipments.length === 0) {
    return NextResponse.json({ message: '전송할 건이 없습니다', uploaded: 0, failed: 0, results: [] })
  }

  // Fetch related orders
  const orderIds = targetShipments.map((s) => s.orderId)
  const orderRows = await db
    .select({
      id: orders.id,
      marketplaceId: orders.marketplaceId,
      marketplaceOrderId: orders.marketplaceOrderId,
      connectionId: orders.connectionId,
      rawData: orders.rawData,
    })
    .from(orders)
    .where(inArray(orders.id, orderIds))

  const orderMap = new Map(orderRows.map((o) => [o.id, o]))

  const results: Array<{
    shipmentId: string
    trackingNumber: string
    success: boolean
    error?: string
    marketplaceId?: string
  }> = []

  // Group by marketplaceId + connectionId for adapter reuse
  const groups = new Map<string, typeof targetShipments>()
  for (const s of targetShipments) {
    const order = orderMap.get(s.orderId)
    if (!order) continue
    const key = `${order.marketplaceId}:${order.connectionId}`
    const g = groups.get(key) ?? []
    g.push(s)
    groups.set(key, g)
  }

  for (const [, groupShipments] of groups) {
    const order = orderMap.get(groupShipments[0].orderId)
    if (!order) continue
    const { marketplaceId, connectionId } = order

    // Skip if no connection (Excel import orders)
    if (!connectionId) {
      for (const s of groupShipments) {
        await markShipmentUploadedAndOrderShipped(s.id, s.orderId, s.uploadAttempts)
        results.push({ shipmentId: s.id, trackingNumber: s.trackingNumber, success: true, marketplaceId })
      }
      continue
    }

    // Load adapter config + credentials
    let adapterConfig: ReturnType<typeof marketplaceRegistry.get> | null = null
    try { adapterConfig = marketplaceRegistry.get(marketplaceId) } catch {
      for (const s of groupShipments) {
        results.push({ shipmentId: s.id, trackingNumber: s.trackingNumber, success: false, error: `${marketplaceId}: 어댑터 미등록`, marketplaceId })
      }
      continue
    }

    // Get storeAlias for credential key suffix
    const [conn] = await db
      .select({
        storeAlias: marketplaceConnections.storeAlias,
        authType: marketplaceConnections.authType,
        isManual: marketplaceConnections.isManual,
      })
      .from(marketplaceConnections)
      .where(eq(marketplaceConnections.id, connectionId))
      .limit(1)

    if (getIntegrationMethod(marketplaceId, { authType: conn?.authType, isManual: conn?.isManual }) === 'rpa') {
      for (const s of groupShipments) {
        results.push({
          shipmentId: s.id,
          trackingNumber: s.trackingNumber,
          success: false,
          error: 'RPA 연동 주문은 [RPA 송장 전송] 버튼을 사용하세요.',
          marketplaceId,
        })
      }
      continue
    }

    const aliasTag = (conn?.storeAlias && conn.storeAlias !== 'default') ? `_${conn.storeAlias}` : ''

    const credentials: Record<string, string> = {}
    let credError = false
    for (const key of adapterConfig.config.requiredCredentials) {
      const val = await readCredential(marketplaceId, workspaceUserId, `${key}${aliasTag}`)
      if (!val) { credError = true; break }
      credentials[key] = val
    }
    if (credError) {
      for (const s of groupShipments) {
        results.push({ shipmentId: s.id, trackingNumber: s.trackingNumber, success: false, error: '인증 정보 없음', marketplaceId })
      }
      continue
    }

    const adapter = createAdapter(marketplaceId, credentials)

    for (const s of groupShipments) {
      const ord = orderMap.get(s.orderId)!
      try {
        await db.update(shipments).set({ uploadStatus: 'uploading', updatedAt: new Date() }).where(eq(shipments.id, s.id))
        await logOrderChange({
          orderId: s.orderId,
          userId: workspaceUserId,
          actorId: user.id,
          action: 'invoice.send_requested',
          title: 'API 송장 송신시작',
          description: s.trackingNumber,
          after: { uploadStatus: 'uploading', trackingNumber: s.trackingNumber },
          metadata: { shipmentId: s.id, marketplaceId },
        })

        const result = await adapter.uploadInvoice(ord.marketplaceOrderId, {
          trackingNumber: s.trackingNumber,
          carrierId: s.carrierId,
          rawData: ord.rawData,
        })

        if (result.success) {
          await markShipmentUploadedAndOrderShipped(s.id, s.orderId, s.uploadAttempts + 1)
          results.push({ shipmentId: s.id, trackingNumber: s.trackingNumber, success: true, marketplaceId })
        } else {
          await db.update(shipments).set({
            uploadStatus: 'failed',
            marketplaceUploadError: result.error ?? null,
            uploadAttempts: s.uploadAttempts + 1,
            updatedAt: new Date(),
          }).where(eq(shipments.id, s.id))
          results.push({ shipmentId: s.id, trackingNumber: s.trackingNumber, success: false, error: result.error, marketplaceId })
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Unknown error'
        await db.update(shipments).set({
          uploadStatus: 'failed',
          marketplaceUploadError: msg,
          uploadAttempts: s.uploadAttempts + 1,
          updatedAt: new Date(),
        }).where(eq(shipments.id, s.id))
        results.push({ shipmentId: s.id, trackingNumber: s.trackingNumber, success: false, error: msg, marketplaceId })
      }
    }
  }

  const uploaded = results.filter((r) => r.success).length
  const failed = results.filter((r) => !r.success).length

  return NextResponse.json({ uploaded, failed, total: results.length, results })
}
