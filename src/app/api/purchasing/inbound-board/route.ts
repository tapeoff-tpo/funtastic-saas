import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getUserMenuAccess } from '@/lib/auth/menu-access'
import { canUseMenu } from '@/lib/auth/menu-permissions'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getChinaOutboundShipmentDetail } from '@/lib/purchasing/saas-china-outbound'
import { getPurchasingItemLocationsBySku } from '@/lib/purchasing/items'
import { getInboundPost, listInboundPosts, publishInboundPost, updateInboundDates } from '@/lib/purchasing/inbound-board-store'
import { exportKoreaShippingDocument } from '@/lib/purchasing/korea-shipping-document'
import { renderChinaImportPreview } from '@/lib/purchasing/china-import-preview'
export const runtime = 'nodejs'
const headers = { 'Cache-Control': 'private, no-store' }
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0,10) === value
})
const dates = z.object({ expectedDate: date, receivedDate: date.nullable() })
async function authorize() {
  const user = await getCurrentUser()
  if (!user || user.mustChangePassword) return { response: NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 }) }
  const access = await getUserMenuAccess(user.id, user)
  if (!access || !canUseMenu(access, '/purchasing/import-documents')) return { response: NextResponse.json({ error: '무역서류 권한이 필요합니다.' }, { status: 403 }) }
  return { userId: await getWorkspaceUserId(user.id), actorId: user.id }
}
export async function GET(request: Request) {
  try {
    const auth = await authorize()
    if (auth.response) return auth.response
    const params = new URL(request.url).searchParams
    const id = params.get('id')
    if (!id) return NextResponse.json({ posts: await listInboundPosts(auth.userId, (params.get('q') ?? '').slice(0,200)) }, { headers })
    if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: '게시글을 찾을 수 없습니다.' }, { status: 404 })
    const post = await getInboundPost(auth.userId, id)
    if (!post) return NextResponse.json({ error: '게시글을 찾을 수 없습니다.' }, { status: 404 })
    const group = params.get('group') === 'box' ? 'box' : 'pallet'
    const format = params.get('format')
    if (format === 'excel' || format === 'print') {
      const buffer = await exportKoreaShippingDocument(post.detail, group, `${post.title} · 입고 예정 ${post.expectedDate}${post.receivedDate ? ` · 실제 입고 ${post.receivedDate}` : ''}`)
      if (format === 'print') return new NextResponse(await renderChinaImportPreview(buffer), { headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' } })
      return new NextResponse(new Uint8Array(buffer), { headers: { ...headers, 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(post.title + '.xlsx')}` } })
    }
    return NextResponse.json({ post }, { headers })
  } catch (error) {
    console.error('Inbound board read:', error)
    return NextResponse.json({ error: '입고리스트를 불러오지 못했습니다.' }, { status: 500 })
  }
}
export async function POST(request: Request) {
  try {
    const auth = await authorize()
    if (auth.response) return auth.response
    const parsed = dates.extend({ shipmentId: z.string().uuid(), title: z.string().trim().min(1).max(200), note: z.string().trim().max(3000).default('') }).safeParse(await request.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: '제목과 입고 날짜를 확인해주세요.' }, { status: 400 })
    const detail = await getChinaOutboundShipmentDetail({ userId: auth.userId, shipmentId: parsed.data.shipmentId })
    if (!detail) return NextResponse.json({ error: '출고작업을 찾을 수 없습니다.' }, { status: 404 })
    const locations = await getPurchasingItemLocationsBySku(auth.userId, detail.items.map((item) => item.sku))
    const snapshot = { ...detail, items: detail.items.map((item) => ({ ...item, location: locations.get(item.sku) || '' })) }
    const result = await publishInboundPost({ ...auth, ...parsed.data, detail: snapshot })
    return NextResponse.json(result, { status: result.created ? 201 : 200, headers })
  } catch (error) {
    console.error('Inbound board publish:', error)
    return NextResponse.json({ error: '입고리스트를 게시하지 못했습니다.' }, { status: 400 })
  }
}
export async function PATCH(request: Request) {
  try {
    const auth = await authorize()
    if (auth.response) return auth.response
    const parsed = dates.extend({ id: z.string().uuid(), revision: z.number().int().positive() }).safeParse(await request.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: '입고 날짜를 확인해주세요.' }, { status: 400 })
    const post = await updateInboundDates({ ...auth, ...parsed.data })
    if (!post) return NextResponse.json({ error: '다른 사용자가 수정했습니다. 게시글을 다시 열어주세요.' }, { status: 409 })
    return NextResponse.json({ post }, { headers })
  } catch (error) {
    console.error('Inbound board dates:', error)
    return NextResponse.json({ error: '입고 날짜를 저장하지 못했습니다.' }, { status: 400 })
  }
}
