import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getPurchaseInspection, savePurchaseInspection } from '@/lib/purchasing/purchase-requests'
import { purchaseInspectionInputSchema } from '@/lib/purchasing/purchase-inspection'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user || user.mustChangePassword) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const id = z.string().uuid().safeParse((await params).id)
  if (!id.success) return NextResponse.json({ error: '발주 항목을 확인해주세요.' }, { status: 400 })
  const data = await getPurchaseInspection(await getWorkspaceUserId(user.id), id.data)
  return data ? NextResponse.json(data, { headers: { 'Cache-Control': 'private, no-store' } })
    : NextResponse.json({ error: '발주 항목을 찾을 수 없습니다.' }, { status: 404 })
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user || user.mustChangePassword) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const id = z.string().uuid().safeParse((await params).id)
  if (!id.success) return NextResponse.json({ error: '발주 항목을 확인해주세요.' }, { status: 400 })
  const body = purchaseInspectionInputSchema.safeParse(await request.json().catch(() => null))
  if (!body.success) {
    const message = body.error.issues[0]?.message ?? ''
    return NextResponse.json({ error: /[가-힣]/.test(message) ? message : '송장번호와 박스의 수량·크기·무게를 확인해주세요.' }, { status: 400 })
  }
  try {
    const saved = await savePurchaseInspection({ userId: await getWorkspaceUserId(user.id), actorId: user.id, id: id.data, data: body.data })
    if (!saved) return NextResponse.json({ error: '발주 항목을 찾을 수 없습니다.' }, { status: 404 })
    for (const path of ['/purchasing/orders', '/purchasing/payment-flow', '/purchasing/overdue']) revalidatePath(path)
    return NextResponse.json(saved, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '검수 저장에 실패했습니다.' }, { status: 409 })
  }
}
