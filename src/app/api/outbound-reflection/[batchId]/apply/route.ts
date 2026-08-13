import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath, revalidateTag } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { applyOutboundReflectionBatch } from '@/lib/outbound-reflection'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ batchId: string }> },
) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { batchId } = await params
  const workspaceUserId = await getWorkspaceUserId(user.id)
  const limitParam = Number(request.nextUrl.searchParams.get('limit') ?? 300)
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(Math.trunc(limitParam), 1), 500) : 300

  try {
    const result = await applyOutboundReflectionBatch(workspaceUserId, batchId, { limit })
    revalidatePath('/outbound-reflection')
    revalidatePath('/inventory')
    revalidatePath('/analytics')
    revalidateTag('analytics', { expire: 0 })
    return NextResponse.json(result)
  } catch (error) {
    console.error('[OutboundReflectionApply] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '출고반영에 실패했습니다.' },
      { status: 500 },
    )
  }
}
