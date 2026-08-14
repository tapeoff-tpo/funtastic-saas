import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { deleteOutboundReflectionBatch } from '@/lib/outbound-reflection'

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ batchId: string }> },
) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { batchId } = await params
  const workspaceUserId = await getWorkspaceUserId(user.id)

  try {
    const result = await deleteOutboundReflectionBatch(workspaceUserId, batchId)
    revalidatePath('/outbound-reflection')
    return NextResponse.json(result)
  } catch (error) {
    console.error('[OutboundReflectionDelete] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '출고반영 파일 삭제에 실패했습니다.' },
      { status: 400 },
    )
  }
}
