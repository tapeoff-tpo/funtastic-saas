import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { readEcountPurchasingRawFileRows } from './ecount-purchasing-sync'
import { isUniqueSupplierOrderIdentifier, normalizeSupplierOrderReference } from './supplier-order-reference'

type SourceKind = 'purchaseRequest' | 'purchasePlan' | 'purchaseHistory'
type SourceFile = { kind: SourceKind; fileName: string; updatedAt: string }
type SourceFileData = SourceFile & { fileData: Uint8Array }
type WarehouseRow = { warehouse: string; sourceDateNo: string }
type WarehouseIndex = { management: Map<string, WarehouseRow[]>; supplier: Map<string, WarehouseRow[]> }

export type PurchaseSourceWarehouseItem = {
  id: string
  status: string
  sku: string
  purchaseManagementCode: string | null
  supplierOrderNumber: string | null
  inboundWarehouseCode?: string | null
  rawData: Record<string, unknown>
}

// Cache parsed indices, not workbook buffers. A new upload revision gets a new
// key; owner scoping prevents a cached source from crossing workspaces.
const indexCache = new Map<string, Promise<WarehouseIndex | null>>()
const MAX_CACHED_SOURCE_FILES = 9
const keyFor = (file: SourceFile, userId: string) => JSON.stringify([userId, file.kind, file.fileName, file.updatedAt])
const matchKey = (reference: string, sku: string) => JSON.stringify([reference.trim(), sku.trim()])
const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''

/** Restore display values from original purchasing reports without changing operational rows. */
export async function resolvePurchaseSourceWarehouses(userId: string, items: PurchaseSourceWarehouseItem[]): Promise<Map<string, string>> {
  const unresolved = items.filter((item) => !text(item.rawData.arrivalWarehouseCode) && !text(item.inboundWarehouseCode)
    && (text(item.purchaseManagementCode) || isUniqueSupplierOrderIdentifier(item.supplierOrderNumber)))
  if (unresolved.length === 0) return new Map()

  let files: SourceFile[]
  try {
    const result = await db.execute<SourceFile>(sql`
      SELECT report_kind AS kind, file_name AS "fileName", updated_at::text AS "updatedAt"
      FROM purchasing_ecount_raw_files
      WHERE user_id = ${userId}::uuid
        AND report_kind IN ('purchaseRequest', 'purchasePlan', 'purchaseHistory')
    `)
    files = resultRows<SourceFile>(result)
  } catch (error) {
    if (isMissingTable(error)) return new Map()
    throw error
  }
  const missing = files.filter((file) => !indexCache.has(keyFor(file, userId)))
  if (missing.length > 0) {
    const batch = loadSourceIndices(userId, missing)
    for (const file of missing) {
      const key = keyFor(file, userId)
      const promise = batch.then((indices) => indices.get(key) ?? null)
      indexCache.set(key, promise)
      void promise.then((index) => {
        // A report can change between the metadata and workbook reads.
        if (!index && indexCache.get(key) === promise) indexCache.delete(key)
      }, () => {
        if (indexCache.get(key) === promise) indexCache.delete(key)
      })
    }
  }
  const indices = new Map<SourceKind, WarehouseIndex>()
  await Promise.all(files.map(async (file) => {
    const key = keyFor(file, userId)
    const promise = indexCache.get(key)
    if (!promise) return
    // Refresh insertion order for the small least-recently-used cache.
    indexCache.delete(key)
    indexCache.set(key, promise)
    const index = await promise
    if (index) indices.set(file.kind, index)
  }))
  while (indexCache.size > MAX_CACHED_SOURCE_FILES) indexCache.delete(indexCache.keys().next().value!)

  const resolved = new Map<string, string>()
  for (const item of unresolved) {
    const management = text(item.purchaseManagementCode)
    const supplier = normalizeSupplierOrderReference(item.supplierOrderNumber)
    const key = matchKey(management || supplier!, item.sku)
    const priority: SourceKind[] = item.status === 'purchased'
      ? ['purchaseRequest', 'purchasePlan', 'purchaseHistory']
      : ['purchasePlan', 'purchaseRequest', 'purchaseHistory']
    for (const kind of priority) {
      let matches = (management ? indices.get(kind)?.management : indices.get(kind)?.supplier)?.get(key)
      if (!matches?.length) continue
      const sourceDateNo = text(item.rawData.sourceDateNo)
      if (sourceDateNo && sourceKind(item.rawData.source) === kind) {
        const exact = matches.filter((row) => row.sourceDateNo === sourceDateNo)
        if (exact.length > 0) matches = exact
      }
      const warehouses = new Set(matches.map((row) => row.warehouse))
      if (warehouses.size === 1) resolved.set(item.id, warehouses.values().next().value!)
      // A conflicting current-stage source must not silently fall through to
      // an older report that happens to have only one warehouse.
      break
    }
  }
  return resolved
}

async function loadSourceIndices(userId: string, files: SourceFile[]) {
  const result = await db.execute<SourceFileData>(sql`
    SELECT report_kind AS kind, file_name AS "fileName", updated_at::text AS "updatedAt", file_data AS "fileData"
    FROM purchasing_ecount_raw_files
    WHERE user_id = ${userId}::uuid
      AND report_kind IN (${sql.join(files.map((file) => sql`${file.kind}`), sql`, `)})
  `)
  const expectedKeys = new Set(files.map((file) => keyFor(file, userId)))
  const parsed = await Promise.all(resultRows<SourceFileData>(result).map(async (file) => {
    const key = keyFor(file, userId)
    if (!expectedKeys.has(key)) return null
    const report = await readEcountPurchasingRawFileRows({
      fileName: file.fileName,
      fileBuffer: Uint8Array.from(file.fileData).buffer,
    })
    if (report.kind !== file.kind) throw new Error('원본 발주 창고 파일의 종류를 확인해주세요.')
    const index: WarehouseIndex = { management: new Map(), supplier: new Map() }
    for (const row of report.rows) {
      const warehouse = text(row['입고창고명']) || text(row['창고명'])
      const sku = text(row['품목코드'])
      if (!warehouse || !sku) continue
      const value = { warehouse, sourceDateNo: text(row['일자-No.']) }
      const management = text(row['구입관리코드'])
      if (management) append(index.management, matchKey(management, sku), value)
      const supplier = normalizeSupplierOrderReference(row['주문서번호 (C)'] || row['주문서번호'])
      if (isUniqueSupplierOrderIdentifier(supplier)) append(index.supplier, matchKey(supplier!, sku), value)
    }
    return [key, index] as const
  }))
  return new Map(parsed.filter((entry) => entry !== null))
}

function append(index: Map<string, WarehouseRow[]>, key: string, value: WarehouseRow) {
  const values = index.get(key) ?? []
  values.push(value)
  index.set(key, values)
}

function sourceKind(value: unknown): SourceKind | undefined {
  if (value === 'ecount_purchasing_snapshot_plan_purchase_completed') return 'purchasePlan'
  if (value === 'ecount_purchasing_snapshot_request' || value === 'ecount_purchasing_snapshot_request_completed') return 'purchaseRequest'
  if (value === 'ecount_purchasing_snapshot_purchase_completed' || value === 'ecount_purchasing_snapshot_china_arrived') return 'purchaseHistory'
}

function resultRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[]
  return (result as { rows?: T[] }).rows ?? []
}

function isMissingTable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const entry = error as { code?: unknown; cause?: unknown }
  return entry.code === '42P01' || (entry.cause !== error && isMissingTable(entry.cause))
}
