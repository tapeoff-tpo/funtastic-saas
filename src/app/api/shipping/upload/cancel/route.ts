import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { cancelInvoiceUploadJobs } from '@/lib/jobs/queues'

/**
 * POST /api/shipping/upload/cancel
 *
 * Cancels queued API invoice upload jobs. Already-running jobs are reported but
 * not interrupted because the external marketplace call may already be in
 * progress.
 *
 * Body: { jobLogIds: string[] }
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { jobLogIds: string[] }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!Array.isArray(body.jobLogIds) || body.jobLogIds.length === 0) {
    return NextResponse.json(
      { error: 'jobLogIds must be a non-empty array' },
      { status: 400 },
    )
  }

  const workspaceUserId = await getWorkspaceUserId(user.id)
  const result = await cancelInvoiceUploadJobs(body.jobLogIds, workspaceUserId)
  return NextResponse.json(result)
}
