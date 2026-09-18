import { createHash } from 'node:crypto'
import path from 'node:path'
import ExcelJS from 'exceljs'
import postgres from 'postgres'

const [, , sourcePath, userId] = process.argv

if (!sourcePath || !userId) {
  throw new Error('사용법: node scripts/import-saas-china-inventory.mjs <엑셀 경로> <workspace user id>')
}

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL 환경변수가 필요합니다.')
}

const REQUIRED_HEADERS = ['품목코드', '품목명', '규격', '합계']

function cellText(cell) {
  return String(cell.text ?? cell.value ?? '').trim()
}

function quantity(cell) {
  const parsed = Number(cellText(cell).replaceAll(',', ''))
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`수량을 읽을 수 없습니다: ${cellText(cell) || '(빈 값)'}`)
  }
  return parsed
}

function inventoryKey({ warehouseCode, sku, optionName }) {
  return `${warehouseCode}\u0000${sku}\u0000${optionName}`
}

function movementSourceKey({ sourceName, asOfDate, warehouseCode, sku, optionName, onHandQuantity }) {
  const digest = createHash('sha256')
    .update([sourceName, asOfDate ?? '', warehouseCode, sku, optionName, onHandQuantity].join('\u0000'))
    .digest('hex')
  return `saas-china-source:${digest}`
}

async function readInventoryWorkbook(filePath) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(filePath)

  const sheet = workbook.getWorksheet('재고현황')
  if (!sheet) throw new Error('재고현황 시트를 찾을 수 없습니다.')

  const headers = new Map()
  sheet.getRow(2).eachCell({ includeEmpty: true }, (cell, column) => {
    const label = cellText(cell)
    if (label) headers.set(label, column)
  })

  for (const header of REQUIRED_HEADERS) {
    if (!headers.has(header)) throw new Error(`필수 열을 찾을 수 없습니다: ${header}`)
  }

  const totalColumn = headers.get('합계')
  if (!totalColumn) throw new Error('합계 열을 찾을 수 없습니다.')
  const warehouseColumns = [...headers.entries()]
    .filter(([label, column]) => column > totalColumn && label !== '쿠팡')
    .concat(headers.has('쿠팡') ? [['쿠팡', headers.get('쿠팡')]] : [])

  if (warehouseColumns.length === 0) throw new Error('창고 열을 찾을 수 없습니다.')

  const sourceName = path.basename(filePath)
  const title = cellText(sheet.getRow(1).getCell(1))
  const sourceDateMatch = title.match(/(20\d{6})/)
  const asOfDate = sourceDateMatch
    ? `${sourceDateMatch[1].slice(0, 4)}-${sourceDateMatch[1].slice(4, 6)}-${sourceDateMatch[1].slice(6, 8)}`
    : null
  const entries = []
  const totalsByWarehouse = new Map(warehouseColumns.map(([warehouse]) => [warehouse, 0]))
  let sourceTotalRow = null

  for (let rowNumber = 3; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber)
    const sku = cellText(row.getCell(headers.get('품목코드')))
    if (!sku) continue

    if (sku === '합계') {
      sourceTotalRow = row
      break
    }

    const productName = cellText(row.getCell(headers.get('품목명')))
    if (!productName) throw new Error(`${rowNumber}행의 품목명을 찾을 수 없습니다.`)

    const optionName = cellText(row.getCell(headers.get('규격')))
    const sourceTotal = quantity(row.getCell(totalColumn))
    let rowTotal = 0

    for (const [warehouseCode, column] of warehouseColumns) {
      const onHandQuantity = quantity(row.getCell(column))
      rowTotal += onHandQuantity
      totalsByWarehouse.set(warehouseCode, (totalsByWarehouse.get(warehouseCode) ?? 0) + onHandQuantity)
      if (onHandQuantity === 0) continue
      entries.push({ warehouseCode, sku, productName, optionName, onHandQuantity })
    }

    if (rowTotal !== sourceTotal) {
      throw new Error(`${rowNumber}행 ${sku}의 창고 합계(${rowTotal})가 합계 열(${sourceTotal})과 다릅니다.`)
    }
  }

  if (!sourceTotalRow) throw new Error('합계 행을 찾을 수 없습니다.')

  for (const [warehouseCode, column] of warehouseColumns) {
    const expected = quantity(sourceTotalRow.getCell(column))
    const actual = totalsByWarehouse.get(warehouseCode) ?? 0
    if (actual !== expected) {
      throw new Error(`${warehouseCode} 합계가 원본(${expected})과 다릅니다. 파싱값: ${actual}`)
    }
  }

  return { asOfDate, entries, sourceName, totalsByWarehouse }
}

async function importSnapshot() {
  const snapshot = await readInventoryWorkbook(sourcePath)
  const sql = postgres(process.env.DATABASE_URL, { prepare: false })

  try {
    const result = await sql.begin(async (tx) => {
      const existingRows = await tx`
        SELECT id, warehouse_code, sku, option_key, on_hand_quantity, reserved_quantity
        FROM saas_china_inventory
        WHERE user_id = ${userId}
        FOR UPDATE
      `
      const existingByKey = new Map(existingRows.map((row) => [inventoryKey({
        warehouseCode: row.warehouse_code,
        sku: row.sku,
        optionName: row.option_key,
      }), row]))
      const sourceKeys = new Set(snapshot.entries.map(inventoryKey))
      const stale = existingRows.filter((row) => !sourceKeys.has(inventoryKey({
        warehouseCode: row.warehouse_code,
        sku: row.sku,
        optionName: row.option_key,
      })))

      if (stale.length > 0) {
        throw new Error(`원본에 없는 기존 SaaS 재고 ${stale.length}건이 있습니다. 자동 삭제하지 않고 중단했습니다.`)
      }
      const reserved = existingRows.filter((row) => row.reserved_quantity > 0)
      if (reserved.length > 0) {
        throw new Error(`출고 예약이 있는 SaaS 재고 ${reserved.length}건이 있어 원본 덮어쓰기를 중단했습니다.`)
      }

      let inserted = 0
      let updated = 0
      for (const entry of snapshot.entries) {
        const key = inventoryKey(entry)
        const existing = existingByKey.get(key)
        const [inventory] = await tx`
          INSERT INTO saas_china_inventory (
            user_id,
            warehouse_code,
            sku,
            product_name,
            option_key,
            option_name,
            on_hand_quantity,
            reserved_quantity,
            available_quantity,
            last_received_at,
            created_by
          ) VALUES (
            ${userId},
            ${entry.warehouseCode},
            ${entry.sku},
            ${entry.productName},
            ${entry.optionName},
            ${entry.optionName || null},
            ${entry.onHandQuantity},
            0,
            ${entry.onHandQuantity},
            now(),
            ${userId}
          )
          ON CONFLICT (user_id, warehouse_code, sku, option_key)
          DO UPDATE SET
            product_name = EXCLUDED.product_name,
            option_name = EXCLUDED.option_name,
            on_hand_quantity = EXCLUDED.on_hand_quantity,
            available_quantity = EXCLUDED.on_hand_quantity - saas_china_inventory.reserved_quantity,
            last_received_at = EXCLUDED.last_received_at,
            updated_at = now()
          RETURNING id, on_hand_quantity, reserved_quantity
        `

        if (!inventory) throw new Error(`${entry.sku} 재고를 저장하지 못했습니다.`)

        if (!existing) {
          inserted += 1
          await tx`
            INSERT INTO saas_china_inventory_movements (
              inventory_id,
              user_id,
              movement_type,
              on_hand_delta,
              reserved_delta,
              on_hand_before,
              reserved_before,
              on_hand_after,
              reserved_after,
              source_key,
              note,
              created_by
            ) VALUES (
              ${inventory.id},
              ${userId},
              'opening_balance',
              ${entry.onHandQuantity},
              0,
              0,
              0,
              ${entry.onHandQuantity},
              0,
              ${movementSourceKey({ ...entry, sourceName: snapshot.sourceName, asOfDate: snapshot.asOfDate })},
              ${`${snapshot.sourceName}${snapshot.asOfDate ? ` · ${snapshot.asOfDate}` : ''} · ${entry.warehouseCode} 초기 재고`},
              ${userId}
            )
          `
        } else {
          updated += 1
          const delta = entry.onHandQuantity - existing.on_hand_quantity
          if (delta !== 0) {
            await tx`
              INSERT INTO saas_china_inventory_movements (
                inventory_id,
                user_id,
                movement_type,
                on_hand_delta,
                reserved_delta,
                on_hand_before,
                reserved_before,
                on_hand_after,
                reserved_after,
                source_key,
                note,
                created_by
              ) VALUES (
                ${inventory.id},
                ${userId},
                'manual_adjustment',
                ${delta},
                0,
                ${existing.on_hand_quantity},
                ${existing.reserved_quantity},
                ${entry.onHandQuantity},
                ${existing.reserved_quantity},
                ${movementSourceKey({ ...entry, sourceName: snapshot.sourceName, asOfDate: snapshot.asOfDate })},
                ${`${snapshot.sourceName}${snapshot.asOfDate ? ` · ${snapshot.asOfDate}` : ''} 원본 재고 보정`},
                ${userId}
              )
            `
          }
        }
      }

      const storedTotals = await tx`
        SELECT warehouse_code, COUNT(*)::int AS item_count, SUM(on_hand_quantity)::int AS on_hand_quantity
        FROM saas_china_inventory
        WHERE user_id = ${userId}
        GROUP BY warehouse_code
        ORDER BY warehouse_code
      `
      const expectedTotal = [...snapshot.totalsByWarehouse.values()].reduce((sum, value) => sum + value, 0)
      const storedTotal = storedTotals.reduce((sum, row) => sum + row.on_hand_quantity, 0)
      if (storedTotal !== expectedTotal || storedTotals.length !== snapshot.totalsByWarehouse.size) {
        throw new Error(`저장 후 검증에 실패했습니다. 기대 ${expectedTotal}, 저장 ${storedTotal}`)
      }

      return { inserted, updated, source: snapshot, storedTotals, storedTotal }
    })

    console.log(JSON.stringify({
      source: result.source.sourceName,
      asOfDate: result.source.asOfDate,
      inventoryItems: result.source.entries.length,
      inserted: result.inserted,
      updated: result.updated,
      totalQuantity: result.storedTotal,
      warehouses: result.storedTotals,
    }, null, 2))
  } finally {
    await sql.end({ timeout: 5 })
  }
}

await importSnapshot()
