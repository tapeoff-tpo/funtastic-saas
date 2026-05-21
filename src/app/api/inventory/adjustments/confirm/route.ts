import { NextRequest, NextResponse } from 'next/server'
import { and, eq, sql } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { getProfile, getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { db } from '@/lib/db'
import { inventory, inventoryAdjustmentSlips, inventoryHistory } from '@/lib/db/schema'
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

type ConfirmSlipRequest = {
  slipIds?: string[]
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
  const [workspaceUserId, profile] = await Promise.all([
    getWorkspaceUserId(user.id),
    getProfile(user.id),
  ])

  let body: ({ rows?: RequestRow[] } & ConfirmSlipRequest)
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '요청 값을 읽을 수 없습니다.' }, { status: 400 })
  }

  const slipIds = Array.isArray(body.slipIds)
    ? Array.from(new Set(body.slipIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)))
    : []

  if (slipIds.length > 0) {
    const txResult = await db.transaction(async (tx) => {
      let success = 0
      const errors: ResultError[] = []

      for (const slipId of slipIds) {
        const [slip] = await tx
          .select()
          .from(inventoryAdjustmentSlips)
          .where(and(
            eq(inventoryAdjustmentSlips.id, slipId),
            eq(inventoryAdjustmentSlips.userId, workspaceUserId),
            eq(inventoryAdjustmentSlips.status, 'pending'),
          ))
          .limit(1)
          .for('update')

        if (!slip) {
          errors.push({ sku: '-', error: `미확정 전표를 찾을 수 없습니다: ${slipId}` })
          continue
        }

        const [record] = await tx
          .select()
          .from(inventory)
          .where(and(eq(inventory.id, slip.inventoryId), eq(inventory.userId, workspaceUserId)))
          .limit(1)
          .for('update')

        if (!record) {
          errors.push({ sku: slip.sku, error: '재고관리에서 해당 상품코드를 찾을 수 없습니다.' })
          continue
        }

        const previousTotal = record.totalStock
        const newTotal = previousTotal + slip.delta
        const newAvailable = newTotal - record.reservedStock
        if (newTotal < 0 || newAvailable < 0) {
          errors.push({ sku: slip.sku, error: `재고가 음수가 됩니다. 현재고 ${previousTotal}, 변동 ${slip.delta}` })
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
          adjustmentReason: slip.adjustmentReason,
          delta: slip.delta,
          previousTotal,
          newTotal,
          note: slip.note ? `전표확정: ${slip.note}` : '전표확정',
          orderId: null,
        })

        await tx
          .update(inventoryAdjustmentSlips)
          .set({
            status: 'confirmed',
            confirmedBy: user.id,
            confirmedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(inventoryAdjustmentSlips.id, slip.id))

        success += 1
      }

      return { success, errors }
    })

    return NextResponse.json({
      total: slipIds.length,
      success: txResult.success,
      failed: txResult.errors.length,
      errors: txResult.errors,
    })
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

        await tx.insert(inventoryAdjustmentSlips).values({
          inventoryId: record.id,
          userId: workspaceUserId,
          sku: record.sku,
          productName: record.productName,
          optionName: record.optionName,
          warehouseZone: record.warehouseZone,
          sectorCode: record.sectorCode,
          adjustmentReason: row.reason,
          delta: row.delta,
          note: row.note,
          status: 'pending',
          registeredBy: user.id,
          registeredByName: profile?.displayName ?? profile?.email ?? user.email ?? null,
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
