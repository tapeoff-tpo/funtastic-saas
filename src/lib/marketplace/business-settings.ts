import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'

export interface MarketplaceBusinessSetting {
  marketplaceId: string
  systemMarketplaceName: string
  salesExportMarketplaceId: string
  salesFeePercent: string
}

export async function ensureMarketplaceBusinessSettingsTable(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS marketplace_business_settings (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL,
      marketplace_id varchar(100) NOT NULL,
      system_marketplace_name varchar(100) NOT NULL DEFAULT '',
      sales_export_marketplace_id varchar(100) NOT NULL DEFAULT '',
      sales_fee_percent numeric(7, 4),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (user_id, marketplace_id)
    )
  `)
}

export async function listMarketplaceBusinessSettings(userId: string): Promise<MarketplaceBusinessSetting[]> {
  await ensureMarketplaceBusinessSettingsTable()
  const result = await db.execute<{
    marketplaceId: string
    systemMarketplaceName: string
    salesExportMarketplaceId: string
    salesFeePercent: string | number | null
  }>(sql`
    SELECT
      marketplace_id AS "marketplaceId",
      system_marketplace_name AS "systemMarketplaceName",
      sales_export_marketplace_id AS "salesExportMarketplaceId",
      sales_fee_percent AS "salesFeePercent"
    FROM marketplace_business_settings
    WHERE user_id = ${userId}
  `)
  const rows = Array.isArray(result) ? result : result.rows ?? []
  return rows.map((row) => ({
    marketplaceId: row.marketplaceId,
    systemMarketplaceName: row.systemMarketplaceName,
    salesExportMarketplaceId: row.salesExportMarketplaceId,
    salesFeePercent: row.salesFeePercent == null ? '' : String(row.salesFeePercent),
  }))
}

export async function saveMarketplaceBusinessSetting(input: {
  userId: string
  marketplaceId: string
  systemMarketplaceName: string
  salesExportMarketplaceId: string
  salesFeePercent: number | null
}): Promise<void> {
  await ensureMarketplaceBusinessSettingsTable()
  await db.execute(sql`
    INSERT INTO marketplace_business_settings (
      user_id,
      marketplace_id,
      system_marketplace_name,
      sales_export_marketplace_id,
      sales_fee_percent,
      updated_at
    )
    VALUES (
      ${input.userId},
      ${input.marketplaceId},
      ${input.systemMarketplaceName},
      ${input.salesExportMarketplaceId},
      ${input.salesFeePercent},
      now()
    )
    ON CONFLICT (user_id, marketplace_id)
    DO UPDATE SET
      system_marketplace_name = EXCLUDED.system_marketplace_name,
      sales_export_marketplace_id = EXCLUDED.sales_export_marketplace_id,
      sales_fee_percent = EXCLUDED.sales_fee_percent,
      updated_at = now()
  `)
}
