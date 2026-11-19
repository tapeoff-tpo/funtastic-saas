import { getPriceTableDisplayColumns } from '@/app/(auth)/analytics/price-table/price-table-columns'
import { registrationIdentifiersKey } from './price-registration-values'

export const CONSOLIDATED_PRICE_SHEET = '재고통합'
export const PRICE_ARCHIVE_KEY = '__priceTableArchive'
const legacySheets = new Set(['메인', '뉴도매'])
const base = (code: string) => code.replace(/-\d{4}$/, '')
const optionKey = (value: unknown) => String(value ?? '').normalize('NFC').toLowerCase()
  .replace(/inch|인치/g, 'in').replace(/[^\p{L}\p{N}]/gu, '')
const populated = (value: unknown) => value !== null && value !== undefined && String(value).trim() !== ''
const identifier = (value: unknown) => populated(value) && !['0', '-', '확인필요', '미등록', '없음'].includes(String(value).trim())
const mallKeys: Record<string, string[]> = {
  domeme: ['도매꾹(T) 상품번호', '도매꾹 상품번호'], domemae: ['도매매(T) 상품번호', '도매매 상품번호'],
  ownerclan: ['오너클랜(T) 진열코드', '오너클랜 진열코드'], domechango: ['도매창고(T) 상품번호', '도매창고 상품번호'],
  wtrading: ['W트레이딩 상품코드'], domesin: ['도매의신 상품코드'], funn: ['펀앤 상품코드'], tobizon: ['투비즈온 상품코드'],
}
export type ConsolidationRow = {
  id?: string; sourceSheetName: string; productCode: string | null; productName: string | null;
  optionName: string | null; registeredProductName?: string | null; rowNumber: number; rawData: Record<string, unknown>
}
export type ConsolidationStock = { sku: string; quantity: number; optionName?: string | null }

function numbers(raw: Record<string, unknown>, mall: string) {
  for (const id of [mall, 'new-' + mall]) {
    const saved = raw[registrationIdentifiersKey(id)]
    if (typeof saved === 'string') {
      try {
        const values: unknown = JSON.parse(saved)
        if (Array.isArray(values) && values.every((value) => value && typeof value.key === 'string' && typeof value.value === 'string')) {
          return values.filter((value) => identifier(value.value)).map((value) => ({ key: value.key as string, value: value.value as string }))
        }
      } catch { /* Retain imported identifiers when saved data is malformed. */ }
    }
    const manualKey = '__registrationEdit:number:' + id
    if (identifier(raw[manualKey])) return [{ key: manualKey, value: String(raw[manualKey]) }]
  }
  return (mallKeys[mall] ?? []).filter((key) => identifier(raw[key])).map((key) => ({ key, value: String(raw[key]) }))
}

/** Only explicit SKU/marketplace identifiers establish identity. Product-name similarity never does. */
export function consolidatePriceRows<T extends ConsolidationRow>(input: {
  rows: T[]; referenceRows: ConsolidationRow[]; stocks: ConsolidationStock[]; archiveKey: string
}) {
  const stocks = new Map(input.stocks.map((stock) => [stock.sku.trim(), stock]))
  const references = input.referenceRows.filter((row) => /^[1-9]\d{5}(?:-\d{4})?$/.test(row.productCode?.trim() ?? ''))
  const inverse = new Map<string, Set<string>>()
  for (const row of references) for (const mall of Object.keys(mallKeys)) for (const number of numbers(row.rawData, mall)) {
    const key = mall + ':' + number.value
    if (!inverse.has(key)) inverse.set(key, new Set())
    inverse.get(key)!.add(base(row.productCode!.trim()))
  }
  const active = new Map<string, T>()
  const retainedSources = new Set<T>()
  const reasons = new Map<T, string>()
  const sources = new Map<string, T[]>()
  // Main's explicit internal SKU and base prices take priority over a legacy YL row.
  const rows = [...input.rows].sort((a, b) => Number(a.sourceSheetName === '뉴도매') - Number(b.sourceSheetName === '뉴도매'))
  for (const row of rows) {
    if (!legacySheets.has(row.sourceSheetName)) continue
    let sku = row.productCode?.trim() ?? ''
    if (!/^[1-9]\d{5}(?:-\d{4})?$/.test(sku)) {
      let candidates: Set<string> | null = null
      for (const mall of Object.keys(mallKeys)) for (const number of numbers(row.rawData, mall)) {
        const matches = inverse.get(mall + ':' + number.value)
        if (matches?.size) {
          if (candidates === null) candidates = new Set<string>(matches)
          else {
            const intersection = new Set<string>()
            for (const code of candidates as Set<string>) if (matches.has(code)) intersection.add(code)
            candidates = intersection
          }
        }
      }
      if (candidates?.size !== 1 || !optionKey(row.optionName)) { reasons.set(row, '재고 연결 미확인'); continue }
      const parent = [...candidates][0]
      const options = new Set(references.filter((reference) => base(reference.productCode!.trim()) === parent
        && optionKey(reference.optionName) === optionKey(row.optionName)).map((reference) => reference.productCode!.trim()))
      for (const stock of input.stocks) if (base(stock.sku.trim()) === parent && optionKey(stock.optionName) === optionKey(row.optionName)) options.add(stock.sku.trim())
      if (options.size !== 1) { reasons.set(row, '옵션 연결 미확인'); continue }
      sku = [...options][0]
    }
    const stock = stocks.get(sku)
    if (!stock) { reasons.set(row, '재고 자료 미확인'); continue }
    if (!(stock.quantity > 0)) { reasons.set(row, '현재 가용재고 없음'); continue }
    const raw = { ...row.rawData }
    delete raw[PRICE_ARCHIVE_KEY]
    if (row.sourceSheetName === '뉴도매') {
      const target = getPriceTableDisplayColumns('상품등록')
      for (const column of getPriceTableDisplayColumns('뉴도매')) {
        const equivalent = target.find((entry) => entry.id === column.id.replace(/^new-/, ''))
        if (equivalent && populated(raw[column.valueKey]) && !populated(raw[equivalent.valueKey])) raw[equivalent.valueKey] = raw[column.valueKey]
      }
    }
    const existing = active.get(sku)
    if (!sources.has(sku)) sources.set(sku, [])
    sources.get(sku)!.push(row)
    if (existing) {
      // Preserve conflicting prices in source snapshots; never overwrite an existing nonblank value.
      for (const [key, value] of Object.entries(raw)) if (!populated(existing.rawData[key]) && populated(value)) existing.rawData[key] = value
      reasons.set(row, '같은 SKU로 통합')
    } else {
      active.set(sku, { ...row, sourceSheetName: CONSOLIDATED_PRICE_SHEET, productCode: sku, rawData: raw })
      retainedSources.add(row)
    }
  }
  for (const [sku, row] of active) {
    const originals = sources.get(sku)!
    row.rawData.__priceConsolidationSources = JSON.stringify(originals.map((source) => ({
      id: source.id, sheet: source.sourceSheetName, code: source.productCode, rawData: source.rawData,
    })))
    row.rawData.__priceConsolidationBackup = input.archiveKey
    for (const mall of Object.keys(mallKeys)) {
      const unique = new Map<string, { key: string; value: string }>()
      for (const source of originals) for (const number of numbers(source.rawData, mall)) if (!unique.has(number.value)) unique.set(number.value, number)
      row.rawData[registrationIdentifiersKey(mall)] = JSON.stringify([...unique.values()])
    }
  }
  const archived = input.rows.filter((row) => legacySheets.has(row.sourceSheetName)
    && !retainedSources.has(row))
    .map((row) => ({ row, reason: reasons.get(row) ?? '같은 SKU로 통합' }))
  return { active: [...active.values()], archived }
}
