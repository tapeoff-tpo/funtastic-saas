import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ChinaShipmentsBoard, type ChinaShipmentDetailView, type ChinaShipmentListItem } from './china-shipments-board'

const { createShipment, updateShipment, saveBoxSplits, savePalletAssignments, addShipmentItems, toastError, navigate } = vi.hoisted(() => ({
  createShipment: vi.fn(),
  updateShipment: vi.fn(),
  saveBoxSplits: vi.fn(),
  savePalletAssignments: vi.fn(),
  addShipmentItems: vi.fn(),
  toastError: vi.fn(),
  navigate: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: toastError } }))
vi.mock('./china-work-navigation', () => ({ navigateChinaWork: navigate }))
vi.mock('../saas-china-actions', () => ({
  addChinaOutboundShipmentItemsAction: addShipmentItems,
  assignChinaOutboundBoxesToPalletsAction: savePalletAssignments,
  cancelChinaOutboundShipmentAction: vi.fn(),
  createChinaOutboundShipmentAction: createShipment,
  deleteChinaOutboundShipmentAction: vi.fn(),
  dispatchChinaOutboundShipmentAction: vi.fn(),
  markChinaOutboundShipmentReadyAction: vi.fn(),
  saveChinaOutboundItemBoxSplitsAction: saveBoxSplits,
  updateChinaOutboundShipmentAction: updateShipment,
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
const inventoryItem = { id: 'inventory-new', warehouseCode: '중국창고', sku: 'NEW-1', productName: '새 상품', optionName: null, onHandQuantity: 20, reservedQuantity: 5, availableQuantity: 15 }

function renderShipment(detail = shipmentA, stage: 'items' | 'boxes' | 'pallets' | 'summary' = 'boxes') {
  return render(<ChinaShipmentsBoard inventoryItems={[inventoryItem]} shipments={shipments} selectedShipment={detail} selectedStep={stage} showCreate={false} />)
}

function selectOtherShipment() {
  fireEvent.change(screen.getByLabelText('중국출고요청 선택'), { target: { value: 'b' } })
}

function editBox(quantity = '3') {
  fireEvent.change(screen.getByPlaceholderText('1'), { target: { value: '1' } })
  fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: quantity } })
}

function makeShipmentWithBox(): ChinaShipmentDetailView {
  return {
    ...shipmentA,
    pallets: [{ id: 'pallet-1', palletNo: 'P1', note: null }],
    boxes: [{ id: 'box-1', shipmentId: 'a', editable: true, palletId: 'pallet-1', boxNo: 'A-01', status: 'packing', note: null, lengthCm: null, widthCm: null, heightCm: null }],
    boxItems: [{ id: 'allocation-1', boxId: 'box-1', shipmentItemId: 'shared-item-id', quantity: 3 }],
  }
}

function makeShipmentWithCompletionFilters(): ChinaShipmentDetailView {
  return {
    ...shipmentA,
    items: [
      { ...shipmentA.items[0], id: 'complete-item', sku: 'DONE-01', productName: '완료 상품', optionName: '대형', reservedQuantity: 5, packedQuantity: 5 },
      { ...shipmentA.items[0], id: 'progress-item', sku: 'WORK-01', productName: '진행 상품', optionName: '소형', reservedQuantity: 5, packedQuantity: 2 },
      { ...shipmentA.items[0], id: 'waiting-item', sku: 'WAIT-01', productName: '미작업 상품', optionName: null, reservedQuantity: 5, packedQuantity: 0 },
    ],
    pallets: [{ id: 'pallet-1', palletNo: 'P1', note: null }],
    boxes: [
      { id: 'box-saved', shipmentId: 'a', editable: true, palletId: 'pallet-1', boxNo: 'BOX-01', status: 'packing', note: null, lengthCm: null, widthCm: null, heightCm: null },
      { id: 'box-shared', shipmentId: 'a', editable: true, palletId: null, boxNo: 'BOX-02', status: 'packing', note: null, lengthCm: null, widthCm: null, heightCm: null },
      { id: 'box-empty', shipmentId: 'a', editable: true, palletId: null, boxNo: 'BOX-03', status: 'packing', note: null, lengthCm: null, widthCm: null, heightCm: null },
    ],
    boxItems: [
      { id: 'allocation-done-1', boxId: 'box-saved', shipmentItemId: 'complete-item', quantity: 3 },
      { id: 'allocation-done-2', boxId: 'box-shared', shipmentItemId: 'complete-item', quantity: 2 },
      { id: 'allocation-work', boxId: 'box-shared', shipmentItemId: 'progress-item', quantity: 2 },
    ],
  }
}

function makeShipmentWithSharedBoxDimensions(lengthCm = 10, widthCm = 20, heightCm = 30): ChinaShipmentDetailView {
  return {
    ...shipmentA,
    items: [
      { ...shipmentA.items[0], id: 'shared-item-one', sku: 'SHARED-01', productName: '공유 박스 상품 1', reservedQuantity: 10, packedQuantity: 3 },
      { ...shipmentA.items[0], id: 'shared-item-two', sku: 'SHARED-02', productName: '공유 박스 상품 2', reservedQuantity: 10, packedQuantity: 3 },
    ],
    boxes: [{ id: 'shared-box', shipmentId: 'a', editable: true, palletId: null, boxNo: 'COMMON-1', status: 'packing', note: null, lengthCm, widthCm, heightCm }],
    boxItems: [
      { id: 'shared-allocation-one', boxId: 'shared-box', shipmentItemId: 'shared-item-one', quantity: 3 },
      { id: 'shared-allocation-two', boxId: 'shared-box', shipmentItemId: 'shared-item-two', quantity: 3 },
    ],
  }
}

function makeShipmentWithManyItems(count = 11): ChinaShipmentDetailView {
  return {
    ...shipmentA,
    items: Array.from({ length: count }, (_, index) => ({
      ...shipmentA.items[0],
      id: `item-${index + 1}`,
      sku: `SKU-${String(index + 1).padStart(2, '0')}`,
    })),
  }
}

function makeShipmentWithCompletedBoxOnLaterPage(): ChinaShipmentDetailView {
  const detail = makeShipmentWithManyItems()
  const completedItem = detail.items.at(-1)
  if (!completedItem) throw new Error('완료 품목을 만들지 못했습니다.')
  return {
    ...detail,
    items: detail.items.map((item) => item.id === completedItem.id ? { ...item, packedQuantity: item.reservedQuantity } : item),
    boxes: [{ id: 'completed-box', shipmentId: 'a', editable: true, palletId: null, boxNo: '11', status: 'packing', note: null, lengthCm: null, widthCm: null, heightCm: null }],
    boxItems: [{ id: 'completed-allocation', boxId: 'completed-box', shipmentItemId: completedItem.id, quantity: completedItem.reservedQuantity }],
  }
}

function itemEditor(sku: string) {
  const article = screen.getByText(sku).closest('article')
  if (!article) throw new Error(`편집기를 찾을 수 없습니다: ${sku}`)
  return within(article)
}

describe('ChinaShipmentsBoard', () => {
  beforeEach(() => {
    createShipment.mockReset()
    updateShipment.mockReset()
    saveBoxSplits.mockReset()
    savePalletAssignments.mockReset()
    addShipmentItems.mockReset()
    toastError.mockReset()
    navigate.mockReset()
  })

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

  it('shows only the selected shipment when the server provides another detail', () => {
    const { rerender } = render(<ChinaShipmentsBoard inventoryItems={[]} shipments={shipments} selectedShipment={shipmentA} selectedStep="boxes" showCreate={false} />)

    rerender(<ChinaShipmentsBoard inventoryItems={[]} shipments={shipments} selectedShipment={shipmentB} selectedStep="boxes" showCreate={false} />)

    expect(screen.queryByRole('heading', { name: '출고 A' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '출고 B' })).toBeInTheDocument()
    expect(screen.getAllByRole('navigation', { name: '중국출고 작업 단계' })).toHaveLength(1)
    expect(screen.getByPlaceholderText('1')).toHaveValue('')
    expect(screen.getByLabelText('중국출고요청 선택')).toHaveValue('b')
  })

  it('shows saved box contents and lets users include empty boxes', () => {
    renderShipment(makeShipmentWithCompletionFilters())

    expect(screen.getByRole('link', { name: '부착용 쉽먼트 일괄 다운로드' })).toHaveAttribute('href', '/api/purchasing/china-shipments/a/labels')
    const savedBoxPanel = screen.getByRole('heading', { name: '저장된 박스 현황' }).closest('section')
    if (!savedBoxPanel) throw new Error('저장된 박스 현황을 찾을 수 없습니다.')
    expect(within(savedBoxPanel).getByText('BOX-01')).toBeInTheDocument()
    expect(within(savedBoxPanel).getByRole('link', { name: 'BOX-01 박스 부착용 쉽먼트 다운로드' })).toHaveAttribute('href', '/api/purchasing/china-shipments/a/labels?boxId=box-saved')
    const sharedBoxRow = within(savedBoxPanel).getByText('BOX-02').closest('tr')
    if (!sharedBoxRow) throw new Error('공유 박스 행을 찾을 수 없습니다.')
    expect(within(sharedBoxRow).getByText(/DONE-01 · 완료 상품 · 대형/)).toBeInTheDocument()
    expect(within(sharedBoxRow).getByText(/WORK-01 · 진행 상품 · 소형/)).toBeInTheDocument()
    expect(within(sharedBoxRow).getByText('4개')).toBeInTheDocument()
    expect(within(sharedBoxRow).getByText('미배정')).toBeInTheDocument()
    expect(within(sharedBoxRow).getByRole('link', { name: 'BOX-02 박스 부착용 쉽먼트 다운로드' })).toHaveAttribute('href', '/api/purchasing/china-shipments/a/labels?boxId=box-shared')
    expect(within(savedBoxPanel).queryByText('BOX-03')).not.toBeInTheDocument()

    fireEvent.click(within(savedBoxPanel).getByRole('button', { name: /전체 박스/ }))
    const emptyBoxRow = within(savedBoxPanel).getByText('BOX-03').closest('tr')
    if (!emptyBoxRow) throw new Error('빈 박스 행을 찾을 수 없습니다.')
    expect(within(emptyBoxRow).getByText('내용 없음')).toBeInTheDocument()
    expect(within(emptyBoxRow).queryByRole('link', { name: /부착용 쉽먼트 다운로드/ })).not.toBeInTheDocument()
  })

  it('opens a completed saved box in its editable product editor', () => {
    renderShipment(makeShipmentWithCompletedBoxOnLaterPage())

    const savedBoxPanel = screen.getByRole('heading', { name: '저장된 박스 현황' }).closest('section')
    if (!savedBoxPanel) throw new Error('저장된 박스 현황을 찾을 수 없습니다.')
    fireEvent.click(within(savedBoxPanel).getByRole('button', { name: '11 박스 내용 수정' }))

    expect(screen.getAllByText('2 / 2')).toHaveLength(2)
    const editor = itemEditor('SKU-11')
    expect(editor.getByPlaceholderText('1')).toHaveValue('11')
    expect(editor.getByPlaceholderText('1')).toBeEnabled()
    expect(editor.getByRole('button', { name: '박스분할 저장' })).toBeEnabled()
  })

  it('filters completed items without losing a hidden box split draft', () => {
    renderShipment(makeShipmentWithCompletionFilters())
    const itemFilter = screen.getByRole('group', { name: '박스분할 품목 상태 필터' })
    fireEvent.change(itemEditor('WORK-01').getByPlaceholderText('0'), { target: { value: '3' } })

    fireEvent.click(within(itemFilter).getByRole('button', { name: /박스분할 완료/ }))
    expect(screen.getByText('DONE-01')).toBeInTheDocument()
    expect(screen.queryByText('WORK-01')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    fireEvent.click(within(itemFilter).getByRole('button', { name: /진행 중/ }))
    expect(screen.getByText('WORK-01')).toBeInTheDocument()
    expect(screen.getByText('WAIT-01')).toBeInTheDocument()
    expect(itemEditor('WORK-01').getByPlaceholderText('0')).toHaveValue(3)
  })

  it('switches immediately with a clean blank box number', () => {
    renderShipment()
    expect(screen.getByPlaceholderText('1')).toHaveValue('')
    selectOtherShipment()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(navigate).toHaveBeenCalledWith('/purchasing/china-shipments?shipment=b&step=items')
    expect(saveBoxSplits).not.toHaveBeenCalled()
  })

  it('leaves every newly added box number blank and hints at numeric numbering', () => {
    renderShipment()

    const firstBoxNumber = screen.getByPlaceholderText('1')
    expect(firstBoxNumber).toHaveValue('')
    expect(firstBoxNumber).toHaveAttribute('inputmode', 'numeric')

    fireEvent.click(screen.getByRole('button', { name: '박스 추가' }))
    expect(screen.getAllByPlaceholderText('1')).toHaveLength(2)
    expect(screen.getAllByPlaceholderText('1')).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: '' }),
      expect.objectContaining({ value: '' }),
    ]))
  })

  it('does not ask when an edited box is restored to its saved state', () => {
    renderShipment()
    const boxNumber = screen.getByPlaceholderText('1')
    fireEvent.change(boxNumber, { target: { value: '임시' } })
    fireEvent.change(boxNumber, { target: { value: '' } })
    selectOtherShipment()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(navigate).toHaveBeenCalledWith('/purchasing/china-shipments?shipment=b&step=items')
  })

  it('asks before switching a shipment with an unsaved box and keeps the draft when continuing', () => {
    renderShipment()
    editBox()

    selectOtherShipment()
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('button', { name: '저장 후 이동' })).toBeEnabled()
    expect(within(dialog).getByRole('button', { name: '저장하지 않고 이동' })).toBeEnabled()
    fireEvent.click(within(dialog).getByRole('button', { name: '계속 작업' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByLabelText('중국출고요청 선택')).toHaveValue('a')
    expect(screen.getByPlaceholderText('1')).toHaveValue('1')
    expect(screen.getByPlaceholderText('0')).toHaveValue(3)
    expect(saveBoxSplits).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('switches without saving only after the user explicitly discards the draft', () => {
    renderShipment()
    editBox()
    selectOtherShipment()
    expect(navigate).not.toHaveBeenCalled()

    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '저장하지 않고 이동' }))
    expect(saveBoxSplits).not.toHaveBeenCalled()
    expect(navigate).toHaveBeenCalledWith('/purchasing/china-shipments?shipment=b&step=items')
  })

  it('waits for the box save response before proceeding and preserves the draft on failure', async () => {
    let finishSave!: (result: { ok: boolean; error?: string }) => void
    saveBoxSplits.mockReturnValue(new Promise((resolve) => { finishSave = resolve }))
    renderShipment()
    editBox('4')
    selectOtherShipment()

    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '저장 후 이동' }))
    await waitFor(() => expect(saveBoxSplits).toHaveBeenCalledWith(expect.objectContaining({
      shipmentId: 'a',
      shipmentItemId: 'shared-item-id',
      allocations: [{ boxNo: '1', quantity: 4, lengthCm: null, widthCm: null, heightCm: null }],
    })))
    expect(screen.getByLabelText('중국출고요청 선택')).toHaveValue('a')
    expect(navigate).not.toHaveBeenCalled()
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: '저장하지 않고 이동' })).toBeDisabled()
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: '계속 작업' })).toBeDisabled()

    await act(async () => { finishSave({ ok: false, error: '저장 실패' }) })
    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(screen.getByLabelText('중국출고요청 선택')).toHaveValue('a')
    expect(screen.getByPlaceholderText('0')).toHaveValue(4)
    expect(navigate).not.toHaveBeenCalled()
  })

  it('navigates only after a successful save', async () => {
    let finishSave!: (result: { ok: boolean; error?: string }) => void
    saveBoxSplits.mockReturnValue(new Promise((resolve) => { finishSave = resolve }))
    renderShipment()
    editBox('4')
    selectOtherShipment()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '저장 후 이동' }))
    expect(navigate).not.toHaveBeenCalled()

    await act(async () => { finishSave({ ok: true }) })
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/purchasing/china-shipments?shipment=b&step=items'))
    expect(saveBoxSplits).toHaveBeenCalledTimes(1)
  })

  it('does not move or lose the draft if saving throws a network error', async () => {
    saveBoxSplits.mockRejectedValue(new Error('network'))
    renderShipment()
    editBox('4')
    selectOtherShipment()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '저장 후 이동' }))

    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(navigate).not.toHaveBeenCalled()
    expect(screen.getByPlaceholderText('0')).toHaveValue(4)
    expect(screen.getByLabelText('중국출고요청 선택')).toHaveValue('a')
  })

  it('asks before switching when shipment name or date is edited', () => {
    renderShipment(shipmentA, 'items')
    fireEvent.click(screen.getByRole('button', { name: '이름·날짜 수정' }))
    fireEvent.change(screen.getByLabelText('출고작업명'), { target: { value: '수정 중인 이름' } })
    fireEvent.change(screen.getByLabelText('출고예정일'), { target: { value: '2026-10-21' } })

    selectOtherShipment()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '계속 작업' }))
    expect(screen.getByLabelText('출고작업명')).toHaveValue('수정 중인 이름')
    expect(screen.getByLabelText('출고예정일')).toHaveValue('2026-10-21')
    expect(updateShipment).not.toHaveBeenCalled()
  })

  it('saves edited shipment name and date before switching', async () => {
    updateShipment.mockResolvedValue({ ok: true })
    renderShipment(shipmentA, 'items')
    fireEvent.click(screen.getByRole('button', { name: '이름·날짜 수정' }))
    fireEvent.change(screen.getByLabelText('출고작업명'), { target: { value: '수정된 이름' } })
    fireEvent.change(screen.getByLabelText('출고예정일'), { target: { value: '2026-10-21' } })
    selectOtherShipment()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '저장 후 이동' }))

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/purchasing/china-shipments?shipment=b&step=items'))
    expect(updateShipment).toHaveBeenCalledWith({ shipmentId: 'a', displayName: '수정된 이름', plannedOutboundDate: '2026-10-21' })
  })

  it('treats clearing an existing pallet number as an unsaved change', () => {
    renderShipment(makeShipmentWithBox(), 'pallets')
    const pallet = screen.getByPlaceholderText('예: 1')
    expect(pallet).toHaveValue('P1')
    fireEvent.change(pallet, { target: { value: '' } })

    selectOtherShipment()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '계속 작업' }))
    expect(screen.getByPlaceholderText('예: 1')).toHaveValue('')
    expect(savePalletAssignments).not.toHaveBeenCalled()
  })

  it('saves removal of a pallet assignment before switching', async () => {
    savePalletAssignments.mockResolvedValue({ ok: true })
    renderShipment(makeShipmentWithBox(), 'pallets')
    fireEvent.change(screen.getByPlaceholderText('예: 1'), { target: { value: '' } })
    selectOtherShipment()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '저장 후 이동' }))

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/purchasing/china-shipments?shipment=b&step=items'))
    expect(savePalletAssignments).toHaveBeenCalledWith({ shipmentId: 'a', assignments: [{ boxNo: 'A-01', palletNo: null }] })
  })

  it('guards changing the work stage while a box draft is unsaved', () => {
    renderShipment()
    editBox()
    fireEvent.click(screen.getByRole('button', { name: /3단계.*파렛트적재/ }))

    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '계속 작업' }))
    expect(screen.getByPlaceholderText('0')).toHaveValue(3)
    expect(screen.getByRole('button', { name: /2단계.*박스분할/ })).toHaveAttribute('aria-current', 'step')
  })

  it('does not lose an invalid quantity merely because it cannot be saved yet', () => {
    renderShipment()
    editBox('2.5')
    selectOtherShipment()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '계속 작업' }))
    expect(screen.getByPlaceholderText('0')).toHaveValue(2.5)
    expect(navigate).not.toHaveBeenCalled()
  })

  it('guards changing the box page and retains the current page and draft on cancel', () => {
    renderShipment(makeShipmentWithManyItems())
    fireEvent.change(screen.getAllByPlaceholderText('0')[0], { target: { value: '5' } })
    fireEvent.click(screen.getAllByRole('button', { name: '다음 페이지' })[0])

    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '계속 작업' }))
    expect(screen.getAllByText('1 / 2')).toHaveLength(2)
    expect(screen.getAllByPlaceholderText('0')[0]).toHaveValue(5)
    expect(screen.queryByText('SKU-11')).not.toBeInTheDocument()
  })

  it('changes box page after explicit discard', () => {
    renderShipment(makeShipmentWithManyItems())
    fireEvent.change(itemEditor('SKU-01').getByPlaceholderText('0'), { target: { value: '5' } })
    fireEvent.click(screen.getAllByRole('button', { name: '다음 페이지' })[0])
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '저장하지 않고 이동' }))
    expect(screen.getAllByText('2 / 2')).toHaveLength(2)
    expect(screen.getByText('SKU-11')).toBeInTheDocument()
    expect(saveBoxSplits).not.toHaveBeenCalled()
  })

  it('retains another product draft after saving one product and reordering the results', async () => {
    const detail = makeShipmentWithManyItems()
    saveBoxSplits.mockResolvedValue({ ok: true })
    const { rerender } = renderShipment(detail)
    fireEvent.change(itemEditor('SKU-01').getByPlaceholderText('0'), { target: { value: '10' } })
    fireEvent.change(itemEditor('SKU-02').getByPlaceholderText('0'), { target: { value: '5' } })
    fireEvent.click(itemEditor('SKU-01').getByRole('button', { name: '박스분할 저장' }))
    await waitFor(() => expect(saveBoxSplits).toHaveBeenCalledTimes(1))

    const refreshed: ChinaShipmentDetailView = {
      ...detail,
      items: detail.items.map((item) => item.id === 'item-1' ? { ...item, packedQuantity: 10 } : item),
      boxes: [{ id: 'saved-box', shipmentId: 'a', editable: true, palletId: null, boxNo: 'SKU-01-1', status: 'packing', note: null, lengthCm: null, widthCm: null, heightCm: null }],
      boxItems: [{ id: 'saved-allocation', boxId: 'saved-box', shipmentItemId: 'item-1', quantity: 10 }],
    }
    rerender(<ChinaShipmentsBoard inventoryItems={[inventoryItem]} shipments={shipments} selectedShipment={refreshed} selectedStep="boxes" showCreate={false} />)

    expect(screen.queryByText('SKU-01')).not.toBeInTheDocument()
    expect(itemEditor('SKU-02').getByPlaceholderText('0')).toHaveValue(5)
    selectOtherShipment()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('does not overwrite a shared box dimension after a quantity-only draft remounts', async () => {
    saveBoxSplits.mockResolvedValue({ ok: true })
    const initial = makeShipmentWithSharedBoxDimensions()
    const { rerender } = renderShipment(initial)
    fireEvent.change(itemEditor('SHARED-02').getByPlaceholderText('0'), { target: { value: '4' } })

    rerender(<ChinaShipmentsBoard inventoryItems={[inventoryItem]} shipments={shipments} selectedShipment={initial} selectedStep="items" showCreate={false} />)
    const refreshed = makeShipmentWithSharedBoxDimensions(40, 50, 60)
    rerender(<ChinaShipmentsBoard inventoryItems={[inventoryItem]} shipments={shipments} selectedShipment={refreshed} selectedStep="boxes" showCreate={false} />)

    const editor = itemEditor('SHARED-02')
    expect(editor.getByPlaceholderText('0')).toHaveValue(4)
    fireEvent.click(editor.getByRole('button', { name: '박스분할 저장' }))
    await waitFor(() => expect(saveBoxSplits).toHaveBeenCalledWith({
      shipmentId: 'a',
      shipmentItemId: 'shared-item-two',
      allocations: [{ boxNo: 'COMMON-1', quantity: 4, lengthCm: null, widthCm: null, heightCm: null }],
    }))
  })

  it('does not repeat already successful product saves after another product fails', async () => {
    let secondAttempts = 0
    saveBoxSplits.mockImplementation(async ({ shipmentItemId }: { shipmentItemId: string }) => {
      if (shipmentItemId === 'item-1') return { ok: true }
      secondAttempts += 1
      return secondAttempts === 1 ? { ok: false, error: '두 번째 품목 저장 실패' } : { ok: true }
    })
    renderShipment(makeShipmentWithManyItems(2))
    fireEvent.change(itemEditor('SKU-01').getByPlaceholderText('0'), { target: { value: '3' } })
    fireEvent.change(itemEditor('SKU-02').getByPlaceholderText('0'), { target: { value: '4' } })
    selectOtherShipment()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '저장 후 이동' }))

    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(navigate).not.toHaveBeenCalled()
    expect(itemEditor('SKU-02').getByPlaceholderText('0')).toHaveValue(4)
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '저장 후 이동' }))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/purchasing/china-shipments?shipment=b&step=items'))
    expect(saveBoxSplits.mock.calls.filter(([input]) => input.shipmentItemId === 'item-1')).toHaveLength(1)
    expect(saveBoxSplits.mock.calls.filter(([input]) => input.shipmentItemId === 'item-2')).toHaveLength(2)
  })

  it('does not add the same inventory twice after another draft fails to save', async () => {
    addShipmentItems.mockResolvedValue({ ok: true })
    updateShipment.mockResolvedValueOnce({ ok: false, error: '이름 저장 실패' }).mockResolvedValueOnce({ ok: true })
    renderShipment(shipmentA, 'items')
    fireEvent.click(screen.getByRole('button', { name: '품목 추가' }))
    fireEvent.change(screen.getByLabelText('추가 출고'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: '이름·날짜 수정' }))
    fireEvent.change(screen.getByLabelText('출고작업명'), { target: { value: '수정된 이름' } })
    selectOtherShipment()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '저장 후 이동' }))

    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(navigate).not.toHaveBeenCalled()
    expect(addShipmentItems).toHaveBeenCalledTimes(1)
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '저장 후 이동' }))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/purchasing/china-shipments?shipment=b&step=items'))
    expect(addShipmentItems).toHaveBeenCalledTimes(1)
    expect(updateShipment).toHaveBeenCalledTimes(2)
  })

  it('retains a selected workbook without applying it when leaving before review', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    try {
      renderShipment()
      const file = new File(['workbook'], '작성중.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      fireEvent.change(screen.getByLabelText('엑셀 선택'), { target: { files: [file] } })
      selectOtherShipment()
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '저장 후 이동' }))

      await waitFor(() => expect(toastError).toHaveBeenCalled())
      expect(fetchSpy).not.toHaveBeenCalled()
      expect(navigate).not.toHaveBeenCalled()
      expect(screen.getByText('작성중.xlsx')).toBeInTheDocument()
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('retains an Excel preview if the user decides to keep working', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ preview: { boxSplits: [], palletAssignments: [], summary: { boxSplitItemCount: 0, boxSplitRowCount: 0, palletAssignmentCount: 0, boxCount: 0 }, errors: [] } }),
    } as Response)
    try {
      renderShipment()
      const file = new File(['workbook'], '검토중.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      fireEvent.change(screen.getByLabelText('엑셀 선택'), { target: { files: [file] } })
      fireEvent.click(screen.getByRole('button', { name: '엑셀 검토' }))
      expect(await screen.findByRole('button', { name: '검토 결과 반영' })).toBeInTheDocument()

      selectOtherShipment()
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '계속 작업' }))
      expect(screen.getByRole('button', { name: '검토 결과 반영' })).toBeInTheDocument()
      expect(fetchSpy).toHaveBeenCalledTimes(1)
      expect(navigate).not.toHaveBeenCalled()
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('does not discard an incomplete new-shipment form if saving it fails', async () => {
    createShipment.mockResolvedValue({ ok: false, error: '도착지를 선택해주세요.' })
    render(<ChinaShipmentsBoard inventoryItems={[inventoryItem]} shipments={shipments} selectedShipment={null} selectedStep="items" showCreate />)
    fireEvent.change(screen.getByLabelText('출고작업명'), { target: { value: '작성 중' } })

    selectOtherShipment()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '저장 후 이동' }))
    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(screen.getByLabelText('출고작업명')).toHaveValue('작성 중')
    expect(screen.getByRole('button', { name: '중국출고요청 만들기' })).toBeInTheDocument()
  })

  it('creates a completed new-shipment draft before switching to the requested shipment', async () => {
    createShipment.mockResolvedValue({ ok: true, shipmentId: 'created' })
    render(<ChinaShipmentsBoard inventoryItems={[inventoryItem]} shipments={shipments} selectedShipment={null} selectedStep="items" showCreate />)
    fireEvent.change(screen.getByLabelText('출고작업명'), { target: { value: '새 출고' } })
    fireEvent.change(screen.getByLabelText('도착지'), { target: { value: '인천' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /중국창고/ }))
    fireEvent.change(screen.getByLabelText('이번 출고'), { target: { value: '3' } })
    selectOtherShipment()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '저장 후 이동' }))

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/purchasing/china-shipments?shipment=b&step=items'))
    expect(createShipment).toHaveBeenCalledWith(expect.objectContaining({ displayName: '새 출고', destinationName: '인천', lines: [{ inventoryId: 'inventory-new', quantity: 3 }] }))
    expect(createShipment).toHaveBeenCalledTimes(1)
  })

  it('keeps shipment selection disabled while an ordinary save is pending', async () => {
    let finishSave!: (result: { ok: boolean }) => void
    saveBoxSplits.mockReturnValue(new Promise((resolve) => { finishSave = resolve }))
    renderShipment()
    editBox()
    fireEvent.click(screen.getByRole('button', { name: '박스분할 저장' }))
    expect(screen.getByLabelText('중국출고요청 선택')).toBeDisabled()
    selectOtherShipment()
    expect(navigate).not.toHaveBeenCalled()
    await act(async () => { finishSave({ ok: true }) })
    expect(saveBoxSplits).toHaveBeenCalledTimes(1)
  })

  it('does not ask to save when downloading an Excel file without leaving the page', () => {
    renderShipment()
    editBox()
    const download = screen.getByRole('link', { name: '작업용 엑셀' })
    download.addEventListener('click', (event) => event.preventDefault(), { once: true })
    fireEvent.click(download)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText('0')).toHaveValue(3)
  })

  it('shows compact workbook controls in the top actions for every work stage', () => {
    renderShipment(shipmentA, 'items')

    expect(screen.getByRole('link', { name: '작업용 엑셀' })).toBeInTheDocument()
    expect(screen.getByLabelText('엑셀 선택')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '엑셀 검토' })).toBeDisabled()
    expect(screen.queryByText('현재 박스분할·파렛트적재 내용을 내려받아 엑셀에서 수정한 뒤 다시 검토하고 반영할 수 있습니다.')).not.toBeInTheDocument()
  })

  it('warns on browser unload only while a box draft is unsaved', () => {
    renderShipment()
    const cleanEvent = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(cleanEvent)
    expect(cleanEvent.defaultPrevented).toBe(false)

    editBox()
    const dirtyEvent = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(dirtyEvent)
    expect(dirtyEvent.defaultPrevented).toBe(true)
  })
})
