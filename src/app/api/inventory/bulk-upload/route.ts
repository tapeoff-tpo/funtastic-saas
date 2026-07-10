/**
 * POST /api/inventory/bulk-upload
 *
 * Accepts a multipart FormData with a single `file` field (xlsx).
 * Parses the Excel, upserts inventory records via setStock,
 * and returns a summary { total, success, failed, errors }.
 *
 * Required columns: SKU(품번), 상품명, 수량(재고)
 * Optional columns: 창고, 위치(피킹위치)
 */

import { NextRequest, NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { products, productVariants, inventory } from '@/lib/db/schema'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { normalizeExcelWorkbookBuffer } from '@/lib/orders/excel-workbook-buffer'

export const runtime = 'nodejs'
export const maxDuration = 300

const DB_BATCH_SIZE = 500

/** Korean header → internal key (also supports 사방넷 multi-row headers like "현재고 가용") */
const HEADER_MAP: Record<string, string> = {
  'SKU': 'sku',
  '품번': 'sku',
  '품목코드': 'sku',
  '상품코드': 'sku',
  'SKU(품번)': 'sku',
  '상품명': 'productName',
  '품목명': 'productName',
  '수량': 'totalStock',
  '재고': 'totalStock',
  '재고수량': 'totalStock',
  '수량(재고)': 'totalStock',
  '현재고 가용': 'totalStock', // 사방넷 재고코드관리 format
  '현재고가용': 'totalStock',
  '창고': 'warehouseZone',
  '창고구분': 'warehouseZone',
  '위치': 'sectorCode',
  '피킹위치': 'sectorCode',
  '창고위치': 'sectorCode',
  '한국창고기준 위치': 'sectorCode',
  '섹터': 'sectorCode',
  'Location': 'sectorCode',        // 사방넷 재고코드관리 col 20
  'Location Location': 'sectorCode',
  '원가': 'costPrice',
  '판매가': 'basePrice',
  '택배사': 'carrierId',
  '단품명': 'optionName',
  '옵션명': 'optionName',
  '옵션': 'optionName',
  '단품': 'optionName',            // 사방넷 재고코드관리 col 8
  '단품 단품': 'optionName',       // 사방넷: row2+row3 둘 다 "단품"
  '옵션별칭': 'packagingUnit',     // 사방넷 col 26 — 박스 포장 단위
  '옵션별칭 옵션별칭': 'packagingUnit',
}

/** Build a column map for a single header row */
function mapSingleRow(sheet: ExcelJS.Worksheet, rowNum: number): Record<number, string> {
  const row = sheet.getRow(rowNum)
  const map: Record<number, string> = {}
  row.eachCell((cell, col) => {
    const key = HEADER_MAP[cellText(cell).replace(/\n/g, '').trim()]
    if (key) map[col] = key
  })
  return map
}

/** Build a column map for combined row N + row N+1 headers (merged parents + sub-headers) */
function mapCombinedRows(sheet: ExcelJS.Worksheet, topRow: number, subRow: number): Record<number, string> {
  const top = sheet.getRow(topRow)
  const sub = sheet.getRow(subRow)
  const map: Record<number, string> = {}
  const maxCol = Math.max(top.cellCount, sub.cellCount, sheet.columnCount)

  // Forward-fill the top row for merged cells — value carries across empty continuations
  const topValues: string[] = []
  let last = ''
  for (let col = 1; col <= maxCol; col++) {
    const v = cellText(top.getCell(col)).replace(/\n/g, '').trim()
    if (v) last = v
    topValues[col] = v || last
  }

  for (let col = 1; col <= maxCol; col++) {
    const s = cellText(sub.getCell(col)).replace(/\n/g, '').trim()
    const p = topValues[col]
    // Try "parent sub" combined, then parent alone, then sub alone
    const key =
      (s && HEADER_MAP[`${p} ${s}`]) ??
      HEADER_MAP[p] ??
      (s && HEADER_MAP[s])
    if (key) map[col] = key
  }
  return map
}

function hasRequired(map: Record<number, string>): boolean {
  const vals = Object.values(map)
  return vals.includes('sku') && vals.includes('productName') && vals.includes('totalStock')
}

interface ParsedRow {
  sku: string
  productName: string
  totalStock: number
  warehouseZone?: string
  sectorCode?: string
  optionName?: string
  packagingUnit?: string
  costPrice?: string
  basePrice?: string
  carrierId?: string
}

interface UploadResult {
  total: number
  success: number
  failed: number
  errors: Array<{ sku: string; error: string }>
  warnings?: string[]
}

function chunkArray<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size))
  }
  return chunks
}

function inventoryLocationKey(
  sku: string,
  warehouseZone: string | null | undefined,
  sectorCode: string | null | undefined,
): string {
  return [sku, warehouseZone ?? '', sectorCode ?? ''].join('\u0000')
}

function inventoryWarehouseKey(
  sku: string,
  warehouseZone: string | null | undefined,
): string {
  return [sku, warehouseZone ?? ''].join('\u0000')
}

function cellText(cell: ExcelJS.Cell): string {
  const v = cell.value
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') {
    const obj = v as unknown as Record<string, unknown>
    if ('result' in obj) return String(obj.result ?? '')
    if ('richText' in obj) {
      const parts = obj.richText as Array<{ text?: string }> | undefined
      return parts?.map((p) => p.text ?? '').join('') ?? ''
    }
    if ('text' in obj) return String(obj.text ?? '')
  }
  return String(v).trim()
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    return await handleUpload(req)
  } catch (err) {
    console.error('[bulk-upload] unhandled error:', err)
    return NextResponse.json(
      {
        error: err instanceof Error ? `${err.name}: ${err.message}` : '알 수 없는 오류',
        total: 0,
        success: 0,
        failed: 1,
        errors: [{ sku: '-', error: err instanceof Error ? err.message : String(err) }],
      },
      { status: 500 },
    )
  }
}

async function handleUpload(req: NextRequest): Promise<NextResponse> {
  // Auth check
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  }

  const workspaceUserId = await getWorkspaceUserId(user.id)

  // Parse multipart form
  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: '파일을 읽을 수 없습니다.' }, { status: 400 })
  }

  const file = formData.get('file')
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: 'file 필드가 없습니다.' }, { status: 400 })
  }

  let workbookBuffer: Buffer
  try {
    // ExcelJS reads xlsx only. Normalize legacy xls files before parsing.
    workbookBuffer = normalizeExcelWorkbookBuffer(Buffer.from(await file.arrayBuffer()) as unknown as Buffer)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Excel 파일을 읽을 수 없습니다.' },
      { status: 400 },
    )
  }

  // Parse Excel
  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.load(workbookBuffer as unknown as ArrayBuffer)
  } catch {
    return NextResponse.json({ error: 'Excel 파일을 읽을 수 없습니다. xlsx 형식인지 확인해주세요.' }, { status: 400 })
  }

  const sheet = workbook.worksheets[0]
  if (!sheet) {
    return NextResponse.json({ error: 'Excel 시트가 비어있습니다.' }, { status: 400 })
  }

  // Detect header layout — try row 1 (standard), then row 2+3 combined (사방넷 format)
  let colMap = mapSingleRow(sheet, 1)
  let dataStartRow = 2
  if (!hasRequired(colMap)) {
    const sabangnetMap = mapCombinedRows(sheet, 2, 3)
    if (hasRequired(sabangnetMap)) {
      colMap = sabangnetMap
      dataStartRow = 4
    }
  }

  if (!hasRequired(colMap)) {
    const missing: string[] = []
    const vals = Object.values(colMap)
    if (!vals.includes('sku')) missing.push('상품코드/SKU')
    if (!vals.includes('productName')) missing.push('상품명')
    if (!vals.includes('totalStock')) missing.push('수량/현재고')
    return NextResponse.json(
      { error: `다음 컬럼을 찾을 수 없습니다: ${missing.join(', ')}` },
      { status: 400 },
    )
  }

  // Parse data rows
  const rows: ParsedRow[] = []
  const parseErrors: Array<{ sku: string; error: string }> = []

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber < dataStartRow) return // Skip header rows

    const raw: Record<string, string> = {}
    row.eachCell((cell, colNumber) => {
      const key = colMap[colNumber]
      if (key) raw[key] = cellText(cell)
    })

    const sku = (raw.sku ?? '').trim()
    const productName = (raw.productName ?? '').trim()
    const stockRaw = raw.totalStock ?? ''
    const totalStock = Number(stockRaw)

    if (!sku) return // blank row, skip silently

    if (!productName) {
      parseErrors.push({ sku, error: '상품명이 비어있습니다.' })
      return
    }
    if (!Number.isFinite(totalStock)) {
      parseErrors.push({ sku, error: `수량이 유효하지 않습니다: "${stockRaw}"` })
      return
    }

    rows.push({
      sku,
      productName,
      totalStock: Math.round(totalStock),
      warehouseZone: raw.warehouseZone?.trim() || undefined,
      sectorCode: raw.sectorCode?.trim() || undefined,
      optionName: raw.optionName?.trim() || undefined,
      packagingUnit: raw.packagingUnit?.trim() || undefined,
      costPrice: raw.costPrice?.trim() || undefined,
      basePrice: raw.basePrice?.trim() || undefined,
      carrierId: raw.carrierId?.trim() || undefined,
    })
  })

  // Save the uploaded workbook as an inventory snapshot in bounded DB batches.
  let successCount = 0
  const dbErrors: Array<{ sku: string; error: string }> = []
  const warnings: string[] = []

  if (rows.length > 0) {
    try {
      await db.transaction(async (tx) => {
        const latestRowsByLocation = new Map<string, { row: ParsedRow; rowIndex: number }>()
        for (const [rowIndex, row] of rows.entries()) {
          latestRowsByLocation.set(
            inventoryLocationKey(row.sku, row.warehouseZone, row.sectorCode),
            { row, rowIndex },
          )
        }
        const rowsToSave = Array.from(latestRowsByLocation.values())
          .sort((a, b) => a.rowIndex - b.rowIndex)
        const existingByLocation = new Map<string, Array<{ id: string; reservedStock: number }>>()
        const existingByWarehouse = new Map<string, Array<{
          id: string
          sku: string
          warehouseZone: string | null
          sectorCode: string | null
        }>>()
        const latestNoSectorRowIndexByWarehouse = new Map<string, number>()

        for (const entry of rowsToSave) {
          if (!entry.row.sectorCode) {
            latestNoSectorRowIndexByWarehouse.set(
              inventoryWarehouseKey(entry.row.sku, entry.row.warehouseZone),
              entry.rowIndex,
            )
          }
        }

        for (const skuChunk of chunkArray(
          Array.from(new Set(rowsToSave.map(({ row }) => row.sku))),
          DB_BATCH_SIZE,
        )) {
          const existingRows = await tx.select({
            id: inventory.id,
            sku: inventory.sku,
            warehouseZone: inventory.warehouseZone,
            sectorCode: inventory.sectorCode,
            reservedStock: inventory.reservedStock,
          }).from(inventory).where(and(
            eq(inventory.userId, workspaceUserId),
            inArray(inventory.sku, skuChunk),
          )).orderBy(desc(inventory.updatedAt), desc(inventory.createdAt))

          for (const existing of existingRows) {
            const key = inventoryLocationKey(existing.sku, existing.warehouseZone, existing.sectorCode)
            const matches = existingByLocation.get(key) ?? []
            matches.push({ id: existing.id, reservedStock: existing.reservedStock })
            existingByLocation.set(key, matches)

            const warehouseKey = inventoryWarehouseKey(existing.sku, existing.warehouseZone)
            const warehouseMatches = existingByWarehouse.get(warehouseKey) ?? []
            warehouseMatches.push({
              id: existing.id,
              sku: existing.sku,
              warehouseZone: existing.warehouseZone,
              sectorCode: existing.sectorCode,
            })
            existingByWarehouse.set(warehouseKey, warehouseMatches)
          }
        }

        const inventoryUpdates: Array<{ id: string; row: ParsedRow }> = []
        const inventoryInserts: Array<{ row: ParsedRow; shouldZero: boolean }> = []
        const zeroedInventoryIds = new Set<string>()

        for (const entry of rowsToSave) {
          const r = entry.row
          const warehouseKey = r.warehouseZone ?? ''
          const sectorKey = r.sectorCode ?? ''
          const noSectorRowIndex = latestNoSectorRowIndexByWarehouse.get(
            inventoryWarehouseKey(r.sku, warehouseKey),
          )
          const shouldZero = Boolean(
            r.sectorCode
            && noSectorRowIndex !== undefined
            && entry.rowIndex <= noSectorRowIndex,
          )
          const exactMatches = existingByLocation.get(
            inventoryLocationKey(r.sku, warehouseKey, sectorKey),
          ) ?? []

          const [primary, ...duplicates] = exactMatches
          if (primary) {
            inventoryUpdates.push({ id: primary.id, row: r })
            if (shouldZero) zeroedInventoryIds.add(primary.id)
          } else {
            inventoryInserts.push({ row: r, shouldZero })
          }

          for (const duplicate of duplicates) {
            zeroedInventoryIds.add(duplicate.id)
          }
        }

        for (const [warehouseKey, noSectorRowIndex] of latestNoSectorRowIndexByWarehouse) {
          for (const existing of existingByWarehouse.get(warehouseKey) ?? []) {
            if (existing.sectorCode === null) continue

            const sourceEntry = latestRowsByLocation.get(
              inventoryLocationKey(existing.sku, existing.warehouseZone, existing.sectorCode),
            )
            if (!sourceEntry || (
              Boolean(sourceEntry.row.sectorCode)
              && sourceEntry.rowIndex <= noSectorRowIndex
            )) {
              zeroedInventoryIds.add(existing.id)
            }
          }
        }

        for (const updateChunk of chunkArray(inventoryUpdates, DB_BATCH_SIZE)) {
          await tx.execute(sql`
            UPDATE inventory AS target
            SET product_name = source.product_name,
                total_stock = source.total_stock,
                available_stock = source.total_stock - target.reserved_stock,
                warehouse_zone = source.warehouse_zone,
                sector_code = source.sector_code,
                option_name = source.option_name,
                packaging_unit = source.packaging_unit,
                updated_at = now()
            FROM (VALUES ${sql.join(
              updateChunk.map(({ id, row }) => sql`(
                ${id}::uuid,
                ${row.productName}::text,
                ${row.totalStock}::integer,
                ${row.warehouseZone ?? null}::varchar,
                ${row.sectorCode ?? null}::varchar,
                ${row.optionName ?? null}::varchar,
                ${row.packagingUnit ?? null}::varchar
              )`),
              sql`, `,
            )}) AS source(
              id,
              product_name,
              total_stock,
              warehouse_zone,
              sector_code,
              option_name,
              packaging_unit
            )
            WHERE target.id = source.id
          `)
        }

        for (const insertChunk of chunkArray(inventoryInserts, DB_BATCH_SIZE)) {
          await tx.insert(inventory).values(insertChunk.map(({ row, shouldZero }) => ({
            userId: workspaceUserId,
            sku: row.sku,
            productName: row.productName,
            totalStock: shouldZero ? 0 : row.totalStock,
            reservedStock: 0,
            availableStock: shouldZero ? 0 : row.totalStock,
            warehouseZone: row.warehouseZone ?? null,
            sectorCode: row.sectorCode ?? null,
            optionName: row.optionName ?? null,
            packagingUnit: row.packagingUnit ?? null,
          })))
        }

        for (const zeroedIdChunk of chunkArray(Array.from(zeroedInventoryIds), DB_BATCH_SIZE)) {
          await tx.update(inventory).set({
            totalStock: 0,
            availableStock: sql`0 - ${inventory.reservedStock}`,
            updatedAt: new Date(),
          }).where(inArray(inventory.id, zeroedIdChunk))
        }
      })
      successCount = rows.length
    } catch (err) {
      console.error('[bulk-upload] inventory upsert failed:', err)
      dbErrors.push({
        sku: '-',
        error: `재고 업서트 실패: ${err instanceof Error ? err.message : String(err)}`,
      })
    }
  }

  // Sync products table — one bulk upsert too
  if (successCount > 0) {
    try {
      await syncGroupedProductOptions(workspaceUserId, rows)
    } catch (err) {
      console.error('[bulk-upload] product option sync failed:', err)
      warnings.push('재고는 저장됐지만 품목 옵션 동기화에 실패했습니다. 관리자에게 문의해주세요.')
    }
  }

  const uniqueProductRows = Array.from(new Map(rows.map((row) => [row.sku, row])).values())

  if (successCount > 0) {
    try {
      for (const productRows of chunkArray(uniqueProductRows, DB_BATCH_SIZE)) {
        await db
          .insert(products)
          .values(
            productRows.map((r) => {
            const location = [r.warehouseZone, r.sectorCode].filter(Boolean).join(' ').trim() || null
            return {
              userId: workspaceUserId,
              internalSku: r.sku,
              name: r.productName,
              basePrice: r.basePrice ?? '0',
              costPrice: r.costPrice ?? null,
              warehouseLocation: location,
              defaultCarrierId: r.carrierId ?? null,
              // 재고관리 엑셀 업로드로 들어온 상품은 자동으로 재고관리 대상
              manageInventory: true,
              status: 'active' as const,
            }
            }),
          )
          .onConflictDoUpdate({
            target: [products.userId, products.internalSku],
            set: {
              name: sql`excluded.name`,
              warehouseLocation: sql`excluded.warehouse_location`,
              costPrice: sql`excluded.cost_price`,
              basePrice: sql`excluded.base_price`,
              manageInventory: sql`true`,
              defaultCarrierId: sql`excluded.default_carrier_id`,
              updatedAt: new Date(),
            },
          })
      }
    } catch (err) {
      console.error('[bulk-upload] products upsert failed:', err)
      warnings.push('재고는 저장됐지만 품목 정보 동기화에 실패했습니다. 관리자에게 문의해주세요.')
      // Non-fatal — inventory already updated
    }
  }

  const allErrors = [...parseErrors, ...dbErrors]
  const result: UploadResult = {
    total: rows.length + parseErrors.length,
    success: successCount,
    failed: parseErrors.length + dbErrors.length,
    errors: allErrors,
    warnings,
  }

  return NextResponse.json(result)
}

async function syncGroupedProductOptions(userId: string, rows: ParsedRow[]) {
  const uniqueRows = Array.from(new Map(rows.map((row) => [row.sku, row])).values())
  const groupedProducts = Array.from(new Map(uniqueRows.map((row) => {
    const baseSku = baseProductCode(row.sku)
    return [baseSku, { baseSku, name: row.productName }]
  })).values())

  for (const productChunk of chunkArray(groupedProducts, DB_BATCH_SIZE)) {
    await db.insert(products).values(productChunk.map((product) => ({
    userId,
    internalSku: product.baseSku,
    name: product.name,
    basePrice: '0',
    manageInventory: true,
    status: 'active' as const,
    }))).onConflictDoUpdate({
    target: [products.userId, products.internalSku],
    set: {
      name: sql`excluded.name`,
      manageInventory: sql`true`,
      status: sql`'active'::product_status`,
      updatedAt: new Date(),
    },
    })
  }

  const productRows: Array<{ id: string; internalSku: string }> = []
  for (const productChunk of chunkArray(groupedProducts, DB_BATCH_SIZE)) {
    const foundProducts = await db.select({
      id: products.id,
      internalSku: products.internalSku,
    }).from(products).where(and(
      eq(products.userId, userId),
      inArray(products.internalSku, productChunk.map((product) => product.baseSku)),
    ))
    productRows.push(...foundProducts)
  }
  const productIdBySku = new Map(productRows.map((product) => [product.internalSku, product.id]))

  for (const variantChunk of chunkArray(uniqueRows, DB_BATCH_SIZE)) {
    await db.insert(productVariants).values(variantChunk.map((row) => {
    const baseSku = baseProductCode(row.sku)
    const optionCode = optionCodeFromSku(row.sku)
    return {
      productId: productIdBySku.get(baseSku)!,
      sku: row.sku,
      optionName: row.optionName ?? optionCode,
      optionValues: { '단품코드': optionCode, '단품': row.optionName ?? optionCode },
      sortOrder: Number(optionCode) || 0,
      isActive: true,
    }
    })).onConflictDoUpdate({
    target: [productVariants.productId, productVariants.sku],
    set: {
      optionName: sql`excluded.option_name`,
      optionValues: sql`excluded.option_values`,
      sortOrder: sql`excluded.sort_order`,
      isActive: sql`true`,
      updatedAt: new Date(),
    },
    })
  }

  for (const skuChunk of chunkArray(uniqueRows.map((row) => row.sku), DB_BATCH_SIZE)) {
    await db.update(products).set({
      status: 'deleted',
      manageInventory: false,
      updatedAt: new Date(),
    }).where(and(
      eq(products.userId, userId),
      inArray(products.internalSku, skuChunk),
    ))
  }
}

function baseProductCode(sku: string): string {
  return /^(.+)-\d{4}$/.exec(sku)?.[1] ?? sku
}

function optionCodeFromSku(sku: string): string {
  return /^.+-(\d{4})$/.exec(sku)?.[1] ?? sku
}
