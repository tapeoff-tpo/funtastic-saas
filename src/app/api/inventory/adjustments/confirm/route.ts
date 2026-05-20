import { NextRequest, NextResponse } from 'next/server'
import { and, eq, sql } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { db } from '@/lib/db'
import { inventory, inventoryHistory } from '@/lib/db/schema'
import type { AdjustmentReason } from '@/lib/inventory/types'

export const runtime = 'nodejs'

const REASONS = new Set<AdjustmentReason>([
  'incoming',
  'defective',
  'physical_count',
  'order_ship',
  'other',
])

type RequestRow = {
  rowNum?: number
  sku?: string
  warehouseZone?: string | null
  sectorCode?: string | null
  delta?: number
  reason?: AdjustmentReason
  note?: string | null
}

type ResultError = {
  rowNum?: number
  sku: string
  error: string
}

function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function isAdjustmentReason(value: unknown): value is AdjustmentReason {
  return typeof value === 'string' && REASONS.has(value as AdjustmentReason)
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const workspaceUserId = await getWorkspaceUserId(user.id)

  let body: { rows?: RequestRow[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '요청 값을 읽을 수 없습니다.' }, { status: 400 })
  }

  const requestRows = Array.isArray(body.rows) ? body.rows : []
  if (requestRows.length === 0) {
    return NextResponse.json({ error: '처리할 재고조정 행이 없습니다.' }, { status: 400 })
  }

  const normalized = requestRows.map((row) => ({
    rowNum: typeof row.rowNum === 'number' ? row.rowNum : undefined,
    sku: cleanText(row.sku),
    warehouseZone: cleanText(row.warehouseZone),
    sectorCode: cleanText(row.sectorCode),
    delta: typeof row.delta === 'number' ? row.delta : NaN,
    reason: isAdjustmentReason(row.reason) ? row.reason : 'other',
    note: cleanText(row.note),
  }))

  const validationErrors: ResultError[] = []
  const validRows = normalized.filter((row) => {
    if (!row.sku) {
      validationErrors.push({ rowNum: row.rowNum, sku: '-', error: '상품코드가 없습니다.' })
      return false
    }
    if (!Number.isInteger(row.delta) || row.delta === 0) {
      validationErrors.push({ rowNum: row.rowNum, sku: row.sku, error: '변동수량은 0이 아닌 정수여야 합니다.' })
      return false
    }
    return true
  })

  const txResult = await db.transaction(async (tx) => {
    let success = 0
    const errors: ResultError[] = [...validationErrors]

    for (const row of validRows) {
      const sku = row.sku as string
      try {
        const [record] = await tx
          .select()
          .from(inventory)
          .where(and(
            eq(inventory.userId, workspaceUserId),
            eq(inventory.sku, sku),
            sql`COALESCE(${inventory.warehouseZone}, '') = ${row.warehouseZone ?? ''}`,
            sql`COALESCE(${inventory.sectorCode}, '') = ${row.sectorCode ?? ''}`,
          ))
          .limit(1)
          .for('update')

        if (!record) {
          errors.push({ rowNum: row.rowNum, sku, error: '재고관리에서 해당 상품코드/창고/로케이션을 찾을 수 없습니다.' })
          continue
        }

        const previousTotal = record.totalStock
        const newTotal = previousTotal + row.delta
        const newAvailable = newTotal - record.reservedStock

        if (newTotal < 0) {
          errors.push({ rowNum: row.rowNum, sku, error: `총재고가 음수가 됩니다. 현재고 ${previousTotal}, 변동 ${row.delta}` })
          continue
        }
        if (newAvailable < 0) {
          errors.push({ rowNum: row.rowNum, sku, error: `가용재고가 음수가 됩니다. 예약 ${record.reservedStock}개를 확인해주세요.` })
          continue
        }

        await tx
          .update(inventory)
          .set({
            totalStock: newTotal,
            availableStock: newAvailable,
            updatedAt: new Date(),
          })
          .where(eq(inventory.id, record.id))

        await tx.insert(inventoryHistory).values({
          inventoryId: record.id,
          userId: workspaceUserId,
          adjustmentReason: row.reason,
          delta: row.delta,
          previousTotal,
          newTotal,
          note: row.note ? `대량 재고조정: ${row.note}` : '대량 재고조정',
          orderId: null,
        })

        success += 1
      } catch (error) {
        errors.push({
          rowNum: row.rowNum,
          sku,
          error: error instanceof Error ? error.message : '처리 중 오류가 발생했습니다.',
        })
      }
    }

    return { success, errors }
  })

  return NextResponse.json({
    total: requestRows.length,
    success: txResult.success,
    failed: txResult.errors.length,
    errors: txResult.errors,
  })
}
