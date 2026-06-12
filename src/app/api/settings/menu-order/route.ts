import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  deleteSidebarMenuOrderForUser,
  getSidebarMenuOrder,
  parseSidebarMenuOrder,
  saveSidebarMenuOrderForUser,
} from '@/lib/settings/sidebar-menu-settings'

export async function GET() {
  const userId = await authenticatedUserId()
  if (!userId) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })

  return NextResponse.json({ order: await getSidebarMenuOrder(userId) })
}

export async function PUT(req: NextRequest) {
  const userId = await authenticatedUserId()
  if (!userId) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })

  try {
    const body = await req.json()
    const order = parseSidebarMenuOrder(body.order)
    await saveSidebarMenuOrderForUser(userId, order)
    return NextResponse.json({ order })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '메뉴 순서를 저장하지 못했습니다.' },
      { status: 400 },
    )
  }
}

export async function DELETE() {
  const userId = await authenticatedUserId()
  if (!userId) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })

  await deleteSidebarMenuOrderForUser(userId)
  return NextResponse.json({ ok: true })
}

async function authenticatedUserId(): Promise<string | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user?.id ?? null
}
