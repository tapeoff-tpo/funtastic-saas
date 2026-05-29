import { NextRequest, NextResponse } from 'next/server'
import { and, eq, inArray, or, sql } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { giftRules, inventory, orderItems, orders } from '@/lib/db/schema'
import { expandOrderItemsWithMapping } from '@/lib/orders/mapping-expand'
import { ensureGiftRulesTable, type GiftRuleCondition } from '@/lib/orders/gift-rules'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'

interface ApplyGiftsBody {
  orderIds?: string[]
}

type GiftRuleRow = typeof giftRules.$inferSelect

function getRuleConditions(rule: GiftRuleRow): GiftRuleCondition[] {
  if (Array.isArray(rule.conditions) && rule.conditions.length > 0) {
    return rule.conditions
      .map((condition) => ({
        type: condition.type,
        value: String(condition.value ?? '').trim(),
      }))
      .filter((condition): condition is GiftRuleCondition => (
        (condition.type === 'amount' || condition.type === 'sku' || condition.type === 'marketplaceProductCode') &&
        condition.value.length > 0
      ))
  }

  if (rule.conditionType === 'amount' && rule.minAmount) return [{ type: 'amount', value: String(rule.minAmount) }]
  if (rule.conditionType === 'sku' && rule.triggerSku) return [{ type: 'sku', value: rule.triggerSku }]
  return []
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const workspaceUserId = await getWorkspaceUserId(user.id)

  let body: ApplyGiftsBody
  try {
    body = await req.json() as ApplyGiftsBody
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }

  const orderIds = Array.isArray(body.orderIds)
    ? Array.from(new Set(body.orderIds.filter((id): id is string => typeof id === 'string' && id.length > 0)))
    : []
  if (orderIds.length === 0) {
    return NextResponse.json({ error: 'orderIds must be a non-empty array' }, { status: 400 })
  }

  await ensureGiftRulesTable()

  const [targetOrders, rules] = await Promise.all([
    db
      .select()
      .from(orders)
      .where(and(eq(orders.userId, workspaceUserId), eq(orders.status, 'new'), inArray(orders.id, orderIds))),
    db
      .select()
      .from(giftRules)
      .where(and(eq(giftRules.userId, workspaceUserId), eq(giftRules.isActive, true))),
  ])

  if (targetOrders.length === 0) return NextResponse.json({ applied: 0, skipped: orderIds.length })
  if (rules.length === 0) return NextResponse.json({ applied: 0, skipped: targetOrders.length, message: '사은품 규칙이 없습니다.' })

  const targetOrderIds = targetOrders.map((order) => order.id)
  const sourceItems = await db.select().from(orderItems).where(inArray(orderItems.orderId, targetOrderIds))
  const merchandiseAmountByOrder = new Map<string, number>()
  const marketplaceCodesByOrder = new Map<string, Set<string>>()
  for (const item of sourceItems) {
    if (item.fulfillmentCode === 'gift') continue
    const current = merchandiseAmountByOrder.get(item.orderId) ?? 0
    merchandiseAmountByOrder.set(item.orderId, current + (Number(item.unitPrice) || 0) * item.quantity)
    if (item.marketplaceItemId) {
      const set = marketplaceCodesByOrder.get(item.orderId) ?? new Set<string>()
      set.add(item.marketplaceItemId)
      set.add(item.marketplaceItemId.split('-')[0])
      marketplaceCodesByOrder.set(item.orderId, set)
    }
  }

  const expandedRows = await expandOrderItemsWithMapping(
    workspaceUserId,
    targetOrders.map((order) => ({ id: order.id, marketplaceId: order.marketplaceId, rawData: order.rawData })),
    sourceItems,
  )

  const skusByOrder = new Map<string, Set<string>>()
  for (const row of expandedRows) {
    if (!row.sku) continue
    const set = skusByOrder.get(row.orderId) ?? new Set<string>()
    set.add(row.sku)
    set.add(row.sku.split('-')[0])
    skusByOrder.set(row.orderId, set)
  }

  const giftSkus = Array.from(new Set(rules.map((rule) => rule.giftSku)))
  const giftInventoryRows = giftSkus.length > 0
    ? await db
        .select({
          sku: inventory.sku,
          productName: sql<string | null>`MAX(${inventory.productName})`,
          optionName: sql<string | null>`MAX(${inventory.optionName})`,
        })
        .from(inventory)
        .where(and(eq(inventory.userId, workspaceUserId), inArray(inventory.sku, giftSkus)))
        .groupBy(inventory.sku)
    : []
  const giftInventory = new Map(giftInventoryRows.map((row) => [row.sku, row]))

  const existingGiftRows = await db
    .select({
      orderId: orderItems.orderId,
      marketplaceItemId: orderItems.marketplaceItemId,
    })
    .from(orderItems)
    .where(
      and(
        inArray(orderItems.orderId, targetOrderIds),
        or(...rules.map((rule) => eq(orderItems.marketplaceItemId, `gift:${rule.id}`)))!,
      ),
    )
  const existingGiftKeys = new Set(existingGiftRows.map((row) => `${row.orderId}:${row.marketplaceItemId}`))

  const values: Array<typeof orderItems.$inferInsert> = []
  for (const order of targetOrders) {
    const orderSkuSet = skusByOrder.get(order.id) ?? new Set<string>()
    const marketplaceCodeSet = marketplaceCodesByOrder.get(order.id) ?? new Set<string>()
    for (const rule of rules) {
      if (rule.marketplaceId && rule.marketplaceId !== order.marketplaceId) continue
      const merchandiseAmount = merchandiseAmountByOrder.get(order.id) ?? Math.max(0, Number(order.totalAmount) - Number(order.shippingFee ?? 0))
      const conditions = getRuleConditions(rule)
      const matches = conditions.length > 0 && conditions.every((condition) => {
        if (condition.type === 'amount') return merchandiseAmount >= Number(condition.value)
        if (condition.type === 'sku') return orderSkuSet.has(condition.value)
        if (condition.type === 'marketplaceProductCode') return marketplaceCodeSet.has(condition.value)
        return false
      })
      if (!matches) continue

      const marker = `gift:${rule.id}`
      if (existingGiftKeys.has(`${order.id}:${marker}`)) continue

      const gift = giftInventory.get(rule.giftSku)
      values.push({
        orderId: order.id,
        marketplaceItemId: marker,
        productName: gift?.productName ?? rule.giftSku,
        optionText: gift?.optionName ?? null,
        quantity: rule.giftQuantity,
        unitPrice: '0',
        sku: rule.giftSku,
        skuMultiplier: 1,
        fulfillmentCode: 'gift',
      })
    }
  }

  if (values.length > 0) await db.insert(orderItems).values(values)

  return NextResponse.json({ applied: values.length, skipped: targetOrders.length - new Set(values.map((v) => v.orderId)).size })
}
