import { revalidatePath } from 'next/cache'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import {
  getChinaFundStatementEntries,
  importChinaFundStatementEntries,
} from '@/lib/purchasing/china-fund-statement'
import { createClient } from '@/lib/supabase/server'

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const entrySchema = z.object({
  occurredOn: dateSchema,
  signedAmountCny: z.number().finite().min(-1_000_000_000).max(1_000_000_000).refine((value) => value !== 0),
  balanceAfterCny: z.number().finite().min(-1_000_000_000).max(1_000_000_000),
  memo: z.string().trim().max(500).nullable().optional(),
}).strict()
const importSchema = z.object({
  sourceLabel: z.string().trim().max(200).nullable().optional(),
  entries: z.array(entrySchema).min(1).max(500),
}).strict()

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })

  const from = normalizeQueryDate(request.nextUrl.searchParams.get('from'))
  const to = normalizeQueryDate(request.nextUrl.searchParams.get('to'))
  const rawLimit = Number(request.nextUrl.searchParams.get('limit') ?? '100')
  const rawPage = Number(request.nextUrl.searchParams.get('page') ?? '1')
  if (from === false || to === false || !Number.isFinite(rawLimit) || !Number.isFinite(rawPage)) {
    return NextResponse.json({ error: '조회 기간이 올바르지 않습니다.' }, { status: 400 })
  }

  try {
    const data = await getChinaFundStatementEntries({
      userId: await getWorkspaceUserId(user.id),
      from,
      to,
      limit: rawLimit,
      page: rawPage,
    })
    return NextResponse.json(data)
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : '중국 입금내역을 불러오지 못했습니다.',
    }, { status: 400 })
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })

  const body = importSchema.safeParse(await request.json().catch(() => null))
  if (!body.success) {
    return NextResponse.json({ error: '중국 입금내역의 날짜·금액·총합을 확인해주세요.' }, { status: 400 })
  }

  try {
    const result = await importChinaFundStatementEntries({
      userId: await getWorkspaceUserId(user.id),
      createdBy: user.id,
      ...body.data,
    })
    revalidatePath('/purchasing/payment-flow')
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : '중국 입금내역을 저장하지 못했습니다.',
    }, { status: 400 })
  }
}

function normalizeQueryDate(value: string | null): string | null | false {
  if (!value) return null
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : false
}
