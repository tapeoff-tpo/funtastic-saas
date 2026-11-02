import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getSavedNewProductImage } from '@/lib/new-products/catalogue-images'

export const runtime = 'nodejs'
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user || user.mustChangePassword) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const id = z.string().uuid().safeParse((await context.params).id)
  if (!id.success) return NextResponse.json({ error: '이미지를 찾을 수 없습니다.' }, { status: 404 })
  const image = await getSavedNewProductImage(await getWorkspaceUserId(user.id), id.data)
  if (!image) return NextResponse.json({ error: '이미지를 찾을 수 없습니다.' }, { status: 404 })
  return new NextResponse(Buffer.from(image.fileData, 'base64'), { headers: { 'Content-Type': image.contentType, 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff' } })
}
