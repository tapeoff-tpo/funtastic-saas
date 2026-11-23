import { useSyncExternalStore } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PurchasingLanguageSwitcher } from '@/components/purchasing-language-switcher'
import { toast } from 'sonner'
import type { ChinaOutboundBoxSplitSavedState } from '@/lib/purchasing/china-outbound-save-state'
import { ChinaShipmentsBoard, type ChinaShipmentDetailView, type ChinaShipmentListItem } from './china-shipments-board'

const applyInventoryPacking = vi.hoisted(() => vi.fn())

const { mergeBoxes, saveWeight, saveBoxDimensions, saveBoxMeasurements, savePalletTare, saveChineseName, addSample, savePalletDimensions, createShipment, deleteShipmentAction, updateShipment, saveBoxSplits, savePalletAssignments, saveBoxStatuses, savePalletStatuses, addShipmentItems, toastError, navigate, refresh } = vi.hoisted(() => ({
  mergeBoxes: vi.fn(),
  saveWeight: vi.fn(),
  saveBoxDimensions: vi.fn(),
  saveBoxMeasurements: vi.fn(),
  savePalletTare: vi.fn(),
  saveChineseName: vi.fn(),
  addSample: vi.fn(),
  savePalletDimensions: vi.fn(),
  createShipment: vi.fn(),
  deleteShipmentAction: vi.fn(),
  updateShipment: vi.fn(),
  saveBoxSplits: vi.fn(),
  savePalletAssignments: vi.fn(),
  saveBoxStatuses: vi.fn(),
  savePalletStatuses: vi.fn(),
  addShipmentItems: vi.fn(),
  toastError: vi.fn(),
  navigate: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/purchasing/china-shipments',
  useRouter: () => ({ refresh, replace: navigate }),
  useSearchParams: () => new URLSearchParams(useSyncExternalStore(
    (notify) => { window.addEventListener('popstate', notify); return () => window.removeEventListener('popstate', notify) },
    () => window.location.search,
  )),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: toastError } }))
vi.mock('./china-work-navigation', () => ({ useChinaWorkNavigation: () => navigate }))
vi.mock('../saas-china-actions', () => ({
  applyChinaOutboundInventoryPackingAction: applyInventoryPacking,
  mergeChinaOutboundBoxesAction: mergeBoxes,
  saveChinaOutboundPackageWeightAction: saveWeight,
  saveChinaOutboundBoxDimensionsAction: saveBoxDimensions,
  saveChinaOutboundBoxesMeasurementsAction: saveBoxMeasurements,
  saveChinaOutboundItemChineseNameAction: saveChineseName,
  addChinaOutboundSampleAction: addSample,
  saveChinaOutboundPalletDimensionsAction: savePalletDimensions,
  saveChinaOutboundPalletTareWeightAction: savePalletTare,
  addChinaOutboundShipmentItemsAction: addShipmentItems,
  assignChinaOutboundBoxesToPalletsAction: savePalletAssignments,
  cancelChinaOutboundShipmentAction: vi.fn(),
  createChinaOutboundShipmentAction: createShipment,
  deleteChinaOutboundShipmentAction: deleteShipmentAction,
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
const pushHistoryState = window.history.pushState.bind(window.history)

const shipmentA = makeShipment('a', '출고 A', 'SKU-A')
const shipmentB = makeShipment('b', '출고 B', 'SKU-B')
const shipments = [asListItem(shipmentA), asListItem(shipmentB)]
const inventoryItem = { id: 'inventory-new', warehouseCode: '중국창고', sku: 'NEW-1', productName: '새 상품', optionName: null, onHandQuantity: 20, reservedQuantity: 5, availableQuantity: 15 }

function renderShipment(detail = shipmentA, stage: 'items' | 'boxes' | 'pallets' | 'summary' = 'items') {
  return render(<ChinaShipmentsBoard inventoryItems={[inventoryItem]} shipments={shipments} selectedShipment={detail} selectedStep={stage} showCreate={false} />)
}

function renderShipmentWithLanguage(detail = shipmentA, stage: 'items' | 'boxes' | 'pallets' | 'summary' = 'items') {
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

  const attributes = [...root.querySelectorAll<HTMLElement>('*')].filter((element) => !element.closest('[data-no-translate]')).flatMap((element) =>
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
  fireEvent.click(screen.queryByRole('button', { name: '출고 B' }) ?? screen.getByRole('button', { name: '목록으로' }))
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
    boxes: [{ id: 'box-1', shipmentId: 'a', editable: true, palletId: 'pallet-1', boxNo: 'A-01', status: 'open', note: null, lengthCm: null, widthCm: null, heightCm: null }],
    boxItems: [{ id: 'allocation-1', boxId: 'box-1', shipmentItemId: 'shared-item-id', quantity: 3 }],
  }
}

function makeFullyPackedInProgressShipment(): ChinaShipmentDetailView {
  return {
    ...shipmentA,
    items: [{ ...shipmentA.items[0], packedQuantity: 10, boxSplitStatus: 'in_progress' }],
    pallets: [{ id: 'pallet-1', palletNo: 'P1', note: null }],
    boxes: [{ id: 'box-1', shipmentId: 'a', editable: true, palletId: 'pallet-1', boxNo: '1', status: 'open', note: null, lengthCm: null, widthCm: null, heightCm: null }],
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
      { id: 'box-saved', shipmentId: 'a', editable: true, palletId: 'pallet-1', boxNo: 'BOX-01', status: 'open', note: null, lengthCm: null, widthCm: null, heightCm: null },
      { id: 'box-shared', shipmentId: 'a', editable: true, palletId: null, boxNo: 'BOX-02', status: 'open', note: null, lengthCm: null, widthCm: null, heightCm: null },
      { id: 'box-empty', shipmentId: 'a', editable: true, palletId: null, boxNo: 'BOX-03', status: 'open', note: null, lengthCm: null, widthCm: null, heightCm: null },
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

function makeShipmentWithUnassignedBoxes(): ChinaShipmentDetailView {
  const detail = makeShipmentWithCompletionFilters()
  return { ...detail, boxes: detail.boxes.map((box) => ({ ...box, palletId: null })) }
}

function makeShipmentWithSharedBoxDimensions(lengthCm = 10, widthCm = 20, heightCm = 30): ChinaShipmentDetailView {
  return {
    ...shipmentA,
    items: [
      { ...shipmentA.items[0], id: 'shared-item-one', sku: 'SHARED-01', productName: '공유 박스 상품 1', reservedQuantity: 10, packedQuantity: 3 },
      { ...shipmentA.items[0], id: 'shared-item-two', sku: 'SHARED-02', productName: '공유 박스 상품 2', reservedQuantity: 10, packedQuantity: 3 },
    ],
    boxes: [{ id: 'shared-box', shipmentId: 'a', editable: true, palletId: null, boxNo: 'COMMON-1', status: 'open', note: null, lengthCm, widthCm, heightCm }],
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
    boxes: [{ id: 'completed-box', shipmentId: 'a', editable: true, palletId: null, boxNo: '11', status: 'open', note: null, lengthCm: null, widthCm: null, heightCm: null }],
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
    vi.spyOn(window.history, 'pushState').mockImplementation((...args) => {
      pushHistoryState(...args)
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    HTMLDialogElement.prototype.showModal = function () { this.open = true }
    HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new Event('close')) }
    window.localStorage.clear()
    createShipment.mockReset()
    deleteShipmentAction.mockReset()
    updateShipment.mockReset()
    saveBoxSplits.mockReset()
    savePalletAssignments.mockReset()
    saveBoxStatuses.mockReset()
    savePalletStatuses.mockReset()
    addShipmentItems.mockReset()
    mergeBoxes.mockReset(); saveWeight.mockReset(); saveChineseName.mockReset()
    saveBoxDimensions.mockReset()
    saveBoxMeasurements.mockReset()
    addSample.mockReset()
    savePalletDimensions.mockReset()
    savePalletTare.mockReset()
    toastError.mockReset()
    navigate.mockReset()
    refresh.mockReset()
    applyInventoryPacking.mockReset()
  })

  it('applies inventory packing to existing work without reserving items again', async () => {
    applyInventoryPacking.mockResolvedValueOnce({ ok: true, inventoryPacking: { createdBoxCount: 4, packedQuantity: 10, appliedItemCount: 1, skippedItemCount: 0, preservedBoxCount: 0, missingPackagingCount: 0 } })
    renderShipment()
    fireEvent.click(screen.getByRole('button', { name: '중국재고 포장정보 적용', exact: true }))
    await waitFor(() => expect(applyInventoryPacking).toHaveBeenCalledExactlyOnceWith({ shipmentId: 'a' }))
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    expect(addShipmentItems).not.toHaveBeenCalled()
    expect(saveBoxSplits).not.toHaveBeenCalled()
  })

  it('keeps existing work visible and does not refresh after failed inventory packing', async () => {
    applyInventoryPacking.mockResolvedValueOnce({ ok: false, error: '기존 박스 수량을 확인해주세요.' })
    renderShipment()
    fireEvent.click(screen.getByRole('button', { name: '중국재고 포장정보 적용', exact: true }))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('기존 박스 수량을 확인해주세요.'))
    expect(refresh).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'SKU-A 박스분할 수정' })).toBeInTheDocument()
  })

  it('reports an added option in an existing mixed carton as applied even when no new carton is created', async () => {
    applyInventoryPacking.mockResolvedValueOnce({ ok: true, inventoryPacking: { createdBoxCount: 0, packedQuantity: 10, appliedItemCount: 1, skippedItemCount: 0, preservedBoxCount: 1, missingPackagingCount: 0 } })
    renderShipment()
    fireEvent.click(screen.getByRole('button', { name: '중국재고 포장정보 적용', exact: true }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('기존 혼합박스에 포장정보를 적용했습니다.'))
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(toastError).not.toHaveBeenCalled()
  })

  it('does not offer inventory packing for already packed work', () => {
    renderShipment(makeFullyPackedInProgressShipment())
    expect(screen.queryByRole('button', { name: '중국재고 포장정보 적용', exact: true })).not.toBeInTheDocument()
  })

  it('keeps box splitting in the first stage without a duplicate filter or product batch-save screen', () => {
    renderShipment(makeShipmentWithManyItems())
    expect(screen.getByRole('heading', { name: '1단계 · 출고품목·박스분할' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'SKU-11 박스분할 수정' })).toBeVisible()
    expect(screen.queryByRole('group', { name: '박스분할 품목 상태 필터' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '전체 저장' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '다음 페이지' })).not.toBeInTheDocument()
  })

  it('applies persisted box-save results immediately without reloading the page', async () => {
    const detail = { ...shipmentA, items: [shipmentA.items[0], { ...shipmentA.items[0], id: 'other-item', sku: 'SKU-B' }] }
    saveBoxSplits.mockResolvedValue({ ok: true, savedState: {
      shipmentId: 'a', shipmentItemId: 'shared-item-id', shipmentStatus: 'packing', packedQuantity: 10, boxSplitStatus: 'completed', reopenedPalletIds: [],
      boxes: [{ id: 'saved-box', shipmentId: 'a', editable: true, palletId: null, boxNo: '1', status: 'open', completionStatus: 'in_progress', note: null, lengthCm: 50, widthCm: 40, heightCm: 30, grossWeightKg: 6.75 }],
      boxItems: [{ id: 'saved-allocation', boxId: 'saved-box', shipmentItemId: 'shared-item-id', quantity: 10 }],
    } })
    renderShipment(detail)
    const editor = itemEditor('SKU-A')
    fireEvent.change(editor.getByPlaceholderText('0'), { target: { value: '10' } })
    fireEvent.click(editor.getByRole('button', { name: '박스분할 저장' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(saveBoxSplits).toHaveBeenCalledWith(expect.objectContaining({ returnSavedState: true }))
    expect(refresh).not.toHaveBeenCalled()
    const savedRow = screen.getByText('SKU-A').closest('tr')!
    expect(within(savedRow).getByText('완료', { exact: true })).toBeInTheDocument()
    expect(within(savedRow).getByText('작업 가능 0개')).toBeInTheDocument()
    const reopened = itemEditor('SKU-A')
    expect(reopened.getByLabelText('박스 1 총중량(kg)')).toHaveValue(6.75)
    parkEditor()
    expect(itemEditor('SKU-B').getByPlaceholderText('1')).toHaveValue('2')
  })

  it('refreshes cache after unlocking the save and rejects a late response from before the next save', async () => {
    vi.useFakeTimers()
    const persisted = (quantity: number): ChinaOutboundBoxSplitSavedState => ({
      shipmentId: 'a', shipmentItemId: 'shared-item-id', shipmentStatus: 'packing', packedQuantity: quantity, boxSplitStatus: 'in_progress', reopenedPalletIds: [],
      boxes: [{ id: 'saved-box', shipmentId: 'a', editable: true, palletId: null, boxNo: '1', status: 'open', completionStatus: 'in_progress', note: null, lengthCm: null, widthCm: null, heightCm: null, grossWeightKg: null }],
      boxItems: [{ id: 'saved-allocation', boxId: 'saved-box', shipmentItemId: 'shared-item-id', quantity }],
    })
    saveBoxSplits.mockResolvedValueOnce({ ok: true, savedState: persisted(5) }).mockResolvedValueOnce({ ok: true, savedState: persisted(8) })
    const view = renderShipment()
    try {
      editBox('5')
      await act(async () => { fireEvent.click(itemEditor('SKU-A').getByRole('button', { name: '박스분할 저장' })) })
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(screen.getByText('작업 가능 5개')).toBeInTheDocument()
      expect(refresh).not.toHaveBeenCalled()
      await act(async () => { vi.advanceTimersByTime(1_000) })
      expect(refresh).toHaveBeenCalledOnce()

      editBox('8')
      await act(async () => { fireEvent.click(itemEditor('SKU-A').getByRole('button', { name: '박스분할 저장' })) })
      expect(screen.getByText('작업 가능 2개')).toBeInTheDocument()
      const serverView = (quantity: number): ChinaShipmentDetailView => ({ ...shipmentA,
        items: [{ ...shipmentA.items[0], packedQuantity: quantity }], boxes: persisted(quantity).boxes, boxItems: persisted(quantity).boxItems,
      })
      view.rerender(<ChinaShipmentsBoard inventoryItems={[inventoryItem]} shipments={shipments} selectedShipment={serverView(5)} selectedStep="items" showCreate={false} />)
      expect(screen.getByText('작업 가능 2개')).toBeInTheDocument()
      await act(async () => { vi.advanceTimersByTime(1_000) })
      expect(refresh).toHaveBeenCalledTimes(2)
      view.rerender(<ChinaShipmentsBoard inventoryItems={[inventoryItem]} shipments={shipments} selectedShipment={serverView(8)} selectedStep="items" showCreate={false} />)
      await act(async () => { vi.advanceTimersByTime(2_000) })
      expect(screen.getByText('작업 가능 2개')).toBeInTheDocument()
      expect(refresh).toHaveBeenCalledTimes(2)
    } finally {
      view.unmount()
      vi.useRealTimers()
    }
  })

  it('shows unfinished outbound items before completed quantities and derives work status from counts', () => {
    const detail: ChinaShipmentDetailView = {
      ...shipmentA,
      items: [
        { ...shipmentA.items[0]!, id: 'done', sku: 'A-DONE', reservedQuantity: 10, packedQuantity: 10, boxSplitStatus: 'in_progress' },
        { ...shipmentA.items[0]!, id: 'short', sku: 'Z-SHORT', reservedQuantity: 10, packedQuantity: 5, boxSplitStatus: 'completed' },
        { ...shipmentA.items[0]!, id: 'over', sku: 'B-OVER', reservedQuantity: 10, packedQuantity: 12, boxSplitStatus: 'completed' },
      ],
    }
    const original = structuredClone(detail.items)
    renderShipment(detail, 'items')
    const table = within(screen.getByRole('columnheader', { name: '작업 상태' }).closest('table')!)
    const rows = table.getAllByRole('row').slice(1)
    expect(rows.map((row) => within(row).getAllByRole('cell')[0]!.textContent)).toEqual(['B-OVER', 'Z-SHORT', 'A-DONE'])
    expect(within(rows[0]!).getByText('미완료', { exact: true })).toBeInTheDocument()
    expect(within(rows[1]!).getByText('미완료', { exact: true })).toBeInTheDocument()
    expect(within(rows[2]!).getByText('완료', { exact: true })).toBeInTheDocument()
    expect(detail.items).toEqual(original)
    expect(saveBoxSplits).not.toHaveBeenCalled()
    expect(updateShipment).not.toHaveBeenCalled()
  })

  it('moves an item to the completed group after a saved quantity refresh and brings it back when quantities differ again', () => {
    const detail: ChinaShipmentDetailView = {
      ...shipmentA,
      items: [
        { ...shipmentA.items[0]!, id: 'done', sku: 'A-DONE', reservedQuantity: 10, packedQuantity: 10 },
        { ...shipmentA.items[0]!, id: 'empty', sku: 'M-EMPTY', reservedQuantity: 10, packedQuantity: 0 },
        { ...shipmentA.items[0]!, id: 'working', sku: 'Z-WORKING', reservedQuantity: 10, packedQuantity: 5 },
      ],
    }
    const { rerender } = renderShipment(detail, 'items')
    const rows = () => within(screen.getByRole('columnheader', { name: '작업 상태' }).closest('table')!).getAllByRole('row').slice(1)
    const codes = () => rows().map((row) => within(row).getAllByRole('cell')[0]!.textContent)
    expect(codes()).toEqual(['M-EMPTY', 'Z-WORKING', 'A-DONE'])

    const showQuantity = (quantity: number) => rerender(<ChinaShipmentsBoard inventoryItems={[inventoryItem]} shipments={shipments} selectedShipment={{ ...detail, items: detail.items.map((item) => item.id === 'working' ? { ...item, packedQuantity: quantity } : item) }} selectedStep="items" showCreate={false} />)
    showQuantity(10)
    expect(codes()).toEqual(['M-EMPTY', 'A-DONE', 'Z-WORKING'])
    expect(within(rows()[2]!).getByText('완료', { exact: true })).toBeInTheDocument()
    showQuantity(9)
    expect(codes()).toEqual(['M-EMPTY', 'Z-WORKING', 'A-DONE'])
    expect(within(rows()[1]!).getByText('미완료', { exact: true })).toBeInTheDocument()
    expect(saveBoxSplits).not.toHaveBeenCalled()
  })

  it('shows remaining split work even when the shipment has reserved all available inventory', () => {
    const detail = makeShipmentWithCompletionFilters()
    renderShipment({ ...detail, items: detail.items.map((item) => ({ ...item, onHandQuantity: 5, availableQuantity: 0 })) }, 'items')
    for (const [sku, remaining] of [['DONE-01', 0], ['WORK-01', 3], ['WAIT-01', 5]]) {
      const row = screen.getByRole('cell', { name: String(sku) }).closest('tr')!
      expect(within(row).getByText(`작업 가능 ${remaining}개`)).toBeInTheDocument()
    }
  })

  it.each([
    { entered: '7.125', expected: 7.125 },
    { entered: '', expected: null },
  ])('loads measured box weight and saves an explicit change to $entered with the split', async ({ entered, expected }) => {
    saveBoxSplits.mockResolvedValue({ ok: true })
    const detail = makeFullyPackedInProgressShipment()
    detail.boxes[0].grossWeightKg = 6.75
    renderShipment(detail, 'items')
    const editor = itemEditor('SKU-A')
    expect(editor.getByRole('columnheader', { name: '총중량(kg)' })).toBeInTheDocument()
    const weight = editor.getByLabelText('박스 1 총중량(kg)')
    expect(weight).toHaveValue(6.75)
    fireEvent.change(weight, { target: { value: entered } })
    fireEvent.click(editor.getByRole('button', { name: '박스분할 저장' }))
    await waitFor(() => expect(saveBoxSplits).toHaveBeenCalledOnce())
    expect(saveBoxSplits.mock.calls[0][0].allocations).toEqual([
      { boxNo: '1', quantity: 10, lengthCm: null, widthCm: null, heightCm: null, grossWeightKg: expected },
    ])
    expect(saveWeight).not.toHaveBeenCalled()
  })

  it.each([undefined, 4.5])('estimates missing dimensions from manual CBM with optional weight %s', async (weight) => {
    saveBoxSplits.mockResolvedValue({ ok: true })
    const detail = makeFullyPackedInProgressShipment()
    renderShipment(detail, 'items')
    const editor = itemEditor('SKU-A')
    const cbm = editor.getByLabelText('박스 1 CBM(직접 입력)')
    fireEvent.change(cbm, { target: { value: '0.125' } })
    fireEvent.blur(cbm)
    for (const input of editor.getAllByPlaceholderText('선택')) expect(input).toHaveValue(50)
    if (weight != null) fireEvent.change(editor.getByLabelText('박스 1 총중량(kg)'), { target: { value: String(weight) } })
    parkEditor()
    const reopened = itemEditor('SKU-A')
    expect(reopened.getByLabelText('박스 1 CBM(직접 입력)')).toHaveValue(0.125)
    fireEvent.click(reopened.getByRole('button', { name: '박스분할 저장' }))
    await waitFor(() => expect(saveBoxSplits).toHaveBeenCalledOnce())
    expect(saveBoxSplits.mock.calls[0][0].allocations[0]).toMatchObject({ manualCbm: 0.125, lengthCm: 50, widthCm: 50, heightCm: 50 })
    expect(saveBoxSplits.mock.calls[0][0].allocations[0].grossWeightKg).toBe(weight)
  })

  it('clears a manual box CBM and returns to its measured dimension calculation', async () => {
    saveBoxSplits.mockResolvedValue({ ok: true })
    const detail = makeFullyPackedInProgressShipment()
    detail.boxes[0] = { ...detail.boxes[0], manualCbm: 0.125, lengthCm: 50, widthCm: 40, heightCm: 30 }
    detail.boxItems[0] = { ...detail.boxItems[0], manualCbm: 0.125 }
    renderShipment(detail, 'items')
    const editor = itemEditor('SKU-A')
    const cbm = editor.getByLabelText('박스 1 CBM(직접 입력)')
    expect(cbm).toHaveValue(0.125)
    fireEvent.change(cbm, { target: { value: '' } })
    expect(cbm).toHaveAttribute('placeholder', '0.0600')
    fireEvent.click(editor.getByRole('button', { name: '박스분할 저장' }))
    await waitFor(() => expect(saveBoxSplits).toHaveBeenCalledOnce())
    expect(saveBoxSplits.mock.calls[0][0].allocations[0].manualCbm).toBeNull()
  })

  it('preserves a weight-only draft when closing and reopening the box editor', async () => {
    saveBoxSplits.mockResolvedValue({ ok: true })
    const detail = makeFullyPackedInProgressShipment()
    detail.boxes[0].grossWeightKg = 6.75
    renderShipment(detail)
    fireEvent.change(itemEditor('SKU-A').getByLabelText('박스 1 총중량(kg)'), { target: { value: '7.5' } })
    parkEditor()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    const editor = itemEditor('SKU-A')
    expect(editor.getByLabelText('박스 1 총중량(kg)')).toHaveValue(7.5)
    fireEvent.click(editor.getByRole('button', { name: '박스분할 저장' }))
    await waitFor(() => expect(saveBoxSplits).toHaveBeenCalledOnce())
    expect(saveBoxSplits.mock.calls[0][0].allocations[0].grossWeightKg).toBe(7.5)
  })

  it('retains the existing weight but leaves newly split boxes unweighed', async () => {
    saveBoxSplits.mockResolvedValue({ ok: true })
    const detail = makeFullyPackedInProgressShipment()
    detail.boxes[0].grossWeightKg = 6.75
    renderShipment(detail, 'items')
    const editor = itemEditor('SKU-A')
    fireEvent.change(editor.getByLabelText('SKU-A 총 박스 수'), { target: { value: '2' } })
    fireEvent.click(editor.getByRole('button', { name: '자동 분할 미리보기' }))
    expect(editor.getByLabelText('박스 1 총중량(kg)')).toHaveValue(6.75)
    expect(editor.getByLabelText('박스 2 총중량(kg)')).toHaveValue(null)
    fireEvent.change(editor.getByLabelText('박스 2 총중량(kg)'), { target: { value: '3.5' } })
    fireEvent.click(editor.getByRole('button', { name: '박스 추가' }))
    expect(editor.getByLabelText('박스 3 총중량(kg)')).toHaveValue(null)
    fireEvent.click(editor.getAllByRole('button', { name: '삭제' })[2])
    fireEvent.click(editor.getByRole('button', { name: '박스분할 저장' }))
    await waitFor(() => expect(saveBoxSplits).toHaveBeenCalledOnce())
    expect(saveBoxSplits.mock.calls[0][0].allocations[0].grossWeightKg).toBeUndefined()
    expect(saveBoxSplits.mock.calls[0][0].allocations[1].grossWeightKg).toBe(3.5)
  })

  it('preloads its own shared-box component weight and omits it during a quantity-only save', async () => {
    saveBoxSplits.mockResolvedValue({ ok: true })
    const detail = makeShipmentWithSharedBoxDimensions()
    detail.boxes[0].grossWeightKg = 8.5
    detail.boxItems[0] = { ...detail.boxItems[0], grossWeightKg: 3.25 }
    renderShipment(detail, 'items')
    const editor = itemEditor('SHARED-01')
    expect(editor.getByLabelText('박스 COMMON-1 총중량(kg)')).toHaveValue(3.25)
    fireEvent.change(editor.getByPlaceholderText('0'), { target: { value: '4' } })
    fireEvent.click(editor.getByRole('button', { name: '박스분할 저장' }))
    await waitFor(() => expect(saveBoxSplits).toHaveBeenCalledOnce())
    expect(saveBoxSplits.mock.calls[0][0].allocations[0].grossWeightKg).toBeUndefined()
  })

  it.each([
    { boxNo: 'NEW' },
    { boxNo: 'TARGET' },
  ])('preserves its own component weight and dimensions when moving a shared allocation to $boxNo', async ({ boxNo }) => {
    saveBoxSplits.mockResolvedValue({ ok: true })
    const detail = makeShipmentWithSharedBoxDimensions()
    detail.boxes[0].grossWeightKg = 8.5
    detail.boxItems[0] = { ...detail.boxItems[0], grossWeightKg: 3.25, lengthCm: 8, widthCm: 9, heightCm: 10 }
    detail.boxes.push({ ...detail.boxes[0], id: 'target-box', boxNo: 'TARGET', grossWeightKg: 12.5 })
    renderShipment(detail, 'items')
    const editor = itemEditor('SHARED-01')
    expect(editor.getByLabelText('박스 COMMON-1 총중량(kg)')).toHaveValue(3.25)
    expect(editor.getAllByRole('spinbutton').map((input) => (input as HTMLInputElement).value).slice(-6)).toEqual(['3', '8', '9', '10', '3.25', ''])
    fireEvent.change(editor.getByRole('textbox'), { target: { value: boxNo } })
    expect(editor.getByLabelText(`박스 ${boxNo} 총중량(kg)`)).toHaveValue(3.25)
    fireEvent.click(editor.getByRole('button', { name: '박스분할 저장' }))
    await waitFor(() => expect(saveBoxSplits).toHaveBeenCalledOnce())
    expect(saveBoxSplits.mock.calls[0][0].allocations[0]).toMatchObject({ boxNo, grossWeightKg: 3.25, lengthCm: 8, widthCm: 9, heightCm: 10 })
    expect(saveBoxSplits.mock.calls[0][0].allocations[0].existingBoxId).toBeUndefined()
  })

  it('keeps an entered weight when renaming the same exclusive physical box', async () => {
    saveBoxSplits.mockResolvedValue({ ok: true })
    const detail = makeFullyPackedInProgressShipment()
    detail.boxes[0].grossWeightKg = 6.75
    renderShipment(detail, 'items')
    const editor = itemEditor('SKU-A')
    fireEvent.change(editor.getByLabelText('박스 1 총중량(kg)'), { target: { value: '7.5' } })
    fireEvent.change(editor.getByRole('textbox'), { target: { value: '7' } })
    expect(editor.getByLabelText('박스 7 총중량(kg)')).toHaveValue(7.5)
    fireEvent.click(editor.getByRole('button', { name: '박스분할 저장' }))
    await waitFor(() => expect(saveBoxSplits).toHaveBeenCalledOnce())
    expect(saveBoxSplits.mock.calls[0][0].allocations[0]).toMatchObject({ boxNo: '7', existingBoxId: 'box-1', grossWeightKg: 7.5 })
  })

  it('saves an edited component weight separately from the destination physical-box total', async () => {
    saveBoxSplits.mockResolvedValue({ ok: true })
    const detail = makeShipmentWithSharedBoxDimensions()
    detail.boxes[0].grossWeightKg = 8.5
    detail.boxes.push({ ...detail.boxes[0], id: 'target-box', boxNo: 'TARGET', grossWeightKg: 12.5 })
    renderShipment(detail, 'items')
    const editor = itemEditor('SHARED-01')
    fireEvent.change(editor.getByRole('textbox'), { target: { value: 'TARGET' } })
    fireEvent.change(editor.getByLabelText('박스 TARGET 총중량(kg)'), { target: { value: '8.5' } })
    fireEvent.click(editor.getByRole('button', { name: '박스분할 저장' }))
    await waitFor(() => expect(saveBoxSplits).toHaveBeenCalledOnce())
    expect(saveBoxSplits.mock.calls[0][0].allocations[0]).toMatchObject({ boxNo: 'TARGET', grossWeightKg: 8.5 })
  })

  it('preloads saved boxes and retains their numbers and measurements when increasing the box count', async () => {
    saveBoxSplits.mockResolvedValue({ ok: true })
    const detail = makeFullyPackedInProgressShipment()
    detail.boxes[0] = { ...detail.boxes[0], lengthCm: 50, widthCm: 40, heightCm: 30 }
    renderShipment(detail, 'items')
    fireEvent.click(screen.getByRole('button', { name: 'SKU-A 박스분할 수정' }))
    const dialog = within(screen.getByRole('dialog'))
    expect(dialog.getByLabelText('SKU-A 총 박스 수')).toHaveValue(1)
    expect(dialog.getByLabelText('SKU-A 박스당 수량')).toHaveValue(10)
    const savedRow = dialog.getAllByRole('row')[1]
    expect(within(savedRow).getByRole('textbox')).toHaveValue('1')
    expect(within(savedRow).getAllByRole('spinbutton').map((input) => (input as HTMLInputElement).value)).toEqual(['10', '50', '40', '30', '', ''])

    fireEvent.change(dialog.getByLabelText('SKU-A 총 박스 수'), { target: { value: '2' } })
    fireEvent.click(dialog.getByRole('button', { name: '자동 분할 미리보기' }))
    expect(dialog.getAllByRole('textbox').map((input) => (input as HTMLInputElement).value)).toEqual(['1', '2'])
    for (const row of dialog.getAllByRole('row').slice(1)) {
      expect(within(row).getAllByRole('spinbutton').map((input) => (input as HTMLInputElement).value)).toEqual(['5', '50', '40', '30', '', ''])
    }
    // Repeated previews must keep the same boxes too.
    fireEvent.click(dialog.getByRole('button', { name: '자동 분할 미리보기' }))
    fireEvent.click(dialog.getByRole('button', { name: '박스분할 저장' }))
    await waitFor(() => expect(saveBoxSplits).toHaveBeenCalledOnce())
    expect(saveBoxSplits.mock.calls[0][0].allocations).toEqual([
      { boxNo: '1', quantity: 5, lengthCm: null, widthCm: null, heightCm: null },
      { boxNo: '2', quantity: 5, autoNumber: true, lengthCm: 50, widthCm: 40, heightCm: 30, grossWeightKg: null },
    ])
  })

  it('keeps a shared custom box while replanning and leaves its other product intact', async () => {
    saveBoxSplits.mockResolvedValue({ ok: true })
    const detail = makeShipmentWithSharedBoxDimensions()
    detail.boxItems[0] = { ...detail.boxItems[0], lengthCm: 10, widthCm: 20, heightCm: 30 }
    renderShipment(detail, 'items')
    const dialog = itemEditor('SHARED-01')
    expect(dialog.getByLabelText('SHARED-01 총 박스 수')).toHaveValue(1)
    expect(dialog.getByLabelText('SHARED-01 박스당 수량')).toHaveValue(null)
    fireEvent.change(dialog.getByLabelText('SHARED-01 총 박스 수'), { target: { value: '2' } })
    fireEvent.click(dialog.getByRole('button', { name: '자동 분할 미리보기' }))
    fireEvent.click(dialog.getByRole('button', { name: '박스분할 저장' }))
    await waitFor(() => expect(saveBoxSplits).toHaveBeenCalledOnce())
    expect(saveBoxSplits.mock.calls[0][0]).toMatchObject({
      shipmentItemId: 'shared-item-one',
      allocations: [
        { boxNo: 'COMMON-1', quantity: 5, lengthCm: null, widthCm: null, heightCm: null },
        { boxNo: '1', quantity: 5, autoNumber: true, lengthCm: 10, widthCm: 20, heightCm: 30 },
      ],
    })
    expect(saveBoxSplits.mock.calls[0][0].allocations[0].existingBoxId).toBeUndefined()
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

  it('opens stage-two edits in a popup and clears a saved draft without a duplicate client refresh', async () => {
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
    expect(refresh).not.toHaveBeenCalled()
    selectOtherShipment()
    expect(navigate).toHaveBeenCalledWith('/purchasing/china-shipments')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('applies the first box dimensions to every automatic split and saves them together', async () => {
    saveBoxSplits.mockResolvedValue({ ok: true })
    const detail = { ...shipmentA, items: [{ ...shipmentA.items[0], reservedQuantity: 300 }] }
    renderShipment(detail, 'items')
    fireEvent.click(screen.getByRole('button', { name: 'SKU-A 박스분할 수정' }))
    const dialog = within(screen.getByRole('dialog'))
    fireEvent.change(dialog.getByLabelText('SKU-A 박스당 수량'), { target: { value: '30' } })
    fireEvent.click(dialog.getByRole('button', { name: '자동 분할 미리보기' }))
    const apply = dialog.getByRole('button', { name: '첫 박스 규격·무게 전체 적용' })
    expect(apply).toBeDisabled()
    const rows = dialog.getAllByRole('row').slice(1)
    const first = within(rows[0]).getAllByRole('spinbutton')
    fireEvent.change(first[1], { target: { value: '10' } })
    fireEvent.change(first[2], { target: { value: '20' } })
    expect(apply).toBeDisabled()
    fireEvent.change(first[3], { target: { value: '20' } })
    fireEvent.change(first[4], { target: { value: '6.75' } })
    fireEvent.click(apply)
    for (const row of rows) {
      expect(within(row).getAllByRole('spinbutton').map((input) => (input as HTMLInputElement).value)).toEqual(['30', '10', '20', '20', '6.75', ''])
      expect(within(row).getByPlaceholderText('0.0040')).toBeInTheDocument()
    }
    fireEvent.click(dialog.getByRole('button', { name: '박스분할 저장' }))
    await waitFor(() => expect(saveBoxSplits).toHaveBeenCalledOnce())
    expect(saveBoxSplits.mock.calls[0][0]).toMatchObject({
      shipmentItemId: shipmentA.items[0].id,
      allocations: Array.from({ length: 10 }, (_, index) => ({
        boxNo: String(index + 1), autoNumber: true, quantity: 30, lengthCm: 10, widthCm: 20, heightCm: 20, grossWeightKg: 6.75,
      })),
    })
  })

  it('applies first-box CBM and its estimated dimensions to every split without inventing weights', async () => {
    saveBoxSplits.mockResolvedValue({ ok: true })
    renderShipment(makeFullyPackedInProgressShipment(), 'items')
    const editor = itemEditor('SKU-A')
    fireEvent.change(editor.getByLabelText('SKU-A 총 박스 수'), { target: { value: '2' } })
    fireEvent.click(editor.getByRole('button', { name: '자동 분할 미리보기' }))
    fireEvent.change(editor.getByLabelText('박스 1 CBM(직접 입력)'), { target: { value: '0.2' } })
    fireEvent.click(editor.getByRole('button', { name: '첫 박스 규격·무게 전체 적용' }))
    expect(editor.getByLabelText('박스 2 CBM(직접 입력)')).toHaveValue(0.2)
    fireEvent.click(editor.getByRole('button', { name: '박스분할 저장' }))
    await waitFor(() => expect(saveBoxSplits).toHaveBeenCalledOnce())
    expect(saveBoxSplits.mock.calls[0][0].allocations).toHaveLength(2)
    for (const allocation of saveBoxSplits.mock.calls[0][0].allocations) expect(allocation).toMatchObject({ manualCbm: 0.2, lengthCm: 58.48, widthCm: 58.48, heightCm: 58.48 })
    expect(saveBoxSplits.mock.calls[0][0].allocations.every((allocation: { grossWeightKg?: number | null }) => allocation.grossWeightKg == null)).toBe(true)
  })

  it('preserves measured weights when the first box has no weight to apply', async () => {
    saveBoxSplits.mockResolvedValue({ ok: true })
    const detail = makeFullyPackedInProgressShipment()
    detail.boxes[0] = { ...detail.boxes[0], lengthCm: 10, widthCm: 20, heightCm: 30, grossWeightKg: null }
    detail.boxes.push({ ...detail.boxes[0], id: 'box-2', boxNo: '2', lengthCm: 15, widthCm: 25, heightCm: 35, grossWeightKg: 8.5 })
    detail.boxItems[0].quantity = 5
    detail.boxItems.push({ id: 'allocation-2', boxId: 'box-2', shipmentItemId: 'shared-item-id', quantity: 5 })
    renderShipment(detail)
    const editor = itemEditor('SKU-A')
    fireEvent.click(editor.getByRole('button', { name: '첫 박스 규격·무게 전체 적용' }))
    expect(editor.getByLabelText('박스 1 총중량(kg)')).toHaveValue(null)
    expect(editor.getByLabelText('박스 2 총중량(kg)')).toHaveValue(8.5)
    fireEvent.click(editor.getByRole('button', { name: '박스분할 저장' }))
    await waitFor(() => expect(saveBoxSplits).toHaveBeenCalledOnce())
    expect(saveBoxSplits.mock.calls[0][0].allocations.every((allocation: { grossWeightKg?: number | null }) => allocation.grossWeightKg === undefined)).toBe(true)
  })

  it('opens the selected mixed-box product and does not save or select another product', async () => {
    saveBoxSplits.mockResolvedValue({ ok: true })
    renderShipment(makeShipmentWithSharedBoxDimensions(), 'boxes')
    fireEvent.click(screen.getByRole('button', { name: '박스 COMMON-1 펼치기' }))
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

  it('starts a new product at box four when boxes one through three are already saved', async () => {
    saveBoxSplits.mockResolvedValue({ ok: true })
    const detail = makeFullyPackedInProgressShipment()
    detail.items.push({ ...shipmentA.items[0], id: 'new-item', sku: 'SKU-NEW' })
    detail.boxes = ['1', '2', '3'].map((boxNo) => ({ ...detail.boxes[0], id: `box-${boxNo}`, boxNo }))
    detail.boxItems = detail.boxes.map((box, index) => ({ id: `allocation-${index}`, boxId: box.id, shipmentItemId: 'shared-item-id', quantity: index === 2 ? 4 : 3 }))
    renderShipment(detail, 'items')
    const editor = itemEditor('SKU-NEW')
    expect(editor.getByPlaceholderText('1')).toHaveValue('4')
    fireEvent.change(editor.getByPlaceholderText('0'), { target: { value: '6' } })
    fireEvent.click(editor.getByRole('button', { name: '박스 추가' }))
    const rows = editor.getAllByRole('row').slice(1)
    expect(rows.map((row) => (within(row).getByRole('textbox') as HTMLInputElement).value)).toEqual(['4', '5'])
    fireEvent.change(within(rows[1]).getByPlaceholderText('0'), { target: { value: '4' } })
    fireEvent.click(editor.getByRole('button', { name: '박스분할 저장' }))
    await waitFor(() => expect(saveBoxSplits).toHaveBeenCalledOnce())
    expect(saveBoxSplits.mock.calls[0][0].allocations).toEqual([
      { boxNo: '4', quantity: 6, autoNumber: true, lengthCm: null, widthCm: null, heightCm: null },
      { boxNo: '5', quantity: 4, autoNumber: true, lengthCm: null, widthCm: null, heightCm: null, grossWeightKg: null },
    ])
  })

  it('includes unsaved manual boxes when suggesting the next product number', () => {
    renderShipment({ ...shipmentA, items: [shipmentA.items[0], { ...shipmentA.items[0], id: 'other-item', sku: 'SKU-B' }] })
    const first = itemEditor('SKU-A')
    fireEvent.change(first.getByPlaceholderText('0'), { target: { value: '3' } })
    fireEvent.click(first.getByRole('button', { name: '박스 추가' }))
    fireEvent.click(first.getByRole('button', { name: '박스 추가' }))
    expect(first.getAllByRole('textbox').map((input) => (input as HTMLInputElement).value)).toEqual(['1', '2', '3'])
    expect(itemEditor('SKU-B').getByPlaceholderText('1')).toHaveValue('4')
    expect(itemEditor('SKU-A').getAllByRole('textbox').map((input) => (input as HTMLInputElement).value)).toEqual(['1', '2', '3'])
    expect(itemEditor('SKU-A').getAllByPlaceholderText('0')[0]).toHaveValue(3)
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

    await waitFor(() => expect(screen.getByText('第1步 · 出库品项·装箱拆分')).toBeInTheDocument())
    expect(screen.getByRole('columnheader', { name: '商品名(韩文)' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '实际出库数量' })).toBeInTheDocument()
    expect(screen.getByText('添加出库品项')).toBeInTheDocument()
    expect(screen.getAllByText('SKU-KEEP').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/번역 제외 상품명/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/번역 제외 옵션명/).length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: '添加品项' }))
    fireEvent.click(within(await screen.findByRole('group', { name: '选择出库库存位置' })).getByRole('checkbox'))
    await waitFor(() => expect(screen.getByRole('columnheader', { name: '出库仓库' })).toBeInTheDocument())
    const stageOneRoot = document.querySelector('[data-purchasing-translate]')
    expect(stageOneRoot).not.toBeNull()
    expect(visibleKoreanUi(stageOneRoot!)).toEqual([])

    rerender(<><PurchasingLanguageSwitcher /><ChinaShipmentsBoard inventoryItems={[inventoryItem]} shipments={shipments} selectedShipment={detail} selectedStep="boxes" showCreate={false} /></>)

    await waitFor(() => expect(screen.getByText('已保存箱子情况')).toBeInTheDocument())
    expect(screen.getByText('第2步')).toBeInTheDocument()
    expect(screen.getAllByRole('columnheader', { name: '箱号' }).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: /BOX-01/, expanded: false }))
    fireEvent.click(screen.getByRole('button', { name: '编辑箱 BOX-01 内容' }))
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
    await waitFor(() => expect(screen.getByText('托盘分配')).toBeInTheDocument())
    const palletRoot = document.querySelector('[data-purchasing-translate]')
    expect(palletRoot).not.toBeNull()
    expect(visibleKoreanUi(palletRoot!)).toEqual([])

    rerender(<><PurchasingLanguageSwitcher /><ChinaShipmentsBoard inventoryItems={[inventoryItem]} shipments={shipments} selectedShipment={detail} selectedStep="summary" showCreate={false} /></>)

    await waitFor(() => expect(screen.getByRole('heading', { name: '第4步 · 托盘最终清单' })).toBeInTheDocument())
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
    fireEvent.click(within(screen.getByRole('group', { name: '选择出库库存位置' })).getByRole('checkbox'))
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

  it('keeps new shipment creation available from the request list while other requests are in progress', () => {
    render(<ChinaShipmentsBoard inventoryItems={[]} shipments={shipments} selectedShipment={null} selectedStep="items" showCreate={false} />)

    expect(screen.getByRole('button', { name: '새 중국출고요청' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '출고 A' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '출고 B' })).toBeInTheDocument()
    expect(screen.queryByText(/새 요청은 만들 수 없습니다/)).not.toBeInTheDocument()
  })

  it.each(['items', 'boxes', 'pallets', 'summary'] as const)('hides the request list and period filters while working in %s', (stage) => {
    renderShipment(shipmentA, stage)

    expect(screen.queryByRole('table', { name: '중국출고요청 목록' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '중국출고요청 목록' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('조회 기간')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '출고 B' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '새 중국출고요청' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '목록으로' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '이름·날짜 수정' })).toBeEnabled()
  })

  it('opens a request selected from the list', () => {
    render(<ChinaShipmentsBoard inventoryItems={[]} shipments={shipments} selectedShipment={null} selectedStep="items" showCreate={false} />)

    fireEvent.click(screen.getByRole('button', { name: '출고 B' }))
    expect(navigate).toHaveBeenCalledWith('/purchasing/china-shipments?shipment=b&step=items')
  })

  it('selects only deletable list rows and cancels bulk deletion without deleting anything', () => {
    const list = [...shipments, { ...asListItem(makeShipment('done', '완료된 출고', 'SKU-DONE')), status: 'dispatched' }]
    render(<ChinaShipmentsBoard inventoryItems={[]} shipments={list} selectedShipment={null} selectedStep="items" showCreate={false} />)

    expect(screen.getByRole('button', { name: '선택 삭제 0' })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'OUT-done 삭제 선택' })).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: '삭제 가능한 중국출고 전체 선택' }))
    expect(screen.getByRole('checkbox', { name: 'OUT-a 삭제 선택' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'OUT-b 삭제 선택' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'OUT-done 삭제 선택' })).not.toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: '선택 삭제 2' }))

    const dialog = screen.getByRole('dialog', { name: '선택한 출고작업 삭제' })
    expect(within(dialog).getByText('출고 A · OUT-a')).toHaveAttribute('data-no-translate')
    expect(within(dialog).getByText('출고 B · OUT-b')).toHaveAttribute('data-no-translate')
    expect(within(dialog).queryByText(/완료된 출고/)).not.toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: '취소' }))
    expect(deleteShipmentAction).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '선택 삭제 2' })).toBeEnabled()
  })

  it('deletes only checked shipments after confirmation and removes their rows without leaving the list', async () => {
    deleteShipmentAction.mockResolvedValue({ ok: true })
    const list = [...shipments, asListItem(makeShipment('c', '출고 C', 'SKU-C'))]
    render(<ChinaShipmentsBoard inventoryItems={[]} shipments={list} selectedShipment={null} selectedStep="items" showCreate={false} />)

    fireEvent.click(screen.getByRole('checkbox', { name: 'OUT-a 삭제 선택' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'OUT-c 삭제 선택' }))
    fireEvent.click(screen.getByRole('button', { name: '선택 삭제 2' }))
    expect(deleteShipmentAction).not.toHaveBeenCalled()
    fireEvent.click(within(screen.getByRole('dialog', { name: '선택한 출고작업 삭제' })).getByRole('button', { name: '삭제' }))

    await waitFor(() => expect(deleteShipmentAction).toHaveBeenCalledTimes(2))
    expect(deleteShipmentAction.mock.calls.map(([input]) => input)).toEqual([{ shipmentId: 'a' }, { shipmentId: 'c' }])
    await waitFor(() => expect(screen.queryByRole('button', { name: '출고 A' })).not.toBeInTheDocument())
    expect(screen.queryByRole('button', { name: '출고 C' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '출고 B' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '선택 삭제 0' })).toBeDisabled()
    expect(refresh).toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('keeps failed deletion rows selected while removing successful rows', async () => {
    deleteShipmentAction.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, error: '다른 사용자가 출고완료 처리했습니다.' })
    render(<ChinaShipmentsBoard inventoryItems={[]} shipments={shipments} selectedShipment={null} selectedStep="items" showCreate={false} />)

    fireEvent.click(screen.getByRole('checkbox', { name: '삭제 가능한 중국출고 전체 선택' }))
    fireEvent.click(screen.getByRole('button', { name: '선택 삭제 2' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: '선택한 출고작업 삭제' })).getByRole('button', { name: '삭제' }))

    await waitFor(() => expect(screen.queryByRole('button', { name: '출고 A' })).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: '출고 B' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'OUT-b 삭제 선택' })).toBeChecked()
    await waitFor(() => expect(screen.getByRole('button', { name: '선택 삭제 1' })).toBeEnabled())
    expect(screen.getByText(/다른 사용자가 출고완료 처리했습니다\./)).toBeInTheDocument()
    expect(refresh).toHaveBeenCalled()
  })

  it('disables list selection and deletion until an in-progress deletion finishes', async () => {
    let finishDelete!: (result: { ok: true }) => void
    deleteShipmentAction.mockReturnValue(new Promise((resolve) => { finishDelete = resolve }))
    render(<ChinaShipmentsBoard inventoryItems={[]} shipments={shipments} selectedShipment={null} selectedStep="items" showCreate={false} />)

    fireEvent.click(screen.getByRole('checkbox', { name: 'OUT-a 삭제 선택' }))
    fireEvent.click(screen.getByRole('button', { name: '선택 삭제 1' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: '선택한 출고작업 삭제' })).getByRole('button', { name: '삭제' }))

    await waitFor(() => expect(deleteShipmentAction).toHaveBeenCalledOnce())
    expect(screen.getByRole('checkbox', { name: 'OUT-b 삭제 선택' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '선택 삭제 1' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '출고 B' })).toBeDisabled()
    await act(async () => finishDelete({ ok: true }))
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'OUT-b 삭제 선택' })).toBeEnabled())
  })

  it('shows only the creation form while hiding list rows, filters, deletion, and list tools', () => {
    render(<ChinaShipmentsBoard inventoryItems={[]} shipments={shipments} selectedShipment={shipmentA} selectedStep="items" showCreate />)

    expect(screen.getByRole('button', { name: '중국출고요청 만들기' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '요청 닫기' })).toBeEnabled()
    expect(screen.getByRole('heading', { name: '새 중국출고요청' })).toBeInTheDocument()
    expect(screen.getByLabelText('출고작업명')).toBeInTheDocument()
    expect(screen.getByLabelText('도착지')).toBeInTheDocument()
    expect(screen.queryByRole('table', { name: '중국출고요청 목록' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '중국출고요청 목록' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('조회 기간')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /선택 삭제/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '출고 A' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '출고 B' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '엑셀로 출고 등록' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '창고 수정' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '출고 A' })).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: '중국출고 작업 단계' })).not.toBeInTheDocument()
  })

  it('keeps a new request on cancel and returns to the list only after explicitly discarding its edits', () => {
    const { rerender } = render(<ChinaShipmentsBoard inventoryItems={[]} shipments={shipments} selectedShipment={null} selectedStep="items" showCreate />)
    fireEvent.change(screen.getByLabelText('메모'), { target: { value: '작성 중인 요청' } })
    fireEvent.click(screen.getByRole('button', { name: '요청 닫기' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '계속 작업' }))
    expect(screen.getByLabelText('메모')).toHaveValue('작성 중인 요청')
    expect(screen.queryByRole('table', { name: '중국출고요청 목록' })).not.toBeInTheDocument()
    expect(navigate).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '요청 닫기' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '저장하지 않고 이동' }))
    expect(navigate).toHaveBeenCalledWith('/purchasing/china-shipments')
    rerender(<ChinaShipmentsBoard inventoryItems={[]} shipments={shipments} selectedShipment={null} selectedStep="items" showCreate={false} />)
    expect(screen.getByRole('table', { name: '중국출고요청 목록' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '출고 A' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '중국출고요청 만들기' })).not.toBeInTheDocument()
  })

  it('lists requests as selectable rows and submits custom calendar filters', () => {
    render(<ChinaShipmentsBoard inventoryItems={[]} shipments={shipments} selectedShipment={null} selectedStep="items" showCreate={false} />)
    expect(screen.getByRole('table', { name: '중국출고요청 목록' })).toBeInTheDocument()
    expect(screen.queryByLabelText('중국출고요청 선택')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('조회 기간'), { target: { value: 'custom' } })
    fireEvent.change(screen.getByLabelText('조회 시작일'), { target: { value: '2026-09-01' } })
    fireEvent.change(screen.getByLabelText('조회 종료일'), { target: { value: '2026-09-30' } })
    fireEvent.click(screen.getByRole('button', { name: '조회' }))
    expect(navigate).toHaveBeenCalledWith('/purchasing/china-shipments?period=custom&from=2026-09-01&to=2026-09-30')
  })

  it('opens a request with the arrival warehouse and item visible while leaving the outbound quantity for the user', () => {
    const inventoryItems = [
      { id: 'selected', warehouseCode: '쿠팡창고', sku: 'SKU-1', productName: '입고 품목', optionName: null, onHandQuantity: 20, reservedQuantity: 5, availableQuantity: 15 },
      { id: 'other', warehouseCode: '대량창고', sku: 'SKU-2', productName: '다른 품목', optionName: null, onHandQuantity: 10, reservedQuantity: 0, availableQuantity: 10 },
    ]
    render(<ChinaShipmentsBoard inventoryItems={inventoryItems} shipments={shipments} selectedShipment={null} selectedStep="items" showCreate initialInventoryId="selected" />)

    expect(screen.getByRole('checkbox', { name: /쿠팡창고/ })).toBeChecked()
    expect(screen.getByText('입고 품목')).toBeInTheDocument()
    expect(screen.queryByText('다른 품목')).not.toBeInTheDocument()
    expect(screen.getByLabelText('이번 출고')).toHaveDisplayValue('')
    expect(createShipment).not.toHaveBeenCalled()
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

  it('sorts new-shipment stock by code and name without moving entered quantities to another product', async () => {
    createShipment.mockResolvedValue({ ok: false, error: '테스트 종료' })
    const stock = [
      { ...inventoryItem, id: 'stock-10', sku: 'SKU-10', productName: '나무 컵' },
      { ...inventoryItem, id: 'stock-2', sku: 'SKU-2', productName: '다용도 선반' },
      { ...inventoryItem, id: 'stock-1', sku: 'SKU-1', productName: '가방' },
    ]
    render(<ChinaShipmentsBoard inventoryItems={stock} shipments={shipments} selectedShipment={null} selectedStep="items" showCreate />)
    fireEvent.click(screen.getByRole('checkbox', { name: /중국창고/ }))
    const table = screen.getByRole('table', { name: '신규 출고 상품 목록' })
    const productOrder = () => within(table).getAllByRole('row').slice(1).map((row) => row.textContent)
    expect(productOrder()).toEqual(['가방', '다용도 선반', '나무 컵'].map((name) => expect.stringContaining(name)))
    fireEvent.change(within(screen.getByText('나무 컵').closest('tr')!).getByLabelText('이번 출고'), { target: { value: '7' } })
    const codeSort = within(table).getByRole('button', { name: '상품코드 정렬' })
    const nameSort = within(table).getByRole('button', { name: '상품명 정렬' })
    fireEvent.click(codeSort)
    expect(codeSort.closest('th')).toHaveAttribute('aria-sort', 'descending')
    expect(productOrder()).toEqual(['나무 컵', '다용도 선반', '가방'].map((name) => expect.stringContaining(name)))
    fireEvent.click(codeSort)
    expect(codeSort.closest('th')).toHaveAttribute('aria-sort', 'ascending')
    expect(productOrder()).toEqual(['가방', '다용도 선반', '나무 컵'].map((name) => expect.stringContaining(name)))
    fireEvent.click(nameSort)
    expect(nameSort.closest('th')).toHaveAttribute('aria-sort', 'ascending')
    expect(productOrder()).toEqual(['가방', '나무 컵', '다용도 선반'].map((name) => expect.stringContaining(name)))
    fireEvent.click(nameSort)
    expect(nameSort.closest('th')).toHaveAttribute('aria-sort', 'descending')
    expect(productOrder()).toEqual(['다용도 선반', '나무 컵', '가방'].map((name) => expect.stringContaining(name)))
    expect(createShipment).not.toHaveBeenCalled()
    fireEvent.change(screen.getByPlaceholderText('상품명, 상품코드, 옵션 검색'), { target: { value: '가방' } })
    expect(screen.queryByText('나무 컵')).not.toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('상품명, 상품코드, 옵션 검색'), { target: { value: '' } })
    expect(within(screen.getByText('나무 컵').closest('tr')!).getByLabelText('이번 출고')).toHaveValue(7)
    fireEvent.change(screen.getByLabelText('도착지'), { target: { value: '인천' } })
    fireEvent.click(screen.getByRole('button', { name: '중국출고요청 만들기' }))
    await waitFor(() => expect(createShipment).toHaveBeenCalledWith(expect.objectContaining({ lines: [{ inventoryId: 'stock-10', quantity: 7 }] })))
  })

  it('views saved goods and subsidiary materials separately and fills only the visible category', async () => {
    createShipment.mockResolvedValue({ ok: false, error: '테스트 종료' })
    const stock = [
      { ...inventoryItem, itemCategory: '[상품]' },
      { ...inventoryItem, id: 'material', sku: 'PACK-1', productName: '포장 부자재', itemCategory: '[부재료]', availableQuantity: 8 },
      { ...inventoryItem, id: 'empty-material', sku: 'PACK-EMPTY', productName: '예약된 부자재', itemCategory: '부자재', availableQuantity: 0 },
    ]
    render(<ChinaShipmentsBoard inventoryItems={stock} shipments={shipments} selectedShipment={null} selectedStep="items" showCreate />)
    fireEvent.click(screen.getByRole('checkbox', { name: /중국창고/ }))
    const categories = within(screen.getByRole('group', { name: '출고 품목구분 선택' }))
    expect(categories.getByRole('button', { name: /^전체/ })).toHaveAttribute('aria-pressed', 'true')
    expect(categories.getByRole('button', { name: /^부자재/ })).toHaveTextContent('1종')
    fireEvent.click(categories.getByRole('button', { name: /^상품/ }))
    expect(screen.getByText('새 상품')).toBeInTheDocument()
    expect(screen.queryByText('포장 부자재')).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /중국창고/ })).toHaveAccessibleName(/15개/)
    fireEvent.click(screen.getByRole('button', { name: '보이는 상품 전체수량' }))
    expect(screen.getByLabelText('이번 출고')).toHaveValue(15)
    fireEvent.click(categories.getByRole('button', { name: /^부자재/ }))
    expect(screen.queryByText('새 상품')).not.toBeInTheDocument()
    expect(screen.getByText('포장 부자재')).toBeInTheDocument()
    expect(screen.getByLabelText('이번 출고')).toHaveDisplayValue('')
    expect(screen.getByRole('checkbox', { name: /중국창고/ })).toHaveAccessibleName(/8개/)
    fireEvent.change(screen.getByLabelText('이번 출고'), { target: { value: '3' } })
    fireEvent.click(categories.getByRole('button', { name: /^상품/ }))
    expect(screen.getByLabelText('이번 출고')).toHaveValue(15)
    fireEvent.change(screen.getByLabelText('도착지'), { target: { value: '인천' } })
    fireEvent.click(screen.getByRole('button', { name: '중국출고요청 만들기' }))
    await waitFor(() => expect(createShipment).toHaveBeenCalledWith(expect.objectContaining({ lines: [
      { inventoryId: 'inventory-new', quantity: 15 },
      { inventoryId: 'material', quantity: 3 },
    ] })))
  })

  it('keeps uncategorized legacy goods and custom saved categories accessible', () => {
    render(<ChinaShipmentsBoard inventoryItems={[
      { ...inventoryItem, itemCategory: null },
      { ...inventoryItem, id: 'sample', sku: 'SAMPLE', productName: '출고용 샘플', itemCategory: '[샘플]' },
    ]} shipments={shipments} selectedShipment={null} selectedStep="items" showCreate />)
    fireEvent.click(screen.getByRole('checkbox', { name: /중국창고/ }))
    const categories = within(screen.getByRole('group', { name: '출고 품목구분 선택' }))
    fireEvent.click(categories.getByRole('button', { name: /^상품/ }))
    expect(screen.getByText('새 상품')).toBeInTheDocument()
    expect(screen.queryByText('출고용 샘플')).not.toBeInTheDocument()
    fireEvent.click(categories.getByRole('button', { name: /^샘플/ }))
    expect(screen.getByText('출고용 샘플')).toBeInTheDocument()
    expect(screen.queryByText('새 상품')).not.toBeInTheDocument()
  })

  it('shows configured stock locations before they have available inventory', () => {
    render(<ChinaShipmentsBoard inventoryItems={[]} shipments={shipments} selectedShipment={null} selectedStep="items" showCreate
      outboundWarehouses={[
        { warehouseCode: '중국창고', isDefault: true, hasActiveInventory: false },
        { warehouseCode: '쿠팡창고', isDefault: false, hasActiveInventory: false },
        { warehouseCode: '대량창고', isDefault: false, hasActiveInventory: false },
      ]} />)
    const warehouses = within(screen.getByRole('group', { name: '출고 재고 위치 선택' }))
    expect(warehouses.getAllByRole('checkbox')).toHaveLength(3)
    expect(warehouses.getAllByText('0개')).toHaveLength(3)
    fireEvent.click(warehouses.getByRole('checkbox', { name: /중국창고/ }))
    expect(screen.getByText('선택한 창고에 작업 가능한 SaaS 재고가 없습니다.')).toBeInTheDocument()
    expect(screen.queryByRole('spinbutton', { name: '이번 출고' })).not.toBeInTheDocument()
  })

  it('keeps fully reserved inventory locations visible and lists active warehouses once', () => {
    const stock = [
      { ...inventoryItem, availableQuantity: 0, reservedQuantity: 20 },
      { ...inventoryItem, id: 'second', warehouseCode: '대량창고', availableQuantity: 15 },
    ]
    render(<ChinaShipmentsBoard inventoryItems={stock} shipments={shipments} selectedShipment={null} selectedStep="items" showCreate
      outboundWarehouses={[{ warehouseCode: '중국창고', isDefault: true, hasActiveInventory: true }]} />)
    const warehouses = within(screen.getByRole('group', { name: '출고 재고 위치 선택' }))
    expect(warehouses.getAllByRole('checkbox')).toHaveLength(2)
    expect(warehouses.getByRole('checkbox', { name: /중국창고/ })).toBeInTheDocument()
    fireEvent.click(warehouses.getByRole('checkbox', { name: /대량창고/ }))
    expect(screen.getByLabelText('이번 출고')).toHaveAttribute('max', '15')
  })

  it('shows only the selected shipment when the server provides another detail', () => {
    const { rerender } = render(<ChinaShipmentsBoard inventoryItems={[]} shipments={shipments} selectedShipment={shipmentA} selectedStep="items" showCreate={false} />)

    rerender(<ChinaShipmentsBoard inventoryItems={[]} shipments={shipments} selectedShipment={shipmentB} selectedStep="items" showCreate={false} />)

    expect(screen.queryByRole('heading', { name: '출고 A' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '출고 B' })).toBeInTheDocument()
    expect(screen.getAllByRole('navigation', { name: '중국출고 작업 단계' })).toHaveLength(1)
    expect(itemEditor('SKU-B').getByPlaceholderText('1')).toHaveValue('1')
    expect(screen.queryByRole('table', { name: '중국출고요청 목록' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '목록으로' })).toBeInTheDocument()
  })

  it('enables pallet output only when a saved nonempty box is assigned to a pallet', async () => {
    const detail = makeShipmentWithBox()
    const unassigned = { ...detail, boxes: detail.boxes.map((box) => ({ ...box, palletId: null })) }
    const { rerender } = renderShipment(unassigned)
    expect(screen.getByRole('button', { name: '박스 쉽먼트' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '파렛트 쉽먼트' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '박스 쉽먼트' }))
    expect(await screen.findByRole('menuitem', { name: '박스 쉽먼트 일괄 다운로드' })).toHaveAttribute('href', '/api/purchasing/china-shipments/a/labels?type=boxes')
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    rerender(<ChinaShipmentsBoard inventoryItems={[inventoryItem]} shipments={shipments} selectedShipment={detail} selectedStep="pallets" showCreate={false} />)
    fireEvent.click(screen.getByRole('button', { name: '파렛트 쉽먼트' }))
    expect(await screen.findByRole('menuitem', { name: '파렛트 쉽먼트 일괄 다운로드' })).toHaveAttribute('href', '/api/purchasing/china-shipments/a/labels?type=pallets')
  })

  it('shows saved box contents and lets users include empty boxes', () => {
    renderShipment(makeShipmentWithCompletionFilters(), 'boxes')

    expect(screen.getByRole('button', { name: '박스 쉽먼트' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '파렛트 쉽먼트' })).toBeEnabled()
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
    expect(within(emptyBoxRow).getAllByText('내용 없음').find((element) => !element.closest('[hidden]'))).toBeVisible()
    expect(within(emptyBoxRow).queryByRole('link', { name: /부착용 쉽먼트 다운로드/ })).not.toBeInTheDocument()
  })





  it('keeps pallet measurements visible and expands product names and box weights together', () => {
    renderShipment(makeShipmentWithBoxAndPalletStatuses(), 'pallets')
    expect(screen.getAllByRole('heading', { name: '사용 파렛트' })).toHaveLength(1)
    expect(screen.queryByRole('heading', { name: '파렛트 상태' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('파렛트 P1 가로(cm)')).toBeVisible()
    expect(screen.getByLabelText('파렛트 P1 자체 무게(kg)')).toBeVisible()
    expect(screen.queryByRole('group', { name: '박스 BOX-01 적재 상품·중량' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '파렛트 P1 펼치기' }))
    const article = screen.getByRole('button', { name: '파렛트 P1 접기' }).closest('article')!
    const boxRow = within(article).getByRole('group', { name: '박스 BOX-01 적재 상품·중량' })
    expect(within(boxRow).getByText(/DONE-01 · 완료 상품/)).toBeVisible()
    expect(within(boxRow).getByLabelText('박스 BOX-01 총중량(kg)')).toBeVisible()
    expect(within(boxRow).queryByRole('button', { name: /박스 상품 펼치기/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '파렛트 P1 접기' }))
    expect(screen.queryByRole('group', { name: '박스 BOX-01 적재 상품·중량' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('파렛트 P1 가로(cm)')).toBeVisible()
    expect(screen.getByLabelText('파렛트 P1 자체 무게(kg)')).toBeVisible()
  })

  it('keeps one weight editor for a mixed physical box while showing all loaded products', () => {
    renderShipment(makeShipmentWithBoxAndPalletStatuses(), 'pallets')
    fireEvent.click(screen.getByRole('button', { name: '파렛트 P2 펼치기' }))
    const boxRow = screen.getByRole('group', { name: '박스 BOX-02 적재 상품·중량' })
    expect(within(boxRow).getByText(/DONE-01 · 완료 상품/)).toBeVisible()
    expect(within(boxRow).getByText(/WORK-01 · 진행 상품/)).toBeVisible()
    expect(within(boxRow).getAllByLabelText('박스 BOX-02 총중량(kg)')).toHaveLength(1)
    expect(within(boxRow).getAllByRole('button', { name: '중량 저장' })).toHaveLength(1)
  })

  it('shows the final pallet list with dimensions, calculated weight and loaded products already open and read-only', () => {
    const detail = makeShipmentWithBoxAndPalletStatuses()
    detail.pallets[0] = { ...detail.pallets[0], lengthCm: 120, widthCm: 100, heightCm: 150 }
    detail.boxes[0].grossWeightKg = 10
    renderShipment(detail, 'summary')
    expect(screen.getByRole('heading', { name: '4단계 · 파렛트 최종 리스트' })).toBeVisible()
    expect(screen.getByRole('link', { name: '최종 적재리스트 엑셀 다운로드' })).toHaveAttribute('href', '/api/purchasing/china-shipments/a/export')
    const card = screen.getByRole('button', { name: '파렛트 P1 접기' }).closest('article')!
    expect(within(card).getByText('파렛트 규격: 120 × 100 × 150 cm')).toBeVisible()
    expect(within(card).getByText('총중량(kg): 15')).toBeVisible()
    expect(within(card).getByText('최종 파렛트 CBM: 1.8000 CBM')).toBeVisible()
    expect(within(card).queryByRole('spinbutton')).not.toBeInTheDocument()
    expect(within(card).getByRole('group', { name: '박스 BOX-01 적재 상품·중량' })).toBeVisible()
    expect(within(card).getByText(/DONE-01 · 완료 상품/)).toBeVisible()
    expect(screen.queryByRole('button', { name: '파렛트 배정 전체 저장' })).not.toBeInTheDocument()
    fireEvent.click(within(card).getByRole('button', { name: '파렛트 P1 접기' }))
    expect(within(card).queryByRole('group', { name: /적재 상품·중량/ })).not.toBeInTheDocument()
  })

  it('calculates final CBM from measured pallet dimensions independently of product CBM', async () => {
    savePalletDimensions.mockResolvedValue({ ok: true })
    renderShipment(makeShipmentWithBoxAndPalletStatuses(), 'pallets')
    fireEvent.change(screen.getByLabelText('파렛트 P1 가로(cm)'), { target: { value: '120' } })
    fireEvent.change(screen.getByLabelText('파렛트 P1 세로(cm)'), { target: { value: '100' } })
    fireEvent.change(screen.getByLabelText('파렛트 P1 높이(cm)'), { target: { value: '150' } })
    expect(screen.getByText('최종 파렛트 CBM: 1.8000 CBM')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '파렛트 P1 규격 저장' }))
    await waitFor(() => expect(savePalletDimensions).toHaveBeenCalledWith({ shipmentId: 'a', palletId: 'pallet-1', lengthCm: 120, widthCm: 100, heightCm: 150 }))
  })

  it('estimates missing pallet dimensions and keeps them when the manual CBM is cleared', async () => {
    savePalletDimensions.mockResolvedValue({ ok: true })
    renderShipment(makeShipmentWithBoxAndPalletStatuses(), 'pallets')
    const cbm = screen.getByLabelText('파렛트 P1 CBM(직접 입력)')
    fireEvent.change(cbm, { target: { value: '0.75' } })
    expect(screen.getByText('최종 파렛트 CBM: 0.7500 CBM')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '파렛트 P1 규격 저장' }))
    await waitFor(() => expect(savePalletDimensions).toHaveBeenCalledWith({ shipmentId: 'a', palletId: 'pallet-1', lengthCm: 90.86, widthCm: 90.86, heightCm: 90.86, manualCbm: 0.75 }))
    fireEvent.change(cbm, { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: '파렛트 P1 규격 저장' }))
    await waitFor(() => expect(savePalletDimensions).toHaveBeenLastCalledWith({ shipmentId: 'a', palletId: 'pallet-1', lengthCm: 90.86, widthCm: 90.86, heightCm: 90.86, manualCbm: null }))
  })

  it('retains pallet dimension edits after collapsing and reopening', () => {
    renderShipment(makeShipmentWithBoxAndPalletStatuses(), 'pallets')
    fireEvent.change(screen.getByLabelText('파렛트 P1 가로(cm)'), { target: { value: '120' } })
    fireEvent.change(screen.getByLabelText('파렛트 P1 자체 무게(kg)'), { target: { value: '7' } })
    expect(screen.getByRole('button', { name: '파렛트 P1 펼치기' })).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(screen.getByRole('button', { name: '파렛트 P1 펼치기' }))
    fireEvent.click(screen.getByRole('button', { name: '파렛트 P1 접기' }))
    expect(screen.getByLabelText('파렛트 P1 가로(cm)')).toHaveValue(120)
    expect(screen.getByLabelText('파렛트 P1 자체 무게(kg)')).toHaveValue(7)
    fireEvent.click(screen.getByRole('button', { name: '파렛트 P1 펼치기' }))
    expect(screen.getByLabelText('파렛트 P1 가로(cm)')).toHaveValue(120)
    selectOtherShipment()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('shows pallet assignment inputs directly in the third stage', () => {
    renderShipment(makeShipmentWithBoxAndPalletStatuses(), 'pallets')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '3단계 · 파렛트 배정' })).toBeInTheDocument()
    expect(screen.getByLabelText('박스 BOX-01 파렛트 번호')).toBeVisible()
    expect(screen.getByRole('button', { name: '파렛트 배정 전체 저장' })).toBeVisible()
    expect(screen.queryByRole('button', { name: '파렛트 배정 수정' })).not.toBeInTheDocument()
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
    expect(screen.getByRole('group', { name: '箱 BOX-01 装载商品和重量' })).toBeVisible()
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
    expect(screen.getByRole('group', { name: '박스 1 적재 상품·중량' })).toBeVisible()
    expect(screen.getAllByText('0 PLT + 1 BOX').length).toBeGreaterThan(0)
  })

  it('automatically totals each physical box once plus editable pallet tare while dimensions stay manual', () => {
    const detail = makeShipmentWithCompletionFilters()
    detail.boxes.forEach((box) => { box.grossWeightKg = box.id === 'box-saved' ? 10.125 : box.id === 'box-shared' ? 20.25 : 999 })
    detail.boxes[1].palletId = 'pallet-1'
    detail.pallets[0].grossWeightKg = 888
    const view = renderShipment(detail, 'pallets')
    expect(screen.getByText('총중량(kg): 35.375')).toBeInTheDocument()
    expect(screen.getByLabelText('파렛트 P1 자체 무게(kg)')).toHaveValue(5)
    expect(screen.queryByLabelText('파렛트 P1 총중량(kg)')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('파렛트 P1 자체 무게(kg)'), { target: { value: '7.125' } })
    expect(screen.getByText('총중량(kg): 37.5')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '파렛트 P1 펼치기' }))
    expect(screen.getByLabelText('파렛트 P1 가로(cm)')).toHaveValue(null)
    expect(screen.getByLabelText('파렛트 P1 세로(cm)')).toHaveValue(null)
    expect(screen.getByLabelText('파렛트 P1 높이(cm)')).toHaveValue(null)
    fireEvent.change(screen.getByLabelText('파렛트 P1 자체 무게(kg)'), { target: { value: '5' } })
    view.rerender(<ChinaShipmentsBoard inventoryItems={[inventoryItem]} shipments={shipments} selectedShipment={{ ...detail, boxes: detail.boxes.map((box) => box.id === 'box-shared' ? { ...box, grossWeightKg: 30.25 } : box) }} selectedStep="pallets" showCreate={false} />)
    expect(screen.getByText('총중량(kg): 45.375')).toBeInTheDocument()
  })

  it('does not show a misleading pallet total when a loaded box has no measured weight', () => {
    const detail = makeShipmentWithCompletionFilters()
    detail.boxes[1].palletId = 'pallet-1'
    renderShipment(detail, 'pallets')
    expect(screen.getByText('총중량(kg): 미입력')).toBeInTheDocument()
    expect(screen.getByText('무게 미입력 박스 2개가 있어 총중량을 계산할 수 없습니다.')).toBeInTheDocument()
  })

  it('saves pallet tare separately and retains measured box weight editing', async () => {
    saveWeight.mockResolvedValue({ ok: true })
    savePalletTare.mockResolvedValue({ ok: true })
    renderShipment(makeShipmentWithBoxAndPalletStatuses(), 'pallets')
    fireEvent.change(screen.getByLabelText('파렛트 P1 자체 무게(kg)'), { target: { value: '7.5' } })
    fireEvent.click(screen.getByRole('button', { name: '파렛트 P1 무게 저장' }))
    await waitFor(() => expect(savePalletTare).toHaveBeenCalledWith({ shipmentId: 'a', palletId: 'pallet-1', tareWeightKg: 7.5 }))
    fireEvent.click(screen.getByRole('button', { name: '파렛트 P1 펼치기' }))
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
    expect(screen.queryByRole('button', { name: '중국어 상품명 수정' })).not.toBeInTheDocument()
    fireEvent.doubleClick(screen.getByRole('button', { name: 'SKU-A 중국어 상품명 편집' }))
    fireEvent.change(screen.getByLabelText('SKU-A 中文品名'), { target: { value: '样品杯' } })
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    await waitFor(() => expect(saveChineseName).toHaveBeenCalledWith({ shipmentId: 'a', shipmentItemId: 'shared-item-id', chineseProductName: '样品杯' }))
  })

  it('cancels a double-click Chinese name edit without saving', () => {
    renderShipment(shipmentA, 'items')
    fireEvent.doubleClick(screen.getByRole('button', { name: 'SKU-A 중국어 상품명 편집' }))
    const input = screen.getByLabelText('SKU-A 中文品名')
    fireEvent.change(input, { target: { value: '未保存名称' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByLabelText('SKU-A 中文品名')).not.toBeInTheDocument()
    expect(saveChineseName).not.toHaveBeenCalled()
  })

  it('filters additional stock by inclusive Korea receipt dates and preserves hidden selections', async () => {
    addShipmentItems.mockResolvedValue({ ok: true })
    const stock = [
      { ...inventoryItem, lastReceivedAt: '2026-11-02T15:00:00Z' },
      { ...inventoryItem, id: 'older', sku: 'OLD-1', productName: '오래된 상품', lastReceivedAt: '2026-11-02T14:59:00Z' },
    ]
    render(<ChinaShipmentsBoard inventoryItems={stock} shipments={shipments} selectedShipment={shipmentA} selectedStep="items" showCreate={false} />)
    fireEvent.click(screen.getByRole('button', { name: '품목 추가' }))
    fireEvent.click(within(screen.getByRole('group', { name: '출고 재고 위치 선택' })).getByRole('checkbox', { name: /중국창고/ }))
    fireEvent.change(within(screen.getByText('오래된 상품').closest('tr')!).getByLabelText('추가 출고'), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText('입고일 시작'), { target: { value: '2026-11-03' } })
    fireEvent.change(screen.getByLabelText('입고일 종료'), { target: { value: '2026-11-03' } })
    expect(screen.queryByText('오래된 상품')).not.toBeInTheDocument()
    expect(screen.getByText('새 상품')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '선택 품목 추가' }))
    await waitFor(() => expect(addShipmentItems).toHaveBeenCalledWith({ shipmentId: 'a', lines: [{ inventoryId: 'older', quantity: 2 }] }))
  })

  it('sorts additional stock while preserving separate quantities for the same SKU in different warehouses', async () => {
    addShipmentItems.mockResolvedValue({ ok: true })
    const stock = [
      { ...inventoryItem, id: 'same-b', warehouseCode: 'B창고', sku: 'SKU-2', productName: '동일 상품' },
      { ...inventoryItem, id: 'stock-10', warehouseCode: 'A창고', sku: 'SKU-10', productName: '가방' },
      { ...inventoryItem, id: 'same-a', warehouseCode: 'A창고', sku: 'SKU-2', productName: '동일 상품' },
    ]
    render(<ChinaShipmentsBoard inventoryItems={stock} shipments={shipments} selectedShipment={shipmentA} selectedStep="items" showCreate={false} />)
    fireEvent.click(screen.getByRole('button', { name: '품목 추가' }))
    fireEvent.click(screen.getByRole('button', { name: '전체 선택' }))
    const table = screen.getByRole('table', { name: '추가 출고 상품 목록' })
    const rows = () => within(table).getAllByRole('row').slice(1)
    const sameSkuRow = (warehouse: string) => rows().find((row) => within(row).queryByText('동일 상품') && within(row).queryByText(warehouse))!
    expect(rows().map((row) => row.textContent)).toEqual(['동일 상품', '동일 상품', '가방'].map((name) => expect.stringContaining(name)))
    fireEvent.change(within(sameSkuRow('A창고')).getByLabelText('추가 출고'), { target: { value: '3' } })
    fireEvent.change(within(sameSkuRow('B창고')).getByLabelText('추가 출고'), { target: { value: '4' } })
    const codeSort = within(table).getByRole('button', { name: '상품코드 정렬' })
    fireEvent.click(codeSort)
    expect(codeSort.closest('th')).toHaveAttribute('aria-sort', 'descending')
    expect(rows()[0]).toHaveTextContent('SKU-10')
    const nameSort = within(table).getByRole('button', { name: '상품명 정렬' })
    fireEvent.click(nameSort)
    expect(nameSort.closest('th')).toHaveAttribute('aria-sort', 'ascending')
    expect(rows()[0]).toHaveTextContent('가방')
    fireEvent.click(nameSort)
    expect(nameSort.closest('th')).toHaveAttribute('aria-sort', 'descending')
    expect(rows()[2]).toHaveTextContent('가방')
    expect(within(sameSkuRow('A창고')).getByLabelText('추가 출고')).toHaveValue(3)
    expect(within(sameSkuRow('B창고')).getByLabelText('추가 출고')).toHaveValue(4)
    expect(addShipmentItems).not.toHaveBeenCalled()
    fireEvent.change(screen.getByPlaceholderText('상품명, 상품코드, 옵션, 창고 검색'), { target: { value: 'B창고' } })
    expect(rows()).toHaveLength(1)
    expect(within(rows()[0]!).getByLabelText('추가 출고')).toHaveValue(4)
    fireEvent.change(screen.getByPlaceholderText('상품명, 상품코드, 옵션, 창고 검색'), { target: { value: '' } })
    expect(within(sameSkuRow('A창고')).getByLabelText('추가 출고')).toHaveValue(3)
    fireEvent.click(screen.getByRole('button', { name: '선택 품목 추가' }))
    await waitFor(() => expect(addShipmentItems).toHaveBeenCalledWith({ shipmentId: 'a', lines: [
      { inventoryId: 'same-b', quantity: 4 },
      { inventoryId: 'same-a', quantity: 3 },
    ] }))
  })

  it('loads current stock only when the existing shipment addition panel is opened', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ items: [inventoryItem] })))
    try {
      render(<ChinaShipmentsBoard inventoryItems={[]} shipments={shipments} selectedShipment={shipmentA} selectedStep="items" showCreate={false} />)
      expect(fetchSpy).not.toHaveBeenCalled()
      fireEvent.click(screen.getByRole('button', { name: '품목 추가' }))
      const warehouse = await screen.findByRole('checkbox', { name: /중국창고/ })
      expect(screen.queryByText('새 상품')).not.toBeInTheDocument()
      fireEvent.click(warehouse)
      await waitFor(() => expect(screen.getByText('새 상품')).toBeInTheDocument())
      expect(fetchSpy).toHaveBeenCalledWith('/api/purchasing/china-shipments/available-stock', { cache: 'no-store' })
    } finally { fetchSpy.mockRestore() }
  })

  it('filters lazily loaded additional stock by saved category without losing entered quantities', async () => {
    addShipmentItems.mockResolvedValue({ ok: true })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ items: [
      { ...inventoryItem, itemCategory: '[상품]' },
      { ...inventoryItem, id: 'material', sku: 'PACK-1', productName: '추가 포장재', itemCategory: '[부재료]' },
    ] })))
    try {
      render(<ChinaShipmentsBoard inventoryItems={[]} shipments={shipments} selectedShipment={shipmentA} selectedStep="items" showCreate={false} />)
      fireEvent.click(screen.getByRole('button', { name: '품목 추가' }))
      fireEvent.click(await screen.findByRole('checkbox', { name: /중국창고/ }))
      const categories = within(screen.getByRole('group', { name: '출고 품목구분 선택' }))
      fireEvent.click(categories.getByRole('button', { name: /^상품/ }))
      expect(screen.queryByText('추가 포장재')).not.toBeInTheDocument()
      fireEvent.change(screen.getByLabelText('추가 출고'), { target: { value: '2' } })
      fireEvent.click(categories.getByRole('button', { name: /^부자재/ }))
      expect(screen.queryByText('새 상품')).not.toBeInTheDocument()
      expect(screen.getByText('추가 포장재')).toBeInTheDocument()
      fireEvent.change(screen.getByLabelText('추가 출고'), { target: { value: '4' } })
      fireEvent.click(categories.getByRole('button', { name: /^상품/ }))
      expect(screen.getByLabelText('추가 출고')).toHaveValue(2)
      fireEvent.click(screen.getByRole('button', { name: '선택 품목 추가' }))
      await waitFor(() => expect(addShipmentItems).toHaveBeenCalledWith({ shipmentId: 'a', lines: [
        { inventoryId: 'inventory-new', quantity: 2 },
        { inventoryId: 'material', quantity: 4 },
      ] }))
    } finally { fetchSpy.mockRestore() }
  })

  it('requires warehouse selection and preserves independent same-SKU additions across warehouse and search filters', async () => {
    addShipmentItems.mockResolvedValue({ ok: true })
    const stock = [
      { ...inventoryItem, id: 'warehouse-a-stock', warehouseCode: 'A창고', sku: 'SAME-SKU', productName: 'A창고 재고' },
      { ...inventoryItem, id: 'warehouse-b-stock', warehouseCode: 'B창고', sku: 'SAME-SKU', productName: 'B창고 재고' },
      { ...inventoryItem, id: 'zero-stock', warehouseCode: '빈창고', sku: 'ZERO-SKU', productName: '추가 불가 재고', availableQuantity: 0 },
    ]
    render(<ChinaShipmentsBoard inventoryItems={stock} shipments={shipments} selectedShipment={shipmentA} selectedStep="items" showCreate={false} />)
    fireEvent.click(screen.getByRole('button', { name: '품목 추가' }))
    const warehouses = within(screen.getByRole('group', { name: '출고 재고 위치 선택' }))
    expect(warehouses.getAllByRole('checkbox').every((checkbox) => !(checkbox as HTMLInputElement).checked)).toBe(true)
    expect(screen.queryByText('A창고 재고')).not.toBeInTheDocument()
    expect(screen.queryByText('B창고 재고')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '선택 품목 추가' })).toBeDisabled()

    fireEvent.click(warehouses.getByRole('checkbox', { name: /A창고/ }))
    expect(screen.queryByText('B창고 재고')).not.toBeInTheDocument()
    fireEvent.change(within(screen.getByText('A창고 재고').closest('tr')!).getByLabelText('추가 출고'), { target: { value: '3' } })
    fireEvent.click(warehouses.getByRole('checkbox', { name: /B창고/ }))
    fireEvent.change(within(screen.getByText('B창고 재고').closest('tr')!).getByLabelText('추가 출고'), { target: { value: '4' } })
    fireEvent.change(screen.getByPlaceholderText('상품명, 상품코드, 옵션, 창고 검색'), { target: { value: 'B창고' } })
    expect(screen.queryByText('A창고 재고')).not.toBeInTheDocument()
    expect(within(screen.getByText('B창고 재고').closest('tr')!).getByLabelText('추가 출고')).toHaveValue(4)
    fireEvent.change(screen.getByPlaceholderText('상품명, 상품코드, 옵션, 창고 검색'), { target: { value: '' } })
    expect(within(screen.getByText('A창고 재고').closest('tr')!).getByLabelText('추가 출고')).toHaveValue(3)
    fireEvent.click(warehouses.getByRole('checkbox', { name: /B창고/ }))
    expect(screen.queryByText('B창고 재고')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '전체 선택' }))
    expect(within(screen.getByText('B창고 재고').closest('tr')!).getByLabelText('추가 출고')).toHaveValue(4)
    expect(screen.queryByText('추가 불가 재고')).not.toBeInTheDocument()
    fireEvent.click(warehouses.getByRole('checkbox', { name: /A창고/ }))
    expect(screen.queryByText('A창고 재고')).not.toBeInTheDocument()
    fireEvent.click(warehouses.getByRole('checkbox', { name: /A창고/ }))
    expect(within(screen.getByText('A창고 재고').closest('tr')!).getByLabelText('추가 출고')).toHaveValue(3)
    fireEvent.click(warehouses.getByRole('checkbox', { name: /A창고/ }))
    fireEvent.click(screen.getByRole('button', { name: '선택 품목 추가' }))
    await waitFor(() => expect(addShipmentItems).toHaveBeenCalledWith({ shipmentId: 'a', lines: [
      { inventoryId: 'warehouse-a-stock', quantity: 3 },
      { inventoryId: 'warehouse-b-stock', quantity: 4 },
    ] }))
    await waitFor(() => expect(screen.getByRole('button', { name: '품목 추가' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '품목 추가' }))
    expect(screen.queryByText('A창고 재고')).not.toBeInTheDocument()
    expect(screen.queryByText('B창고 재고')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '선택 품목 추가' })).toBeDisabled()
  })

  it('retains an additional-item draft on cancel and clears its warehouse choice only after explicit discard', () => {
    renderShipment(shipmentA, 'items')
    fireEvent.click(screen.getByRole('button', { name: '품목 추가' }))
    fireEvent.click(within(screen.getByRole('group', { name: '출고 재고 위치 선택' })).getByRole('checkbox', { name: /중국창고/ }))
    fireEvent.change(screen.getByLabelText('추가 출고'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: '추가 닫기' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '계속 작업' }))
    expect(screen.getByLabelText('추가 출고')).toHaveValue(2)
    expect(within(screen.getByRole('group', { name: '출고 재고 위치 선택' })).getByRole('checkbox', { name: /중국창고/ })).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: '추가 닫기' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '저장하지 않고 이동' }))
    fireEvent.click(screen.getByRole('button', { name: '품목 추가' }))
    expect(within(screen.getByRole('group', { name: '출고 재고 위치 선택' })).getByRole('checkbox', { name: /중국창고/ })).not.toBeChecked()
    expect(screen.queryByText('새 상품')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '선택 품목 추가' })).toBeDisabled()
  })

  it('merges selected boxes using the largest physical box as the preview', async () => {
    mergeBoxes.mockResolvedValue({ ok: true })
    const detail = makeShipmentWithBoxAndPalletStatuses()
    detail.boxes[0] = { ...detail.boxes[0]!, lengthCm: 50, widthCm: 40, heightCm: 30 }
    detail.boxes[1] = { ...detail.boxes[1]!, lengthCm: 10, widthCm: 20, heightCm: 30 }
    renderShipment(detail, 'boxes')
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
    renderShipment(makeShipmentWithCompletedBoxOnLaterPage(), 'boxes')

    const savedBoxPanel = screen.getByRole('heading', { name: '저장된 박스 현황' }).closest('section')
    if (!savedBoxPanel) throw new Error('저장된 박스 현황을 찾을 수 없습니다.')
    fireEvent.click(within(savedBoxPanel).getByRole('button', { name: '박스 11 펼치기' }))
    fireEvent.click(within(savedBoxPanel).getByRole('button', { name: '11 박스 내용 수정' }))

    expect(screen.getByRole('dialog', { name: 'SKU-11 박스분할' })).toBeInTheDocument()
    const editor = itemEditor('SKU-11')
    expect(editor.getByPlaceholderText('1')).toHaveValue('11')
    expect(editor.getByPlaceholderText('1')).toBeEnabled()
    expect(editor.getByRole('button', { name: '박스분할 저장' })).toBeEnabled()
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

  it('opens label printing in a separate tab without discarding drafts', async () => {
    renderShipment(makeShipmentWithBox(), 'boxes')
    fireEvent.click(screen.getByRole('button', { name: '박스 쉽먼트' }))
    const link = await screen.findByRole('menuitem', { name: '박스 쉽먼트 바로 인쇄' })
    expect(link).toHaveAttribute('href', '/api/purchasing/china-shipments/a/labels?type=boxes&format=print')
    expect(link).toHaveAttribute('target', '_blank')
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: '박스 A-01 펼치기' }))
    expect(screen.getByRole('link', { name: 'A-01 박스 쉽먼트 바로 인쇄' })).toHaveAttribute('href', '/api/purchasing/china-shipments/a/labels?boxId=box-1&format=print')
  })





  it('switches immediately with a clean automatically suggested box number', () => {
    renderShipment()
    expect(itemEditor('SKU-A').getByPlaceholderText('1')).toHaveValue('1')
    selectOtherShipment()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(navigate).toHaveBeenCalledWith('/purchasing/china-shipments')
    expect(saveBoxSplits).not.toHaveBeenCalled()
  })

  it('automatically numbers the first box and each added box while allowing manual changes', () => {
    renderShipment()

    const firstBoxNumber = itemEditor('SKU-A').getByPlaceholderText('1')
    expect(firstBoxNumber).toHaveValue('1')
    expect(firstBoxNumber).toHaveAttribute('inputmode', 'numeric')

    fireEvent.click(screen.getByRole('button', { name: '박스 추가' }))
    expect(screen.getAllByPlaceholderText('1')).toHaveLength(2)
    expect(screen.getAllByPlaceholderText('1')).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: '1' }),
      expect.objectContaining({ value: '2' }),
    ]))
    fireEvent.change(firstBoxNumber, { target: { value: 'CUSTOM' } })
    expect(firstBoxNumber).toHaveValue('CUSTOM')
  })

  it('does not ask when an edited box is restored to its saved state', () => {
    renderShipment()
    const boxNumber = itemEditor('SKU-A').getByPlaceholderText('1')
    fireEvent.change(boxNumber, { target: { value: '임시' } })
    fireEvent.change(boxNumber, { target: { value: '1' } })
    selectOtherShipment()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(navigate).toHaveBeenCalledWith('/purchasing/china-shipments')
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
    expect(screen.getByRole('heading', { name: '출고 A' })).toBeInTheDocument()
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
    expect(navigate).toHaveBeenCalledWith('/purchasing/china-shipments')
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
      allocations: [{ boxNo: '1', quantity: 4, autoNumber: true, lengthCm: null, widthCm: null, heightCm: null }],
    })))
    expect(screen.getByRole('heading', { name: '출고 A' })).toBeInTheDocument()
    expect(navigate).not.toHaveBeenCalled()
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: '저장하지 않고 이동' })).toBeDisabled()
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: '계속 작업' })).toBeDisabled()

    await act(async () => { finishSave({ ok: false, error: '저장 실패' }) })
    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(screen.getByRole('heading', { name: '출고 A' })).toBeInTheDocument()
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
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/purchasing/china-shipments'))
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
    expect(screen.getByRole('heading', { name: '출고 A' })).toBeInTheDocument()
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

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/purchasing/china-shipments'))
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

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/purchasing/china-shipments'))
    expect(savePalletAssignments).toHaveBeenCalledWith({ shipmentId: 'a', assignments: [{ boxNo: 'A-01', palletNo: null }] })
  })

  it('retains an unselected pallet assignment after saving a selected box', async () => {
    savePalletAssignments.mockResolvedValue({ ok: true })
    renderShipment(makeShipmentWithUnassignedBoxes(), 'pallets')
    fireEvent.change(palletAssignmentRow('BOX-01').getByPlaceholderText('예: 1'), { target: { value: 'P3' } })
    fireEvent.change(palletAssignmentRow('BOX-02').getByPlaceholderText('예: 1'), { target: { value: 'P4' } })
    fireEvent.click(screen.getByLabelText('박스 BOX-01 파렛트 배정 선택'))

    fireEvent.click(screen.getByRole('button', { name: '파렛트 배정 선택 저장' }))
    await waitFor(() => expect(savePalletAssignments).toHaveBeenCalledTimes(1))
    expect(savePalletAssignments).toHaveBeenNthCalledWith(1, { shipmentId: 'a', assignments: [{ boxNo: 'BOX-01', palletNo: 'P3' }] })
    expect(palletAssignmentRow('BOX-02').getByPlaceholderText('예: 1')).toHaveValue('P4')

    selectOtherShipment()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '저장 후 이동' }))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/purchasing/china-shipments'))
    expect(savePalletAssignments).toHaveBeenCalledTimes(2)
    expect(savePalletAssignments).toHaveBeenNthCalledWith(2, { shipmentId: 'a', assignments: [{ boxNo: 'BOX-02', palletNo: 'P4' }] })
  })

  it('keeps a failed saved-assignment row edit for retry', async () => {
    savePalletAssignments.mockResolvedValueOnce({ ok: false, error: '파렛트 배정 저장 실패' }).mockResolvedValue({ ok: true })
    renderShipment(makeShipmentWithBoxAndPalletStatuses(), 'pallets')
    expect(screen.getByLabelText('박스 BOX-01 파렛트 번호')).toHaveValue('P1')
    fireEvent.change(palletAssignmentRow('BOX-01').getByPlaceholderText('예: 1'), { target: { value: 'P3' } })

    fireEvent.click(screen.getByRole('button', { name: '박스 BOX-01 파렛트 수정' }))
    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(palletAssignmentRow('BOX-01').getByPlaceholderText('예: 1')).toHaveValue('P3')
    expect(screen.getByLabelText('박스 BOX-01 파렛트 배정 선택')).not.toBeChecked()
    expect(screen.getByLabelText('박스 BOX-01 파렛트 배정 선택')).toBeDisabled()
    await waitFor(() => expect(screen.getByRole('button', { name: '박스 BOX-01 파렛트 수정' })).toBeEnabled())
    expect(navigate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '박스 BOX-01 파렛트 수정' }))
    await waitFor(() => expect(savePalletAssignments).toHaveBeenCalledTimes(2))
    expect(savePalletAssignments).toHaveBeenLastCalledWith({ shipmentId: 'a', assignments: [{ boxNo: 'BOX-01', palletNo: 'P3' }] })
    await waitFor(() => expect(screen.getByLabelText('박스 BOX-01 파렛트 배정 선택')).not.toBeChecked())
    await waitFor(() => expect(screen.getByRole('button', { name: '박스 BOX-01 파렛트 수정' })).toBeDisabled())
    expect(screen.getByLabelText('박스 BOX-02 파렛트 번호')).toHaveValue('P2')
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

  it('applies a shared pallet number to checked boxes only before saving the batch', async () => {
    savePalletAssignments.mockResolvedValue({ ok: true })
    renderShipment(makeShipmentWithUnassignedBoxes(), 'pallets')
    const input = screen.getByLabelText('선택 박스 일괄 파렛트 번호')
    const apply = screen.getByRole('button', { name: '선택 박스에 번호 적용' })
    expect(apply).toBeDisabled()
    fireEvent.change(input, { target: { value: ' NEW-7 ' } })
    expect(apply).toBeDisabled()
    fireEvent.click(screen.getByLabelText('박스 BOX-01 파렛트 배정 선택'))
    fireEvent.click(apply)
    expect(screen.getByLabelText('박스 BOX-01 파렛트 번호')).toHaveValue('NEW-7')
    expect(screen.getByLabelText('박스 BOX-02 파렛트 번호')).toHaveValue('')
    expect(savePalletAssignments).not.toHaveBeenCalled()
    fireEvent.click(screen.getByLabelText('박스 BOX-02 파렛트 배정 선택'))
    fireEvent.click(apply)
    expect(screen.getByLabelText('박스 BOX-02 파렛트 번호')).toHaveValue('NEW-7')
    fireEvent.click(screen.getByRole('button', { name: '파렛트 배정 선택 저장' }))
    await waitFor(() => expect(savePalletAssignments).toHaveBeenCalledExactlyOnceWith({ shipmentId: 'a', assignments: [
      { boxNo: 'BOX-01', palletNo: 'NEW-7' }, { boxNo: 'BOX-02', palletNo: 'NEW-7' },
    ] }))
  })

  it('selects all displayed pallet assignments together', async () => {
    savePalletAssignments.mockResolvedValue({ ok: true })
    renderShipment(makeShipmentWithUnassignedBoxes(), 'pallets')
    fireEvent.change(palletAssignmentRow('BOX-01').getByPlaceholderText('예: 1'), { target: { value: 'P3' } })
    fireEvent.change(palletAssignmentRow('BOX-02').getByPlaceholderText('예: 1'), { target: { value: 'P4' } })

    fireEvent.click(screen.getByLabelText('표시된 파렛트 배정 전체 선택'))
    fireEvent.click(screen.getByRole('button', { name: '파렛트 배정 선택 저장' }))

    await waitFor(() => expect(savePalletAssignments).toHaveBeenCalledWith({
      shipmentId: 'a',
      assignments: [{ boxNo: 'BOX-01', palletNo: 'P3' }, { boxNo: 'BOX-02', palletNo: 'P4' }],
    }))
  })

  it('excludes saved pallet assignments from bulk selection and locks newly saved boxes immediately', async () => {
    savePalletAssignments.mockResolvedValue({ ok: true })
    renderShipment(makeShipmentWithCompletionFilters(), 'pallets')
    const savedBox = screen.getByLabelText('박스 BOX-01 파렛트 배정 선택')
    const newBox = screen.getByLabelText('박스 BOX-02 파렛트 배정 선택')
    const selectAll = screen.getByLabelText('표시된 파렛트 배정 전체 선택')
    expect(savedBox).toBeDisabled()
    expect(savedBox).not.toBeChecked()
    expect(newBox).toBeEnabled()
    fireEvent.click(savedBox)
    expect(savedBox).not.toBeChecked()
    fireEvent.click(selectAll)
    expect(selectAll).toBeChecked()
    expect(savedBox).not.toBeChecked()
    expect(newBox).toBeChecked()
    fireEvent.change(screen.getByLabelText('선택 박스 일괄 파렛트 번호'), { target: { value: 'P3' } })
    fireEvent.click(screen.getByRole('button', { name: '선택 박스에 번호 적용' }))
    expect(screen.getByLabelText('박스 BOX-01 파렛트 번호')).toHaveValue('P1')
    expect(screen.getByLabelText('박스 BOX-02 파렛트 번호')).toHaveValue('P3')
    expect(newBox).toBeEnabled()
    expect(newBox).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: '파렛트 배정 선택 저장' }))
    await waitFor(() => expect(savePalletAssignments).toHaveBeenCalledExactlyOnceWith({
      shipmentId: 'a', assignments: [{ boxNo: 'BOX-02', palletNo: 'P3' }],
    }))
    await waitFor(() => expect(newBox).toBeDisabled())
    expect(newBox).not.toBeChecked()
    expect(selectAll).toBeDisabled()
    expect(selectAll).not.toBeChecked()
    expect(screen.getByRole('button', { name: '파렛트 배정 선택 저장' })).toBeDisabled()
  })

  it('disables bulk selection when every displayed box already has a saved pallet', () => {
    renderShipment(makeShipmentWithBoxAndPalletStatuses(), 'pallets')
    expect(screen.getByLabelText('표시된 파렛트 배정 전체 선택')).toBeDisabled()
    expect(screen.getByLabelText('박스 BOX-01 파렛트 배정 선택')).toBeDisabled()
    expect(screen.getByLabelText('박스 BOX-02 파렛트 배정 선택')).toBeDisabled()
    expect(screen.getByLabelText('박스 BOX-01 파렛트 번호')).toBeEnabled()
  })

  it('saves only the edited row and preserves other unfinished saved assignments', async () => {
    savePalletAssignments.mockResolvedValue({ ok: true })
    renderShipment(makeShipmentWithBoxAndPalletStatuses(), 'pallets')
    const first = screen.getByLabelText('박스 BOX-01 파렛트 배정 선택')
    const second = screen.getByLabelText('박스 BOX-02 파렛트 배정 선택')
    expect(first).toBeDisabled()
    expect(second).toBeDisabled()
    expect(screen.getByRole('button', { name: '박스 BOX-01 파렛트 수정' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '박스 BOX-02 파렛트 수정' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('박스 BOX-01 파렛트 번호'), { target: { value: 'P3' } })
    fireEvent.change(screen.getByLabelText('박스 BOX-02 파렛트 번호'), { target: { value: 'P4' } })
    fireEvent.click(screen.getByRole('button', { name: '박스 BOX-01 파렛트 수정' }))
    await waitFor(() => expect(savePalletAssignments).toHaveBeenCalledExactlyOnceWith({
      shipmentId: 'a', assignments: [{ boxNo: 'BOX-01', palletNo: 'P3' }],
    }))
    await waitFor(() => expect(screen.getByRole('button', { name: '박스 BOX-01 파렛트 수정' })).toBeDisabled())
    expect(first).toBeDisabled()
    expect(second).toBeDisabled()
    expect(screen.getByLabelText('박스 BOX-01 파렛트 번호')).toHaveValue('P3')
    expect(screen.getByLabelText('박스 BOX-02 파렛트 번호')).toHaveValue('P4')
    expect(screen.getByRole('button', { name: '박스 BOX-02 파렛트 수정' })).toBeEnabled()
    selectOtherShipment()
    expect(screen.getByRole('dialog', { name: '저장하지 않은 내용이 있습니다' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '저장 후 이동' }))
    await waitFor(() => expect(savePalletAssignments).toHaveBeenCalledTimes(2))
    expect(savePalletAssignments).toHaveBeenLastCalledWith({ shipmentId: 'a', assignments: [{ boxNo: 'BOX-02', palletNo: 'P4' }] })
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/purchasing/china-shipments'))
  })

  it('opens saved assignments from final review with current numbers and allows removing one assignment', async () => {
    savePalletAssignments.mockResolvedValue({ ok: true })
    renderShipment(makeShipmentWithBoxAndPalletStatuses(), 'summary')
    expect(screen.queryByLabelText('박스 BOX-01 파렛트 번호')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '파렛트 배정 수정' }))
    expect(screen.getByRole('heading', { name: '3단계 · 파렛트 배정' })).toBeVisible()
    expect(screen.queryByRole('button', { name: '배정 수정 마치기' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('박스 BOX-01 파렛트 번호')).toHaveValue('P1')
    expect(screen.getByLabelText('박스 BOX-02 파렛트 번호')).toHaveValue('P2')
    fireEvent.change(screen.getByLabelText('박스 BOX-01 파렛트 번호'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: '박스 BOX-01 파렛트 수정' }))
    await waitFor(() => expect(savePalletAssignments).toHaveBeenCalledExactlyOnceWith({ shipmentId: 'a', assignments: [{ boxNo: 'BOX-01', palletNo: null }] }))
    expect(screen.getByLabelText('박스 BOX-02 파렛트 번호')).toHaveValue('P2')
    expect(navigate).not.toHaveBeenCalled()
  })

  it('keeps sealed boxes and dispatched shipments closed for saved-assignment editing', () => {
    const detail = makeShipmentWithBoxAndPalletStatuses()
    detail.boxes[0] = { ...detail.boxes[0], status: 'sealed' }
    const { unmount } = renderShipment(detail, 'pallets')
    expect(screen.getByLabelText('박스 BOX-01 파렛트 배정 선택')).toBeDisabled()
    expect(screen.getByLabelText('박스 BOX-01 파렛트 번호')).toBeDisabled()
    expect(screen.getByRole('button', { name: '박스 BOX-01 파렛트 수정' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('박스 BOX-02 파렛트 번호'), { target: { value: 'P3' } })
    expect(screen.getByRole('button', { name: '박스 BOX-02 파렛트 수정' })).toBeEnabled()
    expect(screen.getByLabelText('박스 BOX-01 파렛트 배정 선택')).not.toBeChecked()
    expect(screen.getByLabelText('박스 BOX-02 파렛트 배정 선택')).not.toBeChecked()
    unmount()
    const closed = { ...detail, shipment: { ...detail.shipment, status: 'dispatched' } }
    const { unmount: unmountClosedSummary } = renderShipment(closed, 'summary')
    expect(screen.queryByRole('button', { name: '파렛트 배정 수정' })).not.toBeInTheDocument()
    unmountClosedSummary()
    renderShipment(closed, 'pallets')
    expect(screen.queryByRole('button', { name: '저장된 배정 수정' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('박스 BOX-02 파렛트 번호')).toBeDisabled()
    expect(screen.getByRole('button', { name: '박스 BOX-02 파렛트 수정' })).toBeDisabled()
    expect(savePalletAssignments).not.toHaveBeenCalled()
  })

  it('allows bulk selection again only after an existing pallet assignment is cleared and saved', async () => {
    savePalletAssignments.mockResolvedValue({ ok: true })
    renderShipment(makeShipmentWithBox(), 'pallets')
    const checkbox = screen.getByLabelText('박스 A-01 파렛트 배정 선택')
    expect(checkbox).toBeDisabled()
    fireEvent.change(screen.getByLabelText('박스 A-01 파렛트 번호'), { target: { value: '' } })
    expect(checkbox).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '파렛트 배정 전체 저장' }))
    await waitFor(() => expect(savePalletAssignments).toHaveBeenCalledExactlyOnceWith({
      shipmentId: 'a', assignments: [{ boxNo: 'A-01', palletNo: null }],
    }))
    await waitFor(() => expect(checkbox).toBeEnabled())
    expect(screen.getByLabelText('표시된 파렛트 배정 전체 선택')).toBeEnabled()
    fireEvent.click(checkbox)
    fireEvent.change(screen.getByLabelText('선택 박스 일괄 파렛트 번호'), { target: { value: 'P2' } })
    fireEvent.click(screen.getByRole('button', { name: '선택 박스에 번호 적용' }))
    expect(screen.getByLabelText('박스 A-01 파렛트 번호')).toHaveValue('P2')
    expect(checkbox).toBeChecked()
  })

  it('uses item splitting, saved box review, pallet assignment, and final pallet review as four client-side stages', () => {
    renderShipment(makeShipmentWithBox(), 'items')
    const nav = screen.getByRole('navigation', { name: '중국출고 작업 단계' })
    expect(within(nav).getAllByRole('button')).toHaveLength(4)
    expect(screen.queryByRole('link', { name: '최종 적재리스트 엑셀 다운로드' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '적재현황 엑셀' })).toHaveAttribute('href', '/api/purchasing/china-shipments/a/export')
    expect(screen.queryByRole('heading', { name: '저장된 박스 현황' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '다음: 저장된 박스현황' }))
    expect(screen.getByRole('heading', { name: '저장된 박스 현황' })).toBeVisible()
    expect(screen.queryByRole('link', { name: '최종 적재리스트 엑셀 다운로드' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '1단계 · 출고품목·박스분할' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '다음: 파렛트 배정' }))
    expect(screen.getByRole('heading', { name: '3단계 · 파렛트 배정' })).toBeVisible()
    expect(screen.queryByRole('link', { name: '최종 적재리스트 엑셀 다운로드' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '출고완료' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '다음: 파렛트 최종 리스트' }))
    expect(screen.getByRole('heading', { name: '4단계 · 파렛트 최종 리스트' })).toBeVisible()
    expect(screen.getByRole('link', { name: '최종 적재리스트 엑셀 다운로드' })).toHaveAttribute('href', '/api/purchasing/china-shipments/a/export')
    expect(screen.queryByRole('heading', { name: '저장된 박스 현황' })).not.toBeInTheDocument()
    for (const [step, title] of [['boxes', '2단계.*저장된 박스현황'], ['pallets', '3단계.*파렛트 배정'], ['summary', '4단계.*파렛트 최종 리스트'], ['items', '1단계.*출고품목·박스분할']]) {
      const button = within(nav).getByRole('button', { name: new RegExp(title) })
      fireEvent.click(button)
      expect(button).toHaveAttribute('aria-current', 'step')
      expect(new URLSearchParams(window.location.search).get('step')).toBe(step)
    }
    expect(navigate).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
    act(() => {
      window.history.replaceState(null, '', '/purchasing/china-shipments?shipment=a&step=boxes')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(within(nav).getByRole('button', { name: /2단계.*저장된 박스현황/ })).toHaveAttribute('aria-current', 'step')
  })

  it('returns through visited stages with browser Back and Forward while retaining the list period', async () => {
    const period = 'period=custom&from=2026-09-01&to=2026-09-30'
    replaceHistoryState(null, '', `/purchasing/china-shipments?shipment=a&step=items&${period}`)
    renderShipment(makeShipmentWithBox(), 'items')
    const stages = [
      ['items', /1단계.*출고품목/],
      ['boxes', /2단계.*저장된 박스현황/],
      ['pallets', /3단계.*파렛트 배정/],
      ['summary', /4단계.*파렛트 최종 리스트/],
    ] as const

    for (const [, title] of stages.slice(1)) fireEvent.click(screen.getByRole('button', { name: title }))
    const historyLength = window.history.length
    fireEvent.click(screen.getByRole('button', { name: stages[3][1] }))
    expect(window.history.length).toBe(historyLength)

    async function travel(direction: 'back' | 'forward', index: number) {
      await act(async () => {
        await new Promise<void>((resolve) => {
          window.addEventListener('popstate', () => resolve(), { once: true })
          window.history[direction]()
        })
      })
      expect(screen.getByRole('button', { name: stages[index]![1] })).toHaveAttribute('aria-current', 'step')
      expect(window.location.pathname).toBe('/purchasing/china-shipments')
      expect(new URLSearchParams(window.location.search).get('step')).toBe(stages[index]![0])
      expect(window.location.search).toContain(period)
    }

    for (const index of [2, 1, 0]) await travel('back', index)
    for (const index of [1, 2, 3]) await travel('forward', index)
    expect(navigate).not.toHaveBeenCalled()
  })

  it('guards changing the work stage while a box draft is unsaved', () => {
    renderShipment()
    editBox()
    parkEditor()
    fireEvent.click(screen.getByRole('button', { name: /2단계.*저장된 박스현황/ }))

    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '계속 작업' }))
    expect(itemEditor('SKU-A').getByPlaceholderText('0')).toHaveValue(3)
    expect(screen.getByRole('button', { name: /1단계.*출고품목·박스분할/ })).toHaveAttribute('aria-current', 'step')
  })

  it('does not lose an invalid quantity merely because it cannot be saved yet', () => {
    renderShipment()
    editBox('2.5')
    selectOtherShipment()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '계속 작업' }))
    expect(itemEditor('SKU-A').getByPlaceholderText('0')).toHaveValue(2.5)
    expect(navigate).not.toHaveBeenCalled()
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
      boxes: [{ id: 'saved-box', shipmentId: 'a', editable: true, palletId: null, boxNo: 'SKU-01-1', status: 'open', note: null, lengthCm: null, widthCm: null, heightCm: null }],
      boxItems: [{ id: 'saved-allocation', boxId: 'saved-box', shipmentItemId: 'item-1', quantity: 10 }],
    }
    rerender(<ChinaShipmentsBoard inventoryItems={[inventoryItem]} shipments={shipments} selectedShipment={refreshed} selectedStep="items" showCreate={false} />)

    expect(screen.getByText('SKU-01')).toBeInTheDocument()
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
    rerender(<ChinaShipmentsBoard inventoryItems={[inventoryItem]} shipments={shipments} selectedShipment={refreshed} selectedStep="items" showCreate={false} />)

    const editor = itemEditor('SHARED-02')
    expect(editor.getByPlaceholderText('0')).toHaveValue(4)
    fireEvent.click(editor.getByRole('button', { name: '박스분할 저장' }))
    await waitFor(() => expect(saveBoxSplits).toHaveBeenCalledWith({
      shipmentId: 'a',
      shipmentItemId: 'shared-item-two',
      returnSavedState: true,
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
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/purchasing/china-shipments'))
    expect(saveBoxSplits.mock.calls.filter(([input]) => input.shipmentItemId === 'item-1')).toHaveLength(1)
    expect(saveBoxSplits.mock.calls.filter(([input]) => input.shipmentItemId === 'item-2')).toHaveLength(2)
  })

  it('does not add the same inventory twice after another draft fails to save', async () => {
    addShipmentItems.mockResolvedValue({ ok: true })
    updateShipment.mockResolvedValueOnce({ ok: false, error: '이름 저장 실패' }).mockResolvedValueOnce({ ok: true })
    renderShipment(shipmentA, 'items')
    fireEvent.click(screen.getByRole('button', { name: '품목 추가' }))
    fireEvent.click(within(screen.getByRole('group', { name: '출고 재고 위치 선택' })).getByRole('checkbox', { name: /중국창고/ }))
    fireEvent.change(screen.getByLabelText('추가 출고'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: '이름·날짜 수정' }))
    fireEvent.change(screen.getByLabelText('출고작업명'), { target: { value: '수정된 이름' } })
    selectOtherShipment()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '저장 후 이동' }))

    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(navigate).not.toHaveBeenCalled()
    expect(addShipmentItems).toHaveBeenCalledTimes(1)
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '저장 후 이동' }))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/purchasing/china-shipments'))
    expect(addShipmentItems).toHaveBeenCalledTimes(1)
    expect(updateShipment).toHaveBeenCalledTimes(2)
  })

  it('retains a selected workbook without applying it when leaving before review', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    try {
      renderShipment()
      const file = new File(['workbook'], '작성중.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      fireEvent.click(screen.getByRole('button', { name: '엑셀로 수정' }))
      fireEvent.change(screen.getByLabelText('엑셀 선택'), { target: { files: [file] } })
      fireEvent.click(within(screen.getByRole('dialog', { name: '작업용 엑셀 수정' })).getByRole('button', { name: '닫기' }))
      selectOtherShipment()
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '저장 후 이동' }))

      await waitFor(() => expect(toastError).toHaveBeenCalled())
      expect(fetchSpy).not.toHaveBeenCalled()
      expect(navigate).not.toHaveBeenCalled()
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '계속 작업' }))
      fireEvent.click(screen.getByRole('button', { name: '엑셀로 수정' }))
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
      fireEvent.click(screen.getByRole('button', { name: '엑셀로 수정' }))
      fireEvent.change(screen.getByLabelText('엑셀 선택'), { target: { files: [file] } })
      fireEvent.click(screen.getByRole('button', { name: '엑셀 검토' }))
      expect(await screen.findByRole('button', { name: '검토 결과 반영' })).toBeInTheDocument()

      fireEvent.click(within(screen.getByRole('dialog', { name: '작업용 엑셀 수정' })).getByRole('button', { name: '닫기' }))
      selectOtherShipment()
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '계속 작업' }))
      fireEvent.click(screen.getByRole('button', { name: '엑셀로 수정' }))
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

    fireEvent.click(screen.getByRole('button', { name: '요청 닫기' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '저장 후 이동' }))
    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(screen.getByLabelText('출고작업명')).toHaveValue('작성 중')
    expect(screen.getByRole('button', { name: '중국출고요청 만들기' })).toBeInTheDocument()
  })

  it('creates a completed new-shipment draft before closing to the list', async () => {
    createShipment.mockResolvedValue({ ok: true, shipmentId: 'created' })
    render(<ChinaShipmentsBoard inventoryItems={[inventoryItem]} shipments={shipments} selectedShipment={null} selectedStep="items" showCreate />)
    fireEvent.change(screen.getByLabelText('출고작업명'), { target: { value: '새 출고' } })
    fireEvent.change(screen.getByLabelText('도착지'), { target: { value: '인천' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /중국창고/ }))
    fireEvent.change(screen.getByLabelText('이번 출고'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: '요청 닫기' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '저장 후 이동' }))

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/purchasing/china-shipments'))
    expect(createShipment).toHaveBeenCalledWith(expect.objectContaining({ displayName: '새 출고', destinationName: '인천', lines: [{ inventoryId: 'inventory-new', quantity: 3 }] }))
    expect(createShipment).toHaveBeenCalledTimes(1)
  })

  it('keeps shipment selection disabled while an ordinary save is pending', async () => {
    let finishSave!: (result: { ok: boolean }) => void
    saveBoxSplits.mockReturnValue(new Promise((resolve) => { finishSave = resolve }))
    renderShipment()
    editBox()
    fireEvent.click(screen.getByRole('button', { name: '박스분할 저장' }))
    expect(screen.getByRole('button', { name: '목록으로' })).toBeDisabled()
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

  it('keeps workbook editing controls inside the editor dialog', () => {
    renderShipment(shipmentA, 'items')

    expect(screen.getByRole('link', { name: '작업용 엑셀' })).toBeInTheDocument()
    expect(screen.queryByLabelText('엑셀 선택')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '엑셀 검토' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '엑셀로 수정' }))
    expect(screen.getByRole('dialog', { name: '작업용 엑셀 수정' })).toBeInTheDocument()
    expect(screen.getByLabelText('엑셀 선택')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '엑셀 검토' })).toBeDisabled()
    expect(screen.queryByText('현재 박스분할·파렛트적재 내용을 내려받아 엑셀에서 수정한 뒤 다시 검토하고 반영할 수 있습니다.')).not.toBeInTheDocument()
  })

  it('keeps workbook download available after dispatch without offering edits', () => {
    renderShipment({ ...shipmentA, shipment: { ...shipmentA.shipment, status: 'dispatched' } }, 'items')

    expect(screen.getByRole('link', { name: '작업용 엑셀' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '엑셀로 수정' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('엑셀 선택')).not.toBeInTheDocument()
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
