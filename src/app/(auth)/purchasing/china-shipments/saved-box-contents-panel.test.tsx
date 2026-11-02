import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ChinaShipmentDetailView, SavedBoxSummary } from './china-shipments-board'
import { groupSavedBoxes, SavedBoxContentsPanel } from './saved-box-contents-panel'

function item(id: string, sku = 'SKU-A', optionName = '대형'): ChinaShipmentDetailView['items'][number] {
  return { id, sku, productName: '컵', optionName, inventoryId: id, warehouseCode: '중국', reservedQuantity: 50, packedQuantity: 20, dispatchedQuantity: 0, boxSplitStatus: 'in_progress' }
}
function box(id: string, items = [{ item: item('one'), quantity: 10 }]): SavedBoxSummary {
  return { box: { id, boxNo: id, shipmentId: 'shipment', editable: true, palletId: null, status: 'open', note: null, lengthCm: 10, widthCm: 10, heightCm: 10 }, items, palletNo: null, quantity: items.reduce((sum, entry) => sum + entry.quantity, 0) }
}

describe('saved box groups', () => {
  it('groups the same SKU/option across source rows and keeps other options separate', () => {
    const first = box('1')
    const second = box('2', [{ item: item('another-source'), quantity: 20 }])
    const third = box('3', [{ item: item('small', 'SKU-A', '소형'), quantity: 5 }])
    const grouped = groupSavedBoxes([first, second, third])
    expect(grouped.products.map((group) => group.boxes.map((summary) => summary.box.id))).toEqual([['1', '2'], ['3']])
    expect([first.quantity, second.quantity, third.quantity]).toEqual([10, 20, 5])
  })
  it('puts each physical mixed box only in the mixed list and handles duplicate allocations for a single SKU', () => {
    const mixed = box('mixed', [{ item: item('one'), quantity: 3 }, { item: item('two', 'SKU-B'), quantity: 4 }])
    const single = box('single', [{ item: item('one'), quantity: 3 }, { item: item('same-sku'), quantity: 4 }])
    const empty = box('empty', [])
    const grouped = groupSavedBoxes([mixed, single, empty])
    expect(grouped.mixed).toEqual([mixed])
    expect(grouped.products[0].boxes).toEqual([single])
    expect(grouped.other).toEqual([empty])
  })
  it('starts collapsed, expands the selected product and retains original labels/box quantities', () => {
    const onEditItem = vi.fn()
    render(<SavedBoxContentsPanel shipmentId="shipment" summaries={[box('1'), box('2')]} filter="saved" editable isPending={false} onFilterChange={vi.fn()} onEditItem={onEditItem} />)
    const toggle = screen.getByRole('button', { expanded: false, name: /SKU-A/ })
    expect(toggle).toHaveTextContent('2박스 · 20개')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const link = screen.getByRole('link', { name: '1 박스 쉽먼트 바로 인쇄' })
    expect(link).toHaveAttribute('href', '/api/purchasing/china-shipments/shipment/labels?boxId=1&format=print')
    fireEvent.click(screen.getByRole('button', { name: '2 박스 내용 수정' }))
    expect(onEditItem).toHaveBeenCalledWith('one')
    fireEvent.click(toggle)
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
  it('exposes every mixed-box product for editing rather than always selecting the first one', () => {
    const onEditItem = vi.fn()
    render(<SavedBoxContentsPanel shipmentId="shipment" summaries={[box('mix', [{ item: item('one'), quantity: 3 }, { item: item('two', 'SKU-B'), quantity: 4 }])]} filter="saved" editable isPending={false} onFilterChange={vi.fn()} onEditItem={onEditItem} />)
    const mixed = within(screen.getByRole('region', { name: '혼합박스' }))
    expect(mixed.getByText('7개')).toBeInTheDocument()
    fireEvent.click(mixed.getByRole('button', { name: 'mix 박스 SKU-B 내용 수정' }))
    expect(onEditItem).toHaveBeenCalledWith('two')
    expect(screen.queryByRole('region', { name: '동일 상품 박스' })).not.toBeInTheDocument()
  })
  it('expands and collapses all product groups without changing or hiding the mixed boxes', () => {
    render(<SavedBoxContentsPanel shipmentId="shipment" summaries={[box('1'), box('2', [{ item: item('two', 'SKU-B'), quantity: 4 }]), box('mix', [{ item: item('one'), quantity: 2 }, { item: item('two', 'SKU-B'), quantity: 3 }])]} filter="saved" editable isPending={false} onFilterChange={vi.fn()} onEditItem={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '전체 펼치기' }))
    expect(screen.getAllByRole('table')).toHaveLength(3)
    fireEvent.click(screen.getByRole('button', { name: '전체 접기' }))
    expect(screen.getAllByRole('table')).toHaveLength(1)
    expect(screen.getByRole('region', { name: '혼합박스' })).toHaveTextContent('mix')
  })
})
