import { createHash, randomUUID } from 'node:crypto'
import { and, count, desc, eq, gte, inArray, isNull, lte, sql, type SQL } from 'drizzle-orm'
import { db } from '@/lib/db'
import { chinaFundStatementEntries } from '@/lib/db/schema'

export const CHINA_FUND_STATEMENT_DIRECTIONS = ['china_advance', 'our_remittance'] as const

export type ChinaFundStatementDirection = (typeof CHINA_FUND_STATEMENT_DIRECTIONS)[number]

export type ChinaFundStatementInputRow = {
  occurredOn: string
  signedAmountCny: number
  balanceAfterCny: number
  memo?: string | null
}

export type ChinaFundStatementEntry = {
  id: string
  importBatchId: string
  occurredOn: string
  sequence: number
  direction: ChinaFundStatementDirection
  signedAmountCny: number
  balanceAfterCny: number
  sourceLabel: string | null
  memo: string | null
  createdAt: string
}

export type ChinaFundStatementList = {
  entries: ChinaFundStatementEntry[]
  total: number
  hasMore: boolean
  page: number
  pageSize: number
  totalPages: number
  latestImportBatchId: string | null
  currentBalanceCny: number | null
  currentBalanceAsOf: string | null
  periodAdvanceCny: number
  periodRemittanceCny: number
}

let ensureSchemaPromise: Promise<void> | null = null

export function ensureChinaFundStatementSchema() {
  ensureSchemaPromise ??= (async () => {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS china_fund_statement_entries (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL,
        import_batch_id uuid NOT NULL,
        occurred_on date NOT NULL,
        sequence integer NOT NULL CHECK (sequence >= 0),
        direction varchar(30) NOT NULL CHECK (
          direction IN ('china_advance', 'our_remittance')
        ),
        signed_amount_cny numeric(16, 2) NOT NULL CHECK (signed_amount_cny <> 0),
        balance_after_cny numeric(16, 2) NOT NULL,
        source_key varchar(255) NOT NULL,
        source_label text,
        memo text,
        raw_data jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_by uuid,
        voided_at timestamptz,
        voided_by uuid,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `)
    await db.execute(sql`DROP INDEX IF EXISTS china_fund_statement_entries_user_source_key`)
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS china_fund_statement_entries_user_active_source_key
      ON china_fund_statement_entries(user_id, source_key)
      WHERE voided_at IS NULL
    `)
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS china_fund_statement_entries_user_date_created_sequence
      ON china_fund_statement_entries(user_id, occurred_on, created_at, sequence)
    `)
    await db.execute(sql`ALTER TABLE china_fund_statement_entries ENABLE ROW LEVEL SECURITY`)
    await db.execute(sql`REVOKE ALL ON TABLE china_fund_statement_entries FROM anon, authenticated`)
  })().catch((error) => {
    ensureSchemaPromise = null
    throw error
  })

  return ensureSchemaPromise
}

export async function importChinaFundStatementEntries(input: {
  userId: string
  createdBy: string
  sourceLabel?: string | null
  entries: ChinaFundStatementInputRow[]
}) {
  await ensureChinaFundStatementSchema()
  const entries = normalizeStatementEntries(input.entries)
  const importBatchId = randomUUID()
  const sourceLabel = normalizeText(input.sourceLabel, 200)
  const tupleCounts = new Map<string, number>()
  const values = entries.map((entry, sequence) => {
    const tuple = [
      entry.occurredOn,
      fixedCny(entry.signedAmountCny),
      fixedCny(entry.balanceAfterCny),
    ].join('|')
    const occurrence = (tupleCounts.get(tuple) ?? 0) + 1
    tupleCounts.set(tuple, occurrence)
    const sourceKey = `china-statement:${createHash('sha256')
      .update(`${tuple}|${occurrence}`)
      .digest('hex')}`

    return {
      userId: input.userId,
      importBatchId,
      occurredOn: entry.occurredOn,
      sequence,
      direction: entry.signedAmountCny > 0 ? 'china_advance' : 'our_remittance',
      signedAmountCny: fixedCny(entry.signedAmountCny),
      balanceAfterCny: fixedCny(entry.balanceAfterCny),
      sourceKey,
      sourceLabel,
      memo: normalizeText(entry.memo, 500),
      rawData: {
        originalSignedAmountCny: entry.signedAmountCny,
        originalBalanceAfterCny: entry.balanceAfterCny,
      },
      createdBy: input.createdBy,
    } as const
  })

  return db.transaction(async (tx) => {
    await tx.execute(sql`
      SELECT pg_advisory_xact_lock(hashtext(${`china-fund-statement:${input.userId}`}))
    `)
    const existingKeys = await tx
      .select({ sourceKey: chinaFundStatementEntries.sourceKey })
      .from(chinaFundStatementEntries)
      .where(and(
        eq(chinaFundStatementEntries.userId, input.userId),
        isNull(chinaFundStatementEntries.voidedAt),
        inArray(chinaFundStatementEntries.sourceKey, values.map((value) => value.sourceKey)),
      ))
    const duplicateKeys = new Set(existingKeys.map((row) => row.sourceKey))
    const newValues = values.filter((value) => !duplicateKeys.has(value.sourceKey))

    const [latest] = await tx
      .select({
        occurredOn: chinaFundStatementEntries.occurredOn,
        balanceAfterCny: chinaFundStatementEntries.balanceAfterCny,
      })
      .from(chinaFundStatementEntries)
      .where(and(
        eq(chinaFundStatementEntries.userId, input.userId),
        isNull(chinaFundStatementEntries.voidedAt),
      ))
      .orderBy(
        desc(chinaFundStatementEntries.occurredOn),
        desc(chinaFundStatementEntries.createdAt),
        desc(chinaFundStatementEntries.sequence),
      )
      .limit(1)

    if (newValues.length > 0 && latest) {
      const first = newValues[0]!
      if (first.occurredOn < latest.occurredOn) {
        throw new Error(
          `기존 최신 내역은 ${latest.occurredOn}입니다. 과거 내역을 수정하려면 먼저 가장 최근 입력 묶음을 취소해주세요.`,
        )
      }
      const previousBalance = numericValue(latest.balanceAfterCny)
      const inferredOpeningBalance = roundedCny(
        Number(first.balanceAfterCny) - Number(first.signedAmountCny),
      )
      if (Math.abs(previousBalance - inferredOpeningBalance) > 0.011) {
        throw new Error(
          `기존 총합 ${fixedCny(previousBalance)}元과 새 내역의 시작 총합 ${fixedCny(inferredOpeningBalance)}元이 이어지지 않습니다.`,
        )
      }
    }

    const inserted = newValues.length === 0
      ? []
      : await tx
        .insert(chinaFundStatementEntries)
        .values(newValues)
        .onConflictDoNothing({
          target: [chinaFundStatementEntries.userId, chinaFundStatementEntries.sourceKey],
          where: sql`${chinaFundStatementEntries.voidedAt} IS NULL`,
        })
        .returning({ id: chinaFundStatementEntries.id })

    return {
      importBatchId,
      receivedCount: values.length,
      insertedCount: inserted.length,
      duplicateCount: values.length - inserted.length,
    }
  })
}

export async function voidLatestChinaFundStatementBatch(input: {
  userId: string
  voidedBy: string
  importBatchId: string
}) {
  await ensureChinaFundStatementSchema()
  return db.transaction(async (tx) => {
    await tx.execute(sql`
      SELECT pg_advisory_xact_lock(hashtext(${`china-fund-statement:${input.userId}`}))
    `)
    const [latest] = await tx
      .select({ importBatchId: chinaFundStatementEntries.importBatchId })
      .from(chinaFundStatementEntries)
      .where(and(
        eq(chinaFundStatementEntries.userId, input.userId),
        isNull(chinaFundStatementEntries.voidedAt),
      ))
      .orderBy(
        desc(chinaFundStatementEntries.occurredOn),
        desc(chinaFundStatementEntries.createdAt),
        desc(chinaFundStatementEntries.sequence),
      )
      .limit(1)

    if (!latest) throw new Error('취소할 중국 입금내역이 없습니다.')
    if (latest.importBatchId !== input.importBatchId) {
      throw new Error('원장 연결을 보호하기 위해 가장 최근에 입력한 묶음부터 취소할 수 있습니다.')
    }

    const rows = await tx
      .update(chinaFundStatementEntries)
      .set({
        voidedAt: new Date(),
        voidedBy: input.voidedBy,
        updatedAt: new Date(),
      })
      .where(and(
        eq(chinaFundStatementEntries.userId, input.userId),
        eq(chinaFundStatementEntries.importBatchId, input.importBatchId),
        isNull(chinaFundStatementEntries.voidedAt),
      ))
      .returning({ id: chinaFundStatementEntries.id })

    return { voidedCount: rows.length }
  })
}

export async function getChinaFundStatementEntries(input: {
  userId: string
  from?: string | null
  to?: string | null
  limit?: number
  page?: number
}): Promise<ChinaFundStatementList> {
  await ensureChinaFundStatementSchema()
  validateDateRange(input.from, input.to)
  const limit = Math.min(500, Math.max(1, Math.trunc(input.limit ?? 100)))
  const page = Math.max(1, Math.trunc(input.page ?? 1))
  const conditions: SQL[] = [
    eq(chinaFundStatementEntries.userId, input.userId),
    isNull(chinaFundStatementEntries.voidedAt),
  ]
  if (input.from) conditions.push(gte(chinaFundStatementEntries.occurredOn, input.from))
  if (input.to) conditions.push(lte(chinaFundStatementEntries.occurredOn, input.to))
  const where = and(...conditions)
  const activeWhere = and(
    eq(chinaFundStatementEntries.userId, input.userId),
    isNull(chinaFundStatementEntries.voidedAt),
  )

  const [rows, [totals], [latest]] = await Promise.all([
    db
      .select({
        id: chinaFundStatementEntries.id,
        importBatchId: chinaFundStatementEntries.importBatchId,
        occurredOn: chinaFundStatementEntries.occurredOn,
        sequence: chinaFundStatementEntries.sequence,
        direction: chinaFundStatementEntries.direction,
        signedAmountCny: chinaFundStatementEntries.signedAmountCny,
        balanceAfterCny: chinaFundStatementEntries.balanceAfterCny,
        sourceLabel: chinaFundStatementEntries.sourceLabel,
        memo: chinaFundStatementEntries.memo,
        createdAt: chinaFundStatementEntries.createdAt,
      })
      .from(chinaFundStatementEntries)
      .where(where)
      .orderBy(
        desc(chinaFundStatementEntries.occurredOn),
        desc(chinaFundStatementEntries.createdAt),
        desc(chinaFundStatementEntries.sequence),
      )
      .limit(limit)
      .offset((page - 1) * limit),
    db
      .select({
        total: count(),
        advanceCny: sql<number>`COALESCE(SUM(CASE WHEN ${chinaFundStatementEntries.signedAmountCny} > 0 THEN ${chinaFundStatementEntries.signedAmountCny} ELSE 0 END), 0)`,
        remittanceCny: sql<number>`COALESCE(SUM(CASE WHEN ${chinaFundStatementEntries.signedAmountCny} < 0 THEN -${chinaFundStatementEntries.signedAmountCny} ELSE 0 END), 0)`,
      })
      .from(chinaFundStatementEntries)
      .where(where),
    db
      .select({
        occurredOn: chinaFundStatementEntries.occurredOn,
        balanceAfterCny: chinaFundStatementEntries.balanceAfterCny,
        importBatchId: chinaFundStatementEntries.importBatchId,
      })
      .from(chinaFundStatementEntries)
      .where(activeWhere)
      .orderBy(
        desc(chinaFundStatementEntries.occurredOn),
        desc(chinaFundStatementEntries.createdAt),
        desc(chinaFundStatementEntries.sequence),
      )
      .limit(1),
  ])

  const total = numericValue(totals?.total)
  const totalPages = Math.max(1, Math.ceil(total / limit))
  return {
    entries: rows.map((row) => ({
      id: row.id,
      importBatchId: row.importBatchId,
      occurredOn: row.occurredOn,
      sequence: row.sequence,
      direction: normalizeDirection(row.direction),
      signedAmountCny: numericValue(row.signedAmountCny),
      balanceAfterCny: numericValue(row.balanceAfterCny),
      sourceLabel: row.sourceLabel,
      memo: row.memo,
      createdAt: row.createdAt.toISOString(),
    })),
    total,
    hasMore: page < totalPages,
    page,
    pageSize: limit,
    totalPages,
    latestImportBatchId: latest?.importBatchId ?? null,
    currentBalanceCny: latest ? numericValue(latest.balanceAfterCny) : null,
    currentBalanceAsOf: latest?.occurredOn ?? null,
    periodAdvanceCny: numericValue(totals?.advanceCny),
    periodRemittanceCny: numericValue(totals?.remittanceCny),
  }
}

export function normalizeStatementEntries(entries: ChinaFundStatementInputRow[]) {
  if (entries.length === 0) throw new Error('저장할 중국 입금내역이 없습니다.')
  if (entries.length > 500) throw new Error('중국 입금내역은 한 번에 최대 500건까지 저장할 수 있습니다.')

  const normalized = entries.map((entry, index) => {
    if (!isCalendarDate(entry.occurredOn)) {
      throw new Error(`${index + 1}행의 날짜가 올바르지 않습니다.`)
    }
    if (!Number.isFinite(entry.signedAmountCny) || entry.signedAmountCny === 0) {
      throw new Error(`${index + 1}행의 금액은 0이 아닌 숫자여야 합니다.`)
    }
    if (!Number.isFinite(entry.balanceAfterCny)) {
      throw new Error(`${index + 1}행의 총합이 올바르지 않습니다.`)
    }
    return {
      occurredOn: entry.occurredOn,
      signedAmountCny: roundedCny(entry.signedAmountCny),
      balanceAfterCny: roundedCny(entry.balanceAfterCny),
      memo: entry.memo ?? null,
    }
  })

  for (let index = 1; index < normalized.length; index += 1) {
    const previous = normalized[index - 1]!
    const current = normalized[index]!
    if (current.occurredOn < previous.occurredOn) {
      throw new Error(`${index + 1}행의 날짜가 앞 행보다 이전입니다. 날짜순으로 붙여넣어주세요.`)
    }
    const expected = roundedCny(previous.balanceAfterCny + current.signedAmountCny)
    if (Math.abs(expected - current.balanceAfterCny) > 0.011) {
      throw new Error(
        `${index + 1}행의 총합이 맞지 않습니다. ${fixedCny(previous.balanceAfterCny)} + ${fixedCny(current.signedAmountCny)} = ${fixedCny(expected)}이어야 합니다.`,
      )
    }
  }

  return normalized
}

function normalizeDirection(value: string): ChinaFundStatementDirection {
  return value === 'our_remittance' ? 'our_remittance' : 'china_advance'
}

function validateDateRange(from?: string | null, to?: string | null) {
  if (from && !isCalendarDate(from)) throw new Error('조회 시작일이 올바르지 않습니다.')
  if (to && !isCalendarDate(to)) throw new Error('조회 종료일이 올바르지 않습니다.')
  if (from && to && from > to) throw new Error('조회 시작일은 종료일보다 늦을 수 없습니다.')
}

function isCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
}

function roundedCny(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function fixedCny(value: number) {
  return roundedCny(value).toFixed(2)
}

function numericValue(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function normalizeText(value: string | null | undefined, limit: number) {
  const normalized = value?.trim()
  return normalized ? normalized.slice(0, limit) : null
}
