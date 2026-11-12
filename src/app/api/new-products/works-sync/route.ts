import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getCurrentUser } from '@/lib/auth/current-user'
import { syncWorksProducts } from '@/lib/new-products/works-sync'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60
export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({error:'로그인이 필요합니다.'},{status:401})
  try {
    const text = await request.text()
    if (text.length > 3_500_000) throw new Error('요청 크기가 너무 큽니다. 상품을 나누어 보내주세요.')
    const body = JSON.parse(text)
    const result = await syncWorksProducts({userId:await getWorkspaceUserId(user.id),requestedByUserId:user.id,items:body.items,stageMappings:body.stageMappings,preview:body.preview!==false,runId:body.runId})
    if (!result.preview) revalidatePath('/new-products')
    return NextResponse.json(result,{headers:{'Cache-Control':'private, no-store'}})
  } catch(error) {
    return NextResponse.json({error:error instanceof Error?error.message:'WORKS 동기화에 실패했습니다.'},{status:400})
  }
}
