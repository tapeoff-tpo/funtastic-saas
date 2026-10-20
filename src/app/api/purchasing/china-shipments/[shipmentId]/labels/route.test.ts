import ExcelJS from 'exceljs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getWorkspaceUserId: vi.fn(),
  getChinaOutboundShipmentDetail: vi.fn(),
  getPurchasingItemLocationsBySku: vi.fn(),
  exportChinaOutboundShipmentLabelWorkbook: vi.fn(),
  chinaOutboundShipmentLabelFilename: vi.fn(),
}))

vi.mock('@/lib/auth/current-user', () => ({ getCurrentUser: mocks.getCurrentUser }))
vi.mock('@/lib/admin-accounts/queries', () => ({ getWorkspaceUserId: mocks.getWorkspaceUserId }))
vi.mock('@/lib/purchasing/saas-china-outbound', () => ({ getChinaOutboundShipmentDetail: mocks.getChinaOutboundShipmentDetail }))
vi.mock('@/lib/purchasing/items', () => ({ getPurchasingItemLocationsBySku: mocks.getPurchasingItemLocationsBySku }))
vi.mock('@/lib/purchasing/china-outbound-shipment-labels', () => ({
  exportChinaOutboundShipmentLabelWorkbook: mocks.exportChinaOutboundShipmentLabelWorkbook,
  chinaOutboundShipmentLabelFilename: mocks.chinaOutboundShipmentLabelFilename,
}))

import { GET } from './route'

const shipmentId = '11111111-1111-4111-8111-111111111111'

describe('GET /api/purchasing/china-shipments/[shipmentId]/labels', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getCurrentUser.mockResolvedValue({ id: 'admin-user' })
    mocks.getWorkspaceUserId.mockResolvedValue('workspace-owner')
    mocks.getChinaOutboundShipmentDetail.mockResolvedValue({
      shipment: { shipmentNo: 'OUT-1' },
      items: [
        { id: 'one', sku: 'SKU-1', productName: '물품 1' },
        { id: 'two', sku: ' SKU-2 ', productName: '물품 2' },
        { id: 'three', sku: 'MISSING', productName: '물품 3' },
      ],
      boxes: [],
    })
    mocks.getPurchasingItemLocationsBySku.mockResolvedValue(new Map([
      ['SKU-1', 'A-01'],
      ['SKU-2', 'B-02'],
    ]))
    mocks.exportChinaOutboundShipmentLabelWorkbook.mockResolvedValue(Buffer.from('workbook'))
    mocks.chinaOutboundShipmentLabelFilename.mockReturnValue('labels.xlsx')
  })

  it('uses the shared workspace and supplies locations for every shipment item', async () => {
    const response = await GET(new Request('http://localhost/labels'), { params: Promise.resolve({ shipmentId }) })

    expect(response.status).toBe(200)
    expect(mocks.getWorkspaceUserId).toHaveBeenCalledWith('admin-user')
    expect(mocks.getChinaOutboundShipmentDetail).toHaveBeenCalledWith({ userId: 'workspace-owner', shipmentId })
    expect(mocks.getPurchasingItemLocationsBySku).toHaveBeenCalledWith('workspace-owner', ['SKU-1', ' SKU-2 ', 'MISSING'])
    expect(mocks.exportChinaOutboundShipmentLabelWorkbook).toHaveBeenCalledWith(expect.objectContaining({
      items: [
        { id: 'one', sku: 'SKU-1', productName: '물품 1', location: 'A-01' },
        { id: 'two', sku: ' SKU-2 ', productName: '물품 2', location: 'B-02' },
        { id: 'three', sku: 'MISSING', productName: '물품 3', location: '' },
      ],
    }))
  })

  it('returns an error instead of silently exporting if the location lookup fails', async () => {
    mocks.getPurchasingItemLocationsBySku.mockRejectedValue(new Error('database unavailable'))
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      const response = await GET(new Request('http://localhost/labels'), { params: Promise.resolve({ shipmentId }) })
      expect(response.status).toBe(500)
      expect(mocks.exportChinaOutboundShipmentLabelWorkbook).not.toHaveBeenCalled()
    } finally {
      errorLog.mockRestore()
    }
  })

  it('downloads a real workbook with the item-master location on both label types', async () => {
    const generator = await vi.importActual<typeof import('@/lib/purchasing/china-outbound-shipment-labels')>(
      '@/lib/purchasing/china-outbound-shipment-labels',
    )
    mocks.exportChinaOutboundShipmentLabelWorkbook.mockImplementation(generator.exportChinaOutboundShipmentLabelWorkbook)
    mocks.chinaOutboundShipmentLabelFilename.mockImplementation(generator.chinaOutboundShipmentLabelFilename)
    mocks.getChinaOutboundShipmentDetail.mockResolvedValue({
      shipment: {
        shipmentNo: 'OUT-1',
        status: 'packing',
        originWarehouseCode: '중국창고',
        destinationName: '한국창고',
        plannedOutboundDate: null,
        createdAt: '2026-10-20T00:00:00.000Z',
      },
      items: [
        { id: 'one', warehouseCode: '중국창고', sku: 'SKU-1', productName: '상품 A', optionName: null, reservedQuantity: 5, packedQuantity: 2 },
        { id: 'two', warehouseCode: '중국창고', sku: 'SKU-2', productName: '상품 B', optionName: null, reservedQuantity: 3, packedQuantity: 3 },
        { id: 'three', warehouseCode: '중국창고', sku: 'MISSING', productName: '상품 C', optionName: null, reservedQuantity: 4, packedQuantity: 4 },
      ],
      pallets: [{ id: 'pallet', palletNo: '파렛트 1' }],
      boxes: [{ id: 'box', palletId: 'pallet', boxNo: '박스 1', status: 'open' }],
      boxItems: [
        { id: 'box-item-1', boxId: 'box', shipmentItemId: 'one', quantity: 2 },
        { id: 'box-item-2', boxId: 'box', shipmentItemId: 'two', quantity: 3 },
        { id: 'box-item-3', boxId: 'box', shipmentItemId: 'three', quantity: 4 },
      ],
    })

    const response = await GET(new Request('http://localhost/labels'), { params: Promise.resolve({ shipmentId }) })
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(await response.arrayBuffer() as unknown as ExcelJS.Buffer)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    const box = workbook.getWorksheet('박스 쉽먼트 01')!
    const pallet = workbook.getWorksheet('파렛트 쉽먼트 01')!
    expect([5, 6, 7].map((row) => box.getCell(`E${row}`).value ?? '')).toEqual(['A-01', 'B-02', ''])
    expect([5, 6, 7].map((row) => pallet.getCell(`C${row}`).value ?? '')).toEqual(['A-01', 'B-02', ''])
    expect(box.getCell('B5').value).toBe(2)
    expect(pallet.getCell('F5').value).toBe(2)
  })
})
