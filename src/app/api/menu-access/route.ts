import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getUserMenuAccess } from '@/lib/auth/menu-access'

export async function GET() {
  const user = await getCurrentUser()
  const access = user ? await getUserMenuAccess(user.id) : null
  return access ? NextResponse.json(access, { headers: { 'Cache-Control': 'private, no-store' } })
    : NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
}
