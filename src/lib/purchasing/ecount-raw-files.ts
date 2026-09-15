import ExcelJS from 'exceljs'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  readEcountPurchasingRawFileRows,
  type EcountPurchasingUpload,
  type EcountReportKind,
} from './ecount-purchasing-sync'

export type StoredEcountRawFile = EcountPurchasingUpload & {
  kind: EcountReportKind
  updatedAt: string
}

export type StoredEcountRawFileState = Partial<Record<EcountReportKind, {
  fileName: string
  updatedAt: string
}>>

const KINDS: EcountReportKind[] = [
  'purchaseRequest',
  'purchasePlan',
  'purchaseHistory',
  'chinaInventory',
  'chinaOutbound',
]

const INCREMENTAL_HISTORY_KINDS: EcountReportKind[] = [
  'purchaseRequest',
  'purchasePlan',
  'purchaseHistory',
  'chinaOutbound',
]

export function isIncrementalEcountRawFile(kind: EcountReportKind) {
  return INCREMENTAL_HISTORY_KINDS.includes(kind)
}

/**
 * Keeps the historical purchasing reports server-side. New files can therefore
 * contain only the new period, while overlap rows refresh existing records.
 */
export async function mergeEcountRawFiles(
  storedFiles: StoredEcountRawFile[],
  incomingFiles: StoredEcountRawFile[],
): Promise<StoredEcountRawFile[]> {
  const storedByKind = new Map(storedFiles.map((file) => [file.kind, file]))
  return Promise.all(incomingFiles.map(async (incoming) => {
    const stored = storedByKind.get(incoming.kind)
    if (!stored || !isIncrementalEcountRawFile(incoming.kind)) return incoming

    const [existingReport, incomingReport] = await Promise.all([
      readEcountPurchasingRawFileRows(stored),
      readEcountPurchasingRawFileRows(incoming),
    ])
    if (existingReport.kind !== incoming.kind || incomingReport.kind !== incoming.kind) return incoming

    const headers = mergeHeaders(existingReport.headers, incomingReport.headers)
    const rows = incoming.kind === 'chinaOutbound'
      ? mergeChinaOutboundRows(existingReport.rows, incomingReport.rows)
      : mergeRowsByIdentity(incoming.kind, existingReport.rows, incomingReport.rows)

    return {
      ...incoming,
      fileBuffer: await buildWorkbookBuffer(headers, rows),
    }
  }))
}

/**
 * Returns only rows that were not already held in the accumulated raw file.
 * This is used for the short period between a purchase-history update and the
 * next China-inventory snapshot; existing history must not be reintroduced as
 * a new in-progress purchase just because its workbook is uploaded again.
 */
export async function getNewIncrementalEcountRawRows(
  storedFiles: StoredEcountRawFile[],
  incomingFiles: StoredEcountRawFile[],
  kind: EcountReportKind,
) {
  const incoming = incomingFiles.find((file) => file.kind === kind)
  if (!incoming) return []

  const incomingReport = await readEcountPurchasingRawFileRows(incoming)
  const stored = storedFiles.find((file) => file.kind === kind)
  if (!stored || !isIncrementalEcountRawFile(kind)) return incomingReport.rows

  const storedReport = await readEcountPurchasingRawFileRows(stored)
  const identity = kind === 'chinaOutbound'
    ? getChinaOutboundStableGroupIdentity
    : (row: Record<string, string>) => getEcountRawRowIdentity(kind, row)
  const storedIdentities = new Set(storedReport.rows.map(identity))
  return incomingReport.rows.filter((row) => (
    !storedIdentities.has(identity(row))
  ))
}

async function ensureTable() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS purchasing_ecount_raw_files (
      user_id uuid NOT NULL,
      report_kind text NOT NULL,
      file_name text NOT NULL,
      file_data bytea NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, report_kind),
      CHECK (report_kind IN ('purchaseRequest', 'purchasePlan', 'purchaseHistory', 'chinaInventory', 'chinaOutbound'))
    )
  `)
}

export async function getStoredEcountRawFiles(userId: string): Promise<StoredEcountRawFile[]> {
  await ensureTable()
  const result = await db.execute<{
    kind: string
    fileName: string
    fileBase64: string
    updatedAt: string
  }>(sql`
    SELECT
      report_kind AS "kind",
      file_name AS "fileName",
      encode(file_data, 'base64') AS "fileBase64",
      updated_at::text AS "updatedAt"
    FROM purchasing_ecount_raw_files
    WHERE user_id = ${userId}::uuid
  `)
  const rows = Array.isArray(result)
    ? result
    : ((result as unknown as { rows?: Array<{
      kind: string
      fileName: string
      fileBase64: string
      updatedAt: string
    }> }).rows ?? [])
  return rows
    .filter((row): row is typeof row & { kind: EcountReportKind } => KINDS.includes(row.kind as EcountReportKind))
    .map((row) => ({
      kind: row.kind,
      fileName: row.fileName,
      fileBuffer: Uint8Array.from(Buffer.from(row.fileBase64, 'base64')).buffer,
      updatedAt: row.updatedAt,
    }))
}

export async function getStoredEcountRawFileState(userId: string): Promise<StoredEcountRawFileState> {
  await ensureTable()
  const result = await db.execute<{ kind: string; fileName: string; updatedAt: string }>(sql`
    SELECT report_kind AS "kind", file_name AS "fileName", updated_at::text AS "updatedAt"
    FROM purchasing_ecount_raw_files
    WHERE user_id = ${userId}::uuid
  `)
  const rows = Array.isArray(result)
    ? result
    : ((result as unknown as { rows?: Array<{ kind: string; fileName: string; updatedAt: string }> }).rows ?? [])
  return Object.fromEntries(rows
    .filter((row) => KINDS.includes(row.kind as EcountReportKind))
    .map((row) => [row.kind, { fileName: row.fileName, updatedAt: row.updatedAt }]))
}

export async function saveStoredEcountRawFiles(userId: string, files: StoredEcountRawFile[]) {
  if (files.length === 0) return
  await ensureTable()
  await db.transaction(async (tx) => {
    for (const file of files) {
      const base64 = Buffer.from(file.fileBuffer).toString('base64')
      await tx.execute(sql`
        INSERT INTO purchasing_ecount_raw_files (user_id, report_kind, file_name, file_data, updated_at)
        VALUES (${userId}::uuid, ${file.kind}, ${file.fileName}, decode(${base64}, 'base64'), now())
        ON CONFLICT (user_id, report_kind) DO UPDATE SET
          file_name = EXCLUDED.file_name,
          file_data = EXCLUDED.file_data,
          updated_at = now()
      `)
    }
  })
}

export function summarizeStoredEcountRawFiles(files: StoredEcountRawFile[]): StoredEcountRawFileState {
  return Object.fromEntries(files.map((file) => [file.kind, {
    fileName: file.fileName,
    updatedAt: file.updatedAt,
  }])) as Partial<Record<EcountReportKind, { fileName: string; updatedAt: string }>>
}

function mergeHeaders(existing: string[], incoming: string[]) {
  const headers = [...existing]
  const seen = new Set(headers)
  for (const header of incoming) {
    if (!seen.has(header)) {
      headers.push(header)
      seen.add(header)
    }
  }
  return headers
}

function mergeRowsByIdentity(
  kind: EcountReportKind,
  existingRows: Array<Record<string, string>>,
  incomingRows: Array<Record<string, string>>,
) {
  const rowsByIdentity = new Map<string, Record<string, string>>()
  for (const row of existingRows) rowsByIdentity.set(getEcountRawRowIdentity(kind, row), row)
  for (const row of incomingRows) rowsByIdentity.set(getEcountRawRowIdentity(kind, row), row)
  return [...rowsByIdentity.values()]
}

/**
 * A China-outbound voucher can legitimately contain more than one physical
 * line for the same SKU (for example split quantities or different options).
 * Treating the voucher+SKU itself as a row identity would silently discard
 * those lines. Instead, an incoming voucher group replaces the complete
 * stored group, and only canonical formatting twins inside the selected group
 * are collapsed by the more detailed physical-row identity.
 */
function mergeChinaOutboundRows(
  existingRows: Array<Record<string, string>>,
  incomingRows: Array<Record<string, string>>,
) {
  const groups = groupChinaOutboundRows(existingRows)
  for (const [groupIdentity, rows] of groupChinaOutboundRows(incomingRows)) {
    groups.set(groupIdentity, rows)
  }
  return [...groups.values()].flatMap((rows) => (
    mergeRowsByIdentity('chinaOutbound', [], rows)
  ))
}

function groupChinaOutboundRows(rows: Array<Record<string, string>>) {
  const groups = new Map<string, Array<Record<string, string>>>()
  for (const row of rows) {
    const identity = getChinaOutboundStableGroupIdentity(row)
    const group = groups.get(identity) ?? []
    group.push(row)
    groups.set(identity, group)
  }
  return groups
}

function getChinaOutboundStableGroupIdentity(row: Record<string, string>) {
  const value = (...headers: string[]) => (
    headers.map((header) => row[header]?.trim() ?? '').find((candidate) => candidate !== '') ?? ''
  )
  const sku = canonicalIdentifier(value('품목코드'))
  const outboundCode = canonicalEcountCode(value('출고관리코드'))
  if (outboundCode && sku) return `chinaOutbound:outbound-group:${outboundCode}:${sku}`

  const dateNo = canonicalEcountDateNo(value('일자-No.'))
  if (dateNo && sku) return `chinaOutbound:date-no-group:${dateNo}:${sku}`

  // Malformed/footer rows without a voucher key must not all replace each
  // other. Their physical identity is the safest available group boundary.
  return `chinaOutbound:physical-group:${getEcountRawRowIdentity('chinaOutbound', row)}`
}

export function getEcountRawRowIdentity(kind: EcountReportKind, row: Record<string, string>) {
  const value = (...headers: string[]) => (
    headers.map((header) => row[header]?.trim() ?? '').find((candidate) => candidate !== '') ?? ''
  )
  const sku = canonicalIdentifier(value('품목코드'))
  const dateNo = canonicalEcountDateNo(value('일자-No.'))
  const option = canonicalText(value('규격', '옵션명'))

  if (kind === 'chinaOutbound') {
    const outboundCode = canonicalEcountCode(value('출고관리코드'))
    if (outboundCode && sku) return `${kind}:outbound:${[
      outboundCode,
      dateNo,
      sku,
      option,
      canonicalIdentifier(value('구입관리코드')),
      canonicalIdentifier(value('주문서번호')),
      canonicalEcountDate(value('유효기간')),
      canonicalNumericValue(value('출고수량(EA)')),
    ].join('\u001f')}`
    return `${kind}:row:${[
      dateNo,
      sku,
      option,
      canonicalIdentifier(value('구입관리코드')),
      canonicalIdentifier(value('주문서번호')),
      canonicalEcountDate(value('유효기간')),
      canonicalNumericValue(value('출고수량(EA)')),
    ].join('\u001f')}`
  }

  if (kind === 'purchaseHistory') {
    return `${kind}:row:${[
      dateNo,
      sku,
      option,
      canonicalIdentifier(value('구입관리코드')),
      canonicalIdentifier(value('발주서-no')),
      canonicalIdentifier(value('주문서번호 (C)')),
    ].join('\u001f')}`
  }

  return `${kind}:row:${[
    dateNo,
    sku,
    option,
    canonicalIdentifier(value('구입관리코드')),
  ].join('\u001f')}`
}

/**
 * Ecount exports the same identifier with harmless display differences (for
 * example `20260721-2` and `20260721 -2`). Identities are canonicalized only
 * for comparison; the newest original row is still retained in the workbook.
 */
function canonicalIdentifier(value: string) {
  return canonicalText(value)
    .replace(/[‐‑‒–—−]/g, '-')
    .replace(/[\s\u200B-\u200D\uFEFF]+/g, '')
    .toUpperCase()
}

function canonicalText(value: string) {
  return value
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function canonicalEcountDateNo(value: string) {
  const compact = canonicalIdentifier(value)
  const matched = compact.match(/^(20\d{2})[-./]?(\d{2})[-./]?(\d{2})(?:[-.:/#]0*(\d+))?$/)
  if (!matched) return compact
  const [, year, month, day, sequence] = matched
  if (!isValidDateParts(year, month, day)) return compact
  return `${year}${month}${day}${sequence ? `-${Number(sequence)}` : ''}`
}

function canonicalEcountCode(value: string) {
  return canonicalEcountDateNo(value)
}

function canonicalEcountDate(value: string) {
  const normalized = canonicalText(value)
  const matched = normalized.match(/^(20\d{2})\D*(\d{1,2})\D*(\d{1,2})(?:\D.*)?$/)
  if (!matched) return canonicalIdentifier(value)
  const [, year, rawMonth, rawDay] = matched
  const month = rawMonth.padStart(2, '0')
  const day = rawDay.padStart(2, '0')
  return isValidDateParts(year, month, day)
    ? `${year}-${month}-${day}`
    : canonicalIdentifier(value)
}

function canonicalNumericValue(value: string) {
  const normalized = canonicalText(value).replace(/[\s,]/g, '')
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(normalized)) {
    return canonicalIdentifier(value)
  }
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? String(Object.is(parsed, -0) ? 0 : parsed) : canonicalIdentifier(value)
}

function isValidDateParts(year: string, month: string, day: string) {
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
  return parsed.getUTCFullYear() === Number(year)
    && parsed.getUTCMonth() === Number(month) - 1
    && parsed.getUTCDate() === Number(day)
}

async function buildWorkbookBuffer(headers: string[], rows: Array<Record<string, string>>): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('누적 원본')
  sheet.addRow(headers)
  for (const row of rows) sheet.addRow(headers.map((header) => row[header] ?? ''))
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer() as unknown as Uint8Array)
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
}
