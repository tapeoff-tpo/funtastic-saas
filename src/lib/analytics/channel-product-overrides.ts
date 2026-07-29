import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'

export type ChannelBundleComponent = {
  sku: string
  quantity: number
}

type StoredOverride = {
  id: string
  channelKey: string
  channelName: string
  channelProductId: string
  sourceKey: string
  productName: string
  optionName: string | null
  components: ChannelBundleComponent[]
  salePrice: number
  regularPrice: number | null
  shippingFee: number
  commissionRate: number
  registeredStock: number
  saleStatus: string
  lastCheckedAt: string
  notes: string | null
}

export type ChannelBundleOverride = StoredOverride & {
  availableBundleStock: number
  hasExcessRegisteredStock: boolean
  componentCost: number | null
  b2bReferencePrice: number | null
  actualShippingCost: number | null
  commissionAmount: number
  netPayout: number
  requiredPayout: number | null
  estimatedProfit: number | null
  warnings: string[]
}

const TODAY = '2026-07-27'

const OHOUSE_BUNDLE_SEED: Array<Omit<StoredOverride, 'id'>> = [
  seed('4170322', '파일 서류 정리함 좁은형 3개 세트', '111723-0001-3SET', '111723-0001', 3, 16900, 29700, 20, 30),
  seed('4170382', '파일 서류 정리함 좁은형 2개 세트', '111723-0001-2SET', '111723-0001', 2, 12900, 19800, 20, 45),
  seed('4170368', '흡착식 다용도 후크 3개 세트', '111654-0001-3SET', '111654-0001', 3, 14900, 24000, 18, 3, '그린'),
  seed('4170368', '흡착식 다용도 후크 3개 세트', '111654-0002-3SET', '111654-0002', 3, 14900, 24000, 18, 3, '옐로우'),
  seed('4170384', '흡착식 다용도 후크 2개 세트', '111654-0001-2SET', '111654-0001', 2, 11900, 16000, 18, 5, '그린'),
  seed('4170384', '흡착식 다용도 후크 2개 세트', '111654-0002-2SET', '111654-0002', 2, 11900, 16000, 18, 5, '옐로우'),
  seed('4170374', '실리콘 텀블러·젖병 세척 브러시 3개 세트', '111974-0001-3SET', '111974-0001', 3, 9900, 21000, 18, 22),
  seed('4170373', '실리콘 텀블러·젖병 세척 브러시 2개 세트', '111974-0001-2SET', '111974-0001', 2, 7900, 14000, 18, 33),
  seed('4170375', '비안트 부착식 빨래바구니 2개 세트', '108218-0001-2SET', '108218-0001', 2, 31900, 40000, 17, 4),
]

function seed(
  channelProductId: string,
  productName: string,
  sourceKey: string,
  sku: string,
  quantity: number,
  salePrice: number,
  regularPrice: number,
  commissionRate: number,
  registeredStock: number,
  optionName: string | null = null,
): Omit<StoredOverride, 'id'> {
  return {
    channelKey: 'ohouse',
    channelName: '오늘의집',
    channelProductId,
    sourceKey,
    productName,
    optionName,
    components: [{ sku, quantity }],
    salePrice,
    regularPrice,
    shippingFee: 0,
    commissionRate,
    registeredStock,
    saleStatus: '검수 후 판매대기',
    lastCheckedAt: TODAY,
    notes: '무료배송',
  }
}

let ensureSchemaPromise: Promise<void> | null = null

export async function listChannelBundleOverrides(userId: string, search = ''): Promise<ChannelBundleOverride[]> {
  await ensureChannelProductOverrideSchema()
  await seedOhouseBundles(userId)
  const stored = rows<StoredOverride>(await db.execute<StoredOverride>(sql`
    SELECT id, channel_key AS "channelKey", channel_name AS "channelName",
      channel_product_id AS "channelProductId", source_key AS "sourceKey",
      product_name AS "productName", option_name AS "optionName", components,
      sale_price::float8 AS "salePrice", regular_price::float8 AS "regularPrice",
      shipping_fee::float8 AS "shippingFee", commission_rate::float8 AS "commissionRate",
      registered_stock::int AS "registeredStock", sale_status AS "saleStatus",
      last_checked_at::text AS "lastCheckedAt", notes
    FROM analytics_channel_product_overrides
    WHERE user_id = ${userId}
    ORDER BY channel_name, channel_product_id, source_key
  `))
  const normalized = stored.map((row) => ({ ...row, components: normalizeComponents(row.components) }))
  const sourceSkus = [...new Set(normalized.flatMap((row) => row.components.map((component) => component.sku)))]
  const [stocks, costs, b2bPrices, shippingCosts] = await Promise.all([
    getStocks(userId, sourceSkus),
    getUnitCosts(userId, sourceSkus),
    getB2bReferencePrices(userId, sourceSkus),
    getActualShippingCosts(userId, sourceSkus),
  ])

  return normalized
    .map((row) => calculateChannelBundle(row, stocks, costs, b2bPrices, shippingCosts))
    .filter((row) => matchesSearch(row, search))
}

export async function ensureChannelProductOverrideSchema() {
  ensureSchemaPromise ??= (async () => {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS analytics_channel_product_overrides (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
        channel_key varchar(100) NOT NULL, channel_name varchar(150) NOT NULL,
        channel_product_id varchar(120) NOT NULL, source_key varchar(140) NOT NULL,
        product_name text NOT NULL, option_name text, components jsonb NOT NULL DEFAULT '[]'::jsonb,
        sale_price numeric(12, 2) NOT NULL, regular_price numeric(12, 2),
        shipping_fee numeric(12, 2) NOT NULL DEFAULT 0, commission_rate numeric(7, 4) NOT NULL,
        registered_stock integer NOT NULL DEFAULT 0, sale_status varchar(50) NOT NULL,
        last_checked_at date NOT NULL, notes text,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
      )
    `)
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS analytics_channel_product_overrides_unique
      ON analytics_channel_product_overrides (user_id, channel_key, channel_product_id, source_key)
    `)
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS analytics_channel_product_overrides_user_channel_idx
      ON analytics_channel_product_overrides (user_id, channel_key)
    `)
  })()
  return ensureSchemaPromise
}

async function seedOhouseBundles(userId: string) {
  for (const item of OHOUSE_BUNDLE_SEED) {
    await db.execute(sql`
      INSERT INTO analytics_channel_product_overrides (
        user_id, channel_key, channel_name, channel_product_id, source_key, product_name, option_name,
        components, sale_price, regular_price, shipping_fee, commission_rate, registered_stock,
        sale_status, last_checked_at, notes
      ) VALUES (
        ${userId}, ${item.channelKey}, ${item.channelName}, ${item.channelProductId}, ${item.sourceKey},
        ${item.productName}, ${item.optionName}, ${JSON.stringify(item.components)}::jsonb,
        ${item.salePrice}, ${item.regularPrice}, ${item.shippingFee}, ${item.commissionRate}, ${item.registeredStock},
        ${item.saleStatus}, ${item.lastCheckedAt}::date, ${item.notes}
      ) ON CONFLICT (user_id, channel_key, channel_product_id, source_key) DO NOTHING
    `)
  }
}

async function getStocks(userId: string, skus: string[]) {
  if (!skus.length) return new Map<string, number>()
  const result = rows<{ sku: string; availableStock: number }>(await db.execute(sql`
    SELECT sku, COALESCE(SUM(available_stock), 0)::int AS "availableStock"
    FROM inventory
    WHERE user_id = ${userId} AND sku IN (${sql.join(skus.map((sku) => sql`${sku}`), sql`, `)})
    GROUP BY sku
  `))
  return new Map(result.map((row) => [row.sku, Number(row.availableStock) || 0]))
}

async function getUnitCosts(userId: string, skus: string[]) {
  if (!skus.length) return new Map<string, number>()
  const result = rows<{ sku: string; unitCost: number | null }>(await db.execute(sql`
    SELECT internal_sku AS sku,
      COALESCE(
        NULLIF(regexp_replace(COALESCE(metadata->'esa009m'->>'works 신규 원가', metadata->'esa009m'->>'works 기존 원가', ''), '[^0-9.-]', '', 'g'), '')::numeric,
        cost_price,
        NULL
      )::float8 AS "unitCost"
    FROM products
    WHERE user_id = ${userId} AND internal_sku IN (${sql.join(skus.map((sku) => sql`${sku}`), sql`, `)})
  `))
  return new Map(result.flatMap((row) => row.unitCost == null ? [] : [[row.sku, Number(row.unitCost)] as const]))
}

async function getB2bReferencePrices(userId: string, skus: string[]) {
  if (!skus.length) return new Map<string, number>()
  const result = rows<{ sku: string; b2bPrice: number | null }>(await db.execute(sql`
    WITH source_prices AS (
      SELECT product_code AS sku, MAX(source_price)::float8 AS price
      FROM marketplace_registration_profiles
      WHERE user_id = ${userId} AND source_type = 'funtastic-b2b'
        AND product_code IN (${sql.join(skus.map((sku) => sql`${sku}`), sql`, `)})
      GROUP BY product_code
      UNION ALL
      SELECT product_code AS sku,
        MAX(NULLIF(regexp_replace(COALESCE(raw_data->>'B2B 판매가', ''), '[^0-9.-]', '', 'g'), '')::numeric)::float8 AS price
      FROM analytics_price_table_rows
      WHERE user_id = ${userId}
        AND product_code IN (${sql.join(skus.map((sku) => sql`${sku}`), sql`, `)})
      GROUP BY product_code
    )
    SELECT sku, MAX(price)::float8 AS "b2bPrice"
    FROM source_prices
    WHERE price IS NOT NULL
    GROUP BY sku
  `))
  return new Map(result.flatMap((row) => row.b2bPrice == null ? [] : [[row.sku, Number(row.b2bPrice)] as const]))
}

async function getActualShippingCosts(userId: string, skus: string[]) {
  if (!skus.length) return new Map<string, number>()
  const result = rows<{ sku: string; shippingCost: number | null }>(await db.execute(sql`
    SELECT COALESCE(NULLIF(oi.locked_sku, ''), NULLIF(oi.sku, '')) AS sku,
      AVG(ascost.actual_fee)::float8 AS "shippingCost"
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id AND o.user_id = ${userId}
    JOIN actual_shipping_costs ascost ON ascost.user_id = ${userId} AND ascost.order_id = o.id
    WHERE COALESCE(NULLIF(oi.locked_sku, ''), NULLIF(oi.sku, '')) IN (${sql.join(skus.map((sku) => sql`${sku}`), sql`, `)})
    GROUP BY COALESCE(NULLIF(oi.locked_sku, ''), NULLIF(oi.sku, ''))
  `))
  return new Map(result.flatMap((row) => row.shippingCost == null ? [] : [[row.sku, Number(row.shippingCost)] as const]))
}

export function calculateChannelBundle(
  row: StoredOverride,
  stocks: Map<string, number>,
  costs: Map<string, number>,
  b2bPrices: Map<string, number>,
  shippingCosts: Map<string, number>,
): ChannelBundleOverride {
  const availableBundleStock = row.components.length
    ? Math.min(...row.components.map((component) => Math.floor((stocks.get(component.sku) ?? 0) / component.quantity)))
    : 0
  const allCostsKnown = row.components.every((component) => costs.has(component.sku))
  const allB2bPricesKnown = row.components.every((component) => b2bPrices.has(component.sku))
  const componentCost = allCostsKnown
    ? row.components.reduce((sum, component) => sum + (costs.get(component.sku) ?? 0) * component.quantity, 0)
    : null
  const b2bReferencePrice = allB2bPricesKnown
    ? row.components.reduce((sum, component) => sum + (b2bPrices.get(component.sku) ?? 0) * component.quantity, 0)
    : null
  const knownShipping = row.components.map((component) => shippingCosts.get(component.sku)).filter((value): value is number => value != null)
  const actualShippingCost = knownShipping.length ? Math.max(...knownShipping) : null
  const commissionAmount = Math.round(row.salePrice * row.commissionRate) / 100
  const netPayout = row.salePrice + row.shippingFee - commissionAmount
  const requiredPayout = componentCost == null || actualShippingCost == null
    ? null
    : Math.max(componentCost, b2bReferencePrice ?? 0) + actualShippingCost
  const estimatedProfit = componentCost == null || actualShippingCost == null
    ? null
    : netPayout - componentCost - actualShippingCost
  const warnings = [
    ...(row.registeredStock > availableBundleStock ? [`등록 재고 ${row.registeredStock}세트가 실재고 기준 ${availableBundleStock}세트를 초과`] : []),
    ...(componentCost == null ? ['Works 원가 미확인'] : []),
    ...(b2bReferencePrice == null ? ['B2B 기준 판매가 미확인'] : []),
    ...(actualShippingCost == null ? ['실배송비 미확인'] : []),
    ...(requiredPayout != null && netPayout < requiredPayout ? ['수수료·배송비 반영 후 보전 기준 미달'] : []),
  ]
  return { ...row, availableBundleStock, hasExcessRegisteredStock: row.registeredStock > availableBundleStock, componentCost, b2bReferencePrice, actualShippingCost, commissionAmount, netPayout, requiredPayout, estimatedProfit, warnings }
}

function normalizeComponents(value: unknown): ChannelBundleComponent[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((component) => {
    if (!component || typeof component !== 'object') return []
    const entry = component as { sku?: unknown; quantity?: unknown }
    const sku = typeof entry.sku === 'string' ? entry.sku.trim() : ''
    const quantity = Number(entry.quantity)
    return sku && Number.isInteger(quantity) && quantity > 0 ? [{ sku, quantity }] : []
  })
}

function matchesSearch(row: ChannelBundleOverride, search: string) {
  const query = search.trim().toLowerCase()
  if (!query) return true
  return [row.channelName, row.channelProductId, row.sourceKey, row.productName, row.optionName ?? '', ...row.components.map((component) => component.sku)]
    .some((value) => value.toLowerCase().includes(query))
}

function rows<T>(result: unknown) {
  return (result as { rows?: T[] }).rows ?? result as T[]
}
