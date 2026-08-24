import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import type { EcountPurchasingUpload, EcountReportKind } from './ecount-purchasing-sync'

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
  const rows = Array.isArray(result) ? result : result.rows ?? []
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
  const rows = Array.isArray(result) ? result : result.rows ?? []
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
