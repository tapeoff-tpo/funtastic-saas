import { gzipSync, gunzipSync } from 'node:zlib'
import { unstable_cache } from 'next/cache'
import { createHash } from 'node:crypto'
import { and, asc, eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { analyticsPriceTableRows, products } from '@/lib/db/schema'
import { createMarketplaceIdentifierReaders, findMarketplaceProductIds, getManualRegistrationTargets, type PriceTableDisplayColumn } from '@/app/(auth)/analytics/price-table/price-table-columns'

export function registrationBaseCode(code: string | null | undefined) {
  const value = code?.trim()
  return value && !['0', '확인필요'].includes(value) ? value.replace(/-[0-9]{4}$/, '') : null
}

type NumberRow = { id: string; rawData: Record<string, unknown> }

export function groupRegistrationNumbers(rows: NumberRow[], mall: PriceTableDisplayColumn) {
  const numbers = new Map<string, { key: string; value: string }>()
  for (const row of rows) {
    for (const number of findMarketplaceProductIds(row.rawData as Record<string, string>, mall)) {
      if (!numbers.has(number.value)) numbers.set(number.value, number)
    }
  }
  return [...numbers.values()]
}

export function registrationGroupSnapshot(rows: NumberRow[], mall: PriceTableDisplayColumn) {
  return createHash('sha256').update(JSON.stringify([...rows].sort((a, b) => a.id.localeCompare(b.id))
    .map((row) => [row.id, findMarketplaceProductIds(row.rawData as Record<string, string>, mall)]))).digest('hex')
}

export async function getRegistrationGroupRows(userId: string, rowId: string) {
  const table = analyticsPriceTableRows
  const [row] = await db.select().from(table).where(and(eq(table.userId, userId), eq(table.id, rowId)))
  if (!row) return []
  const base = registrationBaseCode(row.productCode)
  if (!base) return [row]
  return db.select().from(table).where(and(
    eq(table.userId, userId), eq(table.sourceSheetName, row.sourceSheetName),
    sql`regexp_replace(btrim(${table.productCode}), '-[0-9]{4}$', '') = ${base}`,
  )).orderBy(asc(table.productCode), asc(table.rowNumber), asc(table.id))
}

export type RegistrationCatalogRow = {
  id: string
  productCode: string | null
  productName: string | null
  registeredProductName: string | null
  optionName: string | null
  rawData: Record<string, unknown>
}
export type RegistrationCatalogItem = {
  sku: string
  name: string
  createdAt: Date
}

export function buildRegistrationGroups(rows: RegistrationCatalogRow[], items: RegistrationCatalogItem[]) {
  const groups = new Map<string, {
    key: string; code: string; name: string; rowId: string | null; sku: string;
    registeredAt: number; skus: Set<string>; rows: RegistrationCatalogRow[];
  }>()
  for (const item of items) {
    if (!/^[1-9][0-9]{5}(?:-[0-9]{4})?$/.test(item.sku)) continue
    const base = registrationBaseCode(item.sku)!
    const date = new Date(item.createdAt).getTime()
    const group = groups.get(base)
    if (group) {
      group.skus.add(item.sku)
      group.registeredAt = Math.max(group.registeredAt, date)
      if (item.sku === base) group.name = item.name
    } else groups.set(base, { key: base, code: base, name: item.name, rowId: null, sku: item.sku,
      registeredAt: date, skus: new Set([item.sku]), rows: [] })
  }
  for (const row of rows) {
    const base = registrationBaseCode(row.productCode)
    const key = base ?? 'row:' + row.id
    let group = groups.get(key)
    if (!group) {
      group = { key, code: base ?? '', name: row.registeredProductName || row.productName || row.productCode || '',
        rowId: row.id, sku: row.productCode ?? '', registeredAt: 0, skus: new Set(), rows: [] }
      groups.set(key, group)
    }
    group.rows.push(row)
    group.rowId ??= row.id
    if (row.productCode) group.skus.add(row.productCode)
  }
  const targets = getManualRegistrationTargets('상품등록')
  const readers = createMarketplaceIdentifierReaders(rows.map((row) => row.rawData as Record<string, string>), targets)
  return [...groups.values()].map((group) => {
    const optionSkus = [...group.skus].filter((sku) => sku !== group.code)
    const missingMalls = targets.filter((target) => !group.rows.some((row) => readers.get(row.rawData as Record<string, string>)!(target).length)).map((target) => target.id)
    return { ...group, optionCount: optionSkus.length || 1, missingMalls }
  }).sort((a, b) => b.registeredAt - a.registeredAt || a.code.localeCompare(b.code, 'ko-KR', { numeric: true }) || a.key.localeCompare(b.key))
}

export const REGISTRATION_CATALOG_TAG = 'manual-registration-catalog'

async function loadRegistrationCatalog(userId: string) {
  const table = analyticsPriceTableRows
  const [rows, items] = await Promise.all([
    db.select({
      id: table.id, productCode: table.productCode, productName: table.productName,
      registeredProductName: table.registeredProductName, optionName: table.optionName,
      rawData: table.rawData,
    }).from(table).where(and(eq(table.userId, userId), eq(table.sourceSheetName, '상품등록')))
      .orderBy(asc(table.rowNumber), asc(table.id)),
    db.select({ sku: products.internalSku, name: products.name, createdAt: products.createdAt })
      .from(products).where(eq(products.userId, userId)).orderBy(asc(products.internalSku)),
  ])
  return buildRegistrationGroups(rows, items)
}


export async function getRegistrationCatalog(userId: string) {
  const read = unstable_cache(async (owner: string) => {
    const groups = await loadRegistrationCatalog(owner)
    const serializable = groups.map((group) => ({ ...group, skus: [...group.skus] }))
    // The compressed value keeps the shared catalogue below the data-cache entry limit.
    return gzipSync(JSON.stringify(serializable)).toString('base64')
  }, ['manual-registration-catalog-v2'], { revalidate: 60, tags: [REGISTRATION_CATALOG_TAG] })
  const packed = await read(userId)
  type Group = ReturnType<typeof buildRegistrationGroups>[number]
  const groups = JSON.parse(gunzipSync(Buffer.from(packed, 'base64')).toString()) as Array<Omit<Group, 'skus'> & { skus: string[] }>
  return groups.map((group) => ({ ...group, skus: new Set(group.skus) }))
}
