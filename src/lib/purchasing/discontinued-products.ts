import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { products, purchaseRequestItems } from '@/lib/db/schema'
import type { DiscontinuedProductAction, DiscontinuedProductUpload } from './discontinued-product-file'

export type DiscontinuedProductMatchSummary = {
  registeredSkuCount: number
  unregisteredSkus: string[]
}

export type StoredDiscontinuedProductRawFile = {
  fileName: string
  updatedAt: string
}

const PRODUCT_CHUNK_SIZE = 400

export async function getDiscontinuedProductMatchSummary(
  userId: string,
  actions: DiscontinuedProductAction[],
): Promise<DiscontinuedProductMatchSummary> {
  const skus = [...new Set(actions.map((action) => action.sku))]
  const registeredSkus = await getRegisteredProductSkus(userId, skus)
  return {
    registeredSkuCount: registeredSkus.size,
    unregisteredSkus: skus.filter((sku) => !registeredSkus.has(sku)),
  }
}

/**
 * Applies only the SKUs included in the file. A later partial file must never
 * reactivate an SKU simply because that SKU was not uploaded again.
 */
export async function applyDiscontinuedProductActions(input: {
  userId: string
  actions: DiscontinuedProductAction[]
}) {
  const registeredSkus = await getRegisteredProductSkus(input.userId, input.actions.map((action) => action.sku))
  const actions = input.actions.filter((action) => registeredSkus.has(action.sku))
  const discontinuedActions = actions.filter((action) => action.action === 'discontinued')
  const now = new Date()

  let hiddenAutoRecommendationRows = 0
  await db.transaction(async (tx) => {
    for (const chunk of chunks(actions, PRODUCT_CHUNK_SIZE)) {
      const values = sql.join(chunk.map((action) => sql`(
        ${action.sku}::text,
        ${action.action}::text,
        ${action.action === 'discontinued' ? buildStatusNote(action) : null}::text,
        ${action.action === 'discontinued'}::boolean
      )`), sql`, `)
      await tx.execute(sql`
        UPDATE products AS product
        SET
          purchasing_status = source.purchasing_status,
          purchasing_status_note = source.purchasing_status_note,
          purchasing_status_updated_at = ${now},
          metadata = jsonb_set(
            COALESCE(product.metadata, '{}'::jsonb),
            '{purchasingOutgoingMetrics}',
            COALESCE(product.metadata->'purchasingOutgoingMetrics', '{}'::jsonb)
              || jsonb_build_object('isDiscontinued', source.is_discontinued),
            true
          ),
          updated_at = ${now}
        FROM (VALUES ${values}) AS source(
          sku,
          purchasing_status,
          purchasing_status_note,
          is_discontinued
        )
        WHERE product.user_id = ${input.userId}::uuid
          AND product.internal_sku = source.sku
      `)
    }

    for (const chunk of chunks(discontinuedActions.map((action) => action.sku), PRODUCT_CHUNK_SIZE)) {
      if (chunk.length === 0) continue
      const hiddenRows = await tx
        .update(purchaseRequestItems)
        .set({ requestedQuantity: 0, updatedAt: now })
        .where(and(
          eq(purchaseRequestItems.userId, input.userId),
          inArray(purchaseRequestItems.sku, chunk),
          sql`${purchaseRequestItems.rawData}->>'source' = 'auto_purchase_recommendation'`,
        ))
        .returning({ id: purchaseRequestItems.id })
      hiddenAutoRecommendationRows += hiddenRows.length
    }
  })

  return {
    appliedSkuCount: actions.length,
    discontinuedSkuCount: discontinuedActions.length,
    restoredSkuCount: actions.length - discontinuedActions.length,
    unregisteredSkus: input.actions
      .map((action) => action.sku)
      .filter((sku) => !registeredSkus.has(sku)),
    hiddenAutoRecommendationRows,
  }
}

export async function getStoredDiscontinuedProductRawFile(
  userId: string,
): Promise<StoredDiscontinuedProductRawFile | null> {
  await ensureStoredFileTable()
  const result = await db.execute<{ fileName: string; updatedAt: string }>(sql`
    SELECT file_name AS "fileName", updated_at::text AS "updatedAt"
    FROM purchasing_discontinued_product_raw_files
    WHERE user_id = ${userId}::uuid
  `)
  const rows = Array.isArray(result) ? result : result.rows ?? []
  return rows[0] ?? null
}

export async function saveStoredDiscontinuedProductRawFile(input: {
  userId: string
  upload: DiscontinuedProductUpload
}) {
  await ensureStoredFileTable()
  const base64 = Buffer.from(input.upload.fileBuffer).toString('base64')
  await db.execute(sql`
    INSERT INTO purchasing_discontinued_product_raw_files (user_id, file_name, file_data, updated_at)
    VALUES (${input.userId}::uuid, ${input.upload.fileName}, decode(${base64}, 'base64'), now())
    ON CONFLICT (user_id) DO UPDATE SET
      file_name = EXCLUDED.file_name,
      file_data = EXCLUDED.file_data,
      updated_at = now()
  `)
}

async function ensureStoredFileTable() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS purchasing_discontinued_product_raw_files (
      user_id uuid PRIMARY KEY,
      file_name text NOT NULL,
      file_data bytea NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `)
}

async function getRegisteredProductSkus(userId: string, skus: string[]) {
  const registered = new Set<string>()
  for (const chunk of chunks([...new Set(skus)], PRODUCT_CHUNK_SIZE)) {
    if (chunk.length === 0) continue
    const rows = await db
      .select({ sku: products.internalSku })
      .from(products)
      .where(and(eq(products.userId, userId), inArray(products.internalSku, chunk)))
    for (const row of rows) registered.add(row.sku)
  }
  return registered
}

function buildStatusNote(action: DiscontinuedProductAction) {
  const details = [action.reason, action.discontinuedDate, action.note].filter(Boolean).join(' · ')
  return details ? `단종 원본: ${details}` : '단종 원본 반영'
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size))
  return result
}
