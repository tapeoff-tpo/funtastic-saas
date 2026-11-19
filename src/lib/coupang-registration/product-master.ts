import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { normalizeCostName, type RegistrationProductMaster } from './model'

type MasterRequest = { id: string; name: string; skus: string[] }
type MasterMatchRow = {
  requestId: string
  itemId: string
  skuMatch: boolean
  noticeSize: string | null
  noticeWeight: string | null
  noticeMaterial: string | null
  noticeManufacturer: string | null
  noticeCountry: string | null
  qualityPdfId: string | null
  qualityPdfFileName: string | null
  qualityPdfContentType: string | null
}

const rows = <T>(result: unknown): T[] => Array.isArray(result) ? result as T[] : (result as { rows?: T[] }).rows ?? []

function isMissingProductManagementTable(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { code?: unknown; cause?: { code?: unknown } }
  return candidate.code === '42P01' || candidate.cause?.code === '42P01'
}

function text(value: string | null) {
  return value?.trim() ?? ''
}

function toMaster(row: MasterMatchRow, match: RegistrationProductMaster['match']): RegistrationProductMaster {
  return {
    itemId: row.itemId,
    match,
    noticeSize: text(row.noticeSize),
    noticeWeight: text(row.noticeWeight),
    noticeMaterial: text(row.noticeMaterial),
    noticeManufacturer: text(row.noticeManufacturer),
    noticeCountry: text(row.noticeCountry),
    ...(row.qualityPdfId && row.qualityPdfFileName && row.qualityPdfContentType
      ? { qualityPdf: { id: row.qualityPdfId, fileName: row.qualityPdfFileName, contentType: row.qualityPdfContentType } }
      : {}),
  }
}

/**
 * Finds a Product Management record only when it is uniquely identifiable.
 * SKU is authoritative; a normalized exact title is a deliberately conservative
 * fallback for legacy items without a registered SKU.
 */
export async function findRegistrationProductMasters(userId: string, products: MasterRequest[]) {
  const requested = [...new Map(products.map((product) => [product.id, {
    id: product.id,
    name: normalizeCostName(product.name),
    skus: [...new Set(product.skus.map((sku) => sku.trim().toUpperCase()).filter(Boolean))],
  }])).values()].flatMap((product) => [
    ...product.skus.map((value) => ({ requestId: product.id, kind: 'sku', value })),
    ...(product.name ? [{ requestId: product.id, kind: 'name', value: product.name }] : []),
  ])
  if (!requested.length) return new Map<string, RegistrationProductMaster>()

  try {
    const matches = rows<MasterMatchRow>(await db.execute(sql`
      WITH requested AS (
        SELECT * FROM jsonb_to_recordset(${JSON.stringify(requested)}::jsonb)
        AS request("requestId" text, kind text, value text)
      ), source AS MATERIALIZED (
        SELECT
          item.id,
          item.sabangnet_code AS "sabangnetCode",
          item.product_name AS "productName",
          item.registered_product_name AS "registeredProductName",
          item.metadata -> 'optionDetails' AS options,
          item.notice_size AS "noticeSize",
          item.notice_weight AS "noticeWeight",
          item.notice_material AS "noticeMaterial",
          item.notice_manufacturer AS "noticeManufacturer",
          item.notice_country AS "noticeCountry",
          attachment.id::text AS "qualityPdfId",
          attachment.file_name AS "qualityPdfFileName",
          attachment.content_type AS "qualityPdfContentType"
        FROM new_product_workflow_items item
        LEFT JOIN LATERAL (
          SELECT id, file_name, content_type
          FROM new_product_workflow_attachments
          WHERE user_id = item.user_id AND item_id = item.id AND kind = 'quality_pdf'
          ORDER BY created_at DESC
          LIMIT 1
        ) attachment ON TRUE
        WHERE item.user_id = ${userId}::uuid
      ), product_keys AS (
        SELECT id, 'sku'::text AS kind, upper(btrim("sabangnetCode")) AS value FROM source
        UNION ALL
        SELECT source.id, 'sku', upper(btrim(option ->> 'sabangnetOptionCode'))
        FROM source
        CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(source.options) = 'array' THEN source.options ELSE '[]'::jsonb END) option
        UNION ALL
        SELECT id, 'name', regexp_replace(lower(normalize(coalesce("productName", ''), NFKC)), '[^[:alnum:]]', '', 'g') FROM source
        UNION ALL
        SELECT id, 'name', regexp_replace(lower(normalize(coalesce("registeredProductName", ''), NFKC)), '[^[:alnum:]]', '', 'g') FROM source
      ), matches AS (
        SELECT request."requestId", source.id AS "itemId", bool_or(request.kind = 'sku') AS "skuMatch"
        FROM requested request
        JOIN product_keys product_key ON product_key.kind = request.kind AND product_key.value = request.value AND product_key.value <> ''
        JOIN source ON source.id = product_key.id
        GROUP BY request."requestId", source.id
      )
      SELECT
        matches."requestId",
        matches."itemId",
        matches."skuMatch",
        source."noticeSize",
        source."noticeWeight",
        source."noticeMaterial",
        source."noticeManufacturer",
        source."noticeCountry",
        source."qualityPdfId",
        source."qualityPdfFileName",
        source."qualityPdfContentType"
      FROM matches
      JOIN source ON source.id = matches."itemId"
    `))

    const byRequest = new Map<string, MasterMatchRow[]>()
    for (const match of matches) byRequest.set(match.requestId, [...(byRequest.get(match.requestId) ?? []), match])
    const result = new Map<string, RegistrationProductMaster>()
    for (const [requestId, candidates] of byRequest) {
      const skuMatches = candidates.filter((candidate) => candidate.skuMatch)
      // An ambiguous SKU must never fall through to an equally named product.
      if (skuMatches.length === 1) result.set(requestId, toMaster(skuMatches[0], 'sku'))
      else if (!skuMatches.length && candidates.length === 1) result.set(requestId, toMaster(candidates[0], 'name'))
    }
    return result
  } catch (error) {
    // Product Management is supplementary to the B2B catalogue. A workspace
    // without its old workflow tables must still be able to prepare a quote.
    if (isMissingProductManagementTable(error)) return new Map<string, RegistrationProductMaster>()
    throw error
  }
}
