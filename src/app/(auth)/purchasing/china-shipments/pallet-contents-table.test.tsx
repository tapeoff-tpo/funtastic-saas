import { expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
import { PalletContentsPanel } from './pallet-contents-panel'
import { ChinaWorkGuardProvider } from './unsaved-china-work'
import type { ChinaShipmentDetailView } from './china-shipments-board'
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
