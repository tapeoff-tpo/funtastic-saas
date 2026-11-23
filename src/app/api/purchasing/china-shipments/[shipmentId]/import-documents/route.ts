import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { calculateShipmentCost } from '@/lib/purchasing/shipment-cost'
import { confirmShipmentCost } from '@/lib/purchasing/shipment-cost-store'
import { z } from 'zod'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getUserMenuAccess } from '@/lib/auth/menu-access'
import { canUseMenu } from '@/lib/auth/menu-permissions'
import { exportChinaImportDocument, prepareImportDocument } from '@/lib/purchasing/china-import-document'
import { getAllPurchasingItems, getPurchasingItemTradeDataBySku } from '@/lib/purchasing/items'
import { getChinaOutboundShipmentDetail } from '@/lib/purchasing/saas-china-outbound'
import { getImportDocumentProductImages } from '@/lib/purchasing/import-document-product-images'

export const runtime = 'nodejs'
const text = z.string().trim().min(1).max(500)
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
})
const schema = z.object({
  snapshot: z.string().length(64),
  invoiceNo: text, invoiceDate: date, sailingDate: date,
  exporter: text, importer: text, importerAddress: text,
  loadingPort: text, destinationPort: text, paymentTerms: text,
  palletTareKg: z.number().finite().min(0).max(10000),
  palletExtraCbm: z.number().finite().min(0).max(1000),
  items: z.record(z.string().uuid(), z.object({ englishName: text, unitPriceCny: z.number().finite().min(0).max(100000000) })),
  boxes: z.record(z.string().uuid(), z.object({ grossWeightKg: z.number().finite().positive().max(1000000), cbm: z.number().finite().positive().max(10000) })),
})
const costSchema = z.object({
  snapshot: z.string().length(64),
  bl: text,
  date,
  inputs: z.object({
    charges: z.number().int().nonnegative(), vat: z.number().int().nonnegative(),
    exchangeRate: z.number().positive(),
    prices: z.record(z.string().uuid(), z.number().nonnegative()),
    mixedBoxCbm: z.record(z.string().uuid(), z.number().positive()),
  }),
})
type Context = { params: Promise<{ shipmentId: string }> }

async function load(context: Context) {
  const user = await getCurrentUser()
  if (!user || user.mustChangePassword) return { response: NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 }) }
  const access = await getUserMenuAccess(user.id, user)
  if (!access || !['/purchasing/china-shipments', '/purchasing/import-documents'].some((menu) => canUseMenu(access, menu))) {
    return { response: NextResponse.json({ error: '인보이스·패킹리스트를 사용할 권한이 없습니다.' }, { status: 403 }) }
  }
  const { shipmentId } = await context.params
  if (!z.string().uuid().safeParse(shipmentId).success) return { response: NextResponse.json({ error: '출고작업을 찾을 수 없습니다.' }, { status: 404 }) }
  const userId = await getWorkspaceUserId(user.id)
  const detail = await getChinaOutboundShipmentDetail({ userId, shipmentId })
  if (!detail) return { response: NextResponse.json({ error: '출고작업을 찾을 수 없습니다.' }, { status: 404 }) }
  const metadata = await getPurchasingItemTradeDataBySku(userId, detail.items.map((item) => item.sku))
  const prepared = prepareImportDocument(detail, metadata)
  const snapshot = createHash('sha256').update(JSON.stringify({ prepared, boxes: detail.boxes, pallets: detail.pallets, allocations: detail.boxItems })).digest('hex')
  return { detail, metadata, prepared, snapshot, userId, requestedByUserId: user.id }
}

export async function GET(_request: Request, context: Context) {
  try {
    const loaded = await load(context)
    if (loaded.response) return loaded.response
    return NextResponse.json({ ...loaded.prepared, snapshot: loaded.snapshot, costPacking: { shipment: loaded.detail.shipment, items: loaded.detail.items, boxes: loaded.detail.boxes, pallets: loaded.detail.pallets, boxItems: loaded.detail.boxItems } }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    console.error('China import document preparation:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : '인보이스·패킹리스트 정보를 불러오지 못했습니다.' }, { status: 400 })
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const loaded = await load(context)
    if (loaded.response) return loaded.response
    const body = await request.json().catch(() => null)
    if (body?.intent === 'confirm-cost') {
      const cost = costSchema.safeParse(body)
      if (!cost.success) return NextResponse.json({ error: 'B/L 번호, 원가 기준일 및 계산 입력값을 확인해주세요.' }, { status: 400 })
      if (cost.data.snapshot !== loaded.snapshot) return NextResponse.json({ error: '출고정보가 변경되었습니다. 새로고침 후 다시 계산해주세요.' }, { status: 409 })
      const result = calculateShipmentCost(loaded.detail, cost.data.inputs)
      const { shipmentId } = await context.params
      const saved = await confirmShipmentCost({ ...cost.data, userId: loaded.userId, shipmentId, actorId: loaded.requestedByUserId, result })
      if (!saved) return NextResponse.json({ error: '이미 원가를 확정한 출고 회차입니다.' }, { status: 409 })
      revalidatePath('/costs')
      return NextResponse.json({ saved: true })
    }
    const parsed = schema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: '문서 기본정보·영문명·단가·박스 중량·CBM을 확인해주세요.' }, { status: 400 })
    if (parsed.data.snapshot !== loaded.snapshot) return NextResponse.json({ error: '출고정보 또는 품목정보가 변경되었습니다. 인보이스·패킹리스트를 새로고침해주세요.' }, { status: 409 })
    const [productImages, allItems] = await Promise.all([
      getImportDocumentProductImages({
        userId: loaded.userId, requestedByUserId: loaded.requestedByUserId,
        items: loaded.prepared.items.filter((item) => !item.hsCode.trim())
          .map((item) => ({ sku: item.sku, productName: item.productName })),
      }),
      getAllPurchasingItems(loaded.userId),
    ])
    const existingHsItems = allItems.filter((item) => item.data['HS CODE']?.trim()).map((item) => ({
      sku: item.data['품목코드']!, productName: item.data['품목명']!,
      optionName: item.data['규격정보'], hsCode: item.data['HS CODE']!,
    }))
    const buffer = await exportChinaImportDocument(loaded.detail, loaded.metadata, parsed.data, { productImages, existingHsItems })
    const filename = `${loaded.prepared.shipmentNo.replace(/[\\/:*?"<>|]/g, '_')}_INV_PL.xlsx`
    return new NextResponse(new Uint8Array(buffer), { headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Cache-Control': 'private, no-store',
    } })
  } catch (error) {
    console.error('China import document export:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : '인보이스·패킹리스트를 만들지 못했습니다.' }, { status: 400 })
  }
}
