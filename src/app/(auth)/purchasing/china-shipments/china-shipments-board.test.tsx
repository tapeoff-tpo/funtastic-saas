import { useSyncExternalStore } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PurchasingLanguageSwitcher } from '@/components/purchasing-language-switcher'
import { ChinaShipmentsBoard, type ChinaShipmentDetailView, type ChinaShipmentListItem } from './china-shipments-board'

const { mergeBoxes, saveWeight, saveChineseName, addSample, savePalletDimensions, createShipment, updateShipment, saveBoxSplits, savePalletAssignments, saveBoxStatuses, savePalletStatuses, addShipmentItems, toastError, navigate } = vi.hoisted(() => ({
  mergeBoxes: vi.fn(),
  saveWeight: vi.fn(),
  saveChineseName: vi.fn(),
  addSample: vi.fn(),
  savePalletDimensions: vi.fn(),
  createShipment: vi.fn(),
  updateShipment: vi.fn(),
  saveBoxSplits: vi.fn(),
  savePalletAssignments: vi.fn(),
  saveBoxStatuses: vi.fn(),
  savePalletStatuses: vi.fn(),
  addShipmentItems: vi.fn(),
  toastError: vi.fn(),
  navigate: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/purchasing/china-shipments',
  useRouter: () => ({ refresh: vi.fn(), replace: navigate }),
  useSearchParams: () => new URLSearchParams(useSyncExternalStore(
    (notify) => { window.addEventListener('popstate', notify); return () => window.removeEventListener('popstate', notify) },
    () => window.location.search,
  )),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: toastError } }))
vi.mock('./china-work-navigation', () => ({ useChinaWorkNavigation: () => navigate }))
vi.mock('../saas-china-actions', () => ({
  mergeChinaOutboundBoxesAction: mergeBoxes,
  saveChinaOutboundPackageWeightAction: saveWeight,
  saveChinaOutboundItemChineseNameAction: saveChineseName,
  addChinaOutboundSampleAction: addSample,
  saveChinaOutboundPalletDimensionsAction: savePalletDimensions,
  addChinaOutboundShipmentItemsAction: addShipmentItems,
  assignChinaOutboundBoxesToPalletsAction: savePalletAssignments,
  cancelChinaOutboundShipmentAction: vi.fn(),
  createChinaOutboundShipmentAction: createShipment,
  deleteChinaOutboundShipmentAction: vi.fn(),
  dispatchChinaOutboundShipmentAction: vi.fn(),
  markChinaOutboundShipmentReadyAction: vi.fn(),
  saveChinaOutboundItemBoxSplitsAction: saveBoxSplits,
  saveChinaOutboundBoxCompletionStatusesAction: saveBoxStatuses,
  saveChinaOutboundPalletCompletionStatusesAction: savePalletStatuses,
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
      boxSplitStatus: 'in_progress',
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

const replaceHistoryState = window.history.replaceState.bind(window.history)

const shipmentA = makeShipment('a', '출고 A', 'SKU-A')
const shipmentB = makeShipment('b', '출고 B', 'SKU-B')
const shipments = [asListItem(shipmentA), asListItem(shipmentB)]
const inventoryItem = { id: 'inventory-new', warehouseCode: '중국창고', sku: 'NEW-1', productName: '새 상품', optionName: null, onHandQuantity: 20, reservedQuantity: 5, availableQuantity: 15 }

function renderShipment(detail = shipmentA, stage: 'items' | 'boxes' | 'pallets' | 'summary' = 'boxes') {
  return render(<ChinaShipmentsBoard inventoryItems={[inventoryItem]} shipments={shipments} selectedShipment={detail} selectedStep={stage} showCreate={false} />)
}

function renderShipmentWithLanguage(detail = shipmentA, stage: 'items' | 'boxes' | 'pallets' | 'summary' = 'boxes') {
  return render(<><PurchasingLanguageSwitcher /><ChinaShipmentsBoard inventoryItems={[inventoryItem]} shipments={shipments} selectedShipment={detail} selectedStep={stage} showCreate={false} /></>)
}

function visibleKoreanUi(root: Element) {
  const textNodes: string[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    if (!node.parentElement?.closest('[data-no-translate]') && /[가-힣]/.test(node.textContent ?? '') && node.parentElement?.tagName !== 'OPTION') {
      textNodes.push((node.textContent ?? '').trim())
    }
  }

  const attributes = [...root.querySelectorAll<HTMLElement>('*')].flatMap((element) =>
    ['placeholder', 'title', 'aria-label'].flatMap((attribute) => {
      const value = element.getAttribute(attribute)
      return value && /[가-힣]/.test(value) ? [`${element.tagName}.${attribute}: ${value}`] : []
    }),
  )

  return [...textNodes.filter(Boolean), ...attributes]
}

function selectOtherShipment() {
  const assignment = screen.queryByRole('dialog', { name: '파렛트 배정 수정' })
  if (assignment) fireEvent.click(within(assignment).getByRole('button', { name: '닫기' }))
  parkEditor()
  fireEvent.change(screen.getByLabelText('중국출고요청 선택'), { target: { value: 'b' } })
}

function editBox(quantity = '3') {
  itemEditor('SKU-A')
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

function makeFullyPackedInProgressShipment(): ChinaShipmentDetailView {
  return {
    ...shipmentA,
    items: [{ ...shipmentA.items[0], packedQuantity: 10, boxSplitStatus: 'in_progress' }],
    pallets: [{ id: 'pallet-1', palletNo: 'P1', note: null }],
    boxes: [{ id: 'box-1', shipmentId: 'a', editable: true, palletId: 'pallet-1', boxNo: '1', status: 'packing', note: null, lengthCm: null, widthCm: null, heightCm: null }],
    boxItems: [{ id: 'allocation-1', boxId: 'box-1', shipmentItemId: 'shared-item-id', quantity: 10 }],
  }
}

function makeShipmentWithCompletionFilters(): ChinaShipmentDetailView {
  return {
    ...shipmentA,
    items: [
      { ...shipmentA.items[0], id: 'complete-item', sku: 'DONE-01', productName: '완료 상품', optionName: '대형', reservedQuantity: 5, packedQuantity: 5, boxSplitStatus: 'completed' },
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

function makeShipmentWithBoxAndPalletStatuses(): ChinaShipmentDetailView {
  const detail = makeShipmentWithCompletionFilters()
  return {
    ...detail,
    pallets: [
      { id: 'pallet-1', palletNo: 'P1', note: null, completionStatus: 'completed' },
      { id: 'pallet-2', palletNo: 'P2', note: null, completionStatus: 'completed' },
    ],
    boxes: detail.boxes.map((box) => ({
      ...box,
      palletId: box.id === 'box-shared' ? 'pallet-2' : box.palletId,
      completionStatus: box.id === 'box-empty' ? 'in_progress' as const : 'completed' as const,
    })),
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
    items: detail.items.map((item) => item.id === completedItem.id ? { ...item, packedQuantity: item.reservedQuantity, boxSplitStatus: 'completed' } : item),
    boxes: [{ id: 'completed-box', shipmentId: 'a', editable: true, palletId: null, boxNo: '11', status: 'packing', note: null, lengthCm: null, widthCm: null, heightCm: null }],
    boxItems: [{ id: 'completed-allocation', boxId: 'completed-box', shipmentItemId: completedItem.id, quantity: completedItem.reservedQuantity }],
  }
}

function itemEditor(sku: string) {
  const dialog = document.querySelector<HTMLDialogElement>(`dialog[aria-label="${sku} 박스분할"]`)
  if (!dialog) {
    parkEditor()
    fireEvent.click(screen.getByRole('button', { name: `${sku} 박스분할 수정` }))
  }
  const article = document.querySelector<HTMLElement>(`dialog[aria-label="${sku} 박스분할"] article`)
  if (!article) throw new Error(`편집기를 찾을 수 없습니다: ${sku}`)
  return within(article)
}

function parkEditor() {
  const dialog = document.querySelector<HTMLDialogElement>('dialog[aria-label$=" 박스분할"]')
  if (!dialog) return
  const close = within(dialog).getByRole('button', { name: '닫기' })
  if (close.hasAttribute('disabled')) return
  fireEvent.click(close)
  const defer = within(dialog).queryByRole('button', { name: '임시 보관 후 닫기' })
  if (defer) fireEvent.click(defer)
}

function palletAssignmentRow(boxNo: string) {
  if (!screen.queryByRole('dialog', { name: '파렛트 배정 수정' })) fireEvent.click(screen.getByRole('button', { name: '파렛트 배정 수정' }))
  const row = screen.getByLabelText(`박스 ${boxNo} 파렛트 배정 선택`).closest('tr')
  if (!row) throw new Error(`파렛트 배정 행을 찾을 수 없습니다: ${boxNo}`)
  return within(row)
}

describe('ChinaShipmentsBoard', () => {
  beforeEach(() => {
    replaceHistoryState(null, '', '/purchasing/china-shipments')
    // Next's history integration notifies useSearchParams without a server navigation.
    vi.spyOn(window.history, 'replaceState').mockImplementation((...args) => {
      replaceHistoryState(...args)
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    HTMLDialogElement.prototype.showModal = function () { this.open = true }
    HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new Event('close')) }
    window.localStorage.clear()
    createShipment.mockReset()
    updateShipment.mockReset()
    saveBoxSplits.mockReset()
    savePalletAssignments.mockReset()
    saveBoxStatuses.mockReset()
    savePalletStatuses.mockReset()
    addShipmentItems.mockReset()
    mergeBoxes.mockReset(); saveWeight.mockReset(); saveChineseName.mockReset()
    addSample.mockReset()
    savePalletDimensions.mockReset()
    toastError.mockReset()
    navigate.mockReset()
  })

  it('splits the actual outbound quantity from the items dialog and supports manual numbering', async () => {
    saveBoxSplits.mockResolvedValue({ ok: true })
    const detail: ChinaShipmentDetailView = { ...shipmentA, items: [{ ...shipmentA.items[0], onHandQuantity: 1000, availableQuantity: 900, reservedQuantity: 100 }] }
    renderShipment(detail, 'items')
    expect(screen.getByRole('columnheader', { name: '현재고' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '실제 출고수량' })).toBeInTheDocument()
    expect(screen.getByText('1,000개')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '자동 분할 미리보기' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'SKU-A 박스분할 수정' }))
    const dialog = within(screen.getByRole('dialog'))
    fireEvent.change(dialog.getByLabelText('SKU-A 박스당 수량'), { target: { value: '10' } })
    expect(dialog.getByLabelText('SKU-A 총 박스 수')).toHaveValue(10)
    fireEvent.click(dialog.getByRole('button', { name: '자동 분할 미리보기' }))
    const rows = dialog.getAllByRole('row').slice(1)
    expect(rows).toHaveLength(10)
    fireEvent.change(within(rows[0]!).getAllByRole('textbox')[0]!, { target: { value: 'CUSTOM-9' } })
    fireEvent.click(dialog.getByRole('button', { name: '박스분할 저장' }))
    await waitFor(() => expect(saveBoxSplits).toHaveBeenCalledOnce())
    const allocations = saveBoxSplits.mock.calls[0]![0].allocations
    expect(allocations).toHaveLength(10)
    expect(allocations[0]).toMatchObject({ boxNo: 'CUSTOM-9', quantity: 10 })
    expect(allocations[0].autoNumber).toBeUndefined()
    expect(allocations[1]).toMatchObject({ boxNo: '2', quantity: 10, autoNumber: true })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('keeps stage-two edit controls out of the list until the edit button opens a popup', async () => {
    saveBoxSplits.mockResolvedValue({ ok: true })
    renderShipment()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText('1')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '박스분할 저장' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'SKU-A 박스분할 수정' }))
    const popup = within(screen.getByRole('dialog', { name: 'SKU-A 박스분할' }))
    fireEvent.change(popup.getByPlaceholderText('1'), { target: { value: '7' } })
    fireEvent.change(popup.getByPlaceholderText('0'), { target: { value: '10' } })
    fireEvent.click(popup.getByRole('button', { name: '박스분할 저장' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(saveBoxSplits).toHaveBeenCalledWith(expect.objectContaining({ shipmentItemId: 'shared-item-id', allocations: [expect.objectContaining({ boxNo: '7', quantity: 10 })] }))
    expect(screen.queryByPlaceholderText('1')).not.toBeInTheDocument()
  })

  it('opens the selected mixed-box product and does not save or select another product', async () => {
    saveBoxSplits.mockResolvedValue({ ok: true })
    renderShipment(makeShipmentWithSharedBoxDimensions())
    fireEvent.click(screen.getByRole('button', { name: 'COMMON-1 박스 SHARED-02 내용 수정' }))
    const popup = within(screen.getByRole('dialog', { name: 'SHARED-02 박스분할' }))
    fireEvent.change(popup.getByPlaceholderText('0'), { target: { value: '4' } })
    fireEvent.click(popup.getByRole('button', { name: '박스분할 저장' }))
    await waitFor(() => expect(saveBoxSplits).toHaveBeenCalledTimes(1))
    expect(saveBoxSplits).toHaveBeenCalledWith(expect.objectContaining({ shipmentItemId: 'shared-item-two', allocations: [expect.objectContaining({ boxNo: 'COMMON-1', quantity: 4 })] }))
  })

  it('keeps title descriptions hidden until help is clicked and translates the opened help', async () => {
    renderShipmentWithLanguage(shipmentA, 'items')
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
    expect(screen.queryByText('선정 후에도 품목이나 추가 수량을 같은 중국출고작업에 예약할 수 있습니다.')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '출고품목 추가 설명 보기' }))
    expect(screen.getByRole('note')).toHaveTextContent('선정 후에도 품목이나 추가 수량을')
    fireEvent.click(await screen.findByRole('button', { name: '中文' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '添加出库品项 帮助' })).toBeInTheDocument())
    expect(screen.getByRole('note')).toHaveTextContent('仍可在同一中国出库作业中预留品项')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('balances by box count and asks before discarding an unsaved dialog', async () => {
    renderShipment(shipmentA, 'items')
    fireEvent.click(screen.getByRole('button', { name: 'SKU-A 박스분할 수정' }))
    const dialog = within(screen.getByRole('dialog'))
    fireEvent.change(dialog.getByLabelText('SKU-A 총 박스 수'), { target: { value: '3' } })
    fireEvent.click(dialog.getByRole('button', { name: '자동 분할 미리보기' }))
    expect(dialog.getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('spinbutton')[0])).toEqual([
      expect.objectContaining({ value: '4' }), expect.objectContaining({ value: '3' }), expect.objectContaining({ value: '3' }),
    ])
    fireEvent.click(dialog.getByRole('button', { name: '닫기' }))
    expect(dialog.getByRole('alert')).toHaveTextContent('저장하지 않은 박스분할')
    fireEvent.click(dialog.getByRole('button', { name: '변경 취소' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(saveBoxSplits).not.toHaveBeenCalled()
  })

  it('shows verified receipt packing and translates the dynamically opened split dialog', async () => {
    const detail: ChinaShipmentDetailView = { ...shipmentA, items: [{ ...shipmentA.items[0], receiptPacking: [{ receiptBoxId: 'receipt-1', trackingNumber: 'SF001', receivedQuantity: 20, quantity: 10, lengthCm: 10, widthCm: 20, heightCm: 30, weightKg: null }] }] }
    renderShipmentWithLanguage(detail, 'items')
    expect(screen.getByText('SF001')).toBeInTheDocument()
    expect(screen.getByText(/입고 20개\/박스/)).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: '中文' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'SKU-A 编辑装箱拆分' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'SKU-A 编辑装箱拆分' }))
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'SKU-A 装箱拆分' })).toBeInTheDocument())
    const root = document.querySelector('[data-purchasing-translate]')!
    expect(visibleKoreanUi(root)).toEqual([])
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: '预览自动拆分' })).toBeInTheDocument()
  })

  it('keeps automatic box numbers distinct across unsaved product editors', () => {
    renderShipment({ ...shipmentA, items: [shipmentA.items[0], { ...shipmentA.items[0], id: 'other-item', sku: 'SKU-B' }] })
    for (const sku of ['SKU-A', 'SKU-B']) {
      const editor = itemEditor(sku)
      fireEvent.change(editor.getByLabelText(`${sku} 박스당 수량`), { target: { value: '5' } })
      fireEvent.click(editor.getByRole('button', { name: '자동 분할 미리보기' }))
    }
    expect(itemEditor('SKU-A').getAllByRole('textbox').map((input) => (input as HTMLInputElement).value)).toEqual(['1', '2'])
    expect(itemEditor('SKU-B').getAllByRole('textbox').map((input) => (input as HTMLInputElement).value)).toEqual(['3', '4'])
  })

  it('translates every visible stage 1 and 2 control while preserving product identity data', async () => {
    const baseDetail = makeShipmentWithCompletionFilters()
    const detail: ChinaShipmentDetailView = {
      ...baseDetail,
      items: baseDetail.items.map((item, index) => index === 0 ? {
        ...item,
        sku: 'SKU-KEEP',
        productName: '번역 제외 상품명',
        optionName: '번역 제외 옵션명',
      } : item),
    }
    const { rerender } = renderShipmentWithLanguage(detail, 'items')

    fireEvent.click(await screen.findByRole('button', { name: '中文' }))

    await waitFor(() => expect(screen.getByText('第1步 · 确认出库品项')).toBeInTheDocument())
    expect(screen.getByRole('columnheader', { name: '商品名(韩文)' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '实际出库数量' })).toBeInTheDocument()
    expect(screen.getByText('添加出库品项')).toBeInTheDocument()
    expect(screen.getAllByText('SKU-KEEP').length).toBeGreaterThan(0)
    expect(screen.getByText(/번역 제외 상품명/)).toBeInTheDocument()
    expect(screen.getByText(/번역 제외 옵션명/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '添加品项' }))
    await waitFor(() => expect(screen.getByText(/出库仓库：/)).toBeInTheDocument())
    const stageOneRoot = document.querySelector('[data-purchasing-translate]')
    expect(stageOneRoot).not.toBeNull()
    expect(visibleKoreanUi(stageOneRoot!)).toEqual([])

    rerender(<><PurchasingLanguageSwitcher /><ChinaShipmentsBoard inventoryItems={[inventoryItem]} shipments={shipments} selectedShipment={detail} selectedStep="boxes" showCreate={false} /></>)

    await waitFor(() => expect(screen.getByText('已保存箱子情况')).toBeInTheDocument())
    expect(screen.getByText('第2步')).toBeInTheDocument()
    expect(screen.getAllByRole('columnheader', { name: '箱号' }).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'SKU-KEEP 编辑装箱拆分' }))
    await waitFor(() => expect(screen.getAllByRole('columnheader', { name: '装载数量' }).length).toBeGreaterThan(0))
    expect(screen.getAllByRole('button', { name: '添加箱子' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: '保存装箱拆分' }).length).toBeGreaterThan(0)
    expect(screen.getAllByText('SKU-KEEP').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/번역 제외 상품명/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/번역 제외 옵션명/).length).toBeGreaterThan(0)
    const stageTwoRoot = document.querySelector('[data-purchasing-translate]')
    expect(stageTwoRoot).not.toBeNull()
    expect(visibleKoreanUi(stageTwoRoot!)).toEqual([])

    fireEvent.click(screen.getByRole('button', { name: '한국어' }))
    await waitFor(() => expect(screen.getByText('저장된 박스 현황')).toBeInTheDocument())
    expect(screen.getAllByRole('columnheader', { name: '박스번호' }).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/번역 제외 상품명/).length).toBeGreaterThan(0)
  })

  it('translates refreshed China outbound values after Chinese mode is already active', async () => {
    const detail: ChinaShipmentDetailView = {
      ...shipmentA,
      items: [{ ...shipmentA.items[0], reservedQuantity: 10 }],
    }
    const { rerender } = renderShipmentWithLanguage(detail, 'items')

    fireEvent.click(await screen.findByRole('button', { name: '中文' }))
    await waitFor(() => expect(screen.getByText('10个')).toBeInTheDocument())

    rerender(<><PurchasingLanguageSwitcher /><ChinaShipmentsBoard inventoryItems={[inventoryItem]} shipments={shipments} selectedShipment={{ ...detail, items: [{ ...detail.items[0], reservedQuantity: 12 }] }} selectedStep="items" showCreate={false} /></>)

    await waitFor(() => expect(screen.getByText('12个')).toBeInTheDocument())
  })

  it('keeps later China outbound stages translated without translating product identity data', async () => {
    const detail = makeShipmentWithBoxAndPalletStatuses()
    const { rerender } = renderShipmentWithLanguage(detail, 'pallets')

    fireEvent.click(await screen.findByRole('button', { name: '中文' }))
    await waitFor(() => expect(screen.getByText('托盘装载')).toBeInTheDocument())
    const palletRoot = document.querySelector('[data-purchasing-translate]')
    expect(palletRoot).not.toBeNull()
    expect(visibleKoreanUi(palletRoot!)).toEqual([])

    rerender(<><PurchasingLanguageSwitcher /><ChinaShipmentsBoard inventoryItems={[inventoryItem]} shipments={shipments} selectedShipment={detail} selectedStep="summary" showCreate={false} /></>)

    await waitFor(() => expect(screen.getByText('最终装载清单')).toBeInTheDocument())
    const summaryRoot = document.querySelector('[data-purchasing-translate]')
    expect(summaryRoot).not.toBeNull()
    expect(visibleKoreanUi(summaryRoot!)).toEqual([])
  })

  it('translates the new China outbound request form while preserving item identity data', async () => {
    render(<><PurchasingLanguageSwitcher /><ChinaShipmentsBoard inventoryItems={[inventoryItem]} shipments={shipments} selectedShipment={null} selectedStep="items" showCreate /></>)

    fireEvent.click(await screen.findByRole('button', { name: '中文' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '创建中国出库申请' })).toBeInTheDocument())
    const createRoot = document.querySelector('[data-purchasing-translate]')
    expect(createRoot).not.toBeNull()
    expect(visibleKoreanUi(createRoot!)).toEqual([])
    fireEvent.click(screen.getByRole('checkbox'))
    await waitFor(() => expect(screen.getByText('새 상품')).toBeInTheDocument())
    expect(visibleKoreanUi(createRoot!)).toEqual([])
    expect(screen.getByText('새 상품')).toBeInTheDocument()
    expect(screen.getByText('NEW-1')).toBeInTheDocument()
  })

  it('translates China shipment confirmations and Sonner feedback in Chinese mode', async () => {
    renderShipmentWithLanguage(shipmentA, 'items')

    fireEvent.click(await screen.findByRole('button', { name: '中文' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '删除' })).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: '删除出库作业' })).toBeInTheDocument()
    expect(within(dialog).getByText('要删除此出库作业吗？预留库存、箱子、托盘和装载记录也会一并删除，且无法恢复。')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: '取消' })).toBeInTheDocument()
    expect(visibleKoreanUi(dialog)).toEqual([])

    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    const toaster = document.createElement('ol')
    toaster.setAttribute('data-sonner-toaster', '')
    const toast = document.createElement('li')
    toast.textContent = '도착지와 올바른 출고수량을 입력한 뒤 저장해주세요.'
    toaster.appendChild(toast)
    document.body.appendChild(toaster)

    await waitFor(() => expect(toast).toHaveTextContent('请输入目的地和正确的出库数量后再保存。'))
    expect(visibleKoreanUi(toaster)).toEqual([])
    toaster.remove()
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
    expect(itemEditor('SKU-B').getByPlaceholderText('1')).toHaveValue('')
    expect(screen.getByLabelText('중국출고요청 선택')).toHaveValue('b')
  })

  it('enables pallet download only when a saved nonempty box is assigned to a pallet', () => {
    const detail = makeShipmentWithBox()
    const unassigned = { ...detail, boxes: detail.boxes.map((box) => ({ ...box, palletId: null })) }
    const { rerender } = renderShipment(unassigned)
    expect(screen.getByRole('link', { name: '박스 쉽먼트 일괄 다운로드' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '파렛트 쉽먼트 일괄 다운로드' })).toBeDisabled()
    rerender(<ChinaShipmentsBoard inventoryItems={[inventoryItem]} shipments={shipments} selectedShipment={detail} selectedStep="pallets" showCreate={false} />)
    expect(screen.getByRole('link', { name: '파렛트 쉽먼트 일괄 다운로드' })).toHaveAttribute('href', '/api/purchasing/china-shipments/a/labels?type=pallets')
  })

  it('shows saved box contents and lets users include empty boxes', () => {
    renderShipment(makeShipmentWithCompletionFilters())

    expect(screen.getByRole('link', { name: '박스 쉽먼트 일괄 다운로드' })).toHaveAttribute('href', '/api/purchasing/china-shipments/a/labels?type=boxes')
    expect(screen.getByRole('link', { name: '파렛트 쉽먼트 일괄 다운로드' })).toHaveAttribute('href', '/api/purchasing/china-shipments/a/labels?type=pallets')
    const savedBoxPanel = screen.getByRole('heading', { name: '저장된 박스 현황' }).closest('section')
    if (!savedBoxPanel) throw new Error('저장된 박스 현황을 찾을 수 없습니다.')
    fireEvent.click(within(savedBoxPanel).getByRole('button', { name: '전체 펼치기' }))
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





  it('shows only used pallets and expands boxes and their products independently', () => {
    renderShipment(makeShipmentWithBoxAndPalletStatuses(), 'pallets')
    expect(screen.getAllByRole('heading', { name: '사용 파렛트' })).toHaveLength(1)
    expect(screen.queryByRole('heading', { name: '파렛트 상태' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'BOX-01 박스 상품 펼치기' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '파렛트 P1 펼치기' }))
    const article = screen.getByRole('button', { name: '파렛트 P1 접기' }).closest('article')!
    const boxButton = within(article).getByRole('button', { name: /박스 상품 펼치기/ })
    expect(within(article).queryByText(/DONE-01 · 완료 상품/)).not.toBeInTheDocument()
    fireEvent.click(boxButton)
    expect(within(article).getByText(/DONE-01 · 완료 상품/)).toBeInTheDocument()
    fireEvent.click(within(article).getByRole('button', { name: /박스 상품 접기/ }))
    expect(within(article).queryByText(/DONE-01 · 완료 상품/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '파렛트 P1 접기' }))
    expect(screen.queryByRole('button', { name: /박스 상품 펼치기/ })).not.toBeInTheDocument()
  })

  it('calculates final CBM from measured pallet dimensions independently of product CBM', async () => {
    savePalletDimensions.mockResolvedValue({ ok: true })
    renderShipment(makeShipmentWithBoxAndPalletStatuses(), 'pallets')
    fireEvent.click(screen.getByRole('button', { name: '파렛트 P1 펼치기' }))
    fireEvent.change(screen.getByLabelText('파렛트 P1 가로(cm)'), { target: { value: '120' } })
    fireEvent.change(screen.getByLabelText('파렛트 P1 세로(cm)'), { target: { value: '100' } })
    fireEvent.change(screen.getByLabelText('파렛트 P1 높이(cm)'), { target: { value: '150' } })
    expect(screen.getByText('최종 파렛트 CBM: 1.8000 CBM')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '파렛트 P1 규격 저장' }))
    await waitFor(() => expect(savePalletDimensions).toHaveBeenCalledWith({ shipmentId: 'a', palletId: 'pallet-1', lengthCm: 120, widthCm: 100, heightCm: 150 }))
  })

  it('retains pallet dimension edits after collapsing and reopening', () => {
    renderShipment(makeShipmentWithBoxAndPalletStatuses(), 'pallets')
    fireEvent.click(screen.getByRole('button', { name: '파렛트 P1 펼치기' }))
    fireEvent.change(screen.getByLabelText('파렛트 P1 가로(cm)'), { target: { value: '120' } })
    fireEvent.click(screen.getByRole('button', { name: '파렛트 P1 접기' }))
    fireEvent.click(screen.getByRole('button', { name: '파렛트 P1 펼치기' }))
    expect(screen.getByLabelText('파렛트 P1 가로(cm)')).toHaveValue(120)
    selectOtherShipment()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('opens pallet assignment editing on demand', () => {
    renderShipment(makeShipmentWithBoxAndPalletStatuses(), 'pallets')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '파렛트 배정 수정' }))
    expect(screen.getByRole('dialog', { name: '파렛트 배정 수정' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '닫기' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('adds samples by hand without selecting existing stock', async () => {
    addSample.mockResolvedValue({ ok: true })
    renderShipment(shipmentA, 'items')
    fireEvent.click(screen.getByRole('button', { name: '샘플 수기 추가' }))
    fireEvent.change(screen.getByLabelText('상품명'), { target: { value: '신규 샘플' } })
    fireEvent.change(screen.getByLabelText('수량'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: '샘플 추가 저장' }))
    await waitFor(() => expect(addSample).toHaveBeenCalledWith(expect.objectContaining({ shipmentId: 'a', productName: '신규 샘플', quantity: 3, warehouseCode: '중국창고', requestId: expect.any(String) })))
    expect(addShipmentItems).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: '샘플 추가 저장' })).not.toBeInTheDocument()
  })

  it('retries an ambiguous sample save with the same id and unchanged payload', async () => {
    addSample.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({ ok: true })
    renderShipment(shipmentA, 'items')
    fireEvent.click(screen.getByRole('button', { name: '샘플 수기 추가' }))
    fireEvent.change(screen.getByLabelText('상품명'), { target: { value: '샘플' } })
    fireEvent.change(screen.getByLabelText('수량'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: '샘플 추가 저장' }))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('등록 결과를 확인하지 못했습니다. 다시 저장하면 중복 없이 확인합니다.'))
    await waitFor(() => expect(screen.getByRole('button', { name: '샘플 추가 저장' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '샘플 추가 저장' }))
    await waitFor(() => expect(addSample).toHaveBeenCalledTimes(2))
    expect(addSample.mock.calls[1]![0]).toEqual(addSample.mock.calls[0]![0])
  })

  it('translates expanded pallet controls and manual samples while keeping product identities', async () => {
    const detail = makeShipmentWithBoxAndPalletStatuses()
    const { rerender } = renderShipmentWithLanguage(detail, 'pallets')
    fireEvent.click(await screen.findByRole('button', { name: '中文' }))
    fireEvent.click(await screen.findByRole('button', { name: '托盘 P1 展开/收起' }))
    const root = document.querySelector('[data-purchasing-translate]')!
    await waitFor(() => expect(visibleKoreanUi(root)).toEqual([]))
    fireEvent.click(screen.getByRole('button', { name: /箱 BOX-01 商品/ }))
    await waitFor(() => expect(visibleKoreanUi(root)).toEqual([]))
    expect(screen.getByText(/DONE-01 · 완료 상품/)).toBeInTheDocument()
    rerender(<><PurchasingLanguageSwitcher /><ChinaShipmentsBoard inventoryItems={[inventoryItem]} shipments={shipments} selectedShipment={detail} selectedStep="items" showCreate={false} /></>)
    fireEvent.click(await screen.findByRole('button', { name: '手动添加样品' }))
    await waitFor(() => expect(visibleKoreanUi(root)).toEqual([]))
  })

  it('allows a sample-only shipment to be created with no existing stock', async () => {
    createShipment.mockResolvedValue({ ok: false, error: 'test' })
    render(<ChinaShipmentsBoard inventoryItems={[]} shipments={shipments} selectedShipment={null} selectedStep="items" showCreate />)
    fireEvent.change(screen.getByLabelText('도착지'), { target: { value: '인천' } })
    fireEvent.click(screen.getByRole('button', { name: '중국출고요청 만들기' }))
    await waitFor(() => expect(createShipment).toHaveBeenCalledWith(expect.objectContaining({ lines: [], destinationName: '인천' })))
  })

  it('allows loose-box dispatch and shows PLT + BOX totals', () => {
    const detail = makeFullyPackedInProgressShipment()
    detail.boxes.forEach((box) => { box.palletId = null })
    renderShipment(detail, 'summary')
    expect(screen.getByRole('button', { name: '출고완료' })).toBeEnabled()
    expect(screen.getByText('낱박스 1개')).toBeInTheDocument()
    expect(screen.getAllByText('0 PLT + 1 BOX').length).toBeGreaterThan(0)
  })

  it('saves a measured gross weight for a box and a pallet', async () => {
    saveWeight.mockResolvedValue({ ok: true })
    renderShipment(makeShipmentWithBoxAndPalletStatuses(), 'pallets')
    fireEvent.click(screen.getByRole('button', { name: '파렛트 P1 펼치기' }))
    fireEvent.change(screen.getByLabelText('파렛트 P1 총중량(kg)'), { target: { value: '52.5' } })
    fireEvent.click(screen.getByRole('button', { name: '중량 저장' }))
    await waitFor(() => expect(saveWeight).toHaveBeenCalledWith({ shipmentId: 'a', kind: 'pallet', packageId: 'pallet-1', grossWeightKg: 52.5 }))
    fireEvent.click(screen.getByRole('button', { name: 'BOX-01 박스 상품 펼치기' }))
    fireEvent.change(screen.getByLabelText('박스 BOX-01 총중량(kg)'), { target: { value: '12.25' } })
    const input = screen.getByLabelText('박스 BOX-01 총중량(kg)')
    fireEvent.click(within(input.closest('div')!).getByRole('button', { name: '중량 저장' }))
    await waitFor(() => expect(saveWeight).toHaveBeenCalledWith({ shipmentId: 'a', kind: 'box', packageId: 'box-saved', grossWeightKg: 12.25 }))
  })

  it('shows Korean and Chinese product names together in the item list and split popup', () => {
    const detail = { ...shipmentA, items: shipmentA.items.map((item) => ({ ...item, chineseProductName: '水杯' })) }
    renderShipment(detail, 'items')
    expect(screen.getByText('水杯')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'SKU-A 박스분할 수정' }))
    expect(within(screen.getByRole('dialog', { name: 'SKU-A 박스분할' })).getByText('水杯')).toBeInTheDocument()
  })

  it('stores a Chinese name for the selected outbound item only', async () => {
    saveChineseName.mockResolvedValue({ ok: true })
    renderShipment(shipmentA, 'items')
    fireEvent.click(screen.getByRole('button', { name: '중국어 상품명 수정' }))
    fireEvent.change(screen.getByLabelText('SKU-A 中文品名'), { target: { value: '样品杯' } })
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    await waitFor(() => expect(saveChineseName).toHaveBeenCalledWith({ shipmentId: 'a', shipmentItemId: 'shared-item-id', chineseProductName: '样品杯' }))
  })

  it('filters additional stock by inclusive Korea receipt dates and preserves hidden selections', async () => {
    addShipmentItems.mockResolvedValue({ ok: true })
    const stock = [
      { ...inventoryItem, lastReceivedAt: '2026-11-02T15:00:00Z' },
      { ...inventoryItem, id: 'older', sku: 'OLD-1', productName: '오래된 상품', lastReceivedAt: '2026-11-02T14:59:00Z' },
    ]
    render(<ChinaShipmentsBoard inventoryItems={stock} shipments={shipments} selectedShipment={shipmentA} selectedStep="items" showCreate={false} />)
    fireEvent.click(screen.getByRole('button', { name: '품목 추가' }))
    fireEvent.change(screen.getAllByLabelText('추가 출고')[1]!, { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText('입고일 시작'), { target: { value: '2026-11-03' } })
    fireEvent.change(screen.getByLabelText('입고일 종료'), { target: { value: '2026-11-03' } })
    expect(screen.queryByText('오래된 상품')).not.toBeInTheDocument()
    expect(screen.getByText('새 상품')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '선택 품목 추가' }))
    await waitFor(() => expect(addShipmentItems).toHaveBeenCalledWith({ shipmentId: 'a', lines: [{ inventoryId: 'older', quantity: 2 }] }))
  })

  it('loads current stock only when the existing shipment addition panel is opened', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ items: [inventoryItem] })))
    try {
      render(<ChinaShipmentsBoard inventoryItems={[]} shipments={shipments} selectedShipment={shipmentA} selectedStep="items" showCreate={false} />)
      expect(fetchSpy).not.toHaveBeenCalled()
      fireEvent.click(screen.getByRole('button', { name: '품목 추가' }))
      await waitFor(() => expect(screen.getByText('새 상품')).toBeInTheDocument())
      expect(fetchSpy).toHaveBeenCalledWith('/api/purchasing/china-shipments/available-stock', { cache: 'no-store' })
    } finally { fetchSpy.mockRestore() }
  })

  it('merges selected boxes using the largest physical box as the preview', async () => {
    mergeBoxes.mockResolvedValue({ ok: true })
    const detail = makeShipmentWithBoxAndPalletStatuses()
    detail.boxes[0] = { ...detail.boxes[0]!, lengthCm: 50, widthCm: 40, heightCm: 30 }
    detail.boxes[1] = { ...detail.boxes[1]!, lengthCm: 10, widthCm: 20, heightCm: 30 }
    renderShipment(detail)
    fireEvent.click(screen.getByRole('button', { name: '박스 합치기' }))
    fireEvent.click(screen.getByLabelText('BOX-01 합치기 선택'))
    fireEvent.click(screen.getByLabelText('BOX-02 합치기 선택'))
    fireEvent.click(screen.getByRole('button', { name: '선택 박스 합치기' }))
    await waitFor(() => expect(mergeBoxes).toHaveBeenCalledWith({ shipmentId: 'a', boxIds: ['box-saved', 'box-shared'] }))
  })

  it('offers direct dispatch and removes cancellation and ready buttons', () => {
    renderShipment(makeFullyPackedInProgressShipment(), 'summary')
    expect(screen.queryByRole('button', { name: '포장완료' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '작업 취소' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '출고완료' })).toBeEnabled()
  })

  it('uses quantities and pallet assignment rather than legacy completion flags for dispatch', () => {
    const detail = makeFullyPackedInProgressShipment()
    detail.items[0]!.boxSplitStatus = 'in_progress'
    detail.boxes[0]!.completionStatus = 'in_progress'
    detail.pallets[0]!.completionStatus = 'in_progress'
    const { rerender } = renderShipment(detail, 'summary')
    expect(screen.getByRole('button', { name: '출고완료' })).toBeEnabled()
    rerender(<ChinaShipmentsBoard inventoryItems={[inventoryItem]} shipments={shipments} selectedShipment={{ ...detail, items: [{ ...detail.items[0]!, packedQuantity: 3 }] }} selectedStep="summary" showCreate={false} />)
    expect(screen.getByRole('button', { name: '출고완료' })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('박스에 담긴 수량')
  })

  it('opens a completed saved box in its editable product editor', () => {
    renderShipment(makeShipmentWithCompletedBoxOnLaterPage())

    const savedBoxPanel = screen.getByRole('heading', { name: '저장된 박스 현황' }).closest('section')
    if (!savedBoxPanel) throw new Error('저장된 박스 현황을 찾을 수 없습니다.')
    fireEvent.click(within(savedBoxPanel).getByRole('button', { name: '전체 펼치기' }))
    fireEvent.click(within(savedBoxPanel).getByRole('button', { name: '11 박스 내용 수정' }))

    expect(screen.getByRole('dialog', { name: 'SKU-11 박스분할' })).toBeInTheDocument()
    const editor = itemEditor('SKU-11')
    expect(editor.getByPlaceholderText('1')).toHaveValue('11')
    expect(editor.getByPlaceholderText('1')).toBeEnabled()
    expect(editor.getByRole('button', { name: '박스분할 저장' })).toBeEnabled()
  })

  it('filters completed items without losing a hidden box split draft', () => {
    renderShipment(makeShipmentWithCompletionFilters())
    const itemFilter = screen.getByRole('group', { name: '박스분할 품목 상태 필터' })
    fireEvent.change(itemEditor('WORK-01').getByPlaceholderText('0'), { target: { value: '3' } })

    parkEditor()
    fireEvent.click(within(itemFilter).getByRole('button', { name: /수량 일치/ }))
    expect(screen.getByRole('button', { name: 'DONE-01 박스분할 수정' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'WORK-01 박스분할 수정' })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    fireEvent.click(within(itemFilter).getByRole('button', { name: /수량 부족/ }))
    expect(screen.getByRole('button', { name: 'WORK-01 박스분할 수정' })).toBeInTheDocument()
    expect(screen.getByText('WAIT-01')).toBeInTheDocument()
    expect(itemEditor('WORK-01').getByPlaceholderText('0')).toHaveValue(3)
  })

  it('allows a fully packed product to be marked complete with the box split save', async () => {
    saveBoxSplits.mockResolvedValue({ ok: true })
    renderShipment()
    editBox('10')

    fireEvent.click(itemEditor('SKU-A').getByRole('button', { name: '박스분할 저장' }))

    await waitFor(() => expect(saveBoxSplits).toHaveBeenCalledWith(expect.objectContaining({
      shipmentId: 'a',
      shipmentItemId: 'shared-item-id',
      boxSplitStatus: 'completed',
    })))
  })

  it('removes manual box and product status controls', () => {
    renderShipment(makeShipmentWithBoxAndPalletStatuses())
    expect(screen.queryByRole('columnheader', { name: '박스 상태' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('박스 BOX-01 상태')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('DONE-01 박스분할 상태')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '박스 전체 저장' })).not.toBeInTheDocument()
  })

  it('opens label printing in a separate tab without discarding drafts', () => {
    renderShipment(makeShipmentWithBox())
    const link = screen.getByRole('link', { name: '박스 쉽먼트 바로 인쇄' })
    expect(link).toHaveAttribute('href', '/api/purchasing/china-shipments/a/labels?type=boxes&format=print')
    expect(link).toHaveAttribute('target', '_blank')
    fireEvent.click(screen.getByRole('button', { name: '전체 펼치기' }))
    expect(screen.getByRole('link', { name: 'A-01 박스 쉽먼트 바로 인쇄' })).toHaveAttribute('href', '/api/purchasing/china-shipments/a/labels?boxId=box-1&format=print')
  })

  it('saves only the checked box split drafts', async () => {
    saveBoxSplits.mockResolvedValue({ ok: true })
    renderShipment(makeShipmentWithManyItems(2))
    fireEvent.change(itemEditor('SKU-01').getByPlaceholderText('1'), { target: { value: '1' } })
    fireEvent.change(itemEditor('SKU-01').getByPlaceholderText('0'), { target: { value: '3' } })
    fireEvent.change(itemEditor('SKU-02').getByPlaceholderText('1'), { target: { value: '2' } })
    fireEvent.change(itemEditor('SKU-02').getByPlaceholderText('0'), { target: { value: '4' } })
    parkEditor()
    fireEvent.click(screen.getByLabelText('SKU-01 저장 선택'))

    fireEvent.click(screen.getByRole('button', { name: '선택 저장' }))

    await waitFor(() => expect(saveBoxSplits).toHaveBeenCalledTimes(1))
    expect(saveBoxSplits).toHaveBeenCalledWith(expect.objectContaining({
      shipmentId: 'a',
      shipmentItemId: 'item-1',
      allocations: [{ boxNo: '1', quantity: 3, lengthCm: null, widthCm: null, heightCm: null }],
    }))
    expect(saveBoxSplits.mock.calls.some(([input]) => input.shipmentItemId === 'item-2')).toBe(false)
  })

  it('saves every changed box split with the overall save button', async () => {
    saveBoxSplits.mockResolvedValue({ ok: true })
    renderShipment(makeShipmentWithManyItems(2))
    fireEvent.change(itemEditor('SKU-01').getByPlaceholderText('1'), { target: { value: '1' } })
    fireEvent.change(itemEditor('SKU-01').getByPlaceholderText('0'), { target: { value: '3' } })
    fireEvent.change(itemEditor('SKU-02').getByPlaceholderText('1'), { target: { value: '2' } })
    fireEvent.change(itemEditor('SKU-02').getByPlaceholderText('0'), { target: { value: '4' } })

    parkEditor()
    fireEvent.click(screen.getByRole('button', { name: '전체 저장' }))

    await waitFor(() => expect(saveBoxSplits).toHaveBeenCalledTimes(2))
    expect(saveBoxSplits.mock.calls.map(([input]) => input.shipmentItemId).sort()).toEqual(['item-1', 'item-2'])
  })

  it('allows shared-box drafts to save with server-side largest-box sizing', async () => {
    saveBoxSplits.mockResolvedValue({ ok: true })
    renderShipment(makeShipmentWithSharedBoxDimensions())
    fireEvent.change(itemEditor('SHARED-01').getByDisplayValue('10'), { target: { value: '11' } })
    fireEvent.change(itemEditor('SHARED-02').getByDisplayValue('10'), { target: { value: '12' } })

    parkEditor()
    fireEvent.click(screen.getByRole('button', { name: '전체 저장' }))

    await waitFor(() => expect(saveBoxSplits).toHaveBeenCalledTimes(2))
    expect(toastError).not.toHaveBeenCalled()
  })

  it('keeps only failed selected drafts checked after a partial batch save', async () => {
    let secondAttempts = 0
    saveBoxSplits.mockImplementation(async ({ shipmentItemId }: { shipmentItemId: string }) => {
      if (shipmentItemId === 'item-1') return { ok: true }
      secondAttempts += 1
      return secondAttempts === 1 ? { ok: false, error: '두 번째 품목 저장 실패' } : { ok: true }
    })
    renderShipment(makeShipmentWithManyItems(2))
    fireEvent.change(itemEditor('SKU-01').getByPlaceholderText('1'), { target: { value: '1' } })
    fireEvent.change(itemEditor('SKU-01').getByPlaceholderText('0'), { target: { value: '3' } })
    fireEvent.change(itemEditor('SKU-02').getByPlaceholderText('1'), { target: { value: '2' } })
    fireEvent.change(itemEditor('SKU-02').getByPlaceholderText('0'), { target: { value: '4' } })
    parkEditor()
    fireEvent.click(screen.getByLabelText('SKU-01 저장 선택'))
    fireEvent.click(screen.getByLabelText('SKU-02 저장 선택'))

    fireEvent.click(screen.getByRole('button', { name: '선택 저장' }))

    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(screen.getByText('선택 1개')).toBeInTheDocument()
    expect(saveBoxSplits.mock.calls.filter(([input]) => input.shipmentItemId === 'item-1')).toHaveLength(1)

    await waitFor(() => expect(screen.getByRole('button', { name: '선택 저장' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '선택 저장' }))

    await waitFor(() => expect(saveBoxSplits.mock.calls.filter(([input]) => input.shipmentItemId === 'item-2')).toHaveLength(2))
    expect(saveBoxSplits.mock.calls.filter(([input]) => input.shipmentItemId === 'item-1')).toHaveLength(1)
  })

  it('switches immediately with a clean blank box number', () => {
    renderShipment()
    expect(itemEditor('SKU-A').getByPlaceholderText('1')).toHaveValue('')
    selectOtherShipment()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(navigate).toHaveBeenCalledWith('/purchasing/china-shipments?shipment=b&step=items')
    expect(saveBoxSplits).not.toHaveBeenCalled()
  })

  it('leaves every newly added box number blank and hints at numeric numbering', () => {
    renderShipment()

    const firstBoxNumber = itemEditor('SKU-A').getByPlaceholderText('1')
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
    const boxNumber = itemEditor('SKU-A').getByPlaceholderText('1')
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
    expect(itemEditor('SKU-A').getByPlaceholderText('1')).toHaveValue('1')
    expect(itemEditor('SKU-A').getByPlaceholderText('0')).toHaveValue(3)
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
    expect(itemEditor('SKU-A').getByPlaceholderText('0')).toHaveValue(4)
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
    expect(itemEditor('SKU-A').getByPlaceholderText('0')).toHaveValue(4)
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

  it('retains an unselected pallet assignment after saving a selected box', async () => {
    savePalletAssignments.mockResolvedValue({ ok: true })
    renderShipment(makeShipmentWithBoxAndPalletStatuses(), 'pallets')
    fireEvent.change(palletAssignmentRow('BOX-01').getByPlaceholderText('예: 1'), { target: { value: 'P3' } })
    fireEvent.change(palletAssignmentRow('BOX-02').getByPlaceholderText('예: 1'), { target: { value: 'P4' } })
    fireEvent.click(screen.getByLabelText('박스 BOX-01 파렛트 배정 선택'))

    fireEvent.click(screen.getByRole('button', { name: '파렛트 배정 선택 저장' }))
    await waitFor(() => expect(savePalletAssignments).toHaveBeenCalledTimes(1))
    expect(savePalletAssignments).toHaveBeenNthCalledWith(1, { shipmentId: 'a', assignments: [{ boxNo: 'BOX-01', palletNo: 'P3' }] })
    expect(palletAssignmentRow('BOX-02').getByPlaceholderText('예: 1')).toHaveValue('P4')

    selectOtherShipment()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '저장 후 이동' }))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/purchasing/china-shipments?shipment=b&step=items'))
    expect(savePalletAssignments).toHaveBeenCalledTimes(2)
    expect(savePalletAssignments).toHaveBeenNthCalledWith(2, { shipmentId: 'a', assignments: [{ boxNo: 'BOX-02', palletNo: 'P4' }] })
  })

  it('keeps a failed selected pallet assignment and selection for retry', async () => {
    savePalletAssignments.mockResolvedValue({ ok: false, error: '파렛트 배정 저장 실패' })
    renderShipment(makeShipmentWithBoxAndPalletStatuses(), 'pallets')
    fireEvent.change(palletAssignmentRow('BOX-01').getByPlaceholderText('예: 1'), { target: { value: 'P3' } })
    fireEvent.click(screen.getByLabelText('박스 BOX-01 파렛트 배정 선택'))

    fireEvent.click(screen.getByRole('button', { name: '파렛트 배정 선택 저장' }))
    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(palletAssignmentRow('BOX-01').getByPlaceholderText('예: 1')).toHaveValue('P3')
    expect(screen.getByLabelText('박스 BOX-01 파렛트 배정 선택')).toBeChecked()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('saves all changed pallet assignments together', async () => {
    savePalletAssignments.mockResolvedValue({ ok: true })
    renderShipment(makeShipmentWithBoxAndPalletStatuses(), 'pallets')
    fireEvent.change(palletAssignmentRow('BOX-01').getByPlaceholderText('예: 1'), { target: { value: 'P3' } })
    fireEvent.change(palletAssignmentRow('BOX-02').getByPlaceholderText('예: 1'), { target: { value: 'P4' } })

    fireEvent.click(screen.getByRole('button', { name: '파렛트 배정 전체 저장' }))

    await waitFor(() => expect(savePalletAssignments).toHaveBeenCalledWith({
      shipmentId: 'a',
      assignments: [{ boxNo: 'BOX-01', palletNo: 'P3' }, { boxNo: 'BOX-02', palletNo: 'P4' }],
    }))
  })

  it('selects all displayed pallet assignments together', async () => {
    savePalletAssignments.mockResolvedValue({ ok: true })
    renderShipment(makeShipmentWithBoxAndPalletStatuses(), 'pallets')
    fireEvent.change(palletAssignmentRow('BOX-01').getByPlaceholderText('예: 1'), { target: { value: 'P3' } })
    fireEvent.change(palletAssignmentRow('BOX-02').getByPlaceholderText('예: 1'), { target: { value: 'P4' } })

    fireEvent.click(screen.getByLabelText('표시된 파렛트 배정 전체 선택'))
    fireEvent.click(screen.getByRole('button', { name: '파렛트 배정 선택 저장' }))

    await waitFor(() => expect(savePalletAssignments).toHaveBeenCalledWith({
      shipmentId: 'a',
      assignments: [{ boxNo: 'BOX-01', palletNo: 'P3' }, { boxNo: 'BOX-02', palletNo: 'P4' }],
    }))
  })

  it('switches work stages immediately without navigating to the server', () => {
    renderShipment(makeShipmentWithBox(), 'items')
    for (const [step, title] of [['boxes', '2단계.*박스분할'], ['pallets', '3단계.*파렛트적재'], ['summary', '4단계.*최종 적재리스트'], ['items', '1단계.*출고품목']]) {
      const button = screen.getByRole('button', { name: new RegExp(title) })
      fireEvent.click(button)
      expect(button).toHaveAttribute('aria-current', 'step')
      expect(new URLSearchParams(window.location.search).get('step')).toBe(step)
    }
    expect(navigate).not.toHaveBeenCalled()
    act(() => {
      window.history.replaceState(null, '', '/purchasing/china-shipments?shipment=a&step=boxes')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(screen.getByRole('button', { name: /2단계.*박스분할/ })).toHaveAttribute('aria-current', 'step')
  })

  it('guards changing the work stage while a box draft is unsaved', () => {
    renderShipment()
    editBox()
    parkEditor()
    fireEvent.click(screen.getByRole('button', { name: /3단계.*파렛트적재/ }))

    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '계속 작업' }))
    expect(itemEditor('SKU-A').getByPlaceholderText('0')).toHaveValue(3)
    expect(screen.getByRole('button', { name: /2단계.*박스분할/ })).toHaveAttribute('aria-current', 'step')
  })

  it('does not lose an invalid quantity merely because it cannot be saved yet', () => {
    renderShipment()
    editBox('2.5')
    selectOtherShipment()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '계속 작업' }))
    expect(itemEditor('SKU-A').getByPlaceholderText('0')).toHaveValue(2.5)
    expect(navigate).not.toHaveBeenCalled()
  })

  it('guards changing the box page and retains the current page and draft on cancel', () => {
    renderShipment(makeShipmentWithManyItems())
    fireEvent.change(itemEditor('SKU-01').getByPlaceholderText('0'), { target: { value: '5' } })
    parkEditor()
    fireEvent.click(screen.getAllByRole('button', { name: '다음 페이지' })[0])

    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '계속 작업' }))
    expect(screen.getAllByText('1 / 2')).toHaveLength(2)
    expect(itemEditor('SKU-01').getByPlaceholderText('0')).toHaveValue(5)
    expect(screen.queryByText('SKU-11')).not.toBeInTheDocument()
  })

  it('changes box page after explicit discard', () => {
    renderShipment(makeShipmentWithManyItems())
    fireEvent.change(itemEditor('SKU-01').getByPlaceholderText('0'), { target: { value: '5' } })
    parkEditor()
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
      items: detail.items.map((item) => item.id === 'item-1' ? { ...item, packedQuantity: 10, boxSplitStatus: 'completed' } : item),
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
    expect(saveBoxSplits).toHaveBeenCalledWith(expect.objectContaining({ shipmentItemId: 'item-2', allocations: [expect.objectContaining({ quantity: 4 })] }))
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
    parkEditor()
    const download = screen.getByRole('link', { name: '작업용 엑셀' })
    download.addEventListener('click', (event) => event.preventDefault(), { once: true })
    fireEvent.click(download)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(itemEditor('SKU-A').getByPlaceholderText('0')).toHaveValue(3)
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
