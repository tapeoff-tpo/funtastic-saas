import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'
const { save } = vi.hoisted(() => ({ save: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('../saas-china-actions', () => ({ saveChinaOutboundPalletDimensionsAction: save }))
import { PalletFinalMeasurements } from './pallet-final-measurements'
import { ChinaWorkGuardProvider } from './unsaved-china-work'
import type { PalletSummary } from './china-shipments-board'
afterEach(() => { cleanup(); vi.clearAllMocks() })
it('adds volume and weight independently and persists both in one save without accumulating repeatedly', async () => {
  save.mockResolvedValue({ ok: true })
  const summary = { pallet: { id: 'p', palletNo: '1', manualCbm: null, tareWeightKg: 0 }, palletNo: '1', cbm: 1.2,
    boxes: [{ id: 'b', grossWeightKg: 10 }], quantity: 20, boxesWithoutDimensions: 0 } as PalletSummary
  render(<ChinaWorkGuardProvider><PalletFinalMeasurements shipmentId="s" summary={summary} editable isPending={false} /></ChinaWorkGuardProvider>)
  fireEvent.click(screen.getByRole('checkbox', { name: '파렛트 부피 0.3CBM 포함' }))
  expect(screen.getByLabelText('파렛트 1 최종 CBM')).toHaveValue(1.5)
  expect(save).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('checkbox', { name: '파렛트 무게 5kg 포함' }))
  fireEvent.click(screen.getByRole('button', { name: '최종 저장하기' }))
  await waitFor(() => expect(save).toHaveBeenCalledWith({ shipmentId: 's', palletId: 'p', lengthCm: null, widthCm: null, heightCm: null, manualCbm: 1.5, tareWeightKg: 5, finalize: true }))
  await waitFor(() => expect(screen.getByText('최종 무게: 15 kg')).toBeInTheDocument())
  expect(screen.getByText('최종 확정 · 수정 가능')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('checkbox', { name: '파렛트 부피 0.3CBM 포함' }))
  expect(screen.queryByText('최종 확정 · 수정 가능')).not.toBeInTheDocument()
  expect(screen.getByLabelText('파렛트 1 최종 CBM')).toHaveValue(1.2)
})

it('includes unmeasured boxes through whole-pallet dimensions and saves all three sides', async () => {
  save.mockResolvedValue({ ok: true })
  const summary = { pallet: { id: 'p', palletNo: '1', manualCbm: null, tareWeightKg: 0 }, palletNo: '1', cbm: 1.2,
    boxes: [{ id: 'b', grossWeightKg: 10 }], quantity: 20, boxesWithoutDimensions: 10 } as PalletSummary
  render(<ChinaWorkGuardProvider><PalletFinalMeasurements shipmentId="s" summary={summary} editable isPending={false} /></ChinaWorkGuardProvider>)
  for (const [name, value] of [['가로', '120'], ['세로', '100'], ['높이', '150']]) fireEvent.change(screen.getByLabelText(`파렛트 1 ${name}`), { target: { value } })
  expect(screen.getByRole('checkbox', { name: '적재 CBM 사용' })).not.toBeChecked()
  expect(screen.getByLabelText('파렛트 1 최종 CBM')).toHaveValue(1.8)
  fireEvent.click(screen.getByRole('checkbox', { name: '파렛트 부피 0.3CBM 포함' }))
  fireEvent.click(screen.getByRole('button', { name: '최종 저장하기' }))
  await waitFor(() => expect(save).toHaveBeenCalledWith({ shipmentId: 's', palletId: 'p', lengthCm: 120, widthCm: 100, heightCm: 150, manualCbm: 2.1, tareWeightKg: 0, finalize: true }))
})

it('confirms the current loaded CBM even when ten boxes have no dimensions', async () => {
  save.mockResolvedValue({ ok: true })
  const summary = { pallet: { id: 'p', palletNo: '1', manualCbm: null, tareWeightKg: 0 }, palletNo: '1', cbm: 1.2,
    boxes: [{ id: 'b', grossWeightKg: 10 }], quantity: 20, boxesWithoutDimensions: 10 } as PalletSummary
  render(<ChinaWorkGuardProvider><PalletFinalMeasurements shipmentId="s" summary={summary} editable isPending={false} /></ChinaWorkGuardProvider>)
  expect(screen.queryByText(/규격 없는/)).not.toBeInTheDocument()
  expect(screen.getByRole('checkbox', { name: '적재 CBM 사용' })).toBeChecked()
  fireEvent.click(screen.getByRole('button', { name: '최종 저장하기' }))
  await waitFor(() => expect(save).toHaveBeenCalledWith({ shipmentId: 's', palletId: 'p', lengthCm: null, widthCm: null, heightCm: null, manualCbm: 1.2, tareWeightKg: 0, finalize: true }))
  expect(screen.getByText('최종 확정 · 수정 가능')).toBeInTheDocument()
})
