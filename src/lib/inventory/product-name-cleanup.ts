import 'server-only'

import { db } from '@/lib/db'
import { inventory, products } from '@/lib/db/schema'
import { sql } from 'drizzle-orm'

const cleanupByWorkspace = new Map<string, Promise<void>>()

/**
 * One-time self-healing for previously imported inventory names. The upload
 * path normalizes new names; this keeps legacy inventory and product master
 * rows in sync the next time the workspace opens inventory management.
 */
export function normalizeStoredInventoryProductNames(userId: string): Promise<void> {
  const pending = cleanupByWorkspace.get(userId)
  if (pending) return pending

  const cleanup = db.transaction(async (tx) => {
    await tx.execute(sql`
      UPDATE ${inventory}
      SET product_name = COALESCE(
            NULLIF(
              BTRIM(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(${inventory.productName}, '_펀타스틱', '', 'gi'), '\\s+', ' ', 'g'), '_+$', '', 'g')),
              ''
            ),
            ${inventory.sku}
          ),
          updated_at = now()
      WHERE ${inventory.userId} = ${userId}
        AND ${inventory.productName} ~* '_펀타스틱'
    `)

    await tx.execute(sql`
      UPDATE ${products}
      SET name = COALESCE(
            NULLIF(
              BTRIM(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(${products.name}, '_펀타스틱', '', 'gi'), '\\s+', ' ', 'g'), '_+$', '', 'g')),
              ''
            ),
            ${products.internalSku}
          ),
          updated_at = now()
      WHERE ${products.userId} = ${userId}
        AND ${products.name} ~* '_펀타스틱'
    `)
  }).catch((error) => {
    cleanupByWorkspace.delete(userId)
    throw error
  })

  cleanupByWorkspace.set(userId, cleanup)
  return cleanup
}
