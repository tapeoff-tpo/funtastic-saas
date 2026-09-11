import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  products,
  purchaseFundEntries,
  purchaseRequestItems,
} from '@/lib/db/schema'
import { calculatePurchaseCosts } from './purchase-costs'
import { ensurePurchasePaymentTrackingSchema } from './purchase-payment-tracking'
import type { PurchaseRequestStatus } from './purchase-request-status'

export const PURCHASE_FUND_MANUAL_ENTRY_TYPES = ['deposit', 'opening_balance'] as const

export type PurchaseFundManualEntryType = (typeof PURCHASE_FUND_MANUAL_ENTRY_TYPES)[number]
export type PurchaseFundEntryType = PurchaseFundManualEntryType | 'purchase_debit'

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
  summary: {
    totalDepositedKrw: number
    totalDebitedKrw: number
    balanceKrw: number
    totalDepositedCny: number | null
    totalDebitedCny: number | null
    balanceCny: number | null
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
  china_arrived: 30,
  outbound_requested: 40,
  completed: 50,
}

let ensureSchemaPromise: Promise<void> | null = null

export function ensurePurchaseFundLedgerSchema() {
  ensureSchemaPromise ??= (async () => {
    await ensurePurchasePaymentTrackingSchema()
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
 * management-code/SKU before the order total is calculated.
 */
export function buildPurchaseDebitSnapshots(
  rows: PurchaseFundDebitSourceRow[],
  fallbackExchangeRateKrw: number,
): PurchaseFundDebitSnapshot[] {
  const rowsByOrder = new Map<string, PurchaseFundDebitSourceRow[]>()

  for (const row of rows) {
    const orderNumber = normalizeKeyPart(row.supplierOrderNumber)
    if (!orderNumber) continue
    const values = rowsByOrder.get(orderNumber) ?? []
    values.push(row)
    rowsByOrder.set(orderNumber, values)
  }

  return [...rowsByOrder.entries()].map(([supplierOrderNumber, orderRows]) => {
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
    const occurredOn = earliestPurchaseDate(orderRows)
    const productNames = [...new Set(lines.map((line) => line.productName).filter(Boolean))]

    return {
      sourceKey: `supplier-order:${supplierOrderNumber}`,
      supplierOrderNumber,
      sourcePurchaseItemId: selectedSource.id,
      occurredOn,
      amountKrw: Math.round(amountKrw),
      amountCny: lines.every((line) => line.totalCostYuan === null)
        ? null
        : Math.round(knownAmountCny * 100) / 100,
      missingCostCount,
      details: {
        schemaVersion: 1,
        lineCount: lines.length,
        productSummary: productNames.length <= 2
          ? productNames.join(', ')
          : `${productNames.slice(0, 2).join(', ')} 외 ${productNames.length - 2}개`,
        lines,
      },
    }
  }).sort((left, right) => (
    left.occurredOn.localeCompare(right.occurredOn)
      || left.supplierOrderNumber.localeCompare(right.supplierOrderNumber)
  ))
}

export async function reconcilePurchaseFundDebits(input: {
  userId: string
  fallbackExchangeRateKrw: number
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
  if (Number(existing?.count ?? 0) > 0) return { reconciledOrderCount: 0, backfilled: false }

  const result = await reconcilePurchaseFundDebits(input)
  return { ...result, backfilled: true }
}

export async function reconcilePurchaseFundDebitsInTransaction(
  tx: DbTransaction,
  input: { userId: string; fallbackExchangeRateKrw: number },
) {
  const rows = await loadPurchaseDebitSourceRows(tx, input.userId)
  const snapshots = buildPurchaseDebitSnapshots(rows, input.fallbackExchangeRateKrw)

  for (const values of chunks(snapshots, 250)) {
    await tx
      .insert(purchaseFundEntries)
      .values(values.map((snapshot) => ({
        userId: input.userId,
        entryType: 'purchase_debit',
        occurredOn: snapshot.occurredOn,
        amountKrw: String(snapshot.amountKrw),
        amountCny: snapshot.amountCny === null ? null : String(snapshot.amountCny),
        memo: '주문서번호 생성에 따른 자동 발주 차감',
        sourceKey: snapshot.sourceKey,
        supplierOrderNumber: snapshot.supplierOrderNumber,
        sourcePurchaseItemId: snapshot.sourcePurchaseItemId,
        missingCostCount: snapshot.missingCostCount,
        details: snapshot.details,
        updatedAt: new Date(),
      })))
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
          updatedAt: new Date(),
        },
      })
  }

  return { reconciledOrderCount: snapshots.length }
}

export async function createPurchaseFundCredit(input: {
  userId: string
  createdBy: string
  entryType: PurchaseFundManualEntryType
  occurredOn: string
  amountKrw: number
  amountCny?: number | null
  memo?: string | null
}) {
  await ensurePurchaseFundLedgerSchema()
  if (!PURCHASE_FUND_MANUAL_ENTRY_TYPES.includes(input.entryType)) {
    throw new Error('지원하지 않는 입금 유형입니다.')
  }
  if (!isDateOnly(input.occurredOn)) throw new Error('입금일이 올바르지 않습니다.')
  if (!Number.isFinite(input.amountKrw) || input.amountKrw <= 0) {
    throw new Error('입금액은 0원보다 커야 합니다.')
  }
  if (input.amountCny !== undefined && input.amountCny !== null
    && (!Number.isFinite(input.amountCny) || input.amountCny <= 0)) {
    throw new Error('위안화 입금액은 0보다 커야 합니다.')
  }

  const [row] = await db
    .insert(purchaseFundEntries)
    .values({
      userId: input.userId,
      entryType: input.entryType,
      occurredOn: input.occurredOn,
      amountKrw: String(Math.round(input.amountKrw)),
      amountCny: input.amountCny === undefined || input.amountCny === null
        ? null
        : String(Math.round(input.amountCny * 100) / 100),
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
  const effectiveRows = latestOpeningBalanceIndex >= 0
    ? rows.slice(latestOpeningBalanceIndex)
    : rows

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
    summary: {
      totalDepositedKrw: Math.round(totalDepositedKrw),
      totalDebitedKrw: Math.round(totalDebitedKrw),
      balanceKrw: Math.round(balanceKrw),
      totalDepositedCny: cnyDepositsKnown ? Math.round(totalDepositedCny * 100) / 100 : null,
      totalDebitedCny: cnyDebitsKnown ? Math.round(totalDebitedCny * 100) / 100 : null,
      balanceCny: cnyBalanceKnown ? Math.round(balanceCny * 100) / 100 : null,
      missingCnyDepositCount,
      missingCostOrderCount,
    },
    entries: timeline.slice(-Math.max(1, limit)).reverse(),
  }
}

async function loadPurchaseDebitSourceRows(executor: DbExecutor, userId: string) {
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
    .where(and(
      eq(purchaseRequestItems.userId, userId),
      sql`NULLIF(BTRIM(COALESCE(${purchaseRequestItems.supplierOrderNumber}, '')), '') IS NOT NULL`,
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
