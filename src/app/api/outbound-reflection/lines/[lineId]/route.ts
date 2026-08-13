import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { updateOutboundReflectionLine, type OutboundReflectionLinePatch } from '@/lib/outbound-reflection'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ lineId: string }> },
) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { lineId } = await params
  const workspaceUserId = await getWorkspaceUserId(user.id)
  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const patch: OutboundReflectionLinePatch = {
    sku: stringValue(body.sku),
    productName: stringValue(body.productName),
    optionText: stringValue(body.optionText),
    quantity: numberValue(body.quantity),
    salesAmount: numberValue(body.salesAmount),
  }

  try {
    const result = await updateOutboundReflectionLine(workspaceUserId, lineId, patch)
    revalidatePath('/outbound-reflection')
    return NextResponse.json(result)
  } catch (error) {
    console.error('[OutboundReflectionLinePatch] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '출고반영 행 수정 중 오류가 발생했습니다.' },
      { status: 500 },
    )
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() : undefined
}

function numberValue(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}
