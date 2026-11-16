import { revalidatePath } from 'next/cache'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { assertMenuAccess } from '@/lib/auth/menu-access'
import { createClient } from '@/lib/auth/server'
import { deleteQuoteClient, updateQuoteClient } from '@/lib/quotes/store'

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

async function requestInput(params: Promise<{ clientId: string }>) {
  const current = await workspace()
  if (!current) return { error: NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 }) }
  const parsed = z.object({ clientId: z.string().uuid() }).safeParse(await params)
  if (!parsed.success) return { error: NextResponse.json({ error: '거래처를 확인해주세요.' }, { status: 400 }) }
  return { current, clientId: parsed.data.clientId }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '거래처 정보를 처리하지 못했습니다.'
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ clientId: string }> }) {
  try {
    const input = await requestInput(params)
    if ('error' in input) return input.error
    const body = z.object({ client: clientSchema }).safeParse(await request.json().catch(() => null))
    if (!body.success) return NextResponse.json({ error: '거래처 정보를 확인해주세요.' }, { status: 400 })
    const client = await updateQuoteClient({ ...input.current, id: input.clientId, client: body.data.client })
    if (!client) return NextResponse.json({ error: '거래처를 찾을 수 없습니다.' }, { status: 404 })
    revalidatePath('/purchasing/quotes')
    return NextResponse.json({ client })
  } catch (error) {
    console.error('[quote-clients:patch]', error)
    return NextResponse.json({ error: errorMessage(error) }, { status: 400 })
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ clientId: string }> }) {
  try {
    const input = await requestInput(params)
    if ('error' in input) return input.error
    const deleted = await deleteQuoteClient({ userId: input.current.userId, id: input.clientId })
    if (!deleted) return NextResponse.json({ error: '거래처를 찾을 수 없습니다.' }, { status: 404 })
    revalidatePath('/purchasing/quotes')
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[quote-clients:delete]', error)
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 })
  }
}
