import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'

export type ClearanceSettings = {
  minimumStock: number
  staleDays: number
  maximumSellThroughPercent: number
  minimumMarginPercent: number
  marketplaceFeePercent: number
  packingCost: number
  shippingCost: number
  defaultDiscountPercent: number
  maximumDiscountPercent: number
  roundingUnit: number
}

export type ClearanceCandidate = {
  sku: string
  productName: string
  currentStock: number
  lastIncomingAt: string | null
  soldSinceIncoming: number
  daysSinceIncoming: number | null
  basePrice: number | null
  costPrice: number | null
  suggestedPrice: number | null
  minimumPrice: number | null
  reason: string
  dataStatus: 'ready' | 'incoming_missing' | 'price_missing'
}

export type ClearanceDecision = { sku: string; status: string; actionType: string; proposedPrice: number | null; discountPercent: number | null; note: string }

export const defaultClearanceSettings: ClearanceSettings = {
  minimumStock: 10, staleDays: 45, maximumSellThroughPercent: 20, minimumMarginPercent: 25,
  marketplaceFeePercent: 12, packingCost: 500, shippingCost: 0, defaultDiscountPercent: 10,
  maximumDiscountPercent: 30, roundingUnit: 1000,
}

export async function ensureClearanceTables() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS inventory_clearance_settings (
      user_id uuid PRIMARY KEY, minimum_stock integer NOT NULL DEFAULT 10, stale_days integer NOT NULL DEFAULT 45,
      maximum_sell_through_percent numeric(7,2) NOT NULL DEFAULT 20, minimum_margin_percent numeric(7,2) NOT NULL DEFAULT 25,
      marketplace_fee_percent numeric(7,2) NOT NULL DEFAULT 12, packing_cost integer NOT NULL DEFAULT 500,
      shipping_cost integer NOT NULL DEFAULT 0, default_discount_percent numeric(7,2) NOT NULL DEFAULT 10,
      maximum_discount_percent numeric(7,2) NOT NULL DEFAULT 30, rounding_unit integer NOT NULL DEFAULT 1000,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS inventory_clearance_decisions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, sku varchar(100) NOT NULL,
      status varchar(30) NOT NULL DEFAULT 'candidate', action_type varchar(30) NOT NULL DEFAULT 'price_drop',
      proposed_price integer, discount_percent numeric(7,2), note text NOT NULL DEFAULT '', updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(user_id, sku)
    );
  `)
}

export async function getClearanceSettings(userId: string): Promise<ClearanceSettings> {
  await ensureClearanceTables()
  const result = await db.execute(sql`SELECT * FROM inventory_clearance_settings WHERE user_id = ${userId} LIMIT 1`)
  const row = (result as unknown as Array<Record<string, unknown>>)[0]
  if (!row) return defaultClearanceSettings
  const n = (key: string, fallback: number) => Number(row[key] ?? fallback)
  return { minimumStock: n('minimum_stock', 10), staleDays: n('stale_days', 45), maximumSellThroughPercent: n('maximum_sell_through_percent', 20), minimumMarginPercent: n('minimum_margin_percent', 25), marketplaceFeePercent: n('marketplace_fee_percent', 12), packingCost: n('packing_cost', 500), shippingCost: n('shipping_cost', 0), defaultDiscountPercent: n('default_discount_percent', 10), maximumDiscountPercent: n('maximum_discount_percent', 30), roundingUnit: n('rounding_unit', 1000) }
}

export async function getClearanceDecisions(userId: string): Promise<ClearanceDecision[]> {
  await ensureClearanceTables()
  const result = await db.execute(sql`SELECT sku, status, action_type AS "actionType", proposed_price AS "proposedPrice", discount_percent AS "discountPercent", note FROM inventory_clearance_decisions WHERE user_id = ${userId}`)
  const rows = result as unknown as Array<Record<string, unknown>>
  return rows.map((r) => ({ sku: String(r.sku), status: String(r.status), actionType: String(r.actionType), proposedPrice: r.proposedPrice == null ? null : Number(r.proposedPrice), discountPercent: r.discountPercent == null ? null : Number(r.discountPercent), note: String(r.note ?? '') }))
}

export async function getClearanceCandidates(userId: string, settings: ClearanceSettings): Promise<ClearanceCandidate[]> {
  const result = await db.execute(sql`
    WITH stock AS (
      SELECT sku, max(product_name) AS product_name, coalesce(sum(available_stock), 0)::int AS current_stock
      FROM inventory WHERE user_id = ${userId} GROUP BY sku
    ), latest_incoming AS (
      SELECT i.sku, max(h.created_at) AS last_incoming_at
      FROM inventory_history h JOIN inventory i ON i.id = h.inventory_id
      WHERE h.user_id = ${userId} AND h.adjustment_reason = 'incoming' GROUP BY i.sku
    ), sold AS (
      SELECT li.sku, coalesce(sum(l.quantity), 0)::int AS sold_since_incoming
      FROM latest_incoming li LEFT JOIN outbound_reflection_lines l ON l.user_id = ${userId}
        AND l.reflection_status IN ('applied','ready') AND l.claim_type IS NULL AND l.sku = li.sku
        AND l.shipment_date >= li.last_incoming_at::date
      GROUP BY li.sku
    )
    SELECT s.sku, s.product_name AS "productName", s.current_stock AS "currentStock", li.last_incoming_at::text AS "lastIncomingAt",
      coalesce(sold.sold_since_incoming, 0)::int AS "soldSinceIncoming", p.base_price::text AS "basePrice",
      coalesce(p.cost_price, CASE WHEN replace(p.metadata->'esa009m'->>'works 신규 원가', ',', '') ~ '^[0-9]+([.][0-9]+)?$' THEN replace(p.metadata->'esa009m'->>'works 신규 원가', ',', '')::numeric END)::text AS "costPrice"
    FROM stock s LEFT JOIN latest_incoming li ON li.sku = s.sku LEFT JOIN sold ON sold.sku = s.sku
    LEFT JOIN products p ON p.user_id = ${userId} AND p.internal_sku = s.sku
    WHERE s.current_stock >= ${settings.minimumStock}
    ORDER BY s.current_stock DESC LIMIT 200
  `)
  const rows = result as unknown as Array<Record<string, unknown>>
  return rows.map((r) => {
    const currentStock = Number(r.currentStock); const sold = Number(r.soldSinceIncoming); const incoming = r.lastIncomingAt ? new Date(String(r.lastIncomingAt)) : null
    const days = incoming ? Math.floor((Date.now() - incoming.getTime()) / 86400000) : null
    const basePriceRaw = r.basePrice == null ? null : Number(r.basePrice)
    const basePrice = basePriceRaw != null && basePriceRaw > 0 ? basePriceRaw : null
    const cost = r.costPrice == null ? null : Number(r.costPrice)
    const sellThrough = currentStock + sold === 0 ? 0 : sold / (currentStock + sold) * 100
    const stale = days != null && days >= settings.staleDays && sellThrough <= settings.maximumSellThroughPercent
    const minPrice = cost == null ? null : Math.ceil((cost + settings.packingCost + settings.shippingCost) / Math.max(0.01, 1 - (settings.marketplaceFeePercent + settings.minimumMarginPercent) / 100))
    const rawSuggested = basePrice == null ? null : basePrice * (1 - settings.defaultDiscountPercent / 100)
    const rounded = rawSuggested == null ? null : Math.floor(rawSuggested / settings.roundingUnit) * settings.roundingUnit
    const suggested = rounded == null ? null : minPrice != null && rounded < minPrice ? null : rounded
    const dataStatus: ClearanceCandidate['dataStatus'] = !incoming ? 'incoming_missing' : basePrice == null ? 'price_missing' : 'ready'
    return { sku: String(r.sku), productName: String(r.productName), currentStock, lastIncomingAt: incoming ? incoming.toISOString().slice(0, 10) : null, soldSinceIncoming: sold, daysSinceIncoming: days, basePrice, costPrice: cost, suggestedPrice: suggested, minimumPrice: minPrice, dataStatus, reason: !incoming ? '입고 이력이 없어 재고 체류일을 판정할 수 없습니다.' : !stale ? `입고 후 ${days}일 · 소진율 ${sellThrough.toFixed(0)}%로 현재 기준 미달` : suggested == null ? '할인 적용 시 최소 마진선 아래로 내려가 수동 검토가 필요합니다.' : `입고 후 ${days}일 · 소진율 ${sellThrough.toFixed(0)}% · 재고 ${currentStock}개` }
  }).filter((row) => row.dataStatus !== 'ready' || row.daysSinceIncoming! >= settings.staleDays)
}

export function roundPrice(price: number, unit: number) { return Math.floor(price / Math.max(unit, 1)) * Math.max(unit, 1) }
