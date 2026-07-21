import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { analyticsMarketplaceProductChecks } from '@/lib/db/schema'

export const MARKETPLACE_CHECK_STATUSES = ['registered', 'missing', 'needs_review', 'stopped'] as const
export type MarketplaceCheckStatus = (typeof MARKETPLACE_CHECK_STATUSES)[number]
export type MarketplaceProductCheck = typeof analyticsMarketplaceProductChecks.$inferSelect

let ensureSchemaPromise: Promise<void> | null = null

export async function listMarketplaceProductChecks(userId: string, productCodes: string[]) {
  await ensureMarketplaceProductCheckSchema()
  const codes = [...new Set(productCodes.map((value) => value.trim()).filter(Boolean))]
  if (!codes.length) return []
  return db
    .select()
    .from(analyticsMarketplaceProductChecks)
    .where(and(
      eq(analyticsMarketplaceProductChecks.userId, userId),
      inArray(analyticsMarketplaceProductChecks.productCode, codes),
    ))
}

export async function saveMarketplaceProductCheck(input: {
  userId: string
  productCode: string
  marketplaceKey: string
  marketplaceName: string
  accountKey?: string | null
  status: MarketplaceCheckStatus
  marketplaceProductId?: string | null
  marketplaceProductName?: string | null
  sellerUrl?: string | null
  source?: string | null
  rawData?: Record<string, unknown> | null
}) {
  await ensureMarketplaceProductCheckSchema()
  const now = new Date()
  const accountKey = input.accountKey?.trim() || 'default'
  const values = {
    userId: input.userId,
    productCode: input.productCode.trim(),
    marketplaceKey: input.marketplaceKey.trim(),
    marketplaceName: input.marketplaceName.trim(),
    accountKey,
    status: input.status,
    marketplaceProductId: input.marketplaceProductId?.trim() || null,
    marketplaceProductName: input.marketplaceProductName?.trim() || null,
    sellerUrl: input.sellerUrl?.trim() || null,
    source: input.source?.trim() || 'browser_extension',
    rawData: input.rawData ?? {},
    checkedAt: now,
    updatedAt: now,
  }
  const [saved] = await db
    .insert(analyticsMarketplaceProductChecks)
    .values(values)
    .onConflictDoUpdate({
      target: [
        analyticsMarketplaceProductChecks.userId,
        analyticsMarketplaceProductChecks.productCode,
        analyticsMarketplaceProductChecks.marketplaceKey,
        analyticsMarketplaceProductChecks.accountKey,
      ],
      set: values,
    })
    .returning()
  return saved
}

export async function ensureMarketplaceProductCheckSchema() {
  ensureSchemaPromise ??= (async () => {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS analytics_marketplace_product_checks (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
        product_code varchar(100) NOT NULL, marketplace_key varchar(100) NOT NULL,
        marketplace_name varchar(150) NOT NULL, account_key varchar(150) NOT NULL DEFAULT 'default',
        status varchar(30) NOT NULL, marketplace_product_id varchar(300),
        marketplace_product_name text, seller_url text,
        source varchar(30) NOT NULL DEFAULT 'browser_extension', raw_data jsonb NOT NULL DEFAULT '{}'::jsonb,
        checked_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `)
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS analytics_marketplace_checks_unique
      ON analytics_marketplace_product_checks (user_id, product_code, marketplace_key, account_key)
    `)
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS analytics_marketplace_checks_user_market_idx
      ON analytics_marketplace_product_checks (user_id, marketplace_key)
    `)
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS analytics_marketplace_checks_user_product_idx
      ON analytics_marketplace_product_checks (user_id, product_code)
    `)
  })()
  return ensureSchemaPromise
}
