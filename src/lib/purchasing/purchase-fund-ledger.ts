import { createHash } from 'node:crypto'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  products,
  purchaseFundEntries,
  purchaseRequestItems,
} from '@/lib/db/schema'
import { calculatePurchaseCosts } from './purchase-costs'
import { summarizeFundMonths, type FundMonth } from './purchase-fund-monthly'
import { buildRequestedFundCharges, requestedChargeOpeningBoundary } from './purchase-fund-requested'
import { ensurePurchasePaymentTrackingSchema } from './purchase-payment-tracking'
import type { PurchaseRequestStatus } from './purchase-request-status'
import {
  isUniqueSupplierOrderIdentifier,
  normalizeSupplierOrderReference,
} from './supplier-order-reference'

export const PURCHASE_FUND_MANUAL_ENTRY_TYPES = ['deposit', 'opening_balance'] as const
export const PURCHASE_FUND_DEBIT_START_DATE = '2026-11-01'

export type PurchaseFundManualEntryType = (typeof PURCHASE_FUND_MANUAL_ENTRY_TYPES)[number]
export type PurchaseFundEntryType = PurchaseFundManualEntryType | 'purchase_debit'
export type PurchaseFundDebitExistingEntryMode = 'recalculate' | 'preserve'

export type PurchaseFundDebitSourceRow = {
  id: string
  status: PurchaseRequestStatus
  requestDate: string | null
  outboundExpectedDate: string | null
  createdAt: Date | string
  sku: string
  productName: string
  optionName: string | null
  requestedQuantity: number
  actualPurchaseQuantity: number | null
  chinaReceivedAt?: Date | string | null
  purchaseManagementCode: string | null
  supplierOrderNumber: string | null
  costExchangeRateKrw: string | null
  specialPriceCny: string | null
  newCostCny: string | null
  rawData: Record<string, unknown>
}

export type PurchaseFundDebitSnapshot = {
  sourceKey: string
  supplierOrderNumber: string
  sourcePurchaseItemId: string
  occurredOn: string
  amountKrw: number
  amountCny: number | null
  missingCostCount: number
  details: Record<string, unknown>
}

export type PurchaseFundLedgerData = {
  monthly: FundMonth[]
  requestReviewItems?: Array<{ id: string; occurredOn: string; sku: string; productName: string; reason: string }>
  missingDebitItems?: Array<{
    id: string
    occurredOn: string
    supplierOrderNumber: string | null
    reason: string
    products: Array<{ productName: string; sku: string; optionName: string }>
  }>
  summary: {
    totalDepositedKrw: number
    totalDebitedKrw: number
    balanceKrw: number
    totalDepositedCny: number | null
    totalDebitedCny: number | null
    balanceCny: number | null
    knownDepositedCny: number
    knownDebitedCny: number
    knownBalanceCny: number
    missingCnyDepositCount: number
    missingCostOrderCount: number
  }
  entries: Array<{
    id: string
    entryType: PurchaseFundEntryType
    occurredOn: string
    amountKrw: number
    amountCny: number | null
    memo: string | null
    detail: string
    balanceKrw: number
    balanceCny: number | null
    isManualCredit: boolean
    voidedAt: string | null
  }>
}

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
type DbExecutor = typeof db | DbTransaction

const STATUS_PRIORITY: Record<PurchaseRequestStatus, number> = {
  requested: 0,
  purchased: 10,
  purchase_completed: 20,
  inspecting: 25,
  china_arrived: 30,
  outbound_requested: 40,
  completed: 50,
}

let ensureSchemaPromise: Promise<void> | null = null

type PurchaseFundLedgerSchemaRow = {
  hasTable: boolean
  hasSourceKeyIndex: boolean
  hasOccurredOnIndex: boolean
  hasRls: boolean
}

function resultRows<T>(result: T[] | { rows?: T[] }) {
  return Array.isArray(result) ? result : result.rows ?? []
}

async function hasPurchaseFundLedgerSchema() {
  const [row] = resultRows<PurchaseFundLedgerSchemaRow>(await db.execute(sql`
    SELECT
      to_regclass(current_schema() || '.purchase_fund_entries') IS NOT NULL AS "hasTable",
      to_regclass(current_schema() || '.purchase_fund_entries_user_source_key') IS NOT NULL AS "hasSourceKeyIndex",
      to_regclass(current_schema() || '.purchase_fund_entries_user_occurred_on') IS NOT NULL AS "hasOccurredOnIndex",
      COALESCE((
        SELECT relrowsecurity
        FROM pg_class
        WHERE oid = to_regclass(current_schema() || '.purchase_fund_entries')
      ), false) AS "hasRls"
  `))
  return row?.hasTable === true
    && row?.hasSourceKeyIndex === true
    && row?.hasOccurredOnIndex === true
    && row?.hasRls === true
}

export function ensurePurchaseFundLedgerSchema() {
  ensureSchemaPromise ??= (async () => {
    await ensurePurchasePaymentTrackingSchema()
    // The migration owns this schema. Avoid table/index DDL on every cold
    // start once production already has the required objects.
    if (await hasPurchaseFundLedgerSchema()) return

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS purchase_fund_entries (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL,
        entry_type varchar(30) NOT NULL CHECK (
          entry_type IN ('deposit', 'opening_balance', 'purchase_debit')
        ),
        occurred_on date NOT NULL,
        amount_krw numeric(16, 2) NOT NULL DEFAULT 0 CHECK (amount_krw >= 0),
        amount_cny numeric(16, 2) CHECK (amount_cny IS NULL OR amount_cny >= 0),
        memo text,
        source_key varchar(255),
        supplier_order_number varchar(100),
        source_purchase_item_id uuid REFERENCES purchase_request_items(id) ON DELETE SET NULL,
        missing_cost_count integer NOT NULL DEFAULT 0 CHECK (missing_cost_count >= 0),
        details jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_by uuid,
        voided_at timestamptz,
        voided_by uuid,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `)
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS purchase_fund_entries_user_source_key
      ON purchase_fund_entries(user_id, source_key)
    `)
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS purchase_fund_entries_user_occurred_on
      ON purchase_fund_entries(user_id, occurred_on)
    `)
    await db.execute(sql`ALTER TABLE purchase_fund_entries ENABLE ROW LEVEL SECURITY`)
    await db.execute(sql`REVOKE ALL ON TABLE purchase_fund_entries FROM anon, authenticated`)
  })().catch((error) => {
    ensureSchemaPromise = null
    throw error
  })

  return ensureSchemaPromise
}

/**
 * Builds one durable debit per supplier order. The same order can appear in
 * several purchasing lifecycle views, so lifecycle copies are collapsed by
 * management-code/SKU before the order total is calculated. Free-text order
 * references such as "웨이신" are purchase evidence, not globally unique order
 * IDs, so they are separated by the strongest available row identity.
 */
export function buildPurchaseDebitSnapshots(
  rows: PurchaseFundDebitSourceRow[],
  fallbackExchangeRateKrw: number,
): PurchaseFundDebitSnapshot[] {
  const rowsByOrder = new Map<string, PurchaseFundDebitSourceRow[]>()
  const canonicalGenericReferenceSkuKeys = new Set(rows.flatMap((row) => {
    if (row.status === 'outbound_requested' || row.status === 'completed') return []
    const reference = normalizeSupplierOrderReference(row.supplierOrderNumber)
    if (!reference || isUniqueSupplierOrderIdentifier(reference)) return []
    return [genericReferenceSkuKey(reference, row.sku)]
  }))

  for (const row of rows) {
    if (isUnidentifiedGenericLogisticsCopy(row, canonicalGenericReferenceSkuKeys)) continue
    const orderGroupKey = purchaseDebitOrderGroupKey(row)
    if (!orderGroupKey) continue
    const values = rowsByOrder.get(orderGroupKey) ?? []
    values.push(row)
    rowsByOrder.set(orderGroupKey, values)
  }

  return [...rowsByOrder.entries()].map(([sourceKey, orderRows]) => {
    const rowsByLine = new Map<string, PurchaseFundDebitSourceRow>()
    for (const row of orderRows) {
      const key = purchaseDebitLineKey(row)
      const current = rowsByLine.get(key)
      if (!current || compareDebitSourceRows(row, current) > 0) rowsByLine.set(key, row)
    }

    const lineRows = [...rowsByLine.values()]
    const lines = lineRows.map((row) => {
      const quantity = purchaseDebitQuantity(row)
      const costs = calculatePurchaseCosts({
        requestedQuantity: quantity,
        specialPriceCny: row.specialPriceCny,
        newCostCny: row.newCostCny,
        exchangeRateKrw: row.costExchangeRateKrw ?? fallbackExchangeRateKrw,
      })

      return {
        sourcePurchaseItemId: row.id,
        sku: row.sku,
        productName: row.productName,
        optionName: row.optionName,
        purchaseManagementCode: row.purchaseManagementCode,
        quantity,
        unitCostYuan: costs.unitCostYuan,
        unitCostKrw: costs.unitCostKrw,
        totalCostYuan: costs.totalCostYuan,
        totalCostKrw: costs.totalCostKrw,
      }
    })
    const amountKrw = lines.reduce((sum, line) => sum + (line.totalCostKrw ?? 0), 0)
    const knownAmountCny = lines.reduce((sum, line) => sum + (line.totalCostYuan ?? 0), 0)
    const missingCostCount = lines.filter((line) => (
      line.totalCostKrw === null || line.totalCostYuan === null
    )).length
    const selectedSource = lineRows.reduce((selected, row) => (
      compareDebitSourceRows(row, selected) > 0 ? row : selected
    ))
    const supplierOrderNumber = normalizeSupplierOrderReference(selectedSource.supplierOrderNumber)!
    const occurredOn = earliestPurchaseDate(orderRows)
    const productNames = [...new Set(lines.map((line) => line.productName).filter(Boolean))]

    return {
      sourceKey,
      supplierOrderNumber,
      sourcePurchaseItemId: selectedSource.id,
      occurredOn,
      amountKrw: Math.round(amountKrw),
      amountCny: lines.every((line) => line.totalCostYuan === null)
        ? null
        : Math.round(knownAmountCny * 100) / 100,
      missingCostCount,
      details: {
        schemaVersion: 2,
        lineCount: lines.length,
        productSummary: productNames.length <= 2
          ? productNames.join(', ')
          : `${productNames.slice(0, 2).join(', ')} 외 ${productNames.length - 2}개`,
        lines,
      },
    }
  }).filter((snapshot) => snapshot.occurredOn >= PURCHASE_FUND_DEBIT_START_DATE)
    .sort((left, right) => (
    left.occurredOn.localeCompare(right.occurredOn)
      || left.supplierOrderNumber.localeCompare(right.supplierOrderNumber)
      || left.sourceKey.localeCompare(right.sourceKey)
  ))
}

function isUnidentifiedGenericLogisticsCopy(
  row: PurchaseFundDebitSourceRow,
  canonicalReferenceSkuKeys: Set<string>,
) {
  if (row.status !== 'outbound_requested' && row.status !== 'completed') return false
  const supplierOrderReference = normalizeSupplierOrderReference(row.supplierOrderNumber)
  if (!supplierOrderReference || isUniqueSupplierOrderIdentifier(supplierOrderReference)) return false
  if (normalizeKeyPart(row.purchaseManagementCode)) return false
  if (normalizeKeyPart(rawString(row.rawData.purchaseOrderNumber))) return false
  return canonicalReferenceSkuKeys.has(genericReferenceSkuKey(supplierOrderReference, row.sku))
}

function genericReferenceSkuKey(reference: string, sku: string) {
  return `${normalizeKeyPart(reference).toLocaleLowerCase('en-US')}|${normalizeKeyPart(sku)}`
}

function purchaseDebitOrderGroupKey(row: PurchaseFundDebitSourceRow) {
  const supplierOrderReference = normalizeSupplierOrderReference(row.supplierOrderNumber)
  if (!supplierOrderReference) return null
  if (isUniqueSupplierOrderIdentifier(supplierOrderReference)) {
    // Preserve the existing durable key for ordinary numeric supplier orders.
    return `supplier-order:${supplierOrderReference}`
  }

  const purchaseManagementCode = normalizeKeyPart(row.purchaseManagementCode)
  const purchaseOrderNumber = normalizeKeyPart(rawString(row.rawData.purchaseOrderNumber))
  const sourceDateNo = normalizeKeyPart(rawString(row.rawData.sourceDateNo))
  const fallbackIdentity = purchaseManagementCode
    ? `management:${purchaseManagementCode}`
    : purchaseOrderNumber
      ? `purchase-order:${purchaseOrderNumber}`
      : sourceDateNo
        ? `source-date:${sourceDateNo}|sku:${normalizeKeyPart(row.sku)}|option:${normalizeKeyPart(row.optionName)}`
        : `row:${row.id}`
  const digest = createHash('sha256').update(fallbackIdentity).digest('hex').slice(0, 32)
  return `supplier-reference:${digest}`
}

export async function reconcilePurchaseFundDebits(input: {
  userId: string
  fallbackExchangeRateKrw: number
  existingEntryMode?: PurchaseFundDebitExistingEntryMode
}) {
  await ensurePurchaseFundLedgerSchema()
  return db.transaction(async (tx) => {
    await tx.execute(sql`
      SELECT pg_advisory_xact_lock(hashtext(${`purchase-fund-ledger:${input.userId}`}))
    `)
    return reconcilePurchaseFundDebitsInTransaction(tx, input)
  })
}

/** Backfills the pre-existing active orders once; later writes reconcile at their mutation point. */
export async function ensurePurchaseFundDebitBackfill(input: {
  userId: string
  fallbackExchangeRateKrw: number
}) {
  await ensurePurchaseFundLedgerSchema()
  const [existing] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(purchaseFundEntries)
    .where(and(
      eq(purchaseFundEntries.userId, input.userId),
      eq(purchaseFundEntries.entryType, 'purchase_debit'),
    ))

  // Preserve previously recorded debit amounts when the balance page is read.
  const result = await reconcilePurchaseFundDebits({
    ...input,
    existingEntryMode: 'preserve',
  })
  return { ...result, backfilled: Number(existing?.count ?? 0) === 0 }
}

export async function reconcilePurchaseFundDebitsInTransaction(
  tx: DbTransaction,
  input: {
    userId: string
    fallbackExchangeRateKrw: number
    existingEntryMode?: PurchaseFundDebitExistingEntryMode
    supplierOrderNumber?: string | null
  },
) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`purchase-fund-ledger:${input.userId}`}))`)
  const existing = resultRows<RecordedCompletion & { source_key: string | null }>(await tx.execute(sql`
    SELECT source_purchase_item_id::text AS item_id, supplier_order_number, details, source_key
    FROM purchase_fund_entries
    WHERE user_id = ${input.userId}::uuid AND entry_type = 'purchase_debit'
      AND voided_at IS NULL
  `))
  const sourceItems = await loadRequestedFundSourceRows(tx, input.userId)
  const backfilled = buildMissingCompletionSnapshots(sourceItems, existing, input.userId, input.fallbackExchangeRateKrw, input.supplierOrderNumber)
  for (const group of chunks(backfilled, 250)) {
    await tx.insert(purchaseFundEntries).values(group).onConflictDoNothing({ target: [purchaseFundEntries.userId, purchaseFundEntries.sourceKey] })
  }
  const captured = [
    ...existing.filter((entry) => entry.source_key?.startsWith('completion:')),
    ...backfilled.map((entry) => ({ item_id: entry.sourcePurchaseItemId, supplier_order_number: entry.supplierOrderNumber, details: entry.details })),
  ]
  const rows = excludeCapturedCompletionRows(await loadPurchaseDebitSourceRows(tx, input.userId, input.supplierOrderNumber), captured)
  const snapshots = buildPurchaseDebitSnapshots(rows, input.fallbackExchangeRateKrw)

  for (const values of chunks(snapshots, 250)) {
    const insertQuery = tx
      .insert(purchaseFundEntries)
      .values(values.map((snapshot) => ({
        userId: input.userId,
        entryType: 'purchase_debit',
        occurredOn: snapshot.occurredOn,
        amountKrw: String(snapshot.amountKrw),
        amountCny: snapshot.amountCny === null ? null : String(snapshot.amountCny),
        memo: '구매완료 단계 도달에 따른 자동 발주 차감',
        sourceKey: snapshot.sourceKey,
        supplierOrderNumber: snapshot.supplierOrderNumber,
        sourcePurchaseItemId: snapshot.sourcePurchaseItemId,
        missingCostCount: snapshot.missingCostCount,
        details: snapshot.details,
        updatedAt: new Date(),
      })))

    if (input.existingEntryMode !== 'recalculate') {
      await insertQuery.onConflictDoNothing({ target: [purchaseFundEntries.userId, purchaseFundEntries.sourceKey] })
      continue
    }

    await insertQuery
      .onConflictDoUpdate({
        target: [purchaseFundEntries.userId, purchaseFundEntries.sourceKey],
        set: {
          occurredOn: sql`LEAST(${purchaseFundEntries.occurredOn}, excluded.occurred_on)`,
          amountKrw: sql`excluded.amount_krw`,
          amountCny: sql`excluded.amount_cny`,
          supplierOrderNumber: sql`excluded.supplier_order_number`,
          sourcePurchaseItemId: sql`excluded.source_purchase_item_id`,
          missingCostCount: sql`excluded.missing_cost_count`,
          details: sql`excluded.details`,
          voidedAt: null,
          voidedBy: null,
          updatedAt: new Date(),
        },
      })
  }

  return { reconciledOrderCount: snapshots.length }
}

type RecordedCompletion = { item_id: string | null; supplier_order_number: string | null; details: unknown }

function completionSnapshot(item: PurchaseFundDebitSourceRow, userId: string, rate: number, occurredOn: string) {
  const quantity = Math.max(0, Math.trunc(item.actualPurchaseQuantity ?? item.requestedQuantity))
  const costs = calculatePurchaseCosts({ requestedQuantity: quantity, specialPriceCny: item.specialPriceCny,
    newCostCny: item.newCostCny, exchangeRateKrw: item.costExchangeRateKrw ?? rate })
  return {
    userId, entryType: 'purchase_debit' as const, occurredOn,
    amountKrw: String(costs.totalCostKrw ?? 0), amountCny: costs.totalCostYuan === null ? null : String(costs.totalCostYuan),
    missingCostCount: costs.totalCostYuan === null || costs.totalCostKrw === null ? 1 : 0,
    memo: '구매완료 시 자동 차감', sourceKey: `completion:${item.id}`, supplierOrderNumber: item.supplierOrderNumber,
    sourcePurchaseItemId: item.id, details: { schemaVersion: 3, productSummary: item.productName,
      lines: [{ sourcePurchaseItemId: item.id, purchaseManagementCode: item.purchaseManagementCode, sku: item.sku, requestDate: item.requestDate,
        productName: item.productName, optionName: item.optionName, quantity, unitCostYuan: costs.unitCostYuan,
        totalCostYuan: costs.totalCostYuan, totalCostKrw: costs.totalCostKrw }] },
  }
}

export function buildMissingCompletionSnapshots(rows: PurchaseFundDebitSourceRow[], existing: RecordedCompletion[], userId: string, rate: number, supplierOrderNumber?: string | null) {
  const order = normalizeSupplierOrderReference(supplierOrderNumber)
  const candidates = excludeCapturedCompletionRows(rows.filter((row) => row.status === 'purchase_completed'
    && (!order || normalizeSupplierOrderReference(row.supplierOrderNumber) === order)), existing)
  const seen = new Set<string>()
  return candidates.flatMap((item) => {
    const occurredOn = item.requestDate ?? kstDate(new Date(item.createdAt))
    if (occurredOn < PURCHASE_FUND_DEBIT_START_DATE) return []
    const management = item.purchaseManagementCode?.trim()
    const supplier = item.supplierOrderNumber?.trim()
    const identity = management ? JSON.stringify(['management', management, item.sku.trim()])
      : supplier && isUniqueSupplierOrderIdentifier(supplier) ? JSON.stringify(['supplier', supplier, item.sku.trim()]) : `row:${item.id}`
    if (seen.has(identity)) return []
    seen.add(identity)
    return [completionSnapshot(item, userId, rate, occurredOn)]
  })
}

export function excludeCapturedCompletionRows(rows: PurchaseFundDebitSourceRow[], recorded: RecordedCompletion[]) {
  const ids = new Set<string>()
  const managementKeys = new Set<string>()
  const supplierKeys = new Set<string>()
  const requestDateKeys = new Set<string>()
  const key = (first: string, second: string) => JSON.stringify([first.trim(), second.trim()])
  for (const entry of recorded) {
    if (entry.item_id) ids.add(entry.item_id)
    const lines = (entry.details as { lines?: Array<{ sourcePurchaseItemId?: string; sku?: string; purchaseManagementCode?: string | null; requestDate?: string | null }> } | null)?.lines
    for (const line of Array.isArray(lines) ? lines : []) {
      if (line.sourcePurchaseItemId) ids.add(line.sourcePurchaseItemId)
      if (!line.sku?.trim()) continue
      if (line.requestDate) requestDateKeys.add(key(line.requestDate, line.sku))
      if (line.purchaseManagementCode?.trim()) managementKeys.add(key(line.purchaseManagementCode, line.sku))
      else if (entry.supplier_order_number && isUniqueSupplierOrderIdentifier(entry.supplier_order_number)) {
        supplierKeys.add(key(entry.supplier_order_number, line.sku))
      }
    }
  }
  return rows.filter((row) => {
    if (ids.has(row.id)) return false
    if (row.purchaseManagementCode?.trim()) return !managementKeys.has(key(row.purchaseManagementCode, row.sku))
    if (!row.supplierOrderNumber && row.requestDate && requestDateKeys.has(key(row.requestDate, row.sku))) return false
    return !row.supplierOrderNumber || !isUniqueSupplierOrderIdentifier(row.supplierOrderNumber)
      || !supplierKeys.has(key(row.supplierOrderNumber, row.sku))
  })
}

/** Records the amount once in the same transaction as the purchase-completed transition. */
export async function recordPurchaseCompletionInTransaction(tx: DbTransaction, input: {
  userId: string; itemId: string; fallbackExchangeRateKrw: number; occurredOn: string
}) {
  if (input.occurredOn < PURCHASE_FUND_DEBIT_START_DATE) return
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`purchase-fund-ledger:${input.userId}`}))`)
  const [item] = await loadRequestedFundSourceRows(tx, input.userId, input.itemId)
  if (!item || item.status !== 'purchase_completed') return
  const prior = resultRows<{ found: number }>(await tx.execute(sql`
    SELECT 1 AS found FROM purchase_fund_entries f
    WHERE f.user_id = ${input.userId}::uuid AND f.entry_type = 'purchase_debit' AND f.voided_at IS NULL
      AND (f.source_purchase_item_id = ${item.id}::uuid OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(f.details->'lines') = 'array' THEN f.details->'lines' ELSE '[]'::jsonb END) line
        WHERE line->>'sourcePurchaseItemId' = ${item.id}
          OR (line->>'sku' = ${item.sku} AND NULLIF(BTRIM(line->>'purchaseManagementCode'), '') IS NOT NULL
            AND line->>'purchaseManagementCode' = ${item.purchaseManagementCode})
          OR (line->>'sku' = ${item.sku} AND ${!item.purchaseManagementCode?.trim() && !!item.supplierOrderNumber && isUniqueSupplierOrderIdentifier(item.supplierOrderNumber)}
            AND NULLIF(BTRIM(line->>'purchaseManagementCode'), '') IS NULL AND f.supplier_order_number = ${item.supplierOrderNumber})
      )) LIMIT 1
  `))
  if (prior.length) return
  await tx.insert(purchaseFundEntries).values(completionSnapshot(item, input.userId, input.fallbackExchangeRateKrw, input.occurredOn))
    .onConflictDoNothing({ target: [purchaseFundEntries.userId, purchaseFundEntries.sourceKey] })
}

export async function createPurchaseFundCredit(input: {
  userId: string
  createdBy: string
  entryType: PurchaseFundManualEntryType
  occurredOn: string
  amountKrw?: number
  amountCny: number
  memo?: string | null
}) {
  await ensurePurchaseFundLedgerSchema()
  if (!PURCHASE_FUND_MANUAL_ENTRY_TYPES.includes(input.entryType)) {
    throw new Error('지원하지 않는 입금 유형입니다.')
  }
  if (!isDateOnly(input.occurredOn)) throw new Error('입금일이 올바르지 않습니다.')
  const amountKrw = input.amountKrw ?? 0
  if (!Number.isFinite(amountKrw) || amountKrw < 0) {
    throw new Error('입금액(원화)은 0원 이상이어야 합니다.')
  }
  if (!Number.isFinite(input.amountCny) || input.amountCny < 0.01) {
    throw new Error('위안화 입금액은 0.01위안 이상이어야 합니다.')
  }

  const [row] = await db
    .insert(purchaseFundEntries)
    .values({
      userId: input.userId,
      entryType: input.entryType,
      occurredOn: input.occurredOn,
      amountKrw: String(Math.round(amountKrw)),
      amountCny: String(Math.round(input.amountCny * 100) / 100),
      memo: normalizeMemo(input.memo),
      createdBy: input.createdBy,
    })
    .returning({ id: purchaseFundEntries.id })

  return row ?? null
}

export async function voidPurchaseFundCredit(input: {
  userId: string
  voidedBy: string
  entryId: string
}) {
  await ensurePurchaseFundLedgerSchema()
  const [row] = await db
    .update(purchaseFundEntries)
    .set({
      voidedAt: new Date(),
      voidedBy: input.voidedBy,
      updatedAt: new Date(),
    })
    .where(and(
      eq(purchaseFundEntries.userId, input.userId),
      eq(purchaseFundEntries.id, input.entryId),
      inArray(purchaseFundEntries.entryType, [...PURCHASE_FUND_MANUAL_ENTRY_TYPES]),
      isNull(purchaseFundEntries.voidedAt),
    ))
    .returning({ id: purchaseFundEntries.id })

  return row ?? null
}

export async function getPurchaseFundLedgerData(
  userId: string,
  limit = 100,
  fallbackExchangeRateKrw = 0,
): Promise<PurchaseFundLedgerData> {
  await ensurePurchaseFundLedgerSchema()
  const rows = await db
    .select({
      id: purchaseFundEntries.id,
      entryType: purchaseFundEntries.entryType,
      occurredOn: purchaseFundEntries.occurredOn,
      amountKrw: purchaseFundEntries.amountKrw,
      amountCny: purchaseFundEntries.amountCny,
      memo: purchaseFundEntries.memo,
      supplierOrderNumber: purchaseFundEntries.supplierOrderNumber,
      sourcePurchaseItemId: purchaseFundEntries.sourcePurchaseItemId,
      missingCostCount: purchaseFundEntries.missingCostCount,
      details: purchaseFundEntries.details,
      voidedAt: purchaseFundEntries.voidedAt,
      createdAt: purchaseFundEntries.createdAt,
    })
    .from(purchaseFundEntries)
    .where(and(
      eq(purchaseFundEntries.userId, userId),
      isNull(purchaseFundEntries.voidedAt),
    ))
    .orderBy(
      asc(purchaseFundEntries.createdAt),
      asc(purchaseFundEntries.id),
    )
  // The newest opening balance starts a fresh accounting period. This lets a
  // workspace begin with its actual balance today without old source rows
  // being deducted a second time. Created order is intentional: a late raw
  // upload with an older purchase date must still be deducted after the start.
  const latestOpeningBalanceIndex = rows.reduce((latestIndex, row, index) => (
    row.entryType === 'opening_balance' ? index : latestIndex
  ), -1)
  let effectiveRows = (latestOpeningBalanceIndex >= 0
    ? rows.slice(latestOpeningBalanceIndex)
    : rows).filter((row) => (
      row.entryType !== 'purchase_debit'
      || String(row.occurredOn).slice(0, 10) >= PURCHASE_FUND_DEBIT_START_DATE
    ))

  // Include purchase requests as temporary, read-only charges until the existing
  // durable debit represents them. Do not modify the purchase workflow or the
  // saved ledger when calculating the overview.
  const candidateRows = await loadRequestedFundSourceRows(db, userId)
  const openingCreatedAt = latestOpeningBalanceIndex >= 0 ? rows[latestOpeningBalanceIndex].createdAt : null
  const charges = buildRequestedFundCharges(candidateRows, effectiveRows.filter((row) => row.entryType === 'purchase_debit'), fallbackExchangeRateKrw)
    .map((charge) => ({ ...charge, boundary: requestedChargeOpeningBoundary(charge, openingCreatedAt) }))
    .filter((charge) => charge.boundary !== 'exclude')
  const virtualRows = charges.map((charge) => ({
    id: `request:${charge.id}`,
    entryType: 'purchase_debit',
    occurredOn: charge.occurredOn,
    amountKrw: String(charge.boundary === 'uncertain' ? 0 : charge.amountKrw ?? 0),
    amountCny: charge.boundary === 'uncertain' || charge.amountCny === null ? null : String(charge.amountCny),
    memo: charge.boundary === 'uncertain' || charge.ambiguous ? '발주요청 중복 또는 기초잔액 기준 확인 필요' : '발주요청 자동 차감',
    supplierOrderNumber: null,
    sourcePurchaseItemId: charge.id,
    missingCostCount: charge.boundary === 'uncertain' || charge.amountCny === null ? 1 : 0,
    details: { productSummary: charge.productName, lines: [{ sourcePurchaseItemId: charge.id, sku: charge.sku, productName: charge.productName, purchaseManagementCode: charge.purchaseManagementCode, totalCostYuan: charge.boundary === 'uncertain' ? null : charge.amountCny }] },
    voidedAt: null,
    createdAt: new Date(Math.max(new Date(charge.createdAt).getTime(), openingCreatedAt ? openingCreatedAt.getTime() + 1 : 0)),
  }))
  effectiveRows = [...effectiveRows, ...virtualRows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))

  let balanceKrw = 0
  let balanceCny = 0
  let cnyBalanceKnown = true
  let totalDepositedKrw = 0
  let totalDebitedKrw = 0
  let totalDepositedCny = 0
  let totalDebitedCny = 0
  let missingCnyDepositCount = 0
  let missingCostOrderCount = 0
  const timeline: PurchaseFundLedgerData['entries'] = []

  for (const row of effectiveRows) {
    const entryType = normalizeEntryType(row.entryType)
    const amountKrw = numericValue(row.amountKrw)
    const amountCny = nullableNumericValue(row.amountCny)
    const isManualCredit = entryType !== 'purchase_debit'

    if (isManualCredit) {
      totalDepositedKrw += amountKrw
      balanceKrw += amountKrw
      if (amountCny === null) {
        missingCnyDepositCount += 1
        cnyBalanceKnown = false
      } else {
        totalDepositedCny += amountCny
        balanceCny += amountCny
      }
    } else {
      totalDebitedKrw += amountKrw
      balanceKrw -= amountKrw
      if (amountCny === null || row.missingCostCount > 0) {
        cnyBalanceKnown = false
      } else {
        totalDebitedCny += amountCny
        balanceCny -= amountCny
      }
      if (row.missingCostCount > 0) missingCostOrderCount += 1
    }

    timeline.push({
      id: row.id,
      entryType,
      occurredOn: row.occurredOn,
      amountKrw,
      amountCny,
      memo: row.memo,
      detail: ledgerEntryDetail(row),
      balanceKrw: Math.round(balanceKrw),
      balanceCny: cnyBalanceKnown ? Math.round(balanceCny * 100) / 100 : null,
      isManualCredit,
      voidedAt: row.voidedAt?.toISOString() ?? null,
    })
  }

  const cnyDepositsKnown = missingCnyDepositCount === 0
  const cnyDebitsKnown = missingCostOrderCount === 0

  return {
    monthly: summarizeFundMonths(effectiveRows),
    missingDebitItems: effectiveRows
      .filter((row) => row.entryType === 'purchase_debit' && row.missingCostCount > 0)
      .map((row) => {
        const details = row.details ?? {}
        const lines = Array.isArray(details.lines)
          ? details.lines.filter((line): line is Record<string, unknown> => Boolean(line) && typeof line === 'object' && !Array.isArray(line))
          : []
        const incomplete = lines.filter((line) => (
          ('totalCostYuan' in line && line.totalCostYuan == null)
          || ('totalCostKrw' in line && line.totalCostKrw == null)
        ))
        const source = candidateRows.find((item) => item.id === row.sourcePurchaseItemId)
        const products = (incomplete.length ? incomplete : lines).map((line) => ({
          productName: rawString(line.productName) || source?.productName || '상품명 정보 없음',
          sku: rawString(line.sku) || source?.sku || '',
          optionName: rawString(line.optionName) || source?.optionName || '',
        }))
        if (!products.length) products.push({
          productName: rawString(details.productSummary) || source?.productName || '상품명 정보 없음',
          sku: source?.sku || '',
          optionName: source?.optionName || '',
        })
        const reason = row.id.startsWith('request:') && row.memo?.includes('기초잔액')
          ? '기초잔액과 발주 시점의 관계가 확인되지 않아 차감에서 제외되었습니다.'
          : row.amountCny == null
            ? '장부에 위안화 구매금액이 기록되지 않아 차감에서 제외되었습니다.'
            : '장부에 원가 미확인 표시가 있어 차감에서 제외되었습니다.'
        return { id: row.id, occurredOn: row.occurredOn, supplierOrderNumber: row.supplierOrderNumber, reason, products }
      }),
    requestReviewItems: charges.filter((charge) => charge.ambiguous || charge.boundary === 'uncertain').map((charge) => ({
      id: charge.id, occurredOn: charge.occurredOn, sku: charge.sku, productName: charge.productName,
      reason: charge.completedUnverified ? '출고완료 전 기존 차감 기록 확인' : charge.boundary === 'uncertain' ? '기초잔액과 발주요청 시점 확인' : '기존 발주와 중복 여부 확인',
    })),
    summary: {
      totalDepositedKrw: Math.round(totalDepositedKrw),
      totalDebitedKrw: Math.round(totalDebitedKrw),
      balanceKrw: Math.round(balanceKrw),
      totalDepositedCny: cnyDepositsKnown ? Math.round(totalDepositedCny * 100) / 100 : null,
      totalDebitedCny: cnyDebitsKnown ? Math.round(totalDebitedCny * 100) / 100 : null,
      balanceCny: cnyBalanceKnown ? Math.round(balanceCny * 100) / 100 : null,
      knownDepositedCny: Math.round(totalDepositedCny * 100) / 100,
      knownDebitedCny: Math.round(totalDebitedCny * 100) / 100,
      knownBalanceCny: Math.round(balanceCny * 100) / 100,
      missingCnyDepositCount,
      missingCostOrderCount,
    },
    entries: timeline.slice(-Math.max(1, limit)).reverse(),
  }
}

async function loadPurchaseDebitSourceRows(
  executor: DbExecutor,
  userId: string,
  supplierOrderNumber?: string | null,
) {
  const supplierOrderReference = normalizeSupplierOrderReference(supplierOrderNumber)
  const conditions = [
    eq(purchaseRequestItems.userId, userId),
    inArray(purchaseRequestItems.status, [
      'purchase_completed',
      'inspecting',
      'china_arrived',
      'outbound_requested',
      'completed',
    ]),
    sql`NULLIF(BTRIM(COALESCE(${purchaseRequestItems.supplierOrderNumber}, '')), '') IS NOT NULL`,
  ]
  if (supplierOrderReference) {
    conditions.push(sql`BTRIM(COALESCE(${purchaseRequestItems.supplierOrderNumber}, '')) = ${supplierOrderReference}`)
  }

  return executor
    .select({
      id: purchaseRequestItems.id,
      status: purchaseRequestItems.status,
      requestDate: purchaseRequestItems.requestDate,
      outboundExpectedDate: purchaseRequestItems.outboundExpectedDate,
      createdAt: purchaseRequestItems.createdAt,
      sku: purchaseRequestItems.sku,
      productName: purchaseRequestItems.productName,
      optionName: purchaseRequestItems.optionName,
      requestedQuantity: purchaseRequestItems.requestedQuantity,
      actualPurchaseQuantity: purchaseRequestItems.actualPurchaseQuantity,
      purchaseManagementCode: purchaseRequestItems.purchaseManagementCode,
      supplierOrderNumber: purchaseRequestItems.supplierOrderNumber,
      costExchangeRateKrw: purchaseRequestItems.costExchangeRateKrw,
      specialPriceCny: sql<string | null>`NULLIF(${products.metadata}->'esa009m'->>'특가(元)', '')`,
      newCostCny: sql<string | null>`NULLIF(${products.metadata}->'esa009m'->>'신규원가(元)', '')`,
      rawData: purchaseRequestItems.rawData,
    })
    .from(purchaseRequestItems)
    .leftJoin(products, and(
      eq(products.userId, purchaseRequestItems.userId),
      eq(products.internalSku, purchaseRequestItems.sku),
    ))
    .where(and(...conditions)) as Promise<PurchaseFundDebitSourceRow[]>
}

async function loadRequestedFundSourceRows(executor: DbExecutor, userId: string, itemId?: string) {
  return executor.select({
    id: purchaseRequestItems.id,
    status: purchaseRequestItems.status,
    requestDate: purchaseRequestItems.requestDate,
    outboundExpectedDate: purchaseRequestItems.outboundExpectedDate,
    createdAt: purchaseRequestItems.createdAt,
    sku: purchaseRequestItems.sku,
    productName: purchaseRequestItems.productName,
    optionName: purchaseRequestItems.optionName,
    requestedQuantity: purchaseRequestItems.requestedQuantity,
    actualPurchaseQuantity: purchaseRequestItems.actualPurchaseQuantity,
    chinaReceivedAt: purchaseRequestItems.chinaReceivedAt,
    purchaseManagementCode: purchaseRequestItems.purchaseManagementCode,
    supplierOrderNumber: purchaseRequestItems.supplierOrderNumber,
    costExchangeRateKrw: purchaseRequestItems.costExchangeRateKrw,
    specialPriceCny: sql<string | null>`NULLIF(${products.metadata}->'esa009m'->>'특가(元)', '')`,
    newCostCny: sql<string | null>`NULLIF(${products.metadata}->'esa009m'->>'신규원가(元)', '')`,
    rawData: purchaseRequestItems.rawData,
  }).from(purchaseRequestItems).leftJoin(products, and(
    eq(products.userId, purchaseRequestItems.userId),
    eq(products.internalSku, purchaseRequestItems.sku),
  )).where(and(
    eq(purchaseRequestItems.userId, userId),
    inArray(purchaseRequestItems.status, ['purchased', 'purchase_completed', 'inspecting', 'china_arrived', 'outbound_requested', 'completed']),
    ...(itemId ? [eq(purchaseRequestItems.id, itemId)] : []),
  )) as Promise<PurchaseFundDebitSourceRow[]>
}

function purchaseDebitLineKey(row: PurchaseFundDebitSourceRow) {
  const managementCode = normalizeKeyPart(row.purchaseManagementCode)
  const purchaseOrderNumber = normalizeKeyPart(rawString(row.rawData.purchaseOrderNumber))
  const sku = normalizeKeyPart(row.sku)
  const optionName = normalizeKeyPart(row.optionName)
  if (managementCode) return `management:${managementCode}|sku:${sku}|option:${optionName}`
  if (purchaseOrderNumber) return `purchase-order:${purchaseOrderNumber}|sku:${sku}|option:${optionName}`
  return `sku:${sku}|option:${optionName}`
}

function compareDebitSourceRows(left: PurchaseFundDebitSourceRow, right: PurchaseFundDebitSourceRow) {
  const priorityDifference = STATUS_PRIORITY[left.status] - STATUS_PRIORITY[right.status]
  if (priorityDifference !== 0) return priorityDifference
  const quantityDifference = purchaseDebitQuantity(left) - purchaseDebitQuantity(right)
  if (quantityDifference !== 0) return quantityDifference
  return sourceTimestamp(left) - sourceTimestamp(right)
}

function purchaseDebitQuantity(row: PurchaseFundDebitSourceRow) {
  if (row.status === 'outbound_requested' || row.status === 'completed') {
    const purchasedQuantity = wholePositiveNumber(row.rawData.purchasedQuantity)
    if (purchasedQuantity !== null) return purchasedQuantity
  }
  return Math.max(0, Math.trunc(row.actualPurchaseQuantity ?? row.requestedQuantity))
}

function earliestPurchaseDate(rows: PurchaseFundDebitSourceRow[]) {
  const dates = rows
    .map((row) => isDateOnly(row.requestDate) ? row.requestDate : null)
    .filter((value): value is string => Boolean(value))
    .sort()
  if (dates[0]) return dates[0]
  const timestamps = rows.map(sourceTimestamp).filter((value) => Number.isFinite(value))
  const timestamp = timestamps.length > 0 ? Math.min(...timestamps) : Date.now()
  return kstDate(new Date(timestamp))
}

function sourceTimestamp(row: PurchaseFundDebitSourceRow) {
  const value = row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt)
  return Number.isFinite(value.getTime()) ? value.getTime() : 0
}

function ledgerEntryDetail(row: {
  entryType: string
  supplierOrderNumber: string | null
  memo: string | null
  missingCostCount: number
  details: Record<string, unknown>
}) {
  if (row.entryType !== 'purchase_debit') {
    return row.memo?.trim() || (row.entryType === 'opening_balance' ? '기초잔액' : '입금')
  }
  const productSummary = rawString(row.details.productSummary)
  const orderNumber = row.supplierOrderNumber?.trim() || '주문서번호 없음'
  const missing = row.missingCostCount > 0 ? ` · 원가 미확정 ${row.missingCostCount}건` : ''
  return `${orderNumber}${productSummary ? ` · ${productSummary}` : ''}${missing}`
}

function normalizeEntryType(value: string): PurchaseFundEntryType {
  return value === 'deposit' || value === 'opening_balance' || value === 'purchase_debit'
    ? value
    : 'purchase_debit'
}

function normalizeKeyPart(value: string | null | undefined) {
  return value?.trim().replace(/\s+/g, ' ') ?? ''
}

function normalizeMemo(value: string | null | undefined) {
  const memo = value?.trim()
  return memo ? memo.slice(0, 500) : null
}

function rawString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function numericValue(value: string | number | null | undefined) {
  const number = Number(value ?? 0)
  return Number.isFinite(number) ? number : 0
}

function nullableNumericValue(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function wholePositiveNumber(value: unknown) {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : null
}

function isDateOnly(value: string | null | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value))
}

function kstDate(value = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value)
}

function chunks<T>(values: T[], size: number) {
  const result: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size))
  }
  return result
}

