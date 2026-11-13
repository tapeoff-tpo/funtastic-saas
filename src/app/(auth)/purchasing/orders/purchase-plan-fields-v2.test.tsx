import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PurchasePlanFieldsV2 } from './purchase-request-actions'

const refresh = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
  usePathname: () => '/purchasing/orders',
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}))

const itemId = '11111111-1111-4111-8111-111111111111'

function renderFields(
  trackingNumber: string | null = null,
  showTrackingNumber = false,
  trackingSaveMode: 'plan' | 'inspection' = 'plan',
  compact = false,
) {
  render(
    <PurchasePlanFieldsV2
      id={itemId}
      supplierOrderNumber={null}
      trackingNumber={trackingNumber}
      showTrackingNumber={showTrackingNumber}
      dateValue="2026-11-02"
      dateField="outboundExpectedDate"
      dateLabel="구매날짜"
      trackingSaveMode={trackingSaveMode}
      compact={compact}
    />,
  )
}

describe('PurchasePlanFieldsV2 manual tracking fields', () => {
  beforeEach(() => {
    refresh.mockReset()
    vi.restoreAllMocks()
  })

  it('saves a compact single-row form through its labelled icon button', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ id: itemId }) } as Response)
    renderFields(null, true, 'plan', true)
    fireEvent.change(screen.getByRole('textbox', { name: /^운송장번호/ }), { target: { value: '9823528519765' } })
    const save = screen.getByRole('button', { name: '저장' })
    expect(save).toHaveAttribute('title', '저장')
    fireEvent.click(save)
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(`/api/purchasing/purchase-requests/${itemId}`, expect.objectContaining({ body: JSON.stringify({ trackingNumber: '9823528519765' }) })))
  })

  it('does not render row-level 1688 lookup or recollect controls', () => {
    renderFields('LP00850611544129', true, 'inspection')
    expect(screen.queryByRole('button', { name: /1688 송장/ })).toBeNull()
  })

  it('renders a Baidu tracking link beside the saved tracking-number label', () => {
    renderFields('9823528519765', true)
    expect(screen.getByTitle('바이두에서 송장번호 조회')).toHaveAttribute(
      'href',
      'https://www.baidu.com/s?wd=9823528519765',
    )
  })

  it('lets the user save a manual tracking number beside the supplier order number', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ id: itemId }) } as Response)
    renderFields(null, true)

    fireEvent.change(screen.getByRole('textbox', { name: /^운송장번호/ }), { target: { value: '9823528519765' } })
    fireEvent.click(screen.getByRole('button', { name: '저장' }))

    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      `/api/purchasing/purchase-requests/${itemId}`,
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ trackingNumber: '9823528519765' }),
      }),
    ))
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce())
  })

  it('saves the visible inspection tracking field through the inspection record', async () => {
    const inspection = {
      revision: 3,
      resolutionNote: '',
      parcels: [{ id: 'parcel-1', trackingNumber: 'LP00850611544129', boxes: [{ id: 'box-1', quantity: null, lengthCm: null, widthCm: null, heightCm: null, weightKg: null }] }],
    }
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url === `/api/purchasing/purchase-requests/${itemId}/inspection` && !init?.method) {
        return { ok: true, json: async () => ({ inspection }) } as Response
      }
      if (url === `/api/purchasing/purchase-requests/${itemId}/inspection` && init?.method === 'POST') {
        return { ok: true, json: async () => ({ inspection: { ...inspection, revision: 4 } }) } as Response
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    renderFields('LP00850611544129', true, 'inspection')

    fireEvent.change(screen.getByRole('textbox', { name: /^운송장번호/ }), { target: { value: '9823528519765' } })
    fireEvent.click(screen.getByRole('button', { name: '저장' }))

    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      `/api/purchasing/purchase-requests/${itemId}/inspection`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          revision: 3,
          parcels: [{ ...inspection.parcels[0], trackingNumber: '9823528519765' }],
          complete: false,
          acknowledgeMismatch: false,
          resolutionNote: '',
        }),
      }),
    ))
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce())
  })

})
