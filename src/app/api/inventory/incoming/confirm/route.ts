/**
 * POST /api/inventory/incoming/confirm
 *
 * Body: { rows: Array<{ sku, quantity, note? }> }
 *
 * Calls adjustStock('incoming') for each row and returns a summary.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { adjustStock } from '@/lib/inventory/actions'
import { z } from 'zod/v4'

const RowSchema = z.object({
  sku: z.string().min(1),
  quantity: z.number().int().positive(),
  note: z.string().optional(),
})

const BodySchema = z.object({
  rows: z.array(RowSchema).min(1),
})

export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '요청 형식이 올바르지 않습니다.' }, { status: 400 })
  }

  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: '입력값이 올바르지 않습니다.' }, { status: 400 })
  }

  const { rows } = parsed.data

  let success = 0
  const errors: Array<{ sku: string; error: string }> = []

  for (const row of rows) {
    const result = await adjustStock(user.id, row.sku, row.quantity, 'incoming', {
      note: row.note || `입고 처리 ${new Date().toLocaleDateString('ko-KR')}`,
    })
    if (result.success) {
      success++
    } else {
      errors.push({ sku: row.sku, error: result.error ?? '실패' })
    }
  }

  return NextResponse.json({
    total: rows.length,
    success,
    failed: errors.length,
    errors,
  })
}
