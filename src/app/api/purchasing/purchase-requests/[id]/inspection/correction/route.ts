import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { correctInspectionPurchaseQuantity, inspectionPurchaseCorrectionSchema } from '@/lib/purchasing/purchase-inspection-corrections'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user || user.mustChangePassword) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const id = z.string().uuid().safeParse((await params).id)
  const data = inspectionPurchaseCorrectionSchema.safeParse(await request.json().catch(() => null))
  if (!id.success || !data.success) return NextResponse.json({ error: '구매수량과 정정 사유를 확인해주세요.' }, { status: 400 })
  try {
    const saved = await correctInspectionPurchaseQuantity({
      userId: await getWorkspaceUserId(user.id), actorId: user.id, id: id.data, data: data.data,
    })
    if (!saved) return NextResponse.json({ error: '발주 항목을 찾을 수 없습니다.' }, { status: 404 })
    for (const path of ['/purchasing/orders', '/purchasing/payment-flow', '/purchasing/overdue', '/costs']) revalidatePath(path)
    return NextResponse.json(saved, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '구매수량 정정에 실패했습니다.' }, { status: 409 })
  }
}
