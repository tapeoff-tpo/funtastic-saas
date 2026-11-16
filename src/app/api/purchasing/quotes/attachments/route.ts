import { revalidatePath } from 'next/cache'
import { NextRequest, NextResponse } from 'next/server'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { assertMenuAccess } from '@/lib/auth/menu-access'
import { createClient } from '@/lib/auth/server'
import {
  addQuoteSaleAttachment,
  listQuoteSaleAttachments,
  MAX_QUOTE_SALE_ATTACHMENT_BYTES,
} from '@/lib/quotes/store'

export const runtime = 'nodejs'

async function workspace() {
  await assertMenuAccess('/purchasing/quotes')
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  return { actorUserId: user.id, userId: await getWorkspaceUserId(user.id) }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '첨부파일을 처리하지 못했습니다.'
}

export async function GET(request: NextRequest) {
  try {
    const current = await workspace()
    if (!current) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
    const saleId = request.nextUrl.searchParams.get('saleId')?.trim()
    if (!saleId) return NextResponse.json({ error: '영업건을 확인해주세요.' }, { status: 400 })
    const attachments = await listQuoteSaleAttachments({ userId: current.userId, saleClientId: saleId })
    return NextResponse.json({ attachments })
  } catch (error) {
    console.error('[quote-attachments:get]', error)
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const current = await workspace()
    if (!current) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
    const formData = await request.formData()
    const saleId = String(formData.get('saleId') ?? '').trim()
    const file = formData.get('file')
    if (!saleId || !(file instanceof File)) {
      return NextResponse.json({ error: '영업건과 첨부파일을 확인해주세요.' }, { status: 400 })
    }
    if (file.size <= 0 || file.size > MAX_QUOTE_SALE_ATTACHMENT_BYTES) {
      return NextResponse.json({ error: '첨부파일은 파일당 4MB 이하만 저장할 수 있습니다.' }, { status: 400 })
    }
    const attachment = await addQuoteSaleAttachment({
      ...current,
      saleClientId: saleId,
      fileName: file.name,
      contentType: file.type || 'application/octet-stream',
      fileBuffer: await file.arrayBuffer(),
    })
    revalidatePath('/purchasing/quotes')
    return NextResponse.json({ attachment }, { status: 201 })
  } catch (error) {
    console.error('[quote-attachments:post]', error)
    return NextResponse.json({ error: errorMessage(error) }, { status: 400 })
  }
}
