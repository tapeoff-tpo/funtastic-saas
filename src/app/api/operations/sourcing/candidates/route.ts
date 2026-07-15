import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { addSourcingCandidate } from '@/lib/operations/sourcing'
import { createClient } from '@/lib/supabase/server'

const candidateSchema = z.object({
  title: z.string().trim().max(1_000).nullable().optional(),
  candidateUrl: z.string().trim().min(1).max(2_000),
  imageUrl: z.string().trim().max(2_000).nullable().optional(),
  priceText: z.string().trim().max(100).nullable().optional(),
  supplierName: z.string().trim().max(200).nullable().optional(),
  matchScore: z.number().int().min(0).max(100).nullable().optional(),
  memo: z.string().trim().max(2_000).nullable().optional(),
})

const bodySchema = z.object({
  itemId: z.string().uuid(),
  candidates: z.array(candidateSchema).min(1).max(30),
})

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })

  const body = bodySchema.safeParse(await request.json().catch(() => null))
  if (!body.success) {
    return NextResponse.json({ error: '1688 후보 정보가 올바르지 않습니다.' }, { status: 400 })
  }

  const userId = await getWorkspaceUserId(user.id)
  let saved = 0
  for (const candidate of body.data.candidates) {
    const result = await addSourcingCandidate({
      userId,
      itemId: body.data.itemId,
      title: candidate.title,
      candidateUrl: candidate.candidateUrl,
      imageUrl: candidate.imageUrl,
      priceText: candidate.priceText,
      supplierName: candidate.supplierName,
      matchScore: candidate.matchScore,
      memo: candidate.memo || '1688 이미지검색 후보',
    })
    if (!('error' in result)) saved += 1
  }

  revalidatePath('/operations/sourcing')
  return NextResponse.json({ saved })
}
