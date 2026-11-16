import { revalidatePath } from 'next/cache'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { assertMenuAccess } from '@/lib/auth/menu-access'
import { createClient } from '@/lib/auth/server'
import { createQuoteClient, listQuoteClients } from '@/lib/quotes/store'

export const runtime = 'nodejs'

const clientSchema = z.object({
  clientName: z.string().max(1_000).default(''),
  representativeName: z.string().max(300).default(''),
  contactName: z.string().max(300).default(''),
  contactPhone: z.string().max(200).default(''),
  businessRegistrationNumber: z.string().max(100).default(''),
  taxInvoiceEmail: z.string().max(320).default(''),
  address: z.string().max(2_000).default(''),
  recipientName: z.string().max(300).default(''),
  recipientTitle: z.string().max(300).default(''),
  recipientPhone: z.string().max(200).default(''),
  deliveryMessage: z.string().max(2_000).default(''),
  memo: z.string().max(8_000).default(''),
})

async function workspace() {
  await assertMenuAccess('/purchasing/quotes')
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  return { actorUserId: user.id, userId: await getWorkspaceUserId(user.id) }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '거래처 정보를 처리하지 못했습니다.'
}

export async function GET() {
  try {
    const current = await workspace()
    if (!current) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
    return NextResponse.json({ clients: await listQuoteClients(current.userId) })
  } catch (error) {
    console.error('[quote-clients:get]', error)
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const current = await workspace()
    if (!current) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
    const body = z.object({ client: clientSchema }).safeParse(await request.json().catch(() => null))
    if (!body.success) return NextResponse.json({ error: '거래처 정보를 확인해주세요.' }, { status: 400 })
    const client = await createQuoteClient({ ...current, client: body.data.client })
    revalidatePath('/purchasing/quotes')
    return NextResponse.json({ client }, { status: 201 })
  } catch (error) {
    console.error('[quote-clients:post]', error)
    return NextResponse.json({ error: errorMessage(error) }, { status: 400 })
  }
}
