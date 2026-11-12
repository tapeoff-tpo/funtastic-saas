import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  purchaseWhere: vi.fn(),
  outgoing: vi.fn(),
  chinaInventory: vi.fn(),
  stockList: vi.fn(),
  latestUpload: vi.fn(),
}))
vi.mock('@/lib/db', () => ({ db: { execute: mocks.execute, select: () => ({ from: () => ({ where: mocks.purchaseWhere }) }) } }))
vi.mock('@/lib/purchasing/items', () => ({ getSkuOutgoingMetrics: mocks.outgoing }))
vi.mock('@/lib/purchasing/saas-china-outbound', () => ({ getSaasChinaInventory: mocks.chinaInventory }))
vi.mock('./short-meeting-stock-list', () => ({ getShortMeetingStockList: mocks.stockList }))
vi.mock('./short-meeting-uploads', () => ({ getLatestShortMeetingUpload: mocks.latestUpload, todayInSeoul: () => '2026-11-11' }))

import { getShortMeetingData, summarizeMeetingPurchases } from './short-meeting'

describe('short meeting data assembly', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-11T03:00:00Z'))
    mocks.latestUpload.mockResolvedValue({ fileName: 'orders.xlsx', meetingDate: '2026-11-11', appliedAt: '2026-11-11T03:00:00Z', rowCount: 3, items: [
      { sku: 'A', productName: '상품 A', optionName: '빨강', quantity: 4 },
      { sku: 'B', productName: '상품 B', optionName: '파랑', quantity: 3 },
      { sku: 'C', productName: '상품 C', optionName: '단품', quantity: 1 },
    ] })
    mocks.execute.mockResolvedValue({ rows: [
      { sku: 'A', productName: '상품 A', optionName: '빨강', todayOutbound: '4', currentStock: '10', location: 'A-1' },
      { sku: 'B', productName: '상품 B', optionName: '파랑', todayOutbound: '3', currentStock: '2', location: 'B-1' },
      { sku: 'C', productName: '상품 C', optionName: '단품', todayOutbound: '1', currentStock: '20', location: 'C-1' },
    ] })
    mocks.outgoing.mockResolvedValue(new Map([
      ['A', { threeMonthAverageOutgoing: 30, currentMonthOutgoing: 17 }],
      ['B', { threeMonthAverageOutgoing: 60, currentMonthOutgoing: 12 }],
      ['C', { threeMonthAverageOutgoing: 0, currentMonthOutgoing: 1 }],
    ]))
    mocks.chinaInventory.mockResolvedValue({ items: [
      { sku: 'A', availableQuantity: 5 },
      { sku: 'A', availableQuantity: 8 },
      { sku: 'B', availableQuantity: 2 },
      { sku: 'OTHER', availableQuantity: 99 },
    ] })
    mocks.purchaseWhere.mockResolvedValue([
      { sku: 'A', status: 'inspecting', requestDate: null, outboundExpectedDate: '2026-11-05', rawData: {} },
      { sku: 'A', status: 'completed', requestDate: null, outboundExpectedDate: '2026-11-08', rawData: {} },
      { sku: 'B', status: 'purchased', requestDate: '2026-10-01', outboundExpectedDate: null, rawData: {} },
      { sku: 'C', status: 'purchase_completed', requestDate: null, outboundExpectedDate: '2026-10-01', rawData: {} },
    ])
    mocks.stockList.mockResolvedValue(new Map([['A', '일시품절'], ['OTHER', '품절']]))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('joins per-SKU stock, outgoing metrics, purchases, and sheet results without mixing products', async () => {
    const data = await getShortMeetingData('workspace-owner')

    expect(mocks.outgoing).toHaveBeenCalledWith('workspace-owner', ['A', 'B', 'C'], new Date('2026-11-11T03:00:00Z'))
    expect(mocks.chinaInventory).toHaveBeenCalledWith('workspace-owner')
    expect(data.sheetStatus).toBe('available')
    expect(data.summary).toEqual({ productCount: 3, todayOutbound: 8, outOfStockCount: 1, riskCount: 1 })
    expect(data.rows.map((row) => row.sku)).toEqual(['B', 'A', 'C'])
    expect(data.rows[1]).toMatchObject({
      sku: 'A', todayOutbound: 4, currentStock: 10, stockAfterOutbound: 6,
      averageDailyOutbound: 30, monthOutbound: 17, stockStatus: 'risk',
      outOfStock: '일시품절', chinaStock: 13, chinaShipmentDate: '2026-11-08',
      chinaOrderDate: '2026-11-05', chinaOrderStatus: '검수', location: 'A-1',
    })
    expect(data.rows[0]).toMatchObject({
      sku: 'B', stockAfterOutbound: -1, stockStatus: 'out', outOfStock: null,
      chinaStock: 2, chinaShipmentDate: null, chinaOrderDate: '2026-10-01', chinaOrderStatus: '발주요청',
    })
    expect(data.rows[2]).toMatchObject({
      sku: 'C', stockStatus: 'normal', outOfStock: null, chinaStock: 0,
      chinaOrderDate: null, chinaOrderStatus: null,
    })
  })

  it('distinguishes a failed stock sheet from a successful sheet with no matching SKU', async () => {
    mocks.stockList.mockResolvedValueOnce(new Map())
    const available = await getShortMeetingData('workspace-owner')
    expect(available.sheetStatus).toBe('available')
    expect(available.rows.every((row) => row.outOfStock === null)).toBe(true)

    mocks.stockList.mockRejectedValueOnce(new Error('sheet inaccessible'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const unavailable = await getShortMeetingData('workspace-owner')
    expect(unavailable.sheetStatus).toBe('unavailable')
    expect(unavailable.rows.every((row) => row.outOfStock === null)).toBe(true)
    expect(unavailable.rows.find((row) => row.sku === 'A')).toMatchObject({ chinaStock: 13, monthOutbound: 17, chinaOrderStatus: '검수' })
  })

  it('does not fall back to unrelated SaaS orders when no file was applied for the selected date', async () => {
    mocks.latestUpload.mockResolvedValueOnce(null)
    const data = await getShortMeetingData('workspace-owner', '2026-11-12')
    expect(mocks.latestUpload).toHaveBeenCalledWith('workspace-owner', '2026-11-12')
    expect(data).toMatchObject({ meetingDate: '2026-11-12', upload: null, rows: [] })
    expect(mocks.execute).not.toHaveBeenCalled()
    expect(mocks.outgoing).not.toHaveBeenCalled()
  })
})

describe('short meeting purchases', () => {
  it('retains requests without a purchase date and includes inspection, excluding purchases at least a calendar month old', () => {
    const rows = summarizeMeetingPurchases([
      { sku: 'A', status: 'purchased', requestDate: '2026-08-01', outboundExpectedDate: null, rawData: {} },
      { sku: 'A', status: 'inspecting', requestDate: null, outboundExpectedDate: '2026-10-12', rawData: {} },
      { sku: 'A', status: 'purchase_completed', requestDate: null, outboundExpectedDate: '2026-10-11', rawData: {} },
      { sku: 'A', status: 'china_arrived', requestDate: '2026-10-10', outboundExpectedDate: null, rawData: { source: 'ecount_purchasing_snapshot_china_arrived' } },
    ], '2026-11-11')
    expect(rows.get('A')).toEqual({
      chinaShipmentDate: null,
      chinaOrderDate: '2026-10-12, 2026-08-01',
      chinaOrderStatus: '발주요청, 검수',
    })
  })

  it('aggregates distinct completed outbound dates separately from active purchases', () => {
    const rows = summarizeMeetingPurchases([
      { sku: 'A', status: 'completed', requestDate: null, outboundExpectedDate: '2026-11-01', rawData: {} },
      { sku: 'A', status: 'completed', requestDate: null, outboundExpectedDate: '2026-11-05', rawData: {} },
      { sku: 'A', status: 'completed', requestDate: null, outboundExpectedDate: '2026-11-05', rawData: {} },
      { sku: 'B', status: 'china_arrived', requestDate: null, outboundExpectedDate: '2026-10-30', rawData: {} },
    ], '2026-11-30')
    expect(rows.get('A')).toEqual({ chinaShipmentDate: '2026-11-05, 2026-11-01', chinaOrderDate: null, chinaOrderStatus: null })
    expect(rows.get('B')).toBeUndefined()
  })
})
