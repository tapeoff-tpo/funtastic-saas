import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { createInspectionBoxLabelWorkbook } from '@/lib/purchasing/china-outbound-shipment-labels'
import { renderShipmentLabelWorkbookPrint } from '@/lib/purchasing/china-shipment-label-print'
import { listInspectionPrintRequests, recordInspectionPrintRequest } from '@/lib/purchasing/purchase-inspection-print-history'
import { listInspectionLabelFiles } from '@/lib/purchasing/purchase-inspection-label-files'
import { INSPECTION_LABEL_SOURCES } from '@/lib/purchasing/purchase-inspection-label-types'
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
  return data ? NextResponse.json({ ...data, printRequests: await listInspectionPrintRequests(workspaceUserId, id.data) }, { headers: { 'Cache-Control': 'private, no-store' } })
    : NextResponse.json({ error: '발주 항목을 찾을 수 없습니다.' }, { status: 404 })
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user || user.mustChangePassword) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const id = z.string().uuid().safeParse((await params).id)
  if (!id.success) return NextResponse.json({ error: '발주 항목을 확인해주세요.' }, { status: 400 })
  const payload = await request.json().catch(() => null)
  if (payload?.action === 'record-print') {
    const target = z.union([
      z.object({ kind: z.literal('box') }),
      z.object({ kind: z.literal('file'), fileId: z.uuid(), source: z.enum(INSPECTION_LABEL_SOURCES) }),
    ]).safeParse(payload)
    if (!target.success) return NextResponse.json({ error: '인쇄할 스티커를 확인해주세요.' }, { status: 400 })
    try {
      const userId = await getWorkspaceUserId(user.id)
      const data = await getPurchaseInspection(userId, id.data)
      if (!data) return NextResponse.json({ error: '발주 항목을 찾을 수 없습니다.' }, { status: 404 })
      const scope = { userId, itemId: id.data, actorId: user.id }
      if (target.data.kind === 'box') {
        const numbers = data.inspection.parcels.flatMap((parcel) => parcel.boxes.map((box) => data.inspection.boxNumbers?.[box.id]))
        if (!numbers.length || !numbers.every((number): number is string => Boolean(number))) {
          return NextResponse.json({ error: '박스번호를 먼저 발급해주세요.' }, { status: 409 })
        }
        const entry = await recordInspectionPrintRequest({ ...scope, kind: 'box', boxNumbers: numbers, fileName: null })
        return NextResponse.json({ entry }, { status: 201 })
      }
      const { fileId, source } = target.data
      const file = (await listInspectionLabelFiles(userId, data.sku)).find((file) => file.id === fileId && file.source === source)
      if (!file) return NextResponse.json({ error: '스티커 파일을 찾을 수 없습니다.' }, { status: 404 })
      const entry = await recordInspectionPrintRequest({ ...scope, kind: file.kind, boxNumbers: null, fileName: file.fileName })
      return NextResponse.json({ entry }, { status: 201 })
    } catch (error) {
      console.error('Purchase inspection print request recording failed', error instanceof Error ? error.name : 'unknown')
      return NextResponse.json({ error: '인쇄 요청 이력을 저장하지 못했습니다.' }, { status: 500 })
    }
  }
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
    if (saved.status === 'china_arrived') {
      revalidatePath('/purchasing/saas-china-inventory')
      revalidatePath('/purchasing/china-shipments')
    }
    return NextResponse.json(saved, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '검수 저장에 실패했습니다.' }, { status: 409 })
  }
}
