import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'

export type RegistrationOption = {
  id: string
  optionName: string
  stockQty: number
  status: string
  barcode: string | null
}

export type RegistrationChannel = {
  marketplaceId: string
  status: string
  categoryName: string | null
}

export type RegistrationRow = {
  id: string
  productCode: string
  productName: string
  stock: number
  price: number
  retailPrice: number
  costPrice: number
  minOrderQty: number
  unit: string | null
  shippingFee: number
  sourceStatus: string | null
  sourceCategoryName: string | null
  sourceProductId: string | null
  sourceDescription: string | null
  sourceTags: string | null
  sourceUpdatedAt: string | null
  lastSyncedAt: string | null
  commonCategory: string | null
  brand: string | null
  manufacturer: string | null
  countryOfOrigin: string | null
  sourceProductUrl: string | null
  primaryImageUrl: string | null
  sourceImageUrl: string | null
  thumbnailUrls: string[]
  detailImageUrls: string[]
  imageUrls: string[]
  options: RegistrationOption[]
  productNotice: Array<{ label: string; value: string }>
  channels: RegistrationChannel[]
  matchedSalesCodes: number
  matchedSalesCodeList: string[]
  inventorySkus: string[]
  inventoryAvailableStock: number
}

export async function ensureMarketplaceRegistrationTables() {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS marketplace_registration_profiles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, product_code varchar(100) NOT NULL, common_category varchar(200), brand varchar(200), manufacturer varchar(200), country_of_origin varchar(120), certification text, detail_notice jsonb NOT NULL DEFAULT '{}'::jsonb, image_urls jsonb NOT NULL DEFAULT '[]'::jsonb, updated_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id, product_code))`)
  await db.execute(sql`ALTER TABLE marketplace_registration_profiles ADD COLUMN IF NOT EXISTS source_product_url text`)
  await db.execute(sql`ALTER TABLE marketplace_registration_profiles ADD COLUMN IF NOT EXISTS primary_image_url text`)
  await db.execute(sql`ALTER TABLE marketplace_registration_profiles
    ADD COLUMN IF NOT EXISTS source_type varchar(50) NOT NULL DEFAULT 'manual',
    ADD COLUMN IF NOT EXISTS source_product_id text,
    ADD COLUMN IF NOT EXISTS product_name text,
    ADD COLUMN IF NOT EXISTS source_description text,
    ADD COLUMN IF NOT EXISTS source_tags text,
    ADD COLUMN IF NOT EXISTS source_category_name text,
    ADD COLUMN IF NOT EXISTS source_status varchar(30),
    ADD COLUMN IF NOT EXISTS source_price numeric(14, 2),
    ADD COLUMN IF NOT EXISTS source_retail_price numeric(14, 2),
    ADD COLUMN IF NOT EXISTS source_cost_price numeric(14, 2),
    ADD COLUMN IF NOT EXISTS source_stock_qty integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS source_min_order_qty integer NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS source_unit varchar(30),
    ADD COLUMN IF NOT EXISTS source_shipping_fee numeric(14, 2),
    ADD COLUMN IF NOT EXISTS source_no_bundle_shipping boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS source_barcode varchar(100),
    ADD COLUMN IF NOT EXISTS source_thumbnail_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS source_detail_image_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS source_options jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS source_product_notice jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS source_updated_at timestamptz,
    ADD COLUMN IF NOT EXISTS last_synced_at timestamptz`)
  await db.execute(sql`CREATE TABLE IF NOT EXISTS marketplace_registration_channels (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), profile_id uuid NOT NULL REFERENCES marketplace_registration_profiles(id) ON DELETE CASCADE, user_id uuid NOT NULL, marketplace_id varchar(50) NOT NULL, category_id varchar(200), category_name text, status varchar(30) NOT NULL DEFAULT 'ready', payload jsonb NOT NULL DEFAULT '{}'::jsonb, updated_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(profile_id, marketplace_id))`)
}

function rows<T>(result: unknown) { return (result as { rows?: T[] }).rows ?? result as T[] }

export async function listMarketplaceRegistrationProducts(userId: string) {
  await ensureMarketplaceRegistrationTables()
  const result = await db.execute<RegistrationRow>(sql`
    SELECT r.id, r.product_code AS "productCode", COALESCE(r.product_name, '') AS "productName",
      r.source_stock_qty::int AS stock, COALESCE(r.source_price, 0)::float8 AS price,
      COALESCE(r.source_retail_price, 0)::float8 AS "retailPrice",
      COALESCE(r.source_cost_price, 0)::float8 AS "costPrice",
      r.source_min_order_qty::int AS "minOrderQty", r.source_unit AS unit,
      COALESCE(r.source_shipping_fee, 0)::float8 AS "shippingFee",
      r.source_status AS "sourceStatus", r.source_category_name AS "sourceCategoryName",
      r.source_product_id AS "sourceProductId", r.source_description AS "sourceDescription",
      r.source_tags AS "sourceTags", r.source_updated_at::text AS "sourceUpdatedAt",
      r.last_synced_at::text AS "lastSyncedAt",
      r.common_category AS "commonCategory", r.brand, r.manufacturer,
      r.country_of_origin AS "countryOfOrigin", r.source_product_url AS "sourceProductUrl",
      r.primary_image_url AS "primaryImageUrl",
      COALESCE(NULLIF(r.source_thumbnail_urls, '[]'::jsonb)->>0, r.primary_image_url) AS "sourceImageUrl",
      COALESCE(r.source_thumbnail_urls, '[]'::jsonb) AS "thumbnailUrls",
      COALESCE(r.source_detail_image_urls, '[]'::jsonb) AS "detailImageUrls",
      COALESCE(r.image_urls, '[]'::jsonb) AS "imageUrls",
      COALESCE(r.source_options, '[]'::jsonb) AS options,
      COALESCE(r.source_product_notice, '[]'::jsonb) AS "productNotice",
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'marketplaceId', c.marketplace_id,
          'status', c.status,
          'categoryName', c.category_name
        ) ORDER BY c.marketplace_id)
        FROM marketplace_registration_channels c
        WHERE c.profile_id = r.id
      ), '[]'::jsonb) AS channels,
      COALESCE((
        SELECT ARRAY_AGG(DISTINCT p.product_code ORDER BY p.product_code)
        FROM analytics_price_table_rows p
        WHERE p.user_id = ${userId}
          AND p.source_sheet_name = '상품등록'
          AND p.product_code IN (
            SELECT r.product_code
            UNION
            SELECT r.source_barcode WHERE COALESCE(r.source_barcode, '') <> ''
            UNION
            SELECT option_value->>'barcode'
            FROM jsonb_array_elements(r.source_options) option_value
            WHERE COALESCE(option_value->>'barcode', '') <> ''
          )
      ), ARRAY[]::text[]) AS "matchedSalesCodeList",
      COALESCE((
        SELECT ARRAY_AGG(DISTINCT i.sku ORDER BY i.sku)
        FROM inventory i
        WHERE i.user_id = ${userId}
          AND i.sku IN (
            SELECT r.product_code
            UNION
            SELECT r.source_barcode WHERE COALESCE(r.source_barcode, '') <> ''
            UNION
            SELECT option_value->>'barcode'
            FROM jsonb_array_elements(r.source_options) option_value
            WHERE COALESCE(option_value->>'barcode', '') <> ''
          )
      ), ARRAY[]::text[]) AS "inventorySkus",
      COALESCE((
        SELECT SUM(i.available_stock)::int
        FROM inventory i
        WHERE i.user_id = ${userId}
          AND i.sku IN (
            SELECT r.product_code
            UNION
            SELECT r.source_barcode WHERE COALESCE(r.source_barcode, '') <> ''
            UNION
            SELECT option_value->>'barcode'
            FROM jsonb_array_elements(r.source_options) option_value
            WHERE COALESCE(option_value->>'barcode', '') <> ''
          )
      ), 0)::int AS "inventoryAvailableStock",
      COALESCE((
        SELECT COUNT(DISTINCT p.product_code)
        FROM analytics_price_table_rows p
        WHERE p.user_id = ${userId}
          AND p.source_sheet_name = '상품등록'
          AND p.product_code IN (
            SELECT r.product_code
            UNION
            SELECT r.source_barcode WHERE COALESCE(r.source_barcode, '') <> ''
            UNION
            SELECT option_value->>'barcode'
            FROM jsonb_array_elements(r.source_options) option_value
            WHERE COALESCE(option_value->>'barcode', '') <> ''
          )
      ), 0)::int AS "matchedSalesCodes"
    FROM marketplace_registration_profiles r
    WHERE r.user_id = ${userId} AND r.source_type = 'funtastic-b2b'
    ORDER BY r.source_updated_at DESC NULLS LAST, r.product_code DESC
  `)
  return rows<RegistrationRow>(result)
}

type RegistrationProfileInput = {
  userId: string
  productCode: string
  commonCategory: string | null
  brand: string | null
  manufacturer: string | null
  countryOfOrigin: string | null
  sourceProductUrl: string | null
  primaryImageUrl: string | null
  imageUrls: string[]
}

export async function applyMarketplaceRegistration(input: RegistrationProfileInput) {
  await ensureMarketplaceRegistrationTables()
  const result = await db.execute<{ id: string }>(sql`
    INSERT INTO marketplace_registration_profiles (user_id, product_code, common_category, brand, manufacturer, country_of_origin, source_product_url, primary_image_url, image_urls)
    VALUES (${input.userId}, ${input.productCode}, ${input.commonCategory || null}, ${input.brand || null}, ${input.manufacturer || null}, ${input.countryOfOrigin || null}, ${input.sourceProductUrl || null}, ${input.primaryImageUrl || null}, ${JSON.stringify(input.imageUrls)}::jsonb)
    ON CONFLICT (user_id, product_code) DO UPDATE SET common_category = EXCLUDED.common_category, brand = EXCLUDED.brand, manufacturer = EXCLUDED.manufacturer, country_of_origin = EXCLUDED.country_of_origin, source_product_url = EXCLUDED.source_product_url, primary_image_url = EXCLUDED.primary_image_url, image_urls = EXCLUDED.image_urls, updated_at = now()
    RETURNING id
  `)
  const profileId = rows<{ id: string }>(result)[0]!.id
  for (const marketplaceId of ['coupang', 'smartstore', 'toss']) {
    await db.execute(sql`INSERT INTO marketplace_registration_channels (profile_id, user_id, marketplace_id, category_name, payload) VALUES (${profileId}, ${input.userId}, ${marketplaceId}, ${input.commonCategory || null}, ${JSON.stringify({ source: 'funtastic-b2b', commonCategory: input.commonCategory || null })}::jsonb) ON CONFLICT (profile_id, marketplace_id) DO UPDATE SET category_name = EXCLUDED.category_name, payload = EXCLUDED.payload, updated_at = now()`)
  }
}

type SourceProduct = {
  id: string
  code: string
  name: string
  description?: string | null
  tags?: string | null
  imageUrl?: string | null
  thumbnailImages?: string[]
  detailImages?: string[]
  price?: number
  retailPrice?: number
  costPrice?: number
  stockQty?: number
  minOrderQty?: number
  unit?: string
  shippingFee?: number
  noBundleShipping?: boolean
  status?: string
  barcode?: string | null
  updatedAt?: string
  category?: { name?: string | null } | null
  productInfoNotice?: Array<{ label?: string; value?: string }>
  options?: Array<{
    id: string
    optionName?: string
    stockQty?: number
    status?: string
    barcode?: string | null
  }>
}

type SourceProductsResponse = {
  products?: SourceProduct[]
  total?: number
  totalPages?: number
}

const SOURCE_BASE_URL = 'https://funtasticb2b.com'

async function fetchSourceProducts() {
  const products: SourceProduct[] = []
  let page = 1
  let totalPages = 1
  do {
    const response = await fetch(`${SOURCE_BASE_URL}/api/products?page=${page}&limit=100&sort=latest`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    })
    if (!response.ok) throw new Error(`B2B 상품 API 응답 오류 (${response.status})`)
    const payload = await response.json() as SourceProductsResponse
    products.push(...(payload.products ?? []))
    totalPages = Math.max(1, payload.totalPages ?? 1)
    page += 1
  } while (page <= totalPages)
  return products
}

export async function syncFuntasticB2bRegistrationProducts(userId: string) {
  await ensureMarketplaceRegistrationTables()
  const products = await fetchSourceProducts()
  const syncedAt = new Date()
  const syncedAtIso = syncedAt.toISOString()
  const payload = products.map((product) => {
    const thumbnailUrls = (product.thumbnailImages ?? []).filter(Boolean)
    const detailImageUrls = (product.detailImages ?? []).filter(Boolean)
    const options: RegistrationOption[] = (product.options ?? []).map((option) => ({
      id: option.id,
      optionName: option.optionName?.trim() || '기본',
      stockQty: Number(option.stockQty ?? 0),
      status: option.status || 'SELLING',
      barcode: option.barcode?.trim() || null,
    }))
    const notice = (product.productInfoNotice ?? [])
      .map((item) => ({ label: item.label?.trim() || '', value: item.value?.trim() || '' }))
      .filter((item) => item.label || item.value)
    const findNoticeValue = (patterns: RegExp[]) => notice.find((item) => (
      patterns.some((pattern) => pattern.test(item.label))
    ))?.value || null

    return {
      productCode: product.code,
      sourceProductId: product.id,
      productName: product.name,
      sourceDescription: product.description || null,
      sourceTags: product.tags || null,
      sourceCategoryName: product.category?.name || null,
      sourceStatus: product.status || null,
      sourcePrice: Number(product.price ?? 0),
      sourceRetailPrice: Number(product.retailPrice ?? 0),
      sourceCostPrice: Number(product.costPrice ?? 0),
      sourceStockQty: Number(product.stockQty ?? 0),
      sourceMinOrderQty: Math.max(1, Number(product.minOrderQty ?? 1)),
      sourceUnit: product.unit || null,
      sourceShippingFee: Number(product.shippingFee ?? 0),
      sourceNoBundleShipping: Boolean(product.noBundleShipping),
      sourceBarcode: product.barcode || null,
      thumbnailUrls,
      detailImageUrls,
      options,
      notice,
      manufacturer: findNoticeValue([/제조자/, /제조사/, /수입자/]),
      countryOfOrigin: findNoticeValue([/제조국/, /원산지/]),
      sourceProductUrl: `${SOURCE_BASE_URL}/goods/view?no=${encodeURIComponent(product.code)}`,
      sourceUpdatedAt: product.updatedAt || null,
    }
  })

  for (let start = 0; start < payload.length; start += 100) {
    const batch = payload.slice(start, start + 100)
    await db.execute(sql`
      WITH source_rows AS (
        SELECT value AS item
        FROM jsonb_array_elements(${JSON.stringify(batch)}::jsonb)
      )
      INSERT INTO marketplace_registration_profiles (
        user_id, product_code, source_type, source_product_id, product_name,
        source_description, source_tags, source_category_name, source_status,
        source_price, source_retail_price, source_cost_price, source_stock_qty,
        source_min_order_qty, source_unit, source_shipping_fee,
        source_no_bundle_shipping, source_barcode, source_thumbnail_urls,
        source_detail_image_urls, source_options, source_product_notice,
        manufacturer, country_of_origin, source_product_url,
        source_updated_at, last_synced_at
      )
      SELECT
        ${userId}, item->>'productCode', 'funtastic-b2b',
        item->>'sourceProductId', item->>'productName',
        NULLIF(item->>'sourceDescription', ''), NULLIF(item->>'sourceTags', ''),
        NULLIF(item->>'sourceCategoryName', ''), NULLIF(item->>'sourceStatus', ''),
        COALESCE((item->>'sourcePrice')::numeric, 0),
        COALESCE((item->>'sourceRetailPrice')::numeric, 0),
        COALESCE((item->>'sourceCostPrice')::numeric, 0),
        COALESCE((item->>'sourceStockQty')::int, 0),
        GREATEST(1, COALESCE((item->>'sourceMinOrderQty')::int, 1)),
        NULLIF(item->>'sourceUnit', ''),
        COALESCE((item->>'sourceShippingFee')::numeric, 0),
        COALESCE((item->>'sourceNoBundleShipping')::boolean, false),
        NULLIF(item->>'sourceBarcode', ''),
        COALESCE(item->'thumbnailUrls', '[]'::jsonb),
        COALESCE(item->'detailImageUrls', '[]'::jsonb),
        COALESCE(item->'options', '[]'::jsonb),
        COALESCE(item->'notice', '[]'::jsonb),
        NULLIF(item->>'manufacturer', ''), NULLIF(item->>'countryOfOrigin', ''),
        NULLIF(item->>'sourceProductUrl', ''),
        NULLIF(item->>'sourceUpdatedAt', '')::timestamptz, ${syncedAtIso}::timestamptz
      FROM source_rows
      ON CONFLICT (user_id, product_code) DO UPDATE SET
        source_type = 'funtastic-b2b',
        source_product_id = EXCLUDED.source_product_id,
        product_name = EXCLUDED.product_name,
        source_description = EXCLUDED.source_description,
        source_tags = EXCLUDED.source_tags,
        source_category_name = EXCLUDED.source_category_name,
        source_status = EXCLUDED.source_status,
        source_price = EXCLUDED.source_price,
        source_retail_price = EXCLUDED.source_retail_price,
        source_cost_price = EXCLUDED.source_cost_price,
        source_stock_qty = EXCLUDED.source_stock_qty,
        source_min_order_qty = EXCLUDED.source_min_order_qty,
        source_unit = EXCLUDED.source_unit,
        source_shipping_fee = EXCLUDED.source_shipping_fee,
        source_no_bundle_shipping = EXCLUDED.source_no_bundle_shipping,
        source_barcode = EXCLUDED.source_barcode,
        source_thumbnail_urls = EXCLUDED.source_thumbnail_urls,
        source_detail_image_urls = EXCLUDED.source_detail_image_urls,
        source_options = EXCLUDED.source_options,
        source_product_notice = EXCLUDED.source_product_notice,
        source_product_url = EXCLUDED.source_product_url,
        source_updated_at = EXCLUDED.source_updated_at,
        last_synced_at = EXCLUDED.last_synced_at,
        updated_at = now()
    `)
  }

  if (payload.length > 0) {
    await db.execute(sql`
      INSERT INTO marketplace_registration_channels (
        profile_id, user_id, marketplace_id, status, payload
      )
      SELECT
        profile.id, profile.user_id, channel.marketplace_id, 'needs_info',
        '{"source":"funtastic-b2b"}'::jsonb
      FROM marketplace_registration_profiles profile
      CROSS JOIN (
        VALUES ('coupang'), ('smartstore'), ('toss')
      ) AS channel(marketplace_id)
      WHERE profile.user_id = ${userId}
        AND profile.source_type = 'funtastic-b2b'
      ON CONFLICT (profile_id, marketplace_id) DO NOTHING
    `)
  }

  return { count: products.length, syncedAt: syncedAtIso }
}
