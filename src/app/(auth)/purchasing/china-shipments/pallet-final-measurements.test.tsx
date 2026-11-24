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
  await waitFor(() => expect(save).toHaveBeenCalledWith({ shipmentId: 's', palletId: 'p', lengthCm: null, widthCm: null, heightCm: null, manualCbm: 1.5, tareWeightKg: 5, finalize: true, refresh: false }))
  await waitFor(() => expect(screen.getByText('최종 무게: 15 kg')).toBeInTheDocument())
  expect(screen.getByText('최종 확정')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '수정하기' }))
  fireEvent.click(screen.getByRole('checkbox', { name: '파렛트 부피 0.3CBM 포함' }))
  expect(screen.queryByText('최종 확정')).not.toBeInTheDocument()
  expect(screen.getByLabelText('파렛트 1 최종 CBM')).toHaveValue(1.2)
})

it('includes unmeasured boxes through whole-pallet dimensions and saves all three sides', async () => {
  save.mockResolvedValue({ ok: true })
  const summary = { pallet: { id: 'p', palletNo: '1', manualCbm: null, tareWeightKg: 0 }, palletNo: '1', cbm: 1.2,
    boxes: [{ id: 'b', grossWeightKg: 10 }], quantity: 20, boxesWithoutDimensions: 10 } as PalletSummary
  render(<ChinaWorkGuardProvider><PalletFinalMeasurements shipmentId="s" summary={summary} editable isPending={false} /></ChinaWorkGuardProvider>)
  fireEvent.click(screen.getByRole('radio', { name: '직접 입력' }))
  for (const [name, value] of [['가로', '120'], ['세로', '100'], ['높이', '150']]) fireEvent.change(screen.getByLabelText(`파렛트 1 ${name}`), { target: { value } })
  expect(screen.getByRole('radio', { name: '적재 CBM 사용' })).not.toBeChecked()
  expect(screen.getByLabelText('파렛트 1 최종 CBM')).toHaveValue(1.8)
  fireEvent.click(screen.getByRole('button', { name: '최종 저장하기' }))
  await waitFor(() => expect(save).toHaveBeenCalledWith({ shipmentId: 's', palletId: 'p', lengthCm: 120, widthCm: 100, heightCm: 150, manualCbm: 1.8, tareWeightKg: 0, finalize: true, refresh: false }))
})

it('confirms the current loaded CBM even when ten boxes have no dimensions', async () => {
  save.mockResolvedValue({ ok: true })
  const summary = { pallet: { id: 'p', palletNo: '1', manualCbm: null, tareWeightKg: 0 }, palletNo: '1', cbm: 1.2,
    boxes: [{ id: 'b', grossWeightKg: 10 }], quantity: 20, boxesWithoutDimensions: 10 } as PalletSummary
  render(<ChinaWorkGuardProvider><PalletFinalMeasurements shipmentId="s" summary={summary} editable isPending={false} /></ChinaWorkGuardProvider>)
  expect(screen.queryByText(/규격 없는/)).not.toBeInTheDocument()
  expect(screen.getByRole('radio', { name: '적재 CBM 사용' })).toBeChecked()
  fireEvent.click(screen.getByRole('button', { name: '최종 저장하기' }))
  await waitFor(() => expect(save).toHaveBeenCalledWith({ shipmentId: 's', palletId: 'p', lengthCm: null, widthCm: null, heightCm: null, manualCbm: 1.2, tareWeightKg: 0, finalize: true, refresh: false }))
  expect(screen.getByText('최종 확정')).toBeInTheDocument()
})

it('shows saving immediately, waits for success, and reopens confirmed fields without submitting another save', async () => {
  let finish!: (result: { ok: true }) => void
  save.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  const summary = { pallet: { id: 'p', palletNo: '1', manualCbm: null, tareWeightKg: 0 }, palletNo: '1', cbm: 1.2,
    boxes: [{ id: 'b', grossWeightKg: 10 }], quantity: 20, boxesWithoutDimensions: 0 } as PalletSummary
  render(<ChinaWorkGuardProvider><PalletFinalMeasurements shipmentId="s" summary={summary} editable isPending={false} /></ChinaWorkGuardProvider>)
  fireEvent.click(screen.getByRole('button', { name: '최종 저장하기' }))
  expect(screen.getByRole('button', { name: '저장 중…' })).toBeDisabled()
  expect(screen.queryByText('최종 확정')).not.toBeInTheDocument()
  finish({ ok: true })
  await waitFor(() => expect(screen.getByText('최종 확정')).toBeInTheDocument())
  expect(screen.getByRole('radio', { name: '적재 CBM 사용' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: '수정하기' }))
  expect(screen.getByRole('radio', { name: '적재 CBM 사용' })).toBeEnabled()
  expect(screen.getByRole('button', { name: '최종 저장하기' })).toBeInTheDocument()
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
})

it('keeps an unsuccessful save unconfirmed and allows retrying', async () => {
  save.mockResolvedValueOnce({ ok: false, error: '저장 실패' }).mockResolvedValueOnce({ ok: true })
  const summary = { pallet: { id: 'p', palletNo: '1', manualCbm: null, tareWeightKg: 0 }, palletNo: '1', cbm: 1.2,
    boxes: [{ id: 'b', grossWeightKg: 10 }], quantity: 20, boxesWithoutDimensions: 0 } as PalletSummary
  render(<ChinaWorkGuardProvider><PalletFinalMeasurements shipmentId="s" summary={summary} editable isPending={false} /></ChinaWorkGuardProvider>)
  fireEvent.click(screen.getByRole('button', { name: '최종 저장하기' }))
  await waitFor(() => expect(screen.getByRole('button', { name: '최종 저장하기' })).toBeEnabled())
  expect(screen.queryByText('최종 확정')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '최종 저장하기' }))
  await waitFor(() => expect(screen.getByText('최종 확정')).toBeInTheDocument())
  expect(save).toHaveBeenCalledTimes(2)
})
it('previews and saves a custom pallet tare without adding the default five kilograms', async () => {
  save.mockResolvedValue({ ok: true })
  const summary = { pallet: { id: 'p', palletNo: '1', manualCbm: null, tareWeightKg: 0 }, palletNo: '1', cbm: 1.2,
    boxes: [{ id: 'b', grossWeightKg: 10 }], quantity: 20, boxesWithoutDimensions: 0 } as PalletSummary
  render(<ChinaWorkGuardProvider><PalletFinalMeasurements shipmentId="s" summary={summary} editable isPending={false} /></ChinaWorkGuardProvider>)
  fireEvent.click(screen.getByRole('radio', { name: '직접 입력' }))
  expect(screen.queryByRole('checkbox', { name: '파렛트 부피 0.3CBM 포함' })).not.toBeInTheDocument()
  for (const [name, value] of [['가로', '120'], ['세로', '100'], ['높이', '150']]) fireEvent.change(screen.getByLabelText(`파렛트 1 ${name}`), { target: { value } })
  fireEvent.click(screen.getByRole('checkbox', { name: '파렛트 무게 5kg 포함' }))
  expect(screen.getByText('최종 무게: 15 kg')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('checkbox', { name: '추가 무게 직접 입력' }))
  fireEvent.change(screen.getByLabelText('파렛트 1 추가 무게'), { target: { value: '7.125' } })
  expect(screen.getByRole('checkbox', { name: '파렛트 무게 5kg 포함' })).not.toBeChecked()
  expect(screen.getByText('최종 무게: 17.125 kg')).toBeInTheDocument()
  expect(screen.getByLabelText('파렛트 1 최종 CBM')).toHaveValue(1.8)
  fireEvent.click(screen.getByRole('button', { name: '최종 저장하기' }))
  await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ manualCbm: 1.8, tareWeightKg: 7.125, lengthCm: 120, finalize: true })))
})
