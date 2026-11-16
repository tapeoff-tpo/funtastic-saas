import { revalidatePath } from 'next/cache'
import { NextRequest, NextResponse } from 'next/server'
import { assertMenuAccess } from '@/lib/auth/menu-access'
import { createClient } from '@/lib/auth/server'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import {
  deleteQuoteRecord,
  deleteQuoteSale,
  getQuoteWorkspace,
  markQuotePrinted,
  saveQuoteRecord,
  saveQuoteSale,
  type QuoteWorkspaceQuote,
  type QuoteWorkspaceSale,
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
  return error instanceof Error ? error.message : '견적서 데이터를 처리하지 못했습니다.'
}

export async function GET() {
  try {
    const current = await workspace()
    if (!current) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
    return NextResponse.json(await getQuoteWorkspace(current.userId))
  } catch (error) {
    console.error('[quote-workspace:get]', error)
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const current = await workspace()
    if (!current) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
    const body = await request.json().catch(() => null) as {
      action?: string
      sale?: QuoteWorkspaceSale
      quote?: QuoteWorkspaceQuote
      sales?: QuoteWorkspaceSale[]
      quotes?: QuoteWorkspaceQuote[]
    } | null
    if (!body) return NextResponse.json({ error: '요청 내용을 확인해주세요.' }, { status: 400 })

    if (body.action === 'save-sale' && body.sale) {
      const sale = await saveQuoteSale({ ...current, sale: body.sale })
      revalidatePath('/purchasing/quotes')
      return NextResponse.json({ sale })
    }
    if (body.action === 'save-quote' && body.quote) {
      const quote = await saveQuoteRecord({ ...current, quote: body.quote })
      revalidatePath('/purchasing/quotes')
      return NextResponse.json({ quote })
    }
    if (body.action === 'migrate-browser-history') {
      const sales = Array.isArray(body.sales) ? body.sales.slice(0, 500) : []
      const quotes = Array.isArray(body.quotes) ? body.quotes.slice(0, 500) : []
      for (const sale of sales) await saveQuoteSale({ ...current, sale })
      for (const quote of quotes) await saveQuoteRecord({ ...current, quote })
      revalidatePath('/purchasing/quotes')
      return NextResponse.json(await getQuoteWorkspace(current.userId))
    }
    return NextResponse.json({ error: '지원하지 않는 저장 요청입니다.' }, { status: 400 })
  } catch (error) {
    console.error('[quote-workspace:post]', error)
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const current = await workspace()
    if (!current) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
    const body = await request.json().catch(() => null) as { action?: string; quoteId?: string } | null
    if (body?.action !== 'mark-printed' || !body.quoteId) {
      return NextResponse.json({ error: '인쇄 기록을 확인해주세요.' }, { status: 400 })
    }
    const quote = await markQuotePrinted({ userId: current.userId, clientId: body.quoteId })
    return NextResponse.json({ quote })
  } catch (error) {
    console.error('[quote-workspace:patch]', error)
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const current = await workspace()
    if (!current) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
    const body = await request.json().catch(() => null) as { target?: string; id?: string } | null
    if (!body?.id) return NextResponse.json({ error: '삭제할 대상을 확인해주세요.' }, { status: 400 })
    if (body.target === 'sale') await deleteQuoteSale({ userId: current.userId, clientId: body.id })
    else if (body.target === 'quote') await deleteQuoteRecord({ userId: current.userId, clientId: body.id })
    else return NextResponse.json({ error: '삭제 대상을 확인해주세요.' }, { status: 400 })
    revalidatePath('/purchasing/quotes')
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[quote-workspace:delete]', error)
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 })
  }
}
