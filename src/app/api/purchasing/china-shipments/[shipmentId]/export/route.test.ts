import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ user: vi.fn(), workspace: vi.fn(), detail: vi.fn(), locations: vi.fn(), export: vi.fn(), filename: vi.fn() }))
vi.mock('@/lib/auth/current-user', () => ({ getCurrentUser: mocks.user }))
vi.mock('@/lib/admin-accounts/queries', () => ({ getWorkspaceUserId: mocks.workspace }))
vi.mock('@/lib/purchasing/saas-china-outbound', () => ({ getChinaOutboundShipmentDetail: mocks.detail }))
vi.mock('@/lib/purchasing/items', () => ({ getPurchasingItemLocationsBySku: mocks.locations }))
vi.mock('@/lib/purchasing/china-outbound-packing-export', () => ({ exportChinaOutboundPackingWorkbook: mocks.export, chinaOutboundPackingFilename: mocks.filename }))

import { GET } from './route'

const shipmentId = '11111111-1111-4111-8111-111111111111'
const context = (id = shipmentId) => ({ params: Promise.resolve({ shipmentId: id }) })
const request = () => new Request(`http://localhost/api/purchasing/china-shipments/${shipmentId}/export`)

describe('China outbound packing export route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.user.mockResolvedValue({ id: 'staff-account' })
    mocks.workspace.mockResolvedValue('workspace-owner')
    mocks.detail.mockResolvedValue({
      shipment: { shipmentNo: 'CN-TEST' },
      items: [{ id: 'one', sku: ' SKU-A ', reservedQuantity: 10 }, { id: 'two', sku: 'SKU-B', reservedQuantity: 3 }],
      boxes: [{ id: 'box-one' }], pallets: [], boxItems: [],
    })
    mocks.locations.mockResolvedValue(new Map([['SKU-A', 'A-01-03']]))
    mocks.export.mockResolvedValue(Buffer.from('xlsx-test'))
    mocks.filename.mockReturnValue('CN-TEST_적재현황.xlsx')
  })

  it('enriches each SKU with the canonical workspace location while preserving shipment data', async () => {
    const original = await mocks.detail()
    mocks.detail.mockClear()
    const response = await GET(request(), context())
    expect(response.status).toBe(200)
    expect(mocks.workspace).toHaveBeenCalledWith('staff-account')
    expect(mocks.detail).toHaveBeenCalledWith({ userId: 'workspace-owner', shipmentId })
    expect(mocks.locations).toHaveBeenCalledWith('workspace-owner', [' SKU-A ', 'SKU-B'])
    expect(mocks.export).toHaveBeenCalledExactlyOnceWith({
      ...original,
      items: [{ ...original.items[0], location: 'A-01-03' }, { ...original.items[1], location: '' }],
    })
    expect(original.items[0]).not.toHaveProperty('location')
    expect(response.headers.get('content-type')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    expect(response.headers.get('content-disposition')).toContain(encodeURIComponent('CN-TEST_적재현황.xlsx'))
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.text()).toBe('xlsx-test')
  })

  it('requires authentication before reading shared operational data', async () => {
    mocks.user.mockResolvedValue(null)
    expect((await GET(request(), context())).status).toBe(401)
    expect(mocks.workspace).not.toHaveBeenCalled()
    expect(mocks.detail).not.toHaveBeenCalled()
    expect(mocks.locations).not.toHaveBeenCalled()
    expect(mocks.export).not.toHaveBeenCalled()
  })

  it('rejects malformed shipment IDs before looking up the workspace or locations', async () => {
    expect((await GET(request(), context('invalid'))).status).toBe(404)
    expect(mocks.workspace).not.toHaveBeenCalled()
    expect(mocks.detail).not.toHaveBeenCalled()
    expect(mocks.locations).not.toHaveBeenCalled()
    expect(mocks.export).not.toHaveBeenCalled()
  })

  it('does not read item locations or create a workbook for an inaccessible shipment', async () => {
    mocks.detail.mockResolvedValue(null)
    expect((await GET(request(), context())).status).toBe(404)
    expect(mocks.detail).toHaveBeenCalledWith({ userId: 'workspace-owner', shipmentId })
    expect(mocks.locations).not.toHaveBeenCalled()
    expect(mocks.export).not.toHaveBeenCalled()
  })

  it('fails the export when location lookup fails instead of silently blanking every location', async () => {
    mocks.locations.mockRejectedValue(new Error('location query unavailable'))
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const response = await GET(request(), context())
      expect(response.status).toBe(500)
      expect(await response.json()).toEqual({ error: '중국출고 적재현황을 엑셀로 만들지 못했습니다.' })
      expect(mocks.export).not.toHaveBeenCalled()
    } finally { errorLog.mockRestore() }
  })
})
