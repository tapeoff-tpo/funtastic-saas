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
  payload: Record<string, unknown>
  updatedAt: string | null
}

export type RegistrationRow = {
  id: string
  productCode: string
  salesCodes: string[]
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
  await db.execute(sql`ALTER TABLE marketplace_registration_profiles ADD COLUMN IF NOT EXISTS sales_codes jsonb NOT NULL DEFAULT '[]'::jsonb`)
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

function jsonArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[]
  if (typeof value !== 'string') return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed as T[] : []
  } catch {
    return []
  }
}

function registrationOptions(value: unknown): RegistrationOption[] {
  return jsonArray<Record<string, unknown>>(value).map((option, index) => ({
    id: String(option.id ?? option.sku ?? index),
    optionName: String(
      option.optionName
        ?? (Array.isArray(option.values) ? option.values.join(' / ') : option.name)
        ?? '기본',
    ),
    stockQty: Number(option.stockQty ?? option.stock ?? 0),
    status: String(option.status ?? 'SELLING'),
    barcode: String(option.barcode ?? option.sku ?? '').trim() || null,
  }))
}

export async function listMarketplaceRegistrationProducts(userId: string) {
  await ensureMarketplaceRegistrationTables()
  await db.execute(sql`
    INSERT INTO marketplace_registration_channels (
      profile_id, user_id, marketplace_id, status, payload
    )
    SELECT profile.id, profile.user_id, 'ohouse', 'needs_info',
      '{"source":"funtastic-b2b"}'::jsonb
    FROM marketplace_registration_profiles profile
    WHERE profile.user_id = ${userId}
      AND profile.source_type = 'funtastic-b2b'
    ON CONFLICT (profile_id, marketplace_id) DO NOTHING
  `)
  await syncLinkedOhouseRegistrationChannels(userId)
  // 최초 등록 기준은 B2B 원본 카테고리로 채운다. 사용자가 이미 보정한 값은 절대 덮어쓰지 않는다.
  await db.execute(sql`
    UPDATE marketplace_registration_profiles
    SET common_category = source_category_name, updated_at = now()
    WHERE user_id = ${userId}
      AND source_type = 'funtastic-b2b'
      AND NULLIF(BTRIM(COALESCE(common_category, '')), '') IS NULL
      AND NULLIF(BTRIM(COALESCE(source_category_name, '')), '') IS NOT NULL
  `)
  const result = await db.execute<RegistrationRow>(sql`
    SELECT r.id, r.product_code AS "productCode", COALESCE(r.sales_codes, '[]'::jsonb) AS "salesCodes", COALESCE(r.product_name, '') AS "productName",
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
          'categoryName', c.category_name,
          'payload', c.payload,
          'updatedAt', c.updated_at::text
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
            SELECT sales_code.value
            FROM jsonb_array_elements_text(COALESCE(r.sales_codes, '[]'::jsonb)) AS sales_code(value)
            UNION
            SELECT r.product_code
            UNION
            SELECT r.source_barcode WHERE COALESCE(r.source_barcode, '') <> ''
            UNION
            SELECT option_value->>'barcode'
            FROM jsonb_array_elements(
              CASE
                WHEN jsonb_typeof(COALESCE(r.source_options, '[]'::jsonb)) = 'array'
                  THEN r.source_options
                ELSE '[]'::jsonb
              END
            ) option_value
            WHERE COALESCE(option_value->>'barcode', '') <> ''
          )
      ), ARRAY[]::text[]) AS "matchedSalesCodeList",
      COALESCE((
        SELECT ARRAY_AGG(DISTINCT i.sku ORDER BY i.sku)
        FROM inventory i
        WHERE i.user_id = ${userId}
          AND i.sku IN (
            SELECT sales_code.value
            FROM jsonb_array_elements_text(COALESCE(r.sales_codes, '[]'::jsonb)) AS sales_code(value)
            UNION
            SELECT r.product_code
            UNION
            SELECT r.source_barcode WHERE COALESCE(r.source_barcode, '') <> ''
            UNION
            SELECT option_value->>'barcode'
            FROM jsonb_array_elements(
              CASE
                WHEN jsonb_typeof(COALESCE(r.source_options, '[]'::jsonb)) = 'array'
                  THEN r.source_options
                ELSE '[]'::jsonb
              END
            ) option_value
            WHERE COALESCE(option_value->>'barcode', '') <> ''
          )
      ), ARRAY[]::text[]) AS "inventorySkus",
      COALESCE((
        SELECT SUM(i.available_stock)::int
        FROM inventory i
        WHERE i.user_id = ${userId}
          AND i.sku IN (
            SELECT sales_code.value
            FROM jsonb_array_elements_text(COALESCE(r.sales_codes, '[]'::jsonb)) AS sales_code(value)
            UNION
            SELECT r.product_code
            UNION
            SELECT r.source_barcode WHERE COALESCE(r.source_barcode, '') <> ''
            UNION
            SELECT option_value->>'barcode'
            FROM jsonb_array_elements(
              CASE
                WHEN jsonb_typeof(COALESCE(r.source_options, '[]'::jsonb)) = 'array'
                  THEN r.source_options
                ELSE '[]'::jsonb
              END
            ) option_value
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
            FROM jsonb_array_elements(
              CASE
                WHEN jsonb_typeof(COALESCE(r.source_options, '[]'::jsonb)) = 'array'
                  THEN r.source_options
                ELSE '[]'::jsonb
              END
            ) option_value
            WHERE COALESCE(option_value->>'barcode', '') <> ''
          )
      ), 0)::int AS "matchedSalesCodes"
    FROM marketplace_registration_profiles r
    WHERE r.user_id = ${userId}
      AND r.source_type = 'funtastic-b2b'
      AND NOT EXISTS (
        SELECT 1
        FROM marketplace_registration_profiles canonical
        WHERE canonical.user_id = r.user_id
          AND canonical.source_type = 'funtastic-b2b'
          AND canonical.product_code <> r.product_code
          AND canonical.product_code IN (
            SELECT linked_code.value
            FROM jsonb_array_elements_text(COALESCE(r.sales_codes, '[]'::jsonb)) AS linked_code(value)
          )
      )
    ORDER BY r.source_updated_at DESC NULLS LAST, r.product_code DESC
  `)
  return rows<RegistrationRow>(result).map((row) => ({
    ...row,
    salesCodes: jsonArray<string>(row.salesCodes),
    thumbnailUrls: jsonArray<string>(row.thumbnailUrls),
    detailImageUrls: jsonArray<string>(row.detailImageUrls),
    imageUrls: jsonArray<string>(row.imageUrls),
    options: registrationOptions(row.options),
    productNotice: jsonArray<{ label: string; value: string }>(row.productNotice),
    channels: jsonArray<RegistrationChannel>(row.channels),
  }))
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
  salesCodes: string[]
}

export async function applyMarketplaceRegistration(input: RegistrationProfileInput) {
  await ensureMarketplaceRegistrationTables()
  const result = await db.execute<{ id: string }>(sql`
    INSERT INTO marketplace_registration_profiles (user_id, product_code, common_category, brand, manufacturer, country_of_origin, source_product_url, primary_image_url, image_urls, sales_codes)
    VALUES (${input.userId}, ${input.productCode}, ${input.commonCategory || null}, ${input.brand || null}, ${input.manufacturer || null}, ${input.countryOfOrigin || null}, ${input.sourceProductUrl || null}, ${input.primaryImageUrl || null}, ${JSON.stringify(input.imageUrls)}::jsonb, ${JSON.stringify(input.salesCodes)}::jsonb)
    ON CONFLICT (user_id, product_code) DO UPDATE SET common_category = EXCLUDED.common_category, brand = EXCLUDED.brand, manufacturer = EXCLUDED.manufacturer, country_of_origin = EXCLUDED.country_of_origin, source_product_url = EXCLUDED.source_product_url, primary_image_url = EXCLUDED.primary_image_url, image_urls = EXCLUDED.image_urls, sales_codes = EXCLUDED.sales_codes, updated_at = now()
    RETURNING id
  `)
  const profileId = rows<{ id: string }>(result)[0]!.id
  for (const marketplaceId of ['coupang', 'smartstore', 'toss', 'ohouse']) {
    await db.execute(sql`INSERT INTO marketplace_registration_channels (profile_id, user_id, marketplace_id, category_name, payload) VALUES (${profileId}, ${input.userId}, ${marketplaceId}, ${input.commonCategory || null}, ${JSON.stringify({ source: 'funtastic-b2b', commonCategory: input.commonCategory || null })}::jsonb) ON CONFLICT (profile_id, marketplace_id) DO UPDATE SET category_name = EXCLUDED.category_name, payload = EXCLUDED.payload, updated_at = now()`)
  }
  await syncRegistrationProfileToProducts(input)
}

async function syncRegistrationProfileToProducts(input: RegistrationProfileInput) {
  if (!input.salesCodes.length) return
  const imageUrls = [input.primaryImageUrl, ...input.imageUrls].filter((url): url is string => Boolean(url))
  const productImages = imageUrls.map((url, sortOrder) => ({ url, sortOrder }))
  await db.execute(sql`
    UPDATE products
    SET
      category_id = CASE
        WHEN ${input.commonCategory} IS NULL THEN category_id
        ELSE ${input.commonCategory}
      END,
      images = CASE
        WHEN ${productImages.length} = 0 THEN images
        ELSE ${JSON.stringify(productImages)}::jsonb
      END,
      updated_at = now()
    WHERE user_id = ${input.userId}
      AND internal_sku IN (${sql.join(input.salesCodes.map((code) => sql`${code}`), sql`, `)})
  `)
}

export async function syncMarketplaceRegistrationSalesCodes(userId: string) {
  await ensureMarketplaceRegistrationTables()
  const result = await db.execute<{ profile_count: number; sales_code_count: number }>(sql`
    WITH matched AS (
      SELECT registration.id,
        jsonb_agg(DISTINCT inventory.sku ORDER BY inventory.sku) AS matched_codes
      FROM marketplace_registration_profiles registration
      JOIN inventory
        ON inventory.user_id = registration.user_id
       AND regexp_replace(lower(replace(COALESCE(inventory.product_name, ''), '_펀타스틱', '')), '[^0-9a-z가-힣]', '', 'g')
         = regexp_replace(lower(replace(COALESCE(registration.product_name, ''), '_펀타스틱', '')), '[^0-9a-z가-힣]', '', 'g')
      WHERE registration.user_id = ${userId}
        AND registration.source_type = 'funtastic-b2b'
      GROUP BY registration.id
    ), updated AS (
      UPDATE marketplace_registration_profiles registration
      SET sales_codes = (
        SELECT COALESCE(jsonb_agg(DISTINCT code ORDER BY code), '[]'::jsonb)
        FROM (
          SELECT value AS code FROM jsonb_array_elements_text(COALESCE(registration.sales_codes, '[]'::jsonb))
          UNION
          SELECT value AS code FROM jsonb_array_elements_text(matched.matched_codes)
        ) codes
      ), updated_at = now()
      FROM matched
      WHERE registration.id = matched.id
      RETURNING registration.sales_codes
    )
    SELECT COUNT(*)::int AS profile_count,
      COALESCE(SUM(jsonb_array_length(sales_codes)), 0)::int AS sales_code_count
    FROM updated
  `)
  return rows<{ profile_count: number; sales_code_count: number }>(result)[0] ?? { profile_count: 0, sales_code_count: 0 }
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
        common_category = CASE
          WHEN NULLIF(BTRIM(COALESCE(marketplace_registration_profiles.common_category, '')), '') IS NULL
            THEN NULLIF(BTRIM(EXCLUDED.source_category_name), '')
          ELSE marketplace_registration_profiles.common_category
        END,
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
        VALUES ('coupang'), ('smartstore'), ('toss'), ('ohouse')
      ) AS channel(marketplace_id)
      WHERE profile.user_id = ${userId}
        AND profile.source_type = 'funtastic-b2b'
      ON CONFLICT (profile_id, marketplace_id) DO NOTHING
    `)
  }

  return { count: products.length, syncedAt: syncedAtIso }
}

type OhouseRegistrationOverride = {
  channelProductId: string
  sourceKey: string
  productName: string
  optionName: string | null
  components: Array<{ sku?: string; quantity?: number }>
  salePrice: number
  regularPrice: number | null
  shippingFee: number
  commissionRate: number
  registeredStock: number
  saleStatus: string
  lastCheckedAt: string
  notes: string | null
}

async function syncLinkedOhouseRegistrationChannels(userId: string) {
  const tableResult = await db.execute<{ tableName: string | null }>(sql`
    SELECT to_regclass('public.analytics_channel_product_overrides')::text AS "tableName"
  `)
  if (!rows<{ tableName: string | null }>(tableResult)[0]?.tableName) return

  const overrides = rows<OhouseRegistrationOverride>(await db.execute<OhouseRegistrationOverride>(sql`
    SELECT channel_product_id AS "channelProductId", source_key AS "sourceKey",
      product_name AS "productName", option_name AS "optionName", components,
      sale_price::float8 AS "salePrice", regular_price::float8 AS "regularPrice",
      shipping_fee::float8 AS "shippingFee", commission_rate::float8 AS "commissionRate",
      registered_stock::int AS "registeredStock", sale_status AS "saleStatus",
      last_checked_at::text AS "lastCheckedAt", notes
    FROM analytics_channel_product_overrides
    WHERE user_id = ${userId} AND channel_key = 'ohouse'
  `))
  if (overrides.length === 0) return

  const bySku = new Map<string, OhouseRegistrationOverride[]>()
  for (const registration of overrides) {
    for (const component of registration.components ?? []) {
      const sku = component.sku?.trim()
      if (!sku) continue
      bySku.set(sku, [...(bySku.get(sku) ?? []), registration])
    }
  }

  for (const [sku, registrations] of bySku) {
    const uniqueRegistrations = [...new Map(
      registrations.map((registration) => [
        `${registration.channelProductId}:${registration.sourceKey}`,
        registration,
      ]),
    ).values()]
    await db.execute(sql`
      INSERT INTO marketplace_registration_channels (
        profile_id, user_id, marketplace_id, status, category_name, payload
      )
      SELECT profile.id, profile.user_id, 'ohouse', 'submitted', profile.common_category,
        ${JSON.stringify({
          source: 'analytics-channel-product-overrides',
          registrations: uniqueRegistrations,
        })}::jsonb
      FROM marketplace_registration_profiles profile
      WHERE profile.user_id = ${userId}
        AND profile.source_type = 'funtastic-b2b'
        AND (
          profile.product_code = ${sku}
          OR COALESCE(profile.sales_codes, '[]'::jsonb) ? ${sku}
          OR EXISTS (
            SELECT 1
            FROM jsonb_array_elements(
              CASE WHEN jsonb_typeof(COALESCE(profile.source_options, '[]'::jsonb)) = 'array'
                THEN profile.source_options ELSE '[]'::jsonb END
            ) option_value
            WHERE option_value->>'barcode' = ${sku}
          )
        )
      ON CONFLICT (profile_id, marketplace_id) DO UPDATE SET
        status = EXCLUDED.status,
        category_name = COALESCE(EXCLUDED.category_name, marketplace_registration_channels.category_name),
        payload = EXCLUDED.payload,
        updated_at = now()
      WHERE marketplace_registration_channels.status IS DISTINCT FROM EXCLUDED.status
        OR marketplace_registration_channels.category_name IS DISTINCT FROM COALESCE(EXCLUDED.category_name, marketplace_registration_channels.category_name)
        OR marketplace_registration_channels.payload IS DISTINCT FROM EXCLUDED.payload
    `)
  }
}
