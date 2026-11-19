import { render } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  currentUser: vi.fn(), workspaceUser: vi.fn(), shipments: vi.fn(), warehouses: vi.fn(),
  detail: vi.fn(), stock: vi.fn(), board: vi.fn((props: Record<string, unknown>) => { void props; return null }),
}))
vi.mock('@/lib/auth/current-user', () => ({ getCurrentUser: mocks.currentUser }))
vi.mock('@/lib/admin-accounts/queries', () => ({ getWorkspaceUserId: mocks.workspaceUser }))
vi.mock('@/lib/purchasing/saas-china-outbound', () => ({ listChinaOutboundShipments: mocks.shipments, listSaasChinaOutboundWarehouses: mocks.warehouses }))
vi.mock('./china-shipment-data', () => ({ loadChinaShipmentDetailView: mocks.detail, loadChinaShipmentStockItems: mocks.stock }))
vi.mock('./china-shipments-board', () => ({ ChinaShipmentsBoard: mocks.board }))
import ChinaShipmentsPage from './page'

const selectedId = '11111111-1111-4111-8111-111111111111'
const inventoryId = '22222222-2222-4222-8222-222222222222'
const period = { period: 'custom', from: '2026-11-01', to: '2026-11-17' }
const shipmentRows = [{
  id: selectedId, displayName: '출고 작업', shipmentNo: 'OUT-1', status: 'packing', originWarehouseCode: '중국창고',
  destinationName: '한국', plannedOutboundDate: '2026-11-17', createdAt: new Date('2026-11-01T00:00:00Z'),
  itemCount: 3, reservedQuantity: 30, packedQuantity: 10,
}]
const warehouses = [{ warehouseCode: '중국창고', isDefault: true, hasActiveInventory: true }]
const selectedDetail = { shipment: { id: selectedId }, items: [], boxes: [], boxItems: [], pallets: [] }

beforeEach(() => {
  vi.resetAllMocks()
  mocks.currentUser.mockResolvedValue({ id: 'actor' })
  mocks.workspaceUser.mockResolvedValue('canonical-owner')
  mocks.shipments.mockResolvedValue(shipmentRows)
  mocks.warehouses.mockResolvedValue(warehouses)
  mocks.detail.mockResolvedValue(selectedDetail)
  mocks.stock.mockResolvedValue([{ id: inventoryId }])
})

async function renderPage(params: Record<string, string | undefined> = period) {
  render(await ChinaShipmentsPage({ searchParams: Promise.resolve(params) }))
  return mocks.board.mock.calls.at(-1)![0]
}

it('loads the visible shipment list concurrently with the configured warehouse catalog', async () => {
  let release!: (rows: typeof shipmentRows) => void
  mocks.shipments.mockReturnValue(new Promise((resolve) => { release = resolve }))
  const pending = renderPage()
  await vi.waitFor(() => expect(mocks.warehouses).toHaveBeenCalledWith('canonical-owner'))
  expect(mocks.shipments).toHaveBeenCalledWith('canonical-owner', { createdFrom: period.from, createdTo: period.to })
  expect(mocks.board).not.toHaveBeenCalled()
  release(shipmentRows)
  const props = await pending
  expect(props.shipments).toEqual([{ ...shipmentRows[0], createdAt: '2026-11-01T00:00:00.000Z' }])
  expect(props.outboundWarehouses).toEqual(warehouses)
  expect(props.selectedShipment).toBeNull()
  expect(mocks.detail).not.toHaveBeenCalled()
  expect(mocks.stock).not.toHaveBeenCalled()
})

it.each([['boxes', 'boxes'], ['pallets', 'pallets'], ['summary', 'summary']])('does not reload the hidden list while displaying a selected shipment at %s', async (step, selectedStep) => {
  const props = await renderPage({ ...period, shipment: selectedId, step })
  expect(mocks.detail).toHaveBeenCalledExactlyOnceWith('canonical-owner', selectedId)
  expect(mocks.shipments).not.toHaveBeenCalled()
  expect(mocks.stock).not.toHaveBeenCalled()
  expect(props).toMatchObject({ shipments: [], selectedShipment: selectedDetail, selectedStep, showCreate: false, outboundWarehouses: warehouses })
})

it('loads creation stock and warehouses without hidden list or detail queries', async () => {
  const props = await renderPage({ ...period, create: '1', shipment: selectedId, inventoryId })
  expect(mocks.stock).toHaveBeenCalledExactlyOnceWith('canonical-owner')
  expect(mocks.warehouses).toHaveBeenCalledWith('canonical-owner')
  expect(mocks.shipments).not.toHaveBeenCalled()
  expect(mocks.detail).not.toHaveBeenCalled()
  expect(props).toMatchObject({ shipments: [], selectedShipment: null, showCreate: true, initialInventoryId: inventoryId, inventoryItems: [{ id: inventoryId }] })
})

it('falls back to the visible list when a selected shipment is missing or unauthorized', async () => {
  mocks.detail.mockResolvedValue(null)
  const props = await renderPage({ ...period, shipment: selectedId })
  expect(mocks.detail).toHaveBeenCalledExactlyOnceWith('canonical-owner', selectedId)
  expect(mocks.shipments).toHaveBeenCalledExactlyOnceWith('canonical-owner', { createdFrom: period.from, createdTo: period.to })
  expect(props.selectedShipment).toBeNull()
  expect(props.shipments).toHaveLength(1)
})

it('treats an invalid shipment identifier as a normal list request', async () => {
  const props = await renderPage({ ...period, shipment: 'invalid' })
  expect(mocks.detail).not.toHaveBeenCalled()
  expect(mocks.shipments).toHaveBeenCalledOnce()
  expect(props.selectedShipment).toBeNull()
  expect(props.shipments).toHaveLength(1)
})

it('preserves invalid-period feedback without querying a list for that range', async () => {
  const props = await renderPage({ ...period, from: '2026-11-18' })
  expect(mocks.shipments).not.toHaveBeenCalled()
  expect(props.shipments).toEqual([])
  expect(props.listPeriod).toMatchObject({ preset: 'custom', from: '2026-11-18', to: period.to, error: '조회 시작일과 종료일을 확인해주세요.' })
  expect(props.outboundWarehouses).toEqual(warehouses)
})

it('does no operational data loading for an unauthenticated request', async () => {
  mocks.currentUser.mockResolvedValue(null)
  expect(await ChinaShipmentsPage({ searchParams: Promise.resolve(period) })).toBeNull()
  for (const mock of [mocks.workspaceUser, mocks.shipments, mocks.warehouses, mocks.detail, mocks.stock, mocks.board]) expect(mock).not.toHaveBeenCalled()
})
