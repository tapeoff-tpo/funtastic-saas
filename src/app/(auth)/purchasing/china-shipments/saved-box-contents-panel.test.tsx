import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChinaShipmentDetailView, SavedBoxSummary } from './china-shipments-board'
import { SavedBoxContentsPanel } from './saved-box-contents-panel'
import { ChinaWorkGuardProvider } from './unsaved-china-work'

const { saveDimensions, saveWeight, saveBulk, merge, refresh, toastError } = vi.hoisted(() => ({ saveDimensions: vi.fn(), saveWeight: vi.fn(), saveBulk: vi.fn(), merge: vi.fn(), refresh: vi.fn(), toastError: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: toastError } }))
vi.mock('../saas-china-actions', () => ({ saveChinaOutboundBoxDimensionsAction: saveDimensions, saveChinaOutboundPackageWeightAction: saveWeight, saveChinaOutboundBoxesMeasurementsAction: saveBulk, mergeChinaOutboundBoxesAction: merge }))

function item(id: string, sku = 'SKU-A', optionName = '대형'): ChinaShipmentDetailView['items'][number] {
  return { id, sku, productName: '컵', optionName, inventoryId: id, warehouseCode: '중국', reservedQuantity: 50, packedQuantity: 20, dispatchedQuantity: 0, boxSplitStatus: 'in_progress' }
}
function box(id: string, items = [{ item: item('one'), quantity: 10 }]): SavedBoxSummary {
  return { box: { id, boxNo: id, shipmentId: 'shipment', editable: true, palletId: null, status: 'open', note: null, lengthCm: 10, widthCm: 20, heightCm: 30, grossWeightKg: 5 }, items, palletNo: null, quantity: items.reduce((sum, entry) => sum + entry.quantity, 0) }
}
const mixedBox = (id: string) => box(id, [{ item: item('one'), quantity: 3 }, { item: item('two', 'SKU-B'), quantity: 4 }])
function renderPanel(summaries: SavedBoxSummary[], props: Partial<Parameters<typeof SavedBoxContentsPanel>[0]> = {}) {
  return render(<ChinaWorkGuardProvider><SavedBoxContentsPanel shipmentId="shipment" summaries={summaries} filter="saved" editable isPending={false} onFilterChange={vi.fn()} {...props} /></ChinaWorkGuardProvider>)
}

beforeEach(() => {
  vi.clearAllMocks()
  saveDimensions.mockResolvedValue({ ok: true })
  saveWeight.mockResolvedValue({ ok: true })
  saveBulk.mockResolvedValue({ ok: true })
})

describe('saved box list', () => {
  it('lists single and mixed boxes in natural box-number order without product groups', () => {
    const summaries = [box('10'), box('3'), mixedBox('2'), box('1')]
    renderPanel(summaries)
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1)
    expect(rows.map((row) => row.getAttribute('aria-label'))).toEqual(['박스 1', '박스 2', '박스 3', '박스 10'])
    expect(within(rows[1]).getByText('혼합박스')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '동일 상품 박스' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '혼합박스' })).not.toBeInTheDocument()
    expect(screen.queryByText('선택 박스 일괄 저장')).not.toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: '관리' })).not.toBeInTheDocument()
    expect(summaries.map((summary) => summary.box.boxNo)).toEqual(['10', '3', '2', '1'])
  })

  it('saves row dimensions and weight atomically from the rightmost save button', async () => {
    renderPanel([mixedBox('2')])
    fireEvent.change(screen.getByRole('spinbutton', { name: '박스 2 가로(cm)' }), { target: { value: '50.5' } })
    fireEvent.change(screen.getByRole('spinbutton', { name: '박스 2 총중량(kg)' }), { target: { value: '12.5' } })
    fireEvent.click(screen.getByRole('button', { name: '박스 2 저장하기' }))
    await waitFor(() => expect(saveBulk).toHaveBeenCalledWith({ shipmentId: 'shipment', boxIds: ['2'], lengthCm: 50.5, widthCm: 20, heightCm: 30, manualCbm: null, grossWeightKg: 12.5 }))
    await waitFor(() => expect(screen.getByRole('button', { name: '박스 2 저장하기' })).toBeDisabled())
    expect(saveDimensions).not.toHaveBeenCalled()
    expect(saveWeight).not.toHaveBeenCalled()
  })
})

it('shows boxed inputs, cancels edits with Escape and keeps save in the last cell', () => {
  renderPanel([box('1')])
  expect(screen.getAllByRole('spinbutton')).toHaveLength(4)
  const input = screen.getByRole('spinbutton', { name: '박스 1 세로(cm)' })
  fireEvent.change(input, { target: { value: '99' } })
  fireEvent.keyDown(input, { key: 'Escape' })
  expect(input).toHaveValue(20)
  expect(saveBulk).not.toHaveBeenCalled()
  const row = screen.getByRole('row', { name: '박스 1' })
  expect(within(row.lastElementChild as HTMLElement).getByRole('button', { name: '박스 1 저장하기' })).toBeDisabled()
})

it('selects merge boxes beside their numbers and confirms only those boxes', async () => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true }
  HTMLDialogElement.prototype.close = function () { this.open = false }
  merge.mockResolvedValue({ ok: true })
  renderPanel([box('1'), box('2'), box('3')])
  fireEvent.click(screen.getByRole('checkbox', { name: '박스 1 합치기 선택' }))
  fireEvent.click(screen.getByRole('checkbox', { name: '박스 3 합치기 선택' }))
  fireEvent.click(screen.getByRole('button', { name: '선택 박스 합치기 (2)' }))
  fireEvent.click(screen.getByRole('button', { name: '합치기 확인' }))
  await waitFor(() => expect(merge).toHaveBeenCalledWith({ shipmentId: 'shipment', boxIds: ['1', '3'] }))
})
