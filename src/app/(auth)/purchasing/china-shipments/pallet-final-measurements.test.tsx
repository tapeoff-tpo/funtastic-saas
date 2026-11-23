import { expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
const { save } = vi.hoisted(() => ({ save: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('../saas-china-actions', () => ({ saveChinaOutboundPalletDimensionsAction: save }))
import { PalletFinalMeasurements } from './pallet-final-measurements'
import { ChinaWorkGuardProvider } from './unsaved-china-work'
import type { PalletSummary } from './china-shipments-board'
it('adds volume and weight independently and persists both in one save without accumulating repeatedly', async () => {
  save.mockResolvedValue({ ok: true })
  const summary = { pallet: { id: 'p', palletNo: '1', manualCbm: null, tareWeightKg: 0 }, palletNo: '1', cbm: 1.2,
    boxes: [{ id: 'b', grossWeightKg: 10 }], quantity: 20, boxesWithoutDimensions: 0 } as PalletSummary
  render(<ChinaWorkGuardProvider><PalletFinalMeasurements shipmentId="s" summary={summary} editable isPending={false} /></ChinaWorkGuardProvider>)
  fireEvent.click(screen.getByRole('checkbox', { name: '파렛트 부피 0.3CBM 포함' }))
  expect(screen.getByLabelText('파렛트 1 최종 CBM')).toHaveValue(1.5)
  expect(save).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('checkbox', { name: '파렛트 무게 5kg 포함' }))
  fireEvent.click(screen.getByRole('button', { name: '저장하기' }))
  await waitFor(() => expect(save).toHaveBeenCalledWith({ shipmentId: 's', palletId: 'p', manualCbm: 1.5, tareWeightKg: 5 }))
  await waitFor(() => expect(screen.getByText('최종 무게: 15 kg')).toBeInTheDocument())
  fireEvent.click(screen.getByRole('checkbox', { name: '파렛트 부피 0.3CBM 포함' }))
  expect(screen.getByLabelText('파렛트 1 최종 CBM')).toHaveValue(1.2)
})
