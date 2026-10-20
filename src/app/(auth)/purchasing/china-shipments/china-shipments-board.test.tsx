import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ChinaShipmentsBoard, type ChinaShipmentDetailView, type ChinaShipmentListItem } from './china-shipments-board'

const createShipment = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('../saas-china-actions', () => ({
  addChinaOutboundShipmentItemsAction: vi.fn(),
  assignChinaOutboundBoxesToPalletsAction: vi.fn(),
  cancelChinaOutboundShipmentAction: vi.fn(),
  createChinaOutboundShipmentAction: createShipment,
  deleteChinaOutboundShipmentAction: vi.fn(),
  dispatchChinaOutboundShipmentAction: vi.fn(),
  markChinaOutboundShipmentReadyAction: vi.fn(),
  saveChinaOutboundItemBoxSplitsAction: vi.fn(),
  updateChinaOutboundShipmentAction: vi.fn(),
}))

function makeShipment(id: string, name: string, sku: string): ChinaShipmentDetailView {
  return {
    shipment: {
      id,
      shipmentNo: `OUT-${id}`,
      displayName: name,
      status: 'packing',
      originWarehouseCode: '중국',
      destinationName: '한국',
      destinationAddress: null,
      forwarderName: null,
      externalReference: null,
      plannedOutboundDate: '2026-10-20',
      memo: null,
      createdAt: '2026-10-20T00:00:00.000Z',
    },
    items: [{
      id: 'shared-item-id',
      inventoryId: `inventory-${id}`,
      warehouseCode: '중국',
      sku,
      productName: `${name} 상품`,
      optionName: null,
      reservedQuantity: 10,
      packedQuantity: 0,
      dispatchedQuantity: 0,
    }],
    pallets: [],
    boxes: [],
    boxItems: [],
  }
}

function asListItem(detail: ChinaShipmentDetailView): ChinaShipmentListItem {
  const { shipment } = detail
  return {
    id: shipment.id,
    shipmentNo: shipment.shipmentNo,
    displayName: shipment.displayName,
    status: shipment.status,
    originWarehouseCode: shipment.originWarehouseCode,
    destinationName: shipment.destinationName,
    plannedOutboundDate: shipment.plannedOutboundDate,
    createdAt: shipment.createdAt,
    itemCount: detail.items.length,
    reservedQuantity: 10,
    packedQuantity: 0,
  }
}

const shipmentA = makeShipment('a', '출고 A', 'SKU-A')
const shipmentB = makeShipment('b', '출고 B', 'SKU-B')
const shipments = [asListItem(shipmentA), asListItem(shipmentB)]

describe('ChinaShipmentsBoard', () => {
  beforeEach(() => createShipment.mockReset())

  it('keeps new shipment creation available while other requests are in progress', () => {
    render(<ChinaShipmentsBoard inventoryItems={[]} shipments={shipments} selectedShipment={shipmentA} selectedStep="items" showCreate={false} />)

    expect(screen.getByRole('button', { name: '새 중국출고요청' })).toBeEnabled()
    expect(screen.getByRole('option', { name: /출고 A/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /출고 B/ })).toBeInTheDocument()
    expect(screen.queryByText(/새 요청은 만들 수 없습니다/)).not.toBeInTheDocument()
  })

  it('shows the creation form without opening an existing shipment editor', () => {
    render(<ChinaShipmentsBoard inventoryItems={[]} shipments={shipments} selectedShipment={shipmentA} selectedStep="items" showCreate />)

    expect(screen.getByRole('button', { name: '중국출고요청 만들기' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '요청 닫기' })).toBeEnabled()
    expect(screen.queryByRole('heading', { name: '출고 A' })).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: '중국출고 작업 단계' })).not.toBeInTheDocument()
  })

  it('submits a new request while existing requests are still in progress', async () => {
    createShipment.mockResolvedValue({ ok: false, error: '테스트 종료' })
    const inventoryItems = [{ id: 'inventory-new', warehouseCode: '중국창고', sku: 'NEW-1', productName: '새 상품', optionName: null, onHandQuantity: 20, reservedQuantity: 5, availableQuantity: 15 }]
    render(<ChinaShipmentsBoard inventoryItems={inventoryItems} shipments={shipments} selectedShipment={null} selectedStep="items" showCreate />)

    fireEvent.change(screen.getByLabelText('도착지'), { target: { value: '인천' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /중국창고/ }))
    fireEvent.change(screen.getByLabelText('이번 출고'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: '중국출고요청 만들기' }))

    await waitFor(() => expect(createShipment).toHaveBeenCalledWith(expect.objectContaining({
      destinationName: '인천',
      lines: [{ inventoryId: 'inventory-new', quantity: 3 }],
    })))
  })

  it('replaces the selected detail and clears shipment-specific unsaved box and name drafts', () => {
    const { rerender } = render(<ChinaShipmentsBoard inventoryItems={[]} shipments={shipments} selectedShipment={shipmentA} selectedStep="boxes" showCreate={false} />)

    fireEvent.change(screen.getByPlaceholderText('예: A-01'), { target: { value: 'A 임시 박스' } })
    fireEvent.click(screen.getByRole('button', { name: '이름·날짜 수정' }))
    fireEvent.change(screen.getByPlaceholderText('예: 2026-10-01 중국출고'), { target: { value: 'A 임시 이름' } })

    rerender(<ChinaShipmentsBoard inventoryItems={[]} shipments={shipments} selectedShipment={shipmentB} selectedStep="boxes" showCreate={false} />)

    expect(screen.queryByRole('heading', { name: '출고 A' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '출고 B' })).toBeInTheDocument()
    expect(screen.getAllByRole('navigation', { name: '중국출고 작업 단계' })).toHaveLength(1)
    expect(screen.getByPlaceholderText('예: A-01')).toHaveValue('SKU-B-1')
    expect(screen.queryByDisplayValue('A 임시 이름')).not.toBeInTheDocument()
    expect(screen.getByLabelText('중국출고요청 선택')).toHaveValue('b')
  })
})
