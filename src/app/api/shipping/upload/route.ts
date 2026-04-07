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
import '@/lib/marketplace/adapters/configs'
import { startOfDay } from 'date-fns'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { shipmentIds?: string[] } = {}
  try { body = await req.json() } catch { /* empty body = upload all today's pending */ }

  // Fetch target shipments
  const todayStart = startOfDay(new Date())

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
    .where(
      and(
        eq(shipments.userId, user.id),
        isNotNull(shipments.shippedAt),
        gte(shipments.shippedAt, todayStart),
        ...(body.shipmentIds?.length
          ? [inArray(shipments.id, body.shipmentIds)]
          : [eq(shipments.uploadStatus, 'pending')]),
      ),
    )

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
        await db.update(shipments).set({ uploadStatus: 'uploaded', lastUploadAt: new Date(), updatedAt: new Date() }).where(eq(shipments.id, s.id))
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
      .select({ storeAlias: marketplaceConnections.storeAlias })
      .from(marketplaceConnections)
      .where(eq(marketplaceConnections.id, connectionId))
      .limit(1)
    const aliasTag = (conn?.storeAlias && conn.storeAlias !== 'default') ? `_${conn.storeAlias}` : ''

    const credentials: Record<string, string> = {}
    let credError = false
    for (const key of adapterConfig.config.requiredCredentials) {
      const val = await readCredential(marketplaceId, user.id, `${key}${aliasTag}`)
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

        const result = await adapter.uploadInvoice(ord.marketplaceOrderId, {
          trackingNumber: s.trackingNumber,
          carrierId: s.carrierId,
          rawData: ord.rawData,
        })

        if (result.success) {
          await db.update(shipments).set({
            uploadStatus: 'uploaded',
            lastUploadAt: new Date(),
            uploadAttempts: s.uploadAttempts + 1,
            marketplaceUploadError: null,
            updatedAt: new Date(),
          }).where(eq(shipments.id, s.id))
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
