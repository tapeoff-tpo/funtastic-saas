import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getCurrentUser } from '@/lib/auth/current-user'
import { exportChinaImportDocument, prepareImportDocument } from '@/lib/purchasing/china-import-document'
import { getPurchasingItemTradeDataBySku } from '@/lib/purchasing/items'
import { getChinaOutboundShipmentDetail } from '@/lib/purchasing/saas-china-outbound'

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
type Context = { params: Promise<{ shipmentId: string }> }

async function load(context: Context) {
  const user = await getCurrentUser()
  if (!user) return { response: NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 }) }
  const { shipmentId } = await context.params
  if (!z.string().uuid().safeParse(shipmentId).success) return { response: NextResponse.json({ error: '출고작업을 찾을 수 없습니다.' }, { status: 404 }) }
  const userId = await getWorkspaceUserId(user.id)
  const detail = await getChinaOutboundShipmentDetail({ userId, shipmentId })
  if (!detail) return { response: NextResponse.json({ error: '출고작업을 찾을 수 없습니다.' }, { status: 404 }) }
  const metadata = await getPurchasingItemTradeDataBySku(userId, detail.items.map((item) => item.sku))
  const prepared = prepareImportDocument(detail, metadata)
  const snapshot = createHash('sha256').update(JSON.stringify({ prepared, allocations: detail.boxItems })).digest('hex')
  return { detail, metadata, prepared, snapshot }
}

export async function GET(_request: Request, context: Context) {
  try {
    const loaded = await load(context)
    if (loaded.response) return loaded.response
    return NextResponse.json({ ...loaded.prepared, snapshot: loaded.snapshot }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    console.error('China import document preparation:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : '수입문서 정보를 불러오지 못했습니다.' }, { status: 400 })
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const loaded = await load(context)
    if (loaded.response) return loaded.response
    const parsed = schema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: '문서 기본정보·영문명·단가·박스 중량·CBM을 확인해주세요.' }, { status: 400 })
    if (parsed.data.snapshot !== loaded.snapshot) return NextResponse.json({ error: '출고정보 또는 품목정보가 변경되었습니다. 창을 닫고 수입문서를 다시 열어주세요.' }, { status: 409 })
    const buffer = await exportChinaImportDocument(loaded.detail, loaded.metadata, parsed.data)
    const filename = `${loaded.prepared.shipmentNo.replace(/[\\/:*?"<>|]/g, '_')}_INV_PL.xlsx`
    return new NextResponse(new Uint8Array(buffer), { headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Cache-Control': 'private, no-store',
    } })
  } catch (error) {
    console.error('China import document export:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : '수입문서를 만들지 못했습니다.' }, { status: 400 })
  }
}
