import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PurchasePlanFieldsV2 } from './purchase-request-actions'

const refresh = vi.hoisted(() => vi.fn())
const toastSuccess = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
  usePathname: () => '/purchasing/orders',
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
const orderNumber = '3317159640039018761'
const exactWaybillEvidence = { label: '运单号码', extractionVersion: 2 }

function renderFields(
  trackingNumber: string | null = null,
  showTrackingNumber = false,
  trackingSaveMode: 'plan' | 'inspection' = 'plan',
  allow1688TrackingRecollect = false,
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
      purchaseMethod="개인"
      allow1688TrackingLookup
      allow1688TrackingRecollect={allow1688TrackingRecollect}
      trackingSaveMode={trackingSaveMode}
    />,
  )
}

function extensionMessage(data: Record<string, unknown>) {
  window.dispatchEvent(new MessageEvent('message', {
    source: window,
    origin: window.location.origin,
    data,
  }))
}

describe('PurchasePlanFieldsV2 1688 tracking lookup', () => {
  beforeEach(() => {
    refresh.mockReset()
    toastSuccess.mockReset()
    vi.restoreAllMocks()
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('1688-tracking-run')
  })

  it('saves the new order number, then applies a matching extension result through the guarded endpoint', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url === `/api/purchasing/purchase-requests/${itemId}`) {
        return { ok: true, json: async () => ({ id: itemId }) } as Response
      }
      if (url === `/api/purchasing/purchase-requests/${itemId}/1688-tracking`) {
        return { ok: true, json: async () => ({ id: itemId, trackingCount: 2 }) } as Response
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    const postMessage = vi.spyOn(window, 'postMessage')
    renderFields()

    fireEvent.change(screen.getByRole('textbox', { name: '주문서번호' }), { target: { value: orderNumber } })
    fireEvent.click(screen.getByRole('button', { name: '1688 송장조회' }))

    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      `/api/purchasing/purchase-requests/${itemId}`,
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ supplierOrderNumber: orderNumber }),
      }),
    ))
    await waitFor(() => expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'funtastic-saas',
        type: 'FUNTASTIC_1688_TRACKING_START',
        runId: '1688-tracking-run',
        orderNumber,
        background: false,
      }),
      window.location.origin,
    ))

    extensionMessage({
      source: 'funtastic-1688-extension',
      type: 'FUNTASTIC_1688_TRACKING_ACK',
      runId: '1688-tracking-run',
    })
    extensionMessage({
      source: 'funtastic-1688-extension',
      type: 'FUNTASTIC_1688_TRACKING_RESULT',
      runId: '1688-tracking-run',
      orderNumber,
      trackingNumbers: ['S71268668516', 'S71268668517'],
      trackingSource: 'waybill_number',
      trackingEvidence: exactWaybillEvidence,
    })

    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      `/api/purchasing/purchase-requests/${itemId}/1688-tracking`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          orderNumber,
          trackingNumbers: ['S71268668516', 'S71268668517'],
          trackingSource: 'waybill_number',
          trackingEvidence: exactWaybillEvidence,
          replaceUninspectedInspection: false,
        }),
      }),
    ))
    expect(toastSuccess).toHaveBeenCalledWith('1688 송장 2건을 등록하고 검수로 이동했습니다.')
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('keeps a pre-existing manual tracking number untouched', () => {
    renderFields('MANUAL-TRACKING')
    expect(screen.getByRole('button', { name: '1688 송장조회' })).toBeDisabled()
  })

  it('does not render duplicate Baidu tracking links below the input', () => {
    renderFields('9823528519765', true)
    expect(screen.queryByTitle('바이두에서 송장번호 조회')).toBeNull()
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

  it('re-queries an untouched inspection and replaces its legacy tracking list only after exact-waybill evidence arrives', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url === `/api/purchasing/purchase-requests/${itemId}/1688-tracking`) {
        return { ok: true, json: async () => ({ id: itemId, trackingCount: 1 }) } as Response
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    render(
      <PurchasePlanFieldsV2
        id={itemId}
        supplierOrderNumber={orderNumber}
        trackingNumber="LP00850611544129"
        showTrackingNumber
        dateValue="2026-11-02"
        dateField="outboundExpectedDate"
        dateLabel="구매날짜"
        purchaseMethod="개인"
        allow1688TrackingRecollect
        trackingSaveMode="inspection"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '1688 송장 다시 수집' }))
    extensionMessage({
      source: 'funtastic-1688-extension',
      type: 'FUNTASTIC_1688_TRACKING_RESULT',
      runId: '1688-tracking-run',
      orderNumber,
      trackingNumbers: ['9823528519765'],
      trackingSource: 'waybill_number',
      trackingEvidence: exactWaybillEvidence,
    })

    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      `/api/purchasing/purchase-requests/${itemId}/1688-tracking`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          orderNumber,
          trackingNumbers: ['9823528519765'],
          trackingSource: 'waybill_number',
          trackingEvidence: exactWaybillEvidence,
          replaceUninspectedInspection: true,
        }),
      }),
    ))
    expect(toastSuccess).toHaveBeenCalledWith('1688 송장 1건을 다시 수집했습니다.')
  })
})
