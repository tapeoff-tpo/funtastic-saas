import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ user: vi.fn(), workspace: vi.fn(), detail: vi.fn(), metadata: vi.fn(), prepare: vi.fn(), export: vi.fn() }))
vi.mock('@/lib/auth/current-user', () => ({ getCurrentUser: mocks.user }))
vi.mock('@/lib/admin-accounts/queries', () => ({ getWorkspaceUserId: mocks.workspace }))
vi.mock('@/lib/purchasing/saas-china-outbound', () => ({ getChinaOutboundShipmentDetail: mocks.detail }))
vi.mock('@/lib/purchasing/items', () => ({ getPurchasingItemTradeDataBySku: mocks.metadata }))
vi.mock('@/lib/purchasing/china-import-document', () => ({ prepareImportDocument: mocks.prepare, exportChinaImportDocument: mocks.export }))
import { GET, POST } from './route'
const shipmentId = '11111111-1111-4111-8111-111111111111'
const context = () => ({ params: Promise.resolve({ shipmentId }) })
const request = (data: unknown) => new Request('http://localhost/documents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
describe('import document export route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.user.mockResolvedValue({ id: 'admin2' })
    mocks.workspace.mockResolvedValue('shared-owner')
    mocks.detail.mockResolvedValue({ items: [{ sku: 'SKU-A' }], boxItems: [] })
    mocks.metadata.mockResolvedValue(new Map())
    mocks.prepare.mockReturnValue({ shipmentNo: 'CN-1', items: [], boxes: [] })
    mocks.export.mockResolvedValue(Buffer.from('xlsx'))
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
  })
  it('rejects a stale shipment or item snapshot before generating the document', async () => {
    const response = await POST(request({
      snapshot: 'a'.repeat(64), invoiceNo: 'CN-1', invoiceDate: '2026-10-30', sailingDate: '2026-10-30',
      exporter: 'Exporter', importer: 'Importer', importerAddress: 'Seoul', loadingPort: 'WEIHAI', destinationPort: 'INCHEON', paymentTerms: 'T/T',
      palletTareKg: 0, palletExtraCbm: 0, items: {}, boxes: {},
    }), context())
    expect(response.status).toBe(409)
    expect(mocks.export).not.toHaveBeenCalled()
  })
  it('rejects malformed dates and does not silently treat missing information as zero', async () => {
    const response = await POST(request({ invoiceDate: '2026-02-31' }), context())
    expect(response.status).toBe(400)
    expect(mocks.export).not.toHaveBeenCalled()
  })
})
