import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'

type RegistrationRow = {
  productCode: string
  productName: string
  stock: number
  commonCategory: string | null
  brand: string | null
  manufacturer: string | null
  countryOfOrigin: string | null
}

export async function ensureMarketplaceRegistrationTables() {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS marketplace_registration_profiles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, product_code varchar(100) NOT NULL, common_category varchar(200), brand varchar(200), manufacturer varchar(200), country_of_origin varchar(120), certification text, detail_notice jsonb NOT NULL DEFAULT '{}'::jsonb, image_urls jsonb NOT NULL DEFAULT '[]'::jsonb, updated_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id, product_code))`)
  await db.execute(sql`CREATE TABLE IF NOT EXISTS marketplace_registration_channels (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), profile_id uuid NOT NULL REFERENCES marketplace_registration_profiles(id) ON DELETE CASCADE, user_id uuid NOT NULL, marketplace_id varchar(50) NOT NULL, category_id varchar(200), category_name text, status varchar(30) NOT NULL DEFAULT 'ready', payload jsonb NOT NULL DEFAULT '{}'::jsonb, updated_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(profile_id, marketplace_id))`)
}

function rows<T>(result: unknown) { return (result as { rows?: T[] }).rows ?? result as T[] }

export async function listMarketplaceRegistrationProducts(userId: string) {
  await ensureMarketplaceRegistrationTables()
  const result = await db.execute<RegistrationRow>(sql`
    SELECT p.product_code AS "productCode", COALESCE(p.product_name, p.registered_product_name, '') AS "productName",
      COALESCE((SELECT SUM(i.available_stock) FROM inventory i WHERE i.user_id = ${userId} AND i.sku = p.product_code), 0)::int AS stock,
      r.common_category AS "commonCategory", r.brand, r.manufacturer, r.country_of_origin AS "countryOfOrigin"
    FROM analytics_price_table_rows p
    LEFT JOIN marketplace_registration_profiles r ON r.user_id = p.user_id AND r.product_code = p.product_code
    WHERE p.user_id = ${userId} AND p.source_sheet_name = '상품등록' AND p.product_code IS NOT NULL
    ORDER BY p.product_code LIMIT 120
  `)
  return rows<RegistrationRow>(result)
}

export async function applyMarketplaceRegistration(input: RegistrationRow & { userId: string }) {
  await ensureMarketplaceRegistrationTables()
  const result = await db.execute<{ id: string }>(sql`
    INSERT INTO marketplace_registration_profiles (user_id, product_code, common_category, brand, manufacturer, country_of_origin)
    VALUES (${input.userId}, ${input.productCode}, ${input.commonCategory || null}, ${input.brand || null}, ${input.manufacturer || null}, ${input.countryOfOrigin || null})
    ON CONFLICT (user_id, product_code) DO UPDATE SET common_category = EXCLUDED.common_category, brand = EXCLUDED.brand, manufacturer = EXCLUDED.manufacturer, country_of_origin = EXCLUDED.country_of_origin, updated_at = now()
    RETURNING id
  `)
  const profileId = rows<{ id: string }>(result)[0]!.id
  for (const marketplaceId of ['coupang', 'smartstore', 'toss']) {
    await db.execute(sql`INSERT INTO marketplace_registration_channels (profile_id, user_id, marketplace_id, category_name, payload) VALUES (${profileId}, ${input.userId}, ${marketplaceId}, ${input.commonCategory || null}, ${JSON.stringify({ source: 'funtastic-b2b', commonCategory: input.commonCategory || null })}::jsonb) ON CONFLICT (profile_id, marketplace_id) DO UPDATE SET category_name = EXCLUDED.category_name, payload = EXCLUDED.payload, updated_at = now()`)
  }
}
