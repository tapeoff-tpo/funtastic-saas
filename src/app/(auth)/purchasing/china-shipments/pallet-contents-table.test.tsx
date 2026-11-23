import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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
  expect(screen.getByRole('button', { name: '낱박스' })).toHaveClass('bg-blue-700')
  fireEvent.click(screen.getByRole('button', { name: '최종 적재 확정' }))
  expect(screen.getByText('0.4000')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: '최종 합계·적재리스트 엑셀 다운로드' })).toHaveAttribute('href', '/api/purchasing/china-shipments/s/export')
})
