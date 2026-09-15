import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PurchaseBulkSelectionProvider,
  PurchasePaymentFlowBulkActions,
  PurchaseQuantityField,
  PurchaseRowCheckbox,
} from './purchase-request-actions'

const refresh = vi.hoisted(() => vi.fn())
const toastSuccess = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('sonner', () => ({
  toast: {
    success: toastSuccess,
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}))

const itemId = '11111111-1111-4111-8111-111111111111'

function renderActions() {
  render(
    <PurchaseBulkSelectionProvider ids={[itemId]} nextStatus={null}>
      <PurchaseRowCheckbox id={itemId} />
      <PurchasePaymentFlowBulkActions />
    </PurchaseBulkSelectionProvider>,
  )
  fireEvent.click(screen.getByRole('checkbox', { name: '발주 항목 선택' }))
}

describe('PurchasePaymentFlowBulkActions', () => {
  beforeEach(() => {
    refresh.mockReset()
    toastSuccess.mockReset()
    vi.restoreAllMocks()
  })

  it('marks the selected outstanding row completed after confirmation', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ completedCount: 1, ineligibleCount: 0, missingCount: 0 }),
    } as Response)
    renderActions()

    fireEvent.click(screen.getByRole('button', { name: '선택 1건 완료' }))

    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      '/api/purchasing/purchase-requests/bulk-complete',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ ids: [itemId] }),
      }),
    ))
    expect(confirm).toHaveBeenCalledOnce()
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce())
  })

  it('deletes the selected outstanding row through the protected bulk endpoint', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ deletedCount: 1, inventoryLinkedCount: 0, ineligibleCount: 0, missingCount: 0 }),
    } as Response)
    renderActions()

    fireEvent.click(screen.getByRole('button', { name: '선택 1건 삭제' }))

    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      '/api/purchasing/purchase-requests/bulk-delete',
      expect.objectContaining({
        method: 'DELETE',
        body: JSON.stringify({ ids: [itemId] }),
      }),
    ))
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce())
  })

  it('saves an edited purchase quantity and refreshes the payment totals', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as Response)
    render(
      <PurchaseQuantityField
        id={itemId}
        field="actualPurchaseQuantity"
        quantity={12}
      />,
    )

    const quantity = screen.getByRole('spinbutton', { name: '수량' })
    fireEvent.change(quantity, { target: { value: '15' } })
    fireEvent.blur(quantity)

    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      `/api/purchasing/purchase-requests/${itemId}`,
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ actualPurchaseQuantity: 15 }),
      }),
    ))
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce())
  })
})
