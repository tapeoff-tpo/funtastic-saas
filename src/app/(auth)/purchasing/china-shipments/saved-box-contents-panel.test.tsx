import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChinaShipmentDetailView, SavedBoxSummary } from './china-shipments-board'
import { SavedBoxContentsPanel } from './saved-box-contents-panel'
import { ChinaWorkGuardProvider, useChinaWorkGuard } from './unsaved-china-work'

const { saveDimensions, saveWeight, saveBulk, refresh, toastError } = vi.hoisted(() => ({ saveDimensions: vi.fn(), saveWeight: vi.fn(), saveBulk: vi.fn(), refresh: vi.fn(), toastError: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: toastError } }))
vi.mock('../saas-china-actions', () => ({ saveChinaOutboundBoxDimensionsAction: saveDimensions, saveChinaOutboundPackageWeightAction: saveWeight, saveChinaOutboundBoxesMeasurementsAction: saveBulk }))

function item(id: string, sku = 'SKU-A', optionName = '대형'): ChinaShipmentDetailView['items'][number] {
  return { id, sku, productName: '컵', optionName, inventoryId: id, warehouseCode: '중국', reservedQuantity: 50, packedQuantity: 20, dispatchedQuantity: 0, boxSplitStatus: 'in_progress' }
}
function box(id: string, items = [{ item: item('one'), quantity: 10 }]): SavedBoxSummary {
  return { box: { id, boxNo: id, shipmentId: 'shipment', editable: true, palletId: null, status: 'open', note: null, lengthCm: 10, widthCm: 20, heightCm: 30, grossWeightKg: 5 }, items, palletNo: null, quantity: items.reduce((sum, entry) => sum + entry.quantity, 0) }
}
const mixedBox = (id: string) => box(id, [{ item: item('one'), quantity: 3 }, { item: item('two', 'SKU-B'), quantity: 4 }])
function renderPanel(summaries: SavedBoxSummary[], props: Partial<Parameters<typeof SavedBoxContentsPanel>[0]> = {}) {
  return render(<ChinaWorkGuardProvider><SavedBoxContentsPanel shipmentId="shipment" summaries={summaries} filter="saved" editable isPending={false} onFilterChange={vi.fn()} onEditItem={vi.fn()} {...props} /></ChinaWorkGuardProvider>)
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
    expect(screen.getByRole('button', { name: '전체 펼치기' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { expanded: false })).toHaveLength(4)
    expect(summaries.map((summary) => summary.box.boxNo)).toEqual(['10', '3', '2', '1'])
  })

  it('shows every box immediately and preserves labels, counts and item editing', () => {
    const onEditItem = vi.fn()
    renderPanel([box('1'), box('2')], { onEditItem })
    expect(screen.getAllByRole('link')).toHaveLength(4)
    expect(screen.getByRole('link', { name: '1 박스 쉽먼트 바로 인쇄' })).toBeVisible()
    expect(screen.getByRole('link', { name: '2 박스 부착용 쉽먼트 다운로드' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '전체 펼치기' }))
    expect(screen.getByRole('link', { name: '1 박스 쉽먼트 바로 인쇄' })).toHaveAttribute('href', '/api/purchasing/china-shipments/shipment/labels?boxId=1&format=print')
    expect(screen.getByRole('link', { name: '2 박스 부착용 쉽먼트 다운로드' })).toHaveAttribute('href', '/api/purchasing/china-shipments/shipment/labels?boxId=2')
    expect(within(screen.getByRole('row', { name: '박스 2' })).getByRole('cell', { name: '10개' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '2 박스 내용 수정' }))
    expect(onEditItem).toHaveBeenCalledWith('one')
  })

  it('keeps every mixed product editable and does not label duplicate same-SKU allocations as mixed', () => {
    const onEditItem = vi.fn()
    renderPanel([mixedBox('2'), box('1', [{ item: item('one'), quantity: 3 }, { item: item('same-sku'), quantity: 4 }])], { onEditItem })
    fireEvent.click(screen.getByRole('button', { name: '박스 2 펼치기' }))
    const mixed = within(screen.getByRole('row', { name: '박스 2' }))
    expect(mixed.getByRole('cell', { name: '7개' })).toBeInTheDocument()
    fireEvent.click(mixed.getByRole('button', { name: '2 박스 SKU-B 내용 수정' }))
    expect(onEditItem).toHaveBeenCalledWith('two')
    expect(within(screen.getByRole('row', { name: '박스 1' })).queryByText('혼합박스')).not.toBeInTheDocument()
  })

  it('keeps empty boxes available under the all filter and prevents editing sealed boxes', () => {
    const sealed = box('2')
    sealed.box.status = 'sealed'
    const empty = box('1', [])
    const { unmount } = renderPanel([sealed, empty])
    expect(screen.queryByRole('row', { name: '박스 1' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '박스 2 펼치기' }))
    expect(within(screen.getByRole('row', { name: '박스 2' })).queryByRole('spinbutton')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '2 박스 내용 수정' })).not.toBeInTheDocument()
    unmount()
    renderPanel([sealed, empty], { filter: 'all' })
    expect(screen.getByRole('row', { name: '박스 1' })).toHaveTextContent('내용 없음')
    expect(screen.queryByRole('link', { name: '1 박스 부착용 쉽먼트 다운로드' })).not.toBeInTheDocument()
  })

  it('saves the actual box dimensions and total weight without sending allocation or quantity edits', async () => {
    renderPanel([mixedBox('2')])
    fireEvent.click(screen.getByRole('button', { name: '박스 2 펼치기' }))
    fireEvent.change(screen.getByRole('spinbutton', { name: '박스 2 가로(cm)' }), { target: { value: '50.5' } })
    fireEvent.click(screen.getByRole('button', { name: '박스 2 규격 저장' }))
    await waitFor(() => expect(saveDimensions).toHaveBeenCalledWith({ shipmentId: 'shipment', boxId: '2', lengthCm: 50.5, widthCm: 20, heightCm: 30 }))
    await waitFor(() => expect(screen.getByRole('button', { name: '박스 2 규격 저장' })).toBeDisabled())
    fireEvent.change(screen.getByRole('spinbutton', { name: '박스 2 총중량(kg)' }), { target: { value: '12.5' } })
    fireEvent.click(screen.getByRole('button', { name: '중량 저장' }))
    await waitFor(() => expect(saveWeight).toHaveBeenCalledWith({ shipmentId: 'shipment', packageId: '2', kind: 'box', grossWeightKg: 12.5 }))
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('retains dimension edits after a failed save and protects them during navigation', async () => {
    saveDimensions.mockResolvedValueOnce({ ok: false, error: '저장 실패' })
    const navigate = vi.fn()
    function NextStage() {
      const guard = useChinaWorkGuard()
      return <button onClick={() => guard.requestNavigation(navigate)}>다음 단계</button>
    }
    render(<ChinaWorkGuardProvider><SavedBoxContentsPanel shipmentId="shipment" summaries={[box('1')]} filter="saved" editable isPending={false} onFilterChange={vi.fn()} onEditItem={vi.fn()} /><NextStage /></ChinaWorkGuardProvider>)
    fireEvent.click(screen.getByRole('button', { name: '박스 1 펼치기' }))
    fireEvent.change(screen.getByRole('spinbutton', { name: '박스 1 가로(cm)' }), { target: { value: '45' } })
    fireEvent.click(screen.getByRole('button', { name: '박스 1 접기' }))
    expect(screen.queryByRole('spinbutton', { name: '박스 1 가로(cm)' })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '박스 1 펼치기' }))
    expect(screen.getByRole('spinbutton', { name: '박스 1 가로(cm)' })).toHaveValue(45)
    fireEvent.click(screen.getByRole('button', { name: '박스 1 규격 저장' }))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('저장 실패'))
    expect(screen.getByRole('spinbutton', { name: '박스 1 가로(cm)' })).toHaveValue(45)
    fireEvent.click(screen.getByRole('button', { name: '다음 단계' }))
    expect(screen.getByRole('dialog', { name: '저장하지 않은 내용이 있습니다' })).toBeInTheDocument()
    expect(navigate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '저장 후 이동' }))
    await waitFor(() => expect(navigate).toHaveBeenCalledOnce())
    expect(saveDimensions).toHaveBeenCalledTimes(2)
    expect(saveDimensions).toHaveBeenLastCalledWith({ shipmentId: 'shipment', boxId: '1', lengthCm: 45, widthCm: 20, heightCm: 30 })
  })

  it('saves CBM without inventing dimensions or weight and keeps a failed manual entry for retry', async () => {
    const unmeasured = box('1')
    Object.assign(unmeasured.box, { lengthCm: null, widthCm: null, heightCm: null, grossWeightKg: null })
    saveDimensions.mockResolvedValueOnce({ ok: false, error: '저장 실패' })
    renderPanel([unmeasured])
    fireEvent.click(screen.getByRole('button', { name: '박스 1 펼치기' }))
    const cbmInput = screen.getByRole('spinbutton', { name: '박스 1 CBM(직접 입력)' })
    fireEvent.change(cbmInput, { target: { value: '0.123456' } })
    fireEvent.click(screen.getByRole('button', { name: '박스 1 규격 저장' }))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('저장 실패'))
    expect(cbmInput).toHaveValue(0.123456)
    expect(screen.getByRole('spinbutton', { name: '박스 1 가로(cm)' })).toHaveValue(null)
    expect(screen.getByRole('spinbutton', { name: '박스 1 총중량(kg)' })).toHaveValue(null)
    fireEvent.click(screen.getByRole('button', { name: '박스 1 규격 저장' }))
    await waitFor(() => expect(saveDimensions).toHaveBeenCalledTimes(2))
    expect(saveDimensions).toHaveBeenLastCalledWith({ shipmentId: 'shipment', boxId: '1', lengthCm: null, widthCm: null, heightCm: null, manualCbm: 0.123456 })
    expect(saveWeight).not.toHaveBeenCalled()
  })

  it('clears a saved manual CBM override to return to the measured dimensions', async () => {
    const measured = box('1')
    measured.box.manualCbm = 0.04
    renderPanel([measured])
    fireEvent.click(screen.getByRole('button', { name: '박스 1 펼치기' }))
    const cbmInput = screen.getByRole('spinbutton', { name: '박스 1 CBM(직접 입력)' })
    expect(cbmInput).toHaveValue(0.04)
    expect(cbmInput).toHaveAttribute('placeholder', '0.0060')
    fireEvent.change(cbmInput, { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: '박스 1 규격 저장' }))
    await waitFor(() => expect(saveDimensions).toHaveBeenCalledExactlyOnceWith({ shipmentId: 'shipment', boxId: '1', lengthCm: 10, widthCm: 20, heightCm: 30, manualCbm: null }))
  })

  it('applies dimensions to selected editable boxes in one request and omits a blank weight', async () => {
    const sealed = box('3'); sealed.box.status = 'sealed'
    const locked = box('4'); locked.box.editable = false
    renderPanel([box('1'), mixedBox('2'), sealed, locked])
    expect(screen.getByRole('checkbox', { name: '박스 3 선택' })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: '박스 4 선택' })).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: '수정 가능한 박스 전체 선택' }))
    for (const [label, value] of [['가로(cm)', '40'], ['세로(cm)', '50'], ['높이(cm)', '60']]) {
      fireEvent.change(screen.getByRole('spinbutton', { name: `일괄 ${label}` }), { target: { value } })
    }
    fireEvent.click(screen.getByRole('button', { name: '선택 박스 일괄 저장' }))
    await waitFor(() => expect(saveBulk).toHaveBeenCalledExactlyOnceWith({ shipmentId: 'shipment', boxIds: ['1', '2'], lengthCm: 40, widthCm: 50, heightCm: 60 }))
    await waitFor(() => expect(screen.getByRole('checkbox', { name: '박스 1 선택' })).not.toBeChecked())
    expect(saveDimensions).not.toHaveBeenCalled()
    expect(saveWeight).not.toHaveBeenCalled()
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('keeps selections and weight after a failed bulk save and preserves dimensions in a weight-only request', async () => {
    saveBulk.mockResolvedValueOnce({ ok: false, error: '일괄 저장 실패' })
    renderPanel([box('1'), box('2')])
    fireEvent.click(screen.getByRole('checkbox', { name: '박스 2 선택' }))
    fireEvent.change(screen.getByRole('spinbutton', { name: '일괄 총중량(kg)' }), { target: { value: '7.5' } })
    fireEvent.click(screen.getByRole('button', { name: '선택 박스 일괄 저장' }))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('일괄 저장 실패'))
    expect(screen.getByRole('checkbox', { name: '박스 2 선택' })).toBeChecked()
    expect(screen.getByRole('spinbutton', { name: '일괄 총중량(kg)' })).toHaveValue(7.5)
    fireEvent.click(screen.getByRole('button', { name: '선택 박스 일괄 저장' }))
    await waitFor(() => expect(saveBulk).toHaveBeenCalledTimes(2))
    expect(saveBulk).toHaveBeenLastCalledWith({ shipmentId: 'shipment', boxIds: ['2'], grossWeightKg: 7.5 })
  })

  it('applies manual CBM alone to selected boxes and leaves omitted measurements unchanged', async () => {
    renderPanel([box('1'), box('2')])
    fireEvent.click(screen.getByRole('checkbox', { name: '박스 2 선택' }))
    fireEvent.change(screen.getByRole('spinbutton', { name: '일괄 CBM(직접 입력)' }), { target: { value: '0.02' } })
    fireEvent.click(screen.getByRole('button', { name: '선택 박스 일괄 저장' }))
    await waitFor(() => expect(saveBulk).toHaveBeenCalledExactlyOnceWith({ shipmentId: 'shipment', boxIds: ['2'], manualCbm: 0.02 }))
    expect(saveDimensions).not.toHaveBeenCalled()
    expect(saveWeight).not.toHaveBeenCalled()
  })

  it('rejects partial bulk dimensions and protects unsaved individual measurements from bulk overwrite', async () => {
    renderPanel([box('1')])
    fireEvent.click(screen.getByRole('checkbox', { name: '박스 1 선택' }))
    fireEvent.change(screen.getByRole('spinbutton', { name: '일괄 가로(cm)' }), { target: { value: '40' } })
    fireEvent.click(screen.getByRole('button', { name: '선택 박스 일괄 저장' }))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('일괄 적용할 가로·세로·높이를 모두 입력해주세요.'))
    expect(saveBulk).not.toHaveBeenCalled()
    fireEvent.change(screen.getByRole('spinbutton', { name: '일괄 가로(cm)' }), { target: { value: '' } })
    fireEvent.change(screen.getByRole('spinbutton', { name: '일괄 총중량(kg)' }), { target: { value: '7' } })
    fireEvent.click(screen.getByRole('button', { name: '박스 1 펼치기' }))
    fireEvent.change(screen.getByRole('spinbutton', { name: '박스 1 가로(cm)' }), { target: { value: '30' } })
    fireEvent.click(screen.getByRole('button', { name: '박스 1 접기' }))
    fireEvent.click(screen.getByRole('button', { name: '선택 박스 일괄 저장' }))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('선택한 박스의 개별 수정 내용을 먼저 저장해주세요.'))
    expect(saveBulk).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '박스 1 펼치기' }))
    expect(screen.getByRole('spinbutton', { name: '박스 1 가로(cm)' })).toHaveValue(30)
    fireEvent.click(screen.getByRole('button', { name: '전체 박스 1' }))
    fireEvent.click(screen.getByRole('button', { name: '저장 후 이동' }))
    await waitFor(() => expect(saveBulk).toHaveBeenCalledOnce())
    expect(saveDimensions).toHaveBeenCalledWith({ shipmentId: 'shipment', boxId: '1', lengthCm: 30, widthCm: 20, heightCm: 30 })
    expect(saveDimensions.mock.invocationCallOrder[0]).toBeLessThan(saveBulk.mock.invocationCallOrder[0])
    expect(saveBulk).toHaveBeenCalledWith({ shipmentId: 'shipment', boxIds: ['1'], grossWeightKg: 7 })
  })
})
