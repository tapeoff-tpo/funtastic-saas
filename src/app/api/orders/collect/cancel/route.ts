import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { cancelManualJobs } from '@/lib/jobs/queues'

/**
 * POST /api/orders/collect/cancel
 *
 * Cancel manual collection jobs.
 * Queued jobs are removed from the queue; running logs are terminalized so the
 * UI and collection lock are released.
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
      { status: 400 }
    )
  }

  const result = await cancelManualJobs(body.jobLogIds)
  return NextResponse.json(result)
}
