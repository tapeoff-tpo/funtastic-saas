import { and, eq, inArray, sql } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jobLogs } from '@/lib/db/schema'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })

  const id = request.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: '작업 ID가 필요합니다.' }, { status: 400 })

  await db
    .update(jobLogs)
    .set({
      status: 'failed',
      completedAt: new Date(),
      progressMessage: '추천 계산 실패',
      errorMessage: '추천 계산이 제한시간 안에 완료되지 않았습니다. 다시 실행해주세요.',
    })
    .where(and(
      eq(jobLogs.id, id),
      eq(jobLogs.jobType, 'purchase-recommendations'),
      inArray(jobLogs.status, ['queued', 'running']),
      sql`COALESCE(${jobLogs.startedAt}, ${jobLogs.createdAt}) < now() - interval '6 minutes'`,
    ))

  const [job] = await db
    .select({
      id: jobLogs.id,
      status: jobLogs.status,
      progressMessage: jobLogs.progressMessage,
      errorMessage: jobLogs.errorMessage,
      startedAt: jobLogs.startedAt,
      completedAt: jobLogs.completedAt,
    })
    .from(jobLogs)
    .where(and(
      eq(jobLogs.id, id),
      eq(jobLogs.jobType, 'purchase-recommendations'),
    ))
    .limit(1)

  if (!job) return NextResponse.json({ error: '추천 작업을 찾을 수 없습니다.' }, { status: 404 })
  return NextResponse.json({ job })
}
