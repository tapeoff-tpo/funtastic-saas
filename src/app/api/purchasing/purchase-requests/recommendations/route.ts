import { after, NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { db } from '@/lib/db'
import { jobLogs } from '@/lib/db/schema'
import { generatePurchaseRecommendations } from '@/lib/purchasing/purchase-recommendations'
import { createClient } from '@/lib/supabase/server'

export const maxDuration = 300

const bodySchema = z.object({
  targetStockMonths: z.coerce.number().min(0.1).max(12).default(1.2),
  budgetKrw: z.coerce.number().positive().max(10_000_000_000).nullable().optional(),
})

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })

  const body = bodySchema.safeParse(await request.json().catch(() => ({})))
  if (!body.success) {
    return NextResponse.json({ error: '목표 보유개월은 0.1~12 사이로 입력해주세요.' }, { status: 400 })
  }

  const workspaceUserId = await getWorkspaceUserId(user.id)
  const requestedByUserId = user.id
  const targetStockMonths = body.data.targetStockMonths
  const budgetKrw = body.data.budgetKrw ?? null
  let jobId: string | null = null

  try {
    const [job] = await db
      .insert(jobLogs)
      .values({
        jobType: 'purchase-recommendations',
        marketplaceId: 'purchasing',
        status: 'queued',
        progressMessage: '추천 계산 대기 중',
      })
      .returning({ id: jobLogs.id })
    jobId = job.id

    after(async () => {
      try {
        await db
          .update(jobLogs)
          .set({
            status: 'running',
            startedAt: new Date(),
            progressMessage: '재고, 진행 중 발주, 출고량을 계산하고 있습니다.',
          })
          .where(eq(jobLogs.id, job.id))

        const result = await generatePurchaseRecommendations({
          userId: workspaceUserId,
          requestedByUserId,
          targetStockMonths,
          budgetKrw,
        })
        await db
          .update(jobLogs)
          .set({
            status: 'completed',
            completedAt: new Date(),
            progressMessage: recommendationProgressMessage(result),
          })
          .where(eq(jobLogs.id, job.id))
        console.info('[purchase-recommendations] completed', result)
      } catch (error) {
        const message = error instanceof Error ? error.message : '자동 발주 추천 계산에 실패했습니다.'
        await db
          .update(jobLogs)
          .set({
            status: 'failed',
            completedAt: new Date(),
            progressMessage: '추천 계산 실패',
            errorMessage: message,
          })
          .where(eq(jobLogs.id, job.id))
          .catch(() => {})
        console.error('[purchase-recommendations] background failed', error)
      }
    })

    return NextResponse.json({
      accepted: true,
      jobId: job.id,
      targetStockMonths,
      budgetKrw,
    })
  } catch (error) {
    if (jobId) {
      await db
        .update(jobLogs)
        .set({
          status: 'failed',
          completedAt: new Date(),
          errorMessage: error instanceof Error ? error.message : '추천 작업을 시작하지 못했습니다.',
        })
        .where(eq(jobLogs.id, jobId))
        .catch(() => {})
    }
    console.error('[purchase-recommendations]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '자동 발주 추천 생성에 실패했습니다.' },
      { status: 500 },
    )
  }
}

function recommendationProgressMessage(
  result: Awaited<ReturnType<typeof generatePurchaseRecommendations>>,
) {
  const replaced = 'replaced' in result ? result.replaced : 0
  const moqBudgetExcludedGroupCount = 'moqBudgetExcludedGroupCount' in result
    ? result.moqBudgetExcludedGroupCount
    : 0
  const parts = [
    `재고 ${result.evaluated.toLocaleString('ko-KR')}개 검토`,
    `추천 ${result.created.toLocaleString('ko-KR')}건 생성`,
    `기존 자동추천 ${replaced.toLocaleString('ko-KR')}건 교체`,
  ]
  if (moqBudgetExcludedGroupCount > 0) {
    parts.push(`예산 부족 MOQ 그룹 ${moqBudgetExcludedGroupCount.toLocaleString('ko-KR')}개 제외`)
  }
  return parts.join(' · ')
}
