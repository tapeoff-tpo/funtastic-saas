import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ user: vi.fn(), access: vi.fn(), workspace: vi.fn(), detail: vi.fn(), locations: vi.fn().mockResolvedValue(new Map()), metadata: vi.fn(), prepare: vi.fn(), export: vi.fn(), images: vi.fn(), allItems: vi.fn(), calculate: vi.fn(), confirm: vi.fn(), revalidate: vi.fn(), preview: vi.fn(), draft: vi.fn(), saveDraft: vi.fn() }))
vi.mock('@/lib/auth/current-user', () => ({ getCurrentUser: mocks.user }))
vi.mock('@/lib/auth/menu-access', () => ({ getUserMenuAccess: mocks.access }))
vi.mock('@/lib/admin-accounts/queries', () => ({ getWorkspaceUserId: mocks.workspace }))
vi.mock('@/lib/purchasing/saas-china-outbound', () => ({ getChinaOutboundShipmentDetail: mocks.detail }))
vi.mock('@/lib/purchasing/items', () => ({ getPurchasingItemLocationsBySku: mocks.locations, getPurchasingItemTradeDataBySku: mocks.metadata, getAllPurchasingItems: mocks.allItems }))
vi.mock('@/lib/purchasing/china-import-document', () => ({ prepareImportDocument: mocks.prepare, exportChinaImportDocument: mocks.export }))
vi.mock('@/lib/purchasing/import-document-product-images', () => ({ getImportDocumentProductImages: mocks.images }))
vi.mock('@/lib/purchasing/china-import-preview', () => ({ renderChinaImportPreview: mocks.preview }))
vi.mock('@/lib/purchasing/china-import-draft-store', () => ({ getImportDocumentDraft: mocks.draft, saveImportDocumentDraft: mocks.saveDraft }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }))
vi.mock('@/lib/purchasing/shipment-cost', () => ({ calculateShipmentCost: mocks.calculate }))
vi.mock('@/lib/purchasing/shipment-cost-store', () => ({ confirmShipmentCost: mocks.confirm }))
import { GET, POST } from './route'
const shipmentId = '11111111-1111-4111-8111-111111111111'
const context = () => ({ params: Promise.resolve({ shipmentId }) })
const request = (data: unknown) => new Request('http://localhost/documents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
describe('import document export route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.draft.mockResolvedValue(null)
    mocks.user.mockResolvedValue({ id: 'admin2' })
    mocks.access.mockResolvedValue({ superAdmin: false, allowedMenus: ['/purchasing/import-documents'] })
    mocks.workspace.mockResolvedValue('shared-owner')
    mocks.detail.mockResolvedValue({ items: [{ sku: 'SKU-A' }], boxItems: [] })
    mocks.metadata.mockResolvedValue(new Map())
    mocks.prepare.mockReturnValue({ shipmentNo: 'CN-1', items: [], boxes: [] })
    mocks.export.mockResolvedValue(Buffer.from('xlsx'))
    mocks.images.mockResolvedValue(new Map())
    mocks.allItems.mockResolvedValue([])
  })
  it('requires authentication before reading operational data', async () => {
    mocks.user.mockResolvedValue(null)
    expect((await GET(new Request('http://localhost'), context())).status).toBe(401)
    expect(mocks.detail).not.toHaveBeenCalled()
  })
  it('looks up both shipment and item prices under the canonical workspace', async () => {
    const response = await GET(new Request('http://localhost'), context())
    expect(response.status).toBe(200)
    expect(mocks.detail).toHaveBeenCalledWith({ userId: 'shared-owner', shipmentId })
    expect(mocks.metadata).toHaveBeenCalledWith('shared-owner', ['SKU-A'])
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(mocks.images).not.toHaveBeenCalled()
    expect(mocks.allItems).not.toHaveBeenCalled()
  })
  it('recalculates on the server and records the confirmed cost under the workspace owner', async () => {
    const snapshot = (await (await GET(new Request('http://localhost'), context())).json()).snapshot
    const inputs = { charges: 2538506, vat: 1136460, exchangeRate: 200, prices: {}, mixedBoxCbm: {} }
    const result = { distributable: 1402046, rows: [{ sku: 'SKU-A', unitCost: 4000 }] }
    const body = { intent: 'confirm-cost', snapshot, bl: 'BL-01', date: '2026-10-19', inputs }
    mocks.calculate.mockReturnValue(result)
    mocks.confirm.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    expect((await POST(request({ ...body, snapshot: 'a'.repeat(64) }), context())).status).toBe(409)
    expect(mocks.calculate).not.toHaveBeenCalled()
    expect((await POST(request(body), context())).status).toBe(200)
    expect(mocks.calculate).toHaveBeenCalledWith({ items: [{ sku: 'SKU-A' }], boxItems: [] }, inputs)
    expect(mocks.confirm).toHaveBeenCalledWith({
      userId: 'shared-owner', actorId: 'admin2', shipmentId, snapshot, bl: 'BL-01', date: '2026-10-19', inputs, result,
    })
    expect(mocks.revalidate).toHaveBeenCalledWith('/costs')
    expect((await POST(request(body), context())).status).toBe(409)
    expect(mocks.export).not.toHaveBeenCalled()
  })
  it('embeds only missing-HS shipment images from the canonical workspace after snapshot validation', async () => {
    mocks.prepare.mockReturnValue({ shipmentNo: 'CN-1', items: [
      { sku: 'SKU-A', productName: '기존 상품', hsCode: '7013' },
      { sku: 'SKU-B', productName: '미등록 상품', hsCode: '  ' },
    ], boxes: [] })
    const images = new Map([['SKU-B', { error: 'missing' }]])
    mocks.images.mockResolvedValue(images)
    mocks.allItems.mockResolvedValue([
      { data: { '품목코드': 'OUTSIDE-SHIPMENT', '품목명': '다른 기존 상품', '규격정보': '대', 'HS CODE': '0392.10-0000' } },
      { data: { '품목코드': 'EMPTY-HS', '품목명': '미등록 상품', 'HS CODE': ' ' } },
    ])
    const snapshot = (await (await GET(new Request('http://localhost'), context())).json()).snapshot
    const response = await POST(request({
      snapshot, invoiceNo: 'CN-1', invoiceDate: '2026-10-30', sailingDate: '2026-10-30',
      exporter: 'Exporter', importer: 'Importer', importerAddress: 'Seoul', loadingPort: 'WEIHAI', destinationPort: 'INCHEON', paymentTerms: 'T/T',
      palletTareKg: 0, palletExtraCbm: 0, items: {}, boxes: {},
    }), context())
    expect(response.status).toBe(200)
    expect(mocks.images).toHaveBeenCalledWith({ userId: 'shared-owner', requestedByUserId: 'admin2', items: [{ sku: 'SKU-B', productName: '미등록 상품' }] })
    expect(mocks.allItems).toHaveBeenCalledWith('shared-owner')
    expect(mocks.export).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), {
      productImages: images,
      existingHsItems: [{ sku: 'OUTSIDE-SHIPMENT', productName: '다른 기존 상품', optionName: '대', hsCode: '0392.10-0000' }],
    }, true)
  })
  it('rejects a stale shipment or item snapshot before generating the document', async () => {
    const response = await POST(request({
      snapshot: 'a'.repeat(64), invoiceNo: 'CN-1', invoiceDate: '2026-10-30', sailingDate: '2026-10-30',
      exporter: 'Exporter', importer: 'Importer', importerAddress: 'Seoul', loadingPort: 'WEIHAI', destinationPort: 'INCHEON', paymentTerms: 'T/T',
      palletTareKg: 0, palletExtraCbm: 0, items: {}, boxes: {},
    }), context())
    expect(response.status).toBe(409)
    expect(mocks.export).not.toHaveBeenCalled()
    expect(mocks.images).not.toHaveBeenCalled()
    expect(mocks.allItems).not.toHaveBeenCalled()
  })
  it('rejects malformed dates and does not silently treat missing information as zero', async () => {
    const response = await POST(request({ invoiceDate: '2026-02-31' }), context())
    expect(response.status).toBe(400)
    expect(mocks.export).not.toHaveBeenCalled()
  })
  it('keeps document access independent of shipment editing and blocks unrelated menu access', async () => {
    expect((await GET(new Request('http://localhost'), context())).status).toBe(200)
    mocks.access.mockResolvedValue({ superAdmin: false, allowedMenus: ['/purchasing/china-shipments'] })
    expect((await GET(new Request('http://localhost'), context())).status).toBe(200)
    vi.clearAllMocks()
    mocks.access.mockResolvedValue({ superAdmin: false, allowedMenus: ['/purchasing/orders'] })
    expect((await POST(request({}), context())).status).toBe(403)
    expect(mocks.detail).not.toHaveBeenCalled()
    expect(mocks.export).not.toHaveBeenCalled()
  })
  it('previews the actual workbook with blank inputs without image lookup or download validation', async () => {
    mocks.prepare.mockReturnValue({ shipmentNo: 'CN-1', items: [{ id: shipmentId }], boxes: [{ id: shipmentId }] })
    mocks.preview.mockResolvedValue('<html>INVOICE</html>')
    const snapshot = (await (await GET(new Request('http://localhost'), context())).json()).snapshot
    const body = { intent: 'preview', snapshot, invoiceNo: 'CN-1', invoiceDate: '2026-11-20', sailingDate: '2026-11-20', exporter: '', importer: '', importerAddress: '', loadingPort: '', destinationPort: '', paymentTerms: '', palletTareKg: 5, palletExtraCbm: 0, items: {}, boxes: {} }
    const response = await POST(request(body), context())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ html: '<html>INVOICE</html>' })
    expect(mocks.export).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ items: { [shipmentId]: { englishName: '', hsCode: undefined, unitPriceCny: Number.NaN } } }), {}, true, expect.anything())
    expect(mocks.images).not.toHaveBeenCalled()
    expect(mocks.allItems).not.toHaveBeenCalled()
    expect((await POST(request({ ...body, snapshot: 'a'.repeat(64) }), context())).status).toBe(409)
  })

  it('saves a shared document with revision checks and rejects stale overwrites', async () => {
    const snapshot = (await (await GET(new Request('http://localhost'), context())).json()).snapshot
    const body = { intent: 'save-document', revision: 0, snapshot, invoiceNo: 'CN-SAVED', invoiceDate: '2026-11-20', sailingDate: '2026-11-20', exporter: '', importer: '', importerAddress: '', loadingPort: '', destinationPort: '', paymentTerms: '', palletTareKg: 5, palletExtraCbm: 0, items: {}, boxes: {} }
    mocks.saveDraft.mockResolvedValueOnce({ revision: 1 }).mockResolvedValueOnce(null)
    const response = await POST(request(body), context())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ revision: 1 })
    expect(mocks.saveDraft).toHaveBeenCalledWith(expect.objectContaining({ userId: 'shared-owner', actorId: 'admin2', shipmentId, revision: 0, inputs: expect.objectContaining({ invoiceNo: 'CN-SAVED' }) }))
    expect((await POST(request(body), context())).status).toBe(409)
    expect(mocks.export).not.toHaveBeenCalled()
  })

  it('downloads a workbook with blank basic information, names, prices and box measurements', async () => {
    mocks.prepare.mockReturnValue({ shipmentNo: 'CN-1', items: [{ id: shipmentId, sku: 'SKU-A', hsCode: '' }], boxes: [{ id: shipmentId }] })
    const snapshot = (await (await GET(new Request('http://localhost'), context())).json()).snapshot
    const response = await POST(request({ snapshot, invoiceNo: '', invoiceDate: '2026-11-20', sailingDate: '2026-11-20', exporter: '', importer: '', importerAddress: '', loadingPort: '', destinationPort: '', paymentTerms: '', palletTareKg: 5, palletExtraCbm: 0, items: { [shipmentId]: { englishName: '', unitPriceCny: null } }, boxes: { [shipmentId]: { grossWeightKg: null, cbm: null } } }), context())
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('spreadsheetml')
    expect(response.headers.get('content-disposition')).toContain('_INV_PL_SSJ.xlsx')
    expect(mocks.export).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ boxes: { [shipmentId]: { grossWeightKg: Number.NaN, cbm: null } } }), expect.anything(), true)
  })

})

it('serves the Korean shipping workbook and preview only after workspace authorization', async () => {
  mocks.user.mockResolvedValue({ id: 'staff' })
  mocks.access.mockResolvedValue({ superAdmin: false, allowedMenus: ['/purchasing/import-documents'] })
  mocks.workspace.mockResolvedValue('owner')
  mocks.detail.mockResolvedValue({ shipment: { shipmentNo: 'CN-KOREA', status: 'packing', plannedOutboundDate: '2026-11-20', originWarehouseCode: '중국', destinationName: '인천', createdAt: '2026-11-20' }, items: [], boxes: [], pallets: [], boxItems: [] })
  mocks.metadata.mockResolvedValue(new Map())
  mocks.prepare.mockReturnValue({ shipmentNo: 'CN-KOREA', items: [], boxes: [] })
  mocks.preview.mockResolvedValue('<table>Korea</table>')
  const preview = await GET(new Request('http://localhost?document=korea&group=box&format=preview'), context())
  expect(preview.status).toBe(200)
  expect(await preview.json()).toEqual({ html: '<table>Korea</table>' })
  const download = await GET(new Request('http://localhost?document=korea'), context())
  expect(download.headers.get('content-type')).toContain('spreadsheetml')
  expect(decodeURIComponent(download.headers.get('content-disposition')!)).toContain('한국출고서류.xlsx')
  expect(mocks.detail).toHaveBeenCalledWith({ userId: 'owner', shipmentId })
  expect(mocks.locations).toHaveBeenCalledWith('owner', [])
})
