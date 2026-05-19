import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { orders, marketplaceConnections } from '@/lib/db/schema'
import { eq, and, inArray } from 'drizzle-orm'
import { readCredential } from '@/lib/supabase/admin'
import { createAdapter } from '@/lib/jobs/workers/order-collector'
import { marketplaceRegistry } from '@/lib/marketplace/registry'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import '@/lib/marketplace/adapters/configs'

/**
 * POST /api/orders/confirm
 *
 * Confirm (발주확인) selected orders on their respective marketplaces.
 * Updates local DB status to 'confirmed' on success.
 *
 * Body: { orderIds: string[] }
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const workspaceUserId = await getWorkspaceUserId(user.id)

  let body: { orderIds: string[] }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!Array.isArray(body.orderIds) || body.orderIds.length === 0) {
    return NextResponse.json(
      { error: 'orderIds must be a non-empty array' },
      { status: 400 }
    )
  }

  // Fetch orders with their marketplace info
  const targetOrders = await db
    .select({
      id: orders.id,
      marketplaceId: orders.marketplaceId,
      marketplaceOrderId: orders.marketplaceOrderId,
      connectionId: orders.connectionId,
      status: orders.status,
      mappedAt: orders.mappedAt,
      rawData: orders.rawData,
    })
    .from(orders)
    .where(
      and(
        eq(orders.userId, workspaceUserId),
        inArray(orders.id, body.orderIds)
      )
    )

  if (targetOrders.length === 0) {
    return NextResponse.json({ error: '주문을 찾을 수 없습니다' }, { status: 404 })
  }

  // Group by marketplace + connection for adapter reuse
  const groups = new Map<string, typeof targetOrders>()
  for (const order of targetOrders) {
    const key = `${order.marketplaceId}:${order.connectionId}`
    const group = groups.get(key) || []
    group.push(order)
    groups.set(key, group)
  }

  const results: Array<{
    orderId: string
    marketplaceOrderId: string
    marketplaceId: string
    success: boolean
    error?: string
  }> = []

  for (const [, groupOrders] of groups) {
    const { marketplaceId, connectionId } = groupOrders[0]

    // Skip orders without marketplace connection (e.g., Excel imports)
    if (!connectionId) {
      for (const order of groupOrders) {
        // Just update local status for manual imports
        if (order.status !== 'new') {
          results.push({
            orderId: order.id,
            marketplaceOrderId: order.marketplaceOrderId,
            marketplaceId,
            success: false,
            error: `이미 ${order.status} 상태입니다`,
          })
          continue
        }
        if (!order.mappedAt) {
          results.push({
            orderId: order.id,
            marketplaceOrderId: order.marketplaceOrderId,
            marketplaceId,
            success: false,
            error: '매핑완료된 신규 주문만 확정할 수 있습니다.',
          })
          continue
        }
        await db
          .update(orders)
          .set({ status: 'confirmed', updatedAt: new Date() })
          .where(eq(orders.id, order.id))
        results.push({
          orderId: order.id,
          marketplaceOrderId: order.marketplaceOrderId,
          marketplaceId,
          success: true,
        })
      }
      continue
    }

    // Get connection info for storeAlias
    const [conn] = await db
      .select({ storeAlias: marketplaceConnections.storeAlias })
      .from(marketplaceConnections)
      .where(eq(marketplaceConnections.id, connectionId))
      .limit(1)

    const storeAlias = conn?.storeAlias ?? 'default'
    const aliasTag = storeAlias === 'default' ? '' : `_${storeAlias}`

    // Load credentials
    let adapterConfig
    try {
      adapterConfig = marketplaceRegistry.get(marketplaceId)
    } catch {
      for (const order of groupOrders) {
        results.push({
          orderId: order.id,
          marketplaceOrderId: order.marketplaceOrderId,
          marketplaceId,
          success: false,
          error: `${marketplaceId}: 어댑터 미등록`,
        })
      }
      continue
    }

    const credentials: Record<string, string> = {}
    let credError = false
    for (const credKey of adapterConfig.config.requiredCredentials) {
      const vaultKey = `${credKey}${aliasTag}`
      const value = await readCredential(marketplaceId, workspaceUserId, vaultKey)
      if (!value) {
        credError = true
        for (const order of groupOrders) {
          results.push({
            orderId: order.id,
            marketplaceOrderId: order.marketplaceOrderId,
            marketplaceId,
            success: false,
            error: `인증 정보 누락: ${credKey}`,
          })
        }
        break
      }
      credentials[credKey] = value
    }
    if (credError) continue

    const adapter = createAdapter(marketplaceId, credentials)

    // Confirm each order
    for (const order of groupOrders) {
      if (order.status !== 'new') {
        results.push({
          orderId: order.id,
          marketplaceOrderId: order.marketplaceOrderId,
          marketplaceId,
          success: false,
          error: `이미 ${order.status} 상태입니다`,
        })
        continue
      }

      if (!order.mappedAt) {
        results.push({
          orderId: order.id,
          marketplaceOrderId: order.marketplaceOrderId,
          marketplaceId,
          success: false,
          error: '매핑완료된 신규 주문만 확정할 수 있습니다.',
        })
        continue
      }

      try {
        if (typeof (adapter as { confirmOrder?: unknown }).confirmOrder === 'function') {
          const result = await adapter.confirmOrder(
            order.marketplaceOrderId,
            (order.rawData ?? undefined) as Record<string, unknown> | undefined
          )

          if (!result.success) {
            results.push({
              orderId: order.id,
              marketplaceOrderId: order.marketplaceOrderId,
              marketplaceId,
              success: false,
              error: result.error,
            })
            continue
          }
        }

        // Update local status
        await db
          .update(orders)
          .set({
            status: 'confirmed',
            marketplaceStatus: 'CONFIRMED',
            updatedAt: new Date(),
          })
          .where(eq(orders.id, order.id))

        results.push({
          orderId: order.id,
          marketplaceOrderId: order.marketplaceOrderId,
          marketplaceId,
          success: true,
        })
      } catch (error) {
        results.push({
          orderId: order.id,
          marketplaceOrderId: order.marketplaceOrderId,
          marketplaceId,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    }
  }

  const successCount = results.filter((r) => r.success).length
  const failCount = results.filter((r) => !r.success).length

  return NextResponse.json({ results, successCount, failCount })
}
