import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { isUniqueSupplierOrderIdentifier } from './supplier-order-reference'

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

export function purchasingItemIdentity(input: {
  source: string
  sku: string
  purchaseManagementCode: string | null
  supplierOrderNumber: string | null
  fallbackDiscriminator?: string | null
  includeFallbackDiscriminator?: boolean
}) {
  const purchaseManagementCode = input.purchaseManagementCode?.trim() ?? ''
  const supplierOrderNumber = input.supplierOrderNumber?.trim() ?? ''
  const uniqueSupplierOrderNumber = isUniqueSupplierOrderIdentifier(supplierOrderNumber)
    ? supplierOrderNumber
    : ''
  // Outbound groups use management code as their primary order identity. A
  // supplier reference may be filled later and must not revive the same dated
  // split shipment after it was manually completed/deleted.
  const identitySupplierOrderNumber = input.includeFallbackDiscriminator && purchaseManagementCode
    ? ''
    : uniqueSupplierOrderNumber
  const parts = [input.source, input.sku, purchaseManagementCode, identitySupplierOrderNumber]
  if (input.includeFallbackDiscriminator || (!purchaseManagementCode && !identitySupplierOrderNumber)) {
    parts.push(input.fallbackDiscriminator?.trim() ?? '')
  }
  return parts.join('|')
}

/**
 * A source-independent identity for the same physical purchase as it advances
 * from request to plan, purchase history, China arrival, and outbound. A
 * reusable text marker such as "wechat" is deliberately not strong enough;
 * only management code or a unique supplier order number can span stages.
 */
export function purchasingItemOrderIdentity(input: {
  sku: string
  purchaseManagementCode: string | null
  supplierOrderNumber: string | null
}) {
  const sku = input.sku.trim()
  const purchaseManagementCode = input.purchaseManagementCode?.trim() ?? ''
  if (sku && purchaseManagementCode) {
    return ['ecount-purchasing-order', sku, 'management', purchaseManagementCode].join('|')
  }
  const supplierOrderNumber = input.supplierOrderNumber?.trim() ?? ''
  if (sku && isUniqueSupplierOrderIdentifier(supplierOrderNumber)) {
    return ['ecount-purchasing-order', sku, 'supplier', supplierOrderNumber].join('|')
  }
  return null
}

/**
 * Stable identity for one raw China-outbound component. Supplier order text is
 * intentionally excluded because Ecount users may fill it after the shipment
 * was already completed or deleted in SaaS.
 */
export function purchasingOutboundComponentIdentity(input: {
  source: string
  sku: string
  purchaseManagementCode: string | null
  componentMatchKey: string
}) {
  return purchasingItemIdentity({
    source: input.source,
    sku: input.sku,
    purchaseManagementCode: input.purchaseManagementCode,
    supplierOrderNumber: null,
    fallbackDiscriminator: input.componentMatchKey,
    includeFallbackDiscriminator: true,
  })
}

export function isPurchasingItemIgnored(
  ignoredKeys: ReadonlySet<string>,
  input: Parameters<typeof purchasingItemIdentity>[0],
) {
  if (ignoredKeys.has(purchasingItemIdentity(input))) return true
  const orderIdentity = purchasingItemOrderIdentity(input)
  if (orderIdentity && ignoredKeys.has(orderIdentity)) return true

  // Keep compatibility with source-specific tombstones created before
  // fallback/order aliases existed, but never revive the old dangerously broad
  // no-identifier key (source|sku||).
  const purchaseManagementCode = input.purchaseManagementCode?.trim() ?? ''
  const supplierOrderNumber = input.supplierOrderNumber?.trim() ?? ''
  if (purchaseManagementCode) {
    return ignoredKeys.has([
      input.source,
      input.sku,
      purchaseManagementCode,
      supplierOrderNumber,
    ].join('|')) || ignoredKeys.has([
      input.source,
      input.sku,
      purchaseManagementCode,
      '',
    ].join('|'))
  }
  if (isUniqueSupplierOrderIdentifier(supplierOrderNumber)) {
    return ignoredKeys.has([input.source, input.sku, '', supplierOrderNumber].join('|'))
  }
  return false
}

export async function ensureIgnoredPurchasingItemsTable() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS purchasing_ignored_items (
      user_id uuid NOT NULL,
      identity_key text NOT NULL,
      reason text,
      ignored_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, identity_key)
    )
  `)
}

export async function getIgnoredPurchasingItemKeys(userId: string) {
  await ensureIgnoredPurchasingItemsTable()
  const rows = await db.execute(sql`
    SELECT identity_key AS "identityKey"
    FROM purchasing_ignored_items
    WHERE user_id = ${userId}::uuid
  `)
  return new Set(rows.map((row) => String(row.identityKey)))
}

export async function ignorePurchasingItem(input: {
  userId: string
  identityKey: string
  reason: string
}) {
  await ensureIgnoredPurchasingItemsTable()
  await db.execute(sql`
    INSERT INTO purchasing_ignored_items (user_id, identity_key, reason, ignored_at)
    VALUES (${input.userId}::uuid, ${input.identityKey}, ${input.reason}, now())
    ON CONFLICT (user_id, identity_key) DO UPDATE SET
      reason = EXCLUDED.reason,
      ignored_at = now()
  `)
}

export async function getIgnoredPurchasingItemKeysInTransaction(
  tx: DbTransaction,
  userId: string,
) {
  const rows = await tx.execute(sql`
    SELECT identity_key AS "identityKey"
    FROM purchasing_ignored_items
    WHERE user_id = ${userId}::uuid
  `)
  return new Set(rows.map((row) => String(row.identityKey)))
}

export async function ignorePurchasingItemsInTransaction(
  tx: DbTransaction,
  input: {
    userId: string
    items: Array<{
      identityKey: string
      reason: string
    }>
  },
) {
  const items = [...new Map(input.items.map((item) => [item.identityKey, item])).values()]
  if (items.length === 0) return

  await tx.execute(sql`
    INSERT INTO purchasing_ignored_items (user_id, identity_key, reason, ignored_at)
    VALUES ${sql.join(items.map((item) => sql`(
      ${input.userId}::uuid,
      ${item.identityKey},
      ${item.reason},
      now()
    )`), sql`, `)}
    ON CONFLICT (user_id, identity_key) DO UPDATE SET
      reason = EXCLUDED.reason,
      ignored_at = now()
  `)
}
