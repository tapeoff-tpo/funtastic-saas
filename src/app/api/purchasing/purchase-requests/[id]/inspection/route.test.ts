import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, POST } from './route'

const mocks = vi.hoisted(() => ({ user: vi.fn(), owner: vi.fn(), get: vi.fn(), save: vi.fn(), labelData: vi.fn(), recordPrint: vi.fn(), listFiles: vi.fn() }))
vi.mock('@/lib/auth/current-user', () => ({ getCurrentUser: mocks.user }))
vi.mock('@/lib/admin-accounts/queries', () => ({ getWorkspaceUserId: mocks.owner }))
vi.mock('@/lib/purchasing/purchase-requests', () => ({ getPurchaseInspection: mocks.get, savePurchaseInspection: mocks.save }))
vi.mock('@/lib/purchasing/items', () => ({ getPurchasingItemLabelDataBySku: mocks.labelData }))
vi.mock('@/lib/purchasing/purchase-inspection-print-history', () => ({
  listInspectionPrintRequests: async () => [], recordInspectionPrintRequest: mocks.recordPrint,
}))
vi.mock('@/lib/purchasing/purchase-inspection-label-files', () => ({ listInspectionLabelFiles: mocks.listFiles }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
const id = '00000000-0000-4000-8000-000000000001'
const context = { params: Promise.resolve({ id }) }
const request = (body: unknown) => new NextRequest(`https://app.example/api/purchasing/purchase-requests/${id}/inspection`, { method: 'POST', body: JSON.stringify(body) })
const input = { revision: 0, parcels: [{ id: '00000000-0000-4000-8000-000000000002', trackingNumber: 'SF001', boxes: [{ id: '00000000-0000-4000-8000-000000000003', quantity: null, lengthCm: null, widthCm: null, heightCm: null, weightKg: null }] }] }
describe('purchase inspection endpoints', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.user.mockResolvedValue({ id: 'staff-id' }); mocks.owner.mockResolvedValue('owner-id'); mocks.get.mockResolvedValue({ id }); mocks.save.mockResolvedValue({ inspection: { revision: 1 }, summary: {} }) })
  it('requires login before any workspace read or write', async () => {
    mocks.user.mockResolvedValue(null)
    expect((await GET(request(null), context)).status).toBe(401)
    expect((await POST(request(input), context)).status).toBe(401)
    expect(mocks.owner).not.toHaveBeenCalled()
  })
  it('reads the shared workspace with no cache', async () => {
    const response = await GET(request(null), context)
    expect(mocks.get).toHaveBeenCalledWith('owner-id', id)
    expect(response.headers.get('cache-control')).toContain('no-store')
  })
  it('prints saved inspection cartons using the China shipment label template', async () => {
    const box = { ...input.parcels[0].boxes[0], quantity: 20 }
    mocks.get.mockResolvedValue({
      id, sku: 'SKU-01', productName: '수납함', optionName: '블랙',
      inspection: {
        parcels: [{ ...input.parcels[0], boxes: [box] }],
        boxNumbers: { [box.id]: '261125-001' },
      },
    })
    mocks.labelData.mockResolvedValue(new Map([['SKU-01', { chineseProductName: '收纳箱', location: 'A-01' }]]))
    const printRequest = new NextRequest(`${request(null).url}?format=box-print`)
    const response = await GET(printRequest, context)
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('content-security-policy')).toContain("script-src 'nonce-")
    for (const value of ['size:180mm 100mm', 'TAPEOFF', '20 PC', '수납함', '블랙', '收纳箱', 'A-01', '261125-001']) {
      expect(html).toContain(value)
    }
    expect(html.match(/class="page box-label"/g)).toHaveLength(1)
    expect(html).toMatch(/<td class="box-number"[^>]*>.*箱子号: .*261125-001.*<\/td>/)
    expect(mocks.labelData).toHaveBeenCalledWith('owner-id', ['SKU-01'])
  })
  it('records the signed-in inspector and box numbers from the saved inspection', async () => {
    const box = input.parcels[0].boxes[0]
    mocks.get.mockResolvedValue({ id, inspection: { ...input, boxNumbers: { [box.id]: '261125-001' } } })
    mocks.recordPrint.mockResolvedValue({ kind: 'box' })

    const response = await POST(request({ action: 'record-print', kind: 'box', boxNumbers: ['forged'] }), context)
    expect(response.status).toBe(201)
    expect(mocks.recordPrint).toHaveBeenCalledWith({
      actorId: 'staff-id', userId: 'owner-id', itemId: id, kind: 'box', boxNumbers: ['261125-001'], fileName: null,
    })
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it('records the kind and name of the actual sticker file in the workspace', async () => {
    const fileId = '00000000-0000-4000-8000-000000000007'
    mocks.get.mockResolvedValue({ id, sku: 'SKU-01' })
    mocks.listFiles.mockResolvedValue([{ id: fileId, kind: 'quality', source: 'works', fileName: '품질표시.pdf' }])
    mocks.recordPrint.mockResolvedValue({ kind: 'quality' })
    const target = { action: 'record-print', kind: 'file', fileId, source: 'works' }

    expect((await POST(request(target), context)).status).toBe(201)
    expect(mocks.listFiles).toHaveBeenCalledWith('owner-id', 'SKU-01')
    expect(mocks.recordPrint).toHaveBeenCalledWith({
      actorId: 'staff-id', userId: 'owner-id', itemId: id, kind: 'quality', boxNumbers: null, fileName: '품질표시.pdf',
    })
    expect((await POST(request({ ...target, source: 'attachment' }), context)).status).toBe(404)
    expect(mocks.recordPrint).toHaveBeenCalledOnce()
  })
  it('separates workspace ownership from the real inspector identity', async () => {
    expect((await POST(request(input), context)).status).toBe(200)
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ userId: 'owner-id', actorId: 'staff-id', id, data: expect.objectContaining({ revision: 0 }) }))
  })
  it('rejects forged verification fields, invalid IDs and conflicting saves', async () => {
    expect((await POST(request({ ...input, checkedBy: 'forged' }), context)).status).toBe(400)
    expect((await GET(request(null), { params: Promise.resolve({ id: 'invalid' }) })).status).toBe(400)
    expect(mocks.save).not.toHaveBeenCalled()
    mocks.save.mockRejectedValue(new Error('다른 작업자가 검수 정보를 변경했습니다.'))
    expect((await POST(request(input), context)).status).toBe(409)
  })
})
