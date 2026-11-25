import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { createInspectionBoxLabelWorkbook } from '@/lib/purchasing/china-outbound-shipment-labels'
import { renderShipmentLabelWorkbookPrint } from '@/lib/purchasing/china-shipment-label-print'
import { getPurchasingItemLabelDataBySku } from '@/lib/purchasing/items'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getPurchaseInspection, issueSavedInspectionBoxNumbers, savePurchaseInspection } from '@/lib/purchasing/purchase-requests'
import { purchaseInspectionInputSchema } from '@/lib/purchasing/purchase-inspection'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user || user.mustChangePassword) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const id = z.string().uuid().safeParse((await params).id)
  if (!id.success) return NextResponse.json({ error: '발주 항목을 확인해주세요.' }, { status: 400 })
  const workspaceUserId = await getWorkspaceUserId(user.id)
  const data = await getPurchaseInspection(workspaceUserId, id.data)
  if (data && request.nextUrl.searchParams.get('format') === 'box-print') {
    const { inspection } = data
    const boxes = inspection.parcels.flatMap((parcel) => parcel.boxes)
    if (!boxes.length || boxes.some((box) => !inspection.boxNumbers?.[box.id])) {
      return NextResponse.json({ error: '박스번호를 먼저 발급해주세요.' }, { status: 409 })
    }
    const labelsBySku = await getPurchasingItemLabelDataBySku(workspaceUserId, [data.sku])
    const label = labelsBySku.get(data.sku.trim())
    const workbook = createInspectionBoxLabelWorkbook(boxes.map((box) => ({
      boxNo: inspection.boxNumbers![box.id]!,
      product: {
        sku: data.sku, productName: data.productName, optionName: data.optionName,
        chineseProductName: label?.chineseProductName ?? '', location: label?.location ?? '',
        quantity: box.quantity,
      },
    })))
    const nonce = randomUUID()
    return new NextResponse(renderShipmentLabelWorkbookPrint(workbook, data.sku, nonce), {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'`,
      },
    })
  }
  return data ? NextResponse.json(data, { headers: { 'Cache-Control': 'private, no-store' } })
    : NextResponse.json({ error: '발주 항목을 찾을 수 없습니다.' }, { status: 404 })
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user || user.mustChangePassword) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const id = z.string().uuid().safeParse((await params).id)
  if (!id.success) return NextResponse.json({ error: '발주 항목을 확인해주세요.' }, { status: 400 })
  const payload = await request.json().catch(() => null)
  if (payload?.action === 'issue-box-numbers') {
    try {
      const inspection = await issueSavedInspectionBoxNumbers(await getWorkspaceUserId(user.id), id.data)
      return NextResponse.json({ inspection }, { headers: { 'Cache-Control': 'private, no-store' } })
    } catch (error) {
      const cause = error instanceof Error ? error.cause ?? error : error
      const code = cause && typeof cause === 'object' && 'code' in cause ? cause.code : undefined
      console.error('Purchase inspection box number issuance failed', code ?? (cause instanceof Error ? cause.name : 'unknown'))
      return NextResponse.json({ error: code ? '박스번호를 발급하지 못했습니다. 잠시 후 다시 시도해주세요.' : error instanceof Error ? error.message : '박스번호 발급에 실패했습니다.' }, { status: 409 })
    }
  }
  const body = purchaseInspectionInputSchema.safeParse(payload)
  if (!body.success) {
    const message = body.error.issues[0]?.message ?? ''
    return NextResponse.json({ error: /[가-힣]/.test(message) ? message : '송장번호와 박스의 수량·크기·무게를 확인해주세요.' }, { status: 400 })
  }
  try {
    const saved = await savePurchaseInspection({ userId: await getWorkspaceUserId(user.id), actorId: user.id, id: id.data, data: body.data })
    if (!saved) return NextResponse.json({ error: '발주 항목을 찾을 수 없습니다.' }, { status: 404 })
    for (const path of ['/purchasing/orders', '/purchasing/payment-flow', '/purchasing/overdue']) revalidatePath(path)
    return NextResponse.json(saved, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '검수 저장에 실패했습니다.' }, { status: 409 })
  }
}
