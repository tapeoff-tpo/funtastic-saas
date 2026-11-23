import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
const { savePallet, saveLoose } = vi.hoisted(() => ({ savePallet: vi.fn(), saveLoose: vi.fn() }))
vi.mock('../saas-china-actions', () => ({ saveChinaOutboundPalletDimensionsAction: savePallet, saveChinaOutboundBoxCompletionStatusesAction: saveLoose }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
import { PalletContentsPanel } from './pallet-contents-panel'
import { ChinaWorkGuardProvider } from './unsaved-china-work'
import type { ChinaShipmentDetailView } from './china-shipments-board'
afterEach(cleanup)
it('shows loose box contents in aligned product columns and counts each physical box once', () => {
  const boxes = [{ id: 'box1', boxNo: '1', palletId: null, lengthCm: 10, widthCm: 20, heightCm: 30, grossWeightKg: 5 }] as ChinaShipmentDetailView['boxes']
  const items = [{ id: 'a', sku: '112001-0001', productName: '상품A', optionName: '블랙' }, { id: 'b', sku: '112002-0001', productName: '상품B', optionName: '화이트' }] as ChinaShipmentDetailView['items']
  render(<ChinaWorkGuardProvider><PalletContentsPanel shipmentId="s" summaries={[]} items={items} boxItems={[
    { id: 'allocation-a', boxId: 'box1', shipmentItemId: 'a', quantity: 3 },
    { id: 'allocation-b', boxId: 'box1', shipmentItemId: 'b', quantity: 4 },
  ]} unassignedBoxes={boxes} editable={false} isPending={false} initiallyExpanded /></ChinaWorkGuardProvider>)
  const table = screen.getByRole('table', { name: '박스별 적재리스트' })
  expect(within(table).getByRole('columnheader', { name: '품목코드' })).toBeInTheDocument()
  expect(within(table).getByText('상품A')).toBeInTheDocument()
  expect(within(table).getByText('상품B')).toBeInTheDocument()
  expect(within(table).getByText('3개')).toBeInTheDocument()
  expect(within(table).getByText('4개')).toBeInTheDocument()
  expect(within(table).getByText('5')).toHaveAttribute('rowspan', '2')
  expect(screen.queryByRole('button', { name: '파렛트 배정 수정' })).not.toBeInTheDocument()
})

it('confirms complete loose-box totals and exposes the spreadsheet download', () => {
  render(<ChinaWorkGuardProvider><PalletContentsPanel shipmentId="s" summaries={[]} items={[]} boxItems={[]} unassignedBoxes={[{ id: 'b', shipmentId: 's', editable: true, status: 'open', note: null, lengthCm: null, widthCm: null, heightCm: null, boxNo: '1', palletId: null, manualCbm: 0.4, grossWeightKg: 7, completionStatus: 'completed' }]} editable={false} isPending={false} /></ChinaWorkGuardProvider>)
  expect(screen.getByRole('button', { name: '낱박스' })).toHaveClass('bg-amber-100')
  fireEvent.click(screen.getByRole('button', { name: '최종 적재 확정' }))
  expect(screen.getByText('0.4000')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: '최종 합계·적재리스트 엑셀 다운로드' })).toHaveAttribute('href', '/api/purchasing/china-shipments/s/export')
})

it('updates final totals from the saved response without waiting for a page refresh', async () => {
  savePallet.mockResolvedValueOnce({ ok: true, savedPallet: { id: 'p', lengthCm: null, widthCm: null, heightCm: null, manualCbm: 0.7, tareWeightKg: 5, completionStatus: 'completed' } })
  const boxes = [{ id: 'b', shipmentId: 's', editable: true, status: 'open', note: null, lengthCm: null, widthCm: null, heightCm: null, boxNo: '1', palletId: 'p', manualCbm: 0.4, grossWeightKg: 7 }]
  render(<ChinaWorkGuardProvider><PalletContentsPanel shipmentId="s" summaries={[{ pallet: { id: 'p', palletNo: '1', note: null, tareWeightKg: 0 }, palletNo: '1', boxes, quantity: 10, cbm: 0.4, boxesWithoutDimensions: 0, products: [] }]} items={[]} boxItems={[]} editable isPending={false} /></ChinaWorkGuardProvider>)
  fireEvent.click(screen.getByRole('checkbox', { name: '파렛트 부피 0.3CBM 포함' }))
  fireEvent.click(screen.getByRole('checkbox', { name: '파렛트 무게 5kg 포함' }))
  fireEvent.click(screen.getByRole('button', { name: '최종 저장하기' }))
  await waitFor(() => expect(screen.getByRole('button', { name: '수정하기' })).toBeInTheDocument())
  fireEvent.click(screen.getByRole('button', { name: '최종 적재 확정' }))
  expect(screen.getByText('0.7000')).toBeInTheDocument()
  expect(screen.getByText('12 kg')).toBeInTheDocument()
})

it('turns the loose-box section yellow only after its save succeeds', async () => {
  let finish!: (result: { ok: true }) => void
  saveLoose.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  const boxes: ChinaShipmentDetailView['boxes'] = [{ id: 'b', shipmentId: 's', editable: true, status: 'open', note: null, lengthCm: null, widthCm: null, heightCm: null, boxNo: '1', palletId: null, manualCbm: 0.4, grossWeightKg: 7, completionStatus: 'in_progress' }]
  const view = render(<ChinaWorkGuardProvider><PalletContentsPanel shipmentId="s" summaries={[]} items={[]} boxItems={[]} unassignedBoxes={boxes} editable isPending={false} /></ChinaWorkGuardProvider>)
  expect(screen.getByRole('article', { name: '낱박스 적재' })).toHaveClass('bg-background')
  fireEvent.click(screen.getByRole('button', { name: '낱박스 확정하기' }))
  expect(screen.getByRole('article', { name: '낱박스 적재' })).not.toHaveClass('bg-amber-50')
  finish({ ok: true })
  await waitFor(() => expect(screen.getByRole('article', { name: '낱박스 적재' })).toHaveClass('bg-amber-50', 'border-amber-300'))
  expect(screen.getByRole('button', { name: '수정하기' })).toBeInTheDocument()
  view.rerender(<ChinaWorkGuardProvider><PalletContentsPanel shipmentId="s" summaries={[]} items={[]} boxItems={[]} unassignedBoxes={boxes.map((box) => ({ ...box, manualCbm: 0.5 }))} editable isPending={false} /></ChinaWorkGuardProvider>)
  expect(screen.getByRole('article', { name: '낱박스 적재' })).toHaveClass('bg-background')
})
