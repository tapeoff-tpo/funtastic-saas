import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'

const PURCHASE_REQUEST_MANAGEMENT_CODE_SKU_INDEX =
  'purchase_request_items_user_management_code_sku'

let ensurePurchaseRequestManagementCodeSkuLookupIndexPromise: Promise<void> | null = null

type IndexMetadataRow = {
  isUnique: boolean
}

function resultRows<T>(result: T[] | { rows?: T[] }) {
  return Array.isArray(result) ? result : result.rows ?? []
}

/**
 * Converts the legacy unique management-code/SKU index to a normal lookup
 * index. Lifecycle rows can share the same key (for example, China arrival
 * and China outbound), so uniqueness is not valid here.
 *
 * SQL migrations are not automatically run by every production deployment.
 * This keeps the application safe on the first sync after deployment, while
 * the process-local promise avoids repeating the DDL for subsequent syncs.
 */
export function ensurePurchaseRequestManagementCodeSkuLookupIndex(): Promise<void> {
  ensurePurchaseRequestManagementCodeSkuLookupIndexPromise ??= db.transaction(async (tx) => {
    // Serialize this upgrade across concurrently started serverless processes.
    await tx.execute(sql`
      SELECT pg_advisory_xact_lock(hashtext(${PURCHASE_REQUEST_MANAGEMENT_CODE_SKU_INDEX}))
    `)

    const metadataResult = await tx.execute<IndexMetadataRow>(sql`
      SELECT index_definition.indisunique AS "isUnique"
      FROM pg_class AS index_class
      JOIN pg_namespace AS index_namespace
        ON index_namespace.oid = index_class.relnamespace
      JOIN pg_index AS index_definition
        ON index_definition.indexrelid = index_class.oid
      WHERE index_namespace.nspname = current_schema()
        AND index_class.relname = ${PURCHASE_REQUEST_MANAGEMENT_CODE_SKU_INDEX}
    `)
    const indexMetadata = resultRows(metadataResult)[0]

    if (indexMetadata?.isUnique) {
      await tx.execute(sql`
        DROP INDEX IF EXISTS "purchase_request_items_user_management_code_sku"
      `)
    }

    await tx.execute(sql`
      CREATE INDEX IF NOT EXISTS "purchase_request_items_user_management_code_sku"
      ON "purchase_request_items" ("user_id", "purchase_management_code", "sku")
    `)
  }).catch((error) => {
    ensurePurchaseRequestManagementCodeSkuLookupIndexPromise = null
    throw error
  })

  return ensurePurchaseRequestManagementCodeSkuLookupIndexPromise
}
