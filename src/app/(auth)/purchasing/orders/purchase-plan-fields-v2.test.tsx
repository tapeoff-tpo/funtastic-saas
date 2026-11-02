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

function renderFields(trackingNumber: string | null = null) {
  render(
    <PurchasePlanFieldsV2
      id={itemId}
      supplierOrderNumber={null}
      trackingNumber={trackingNumber}
      showTrackingNumber={false}
      dateValue="2026-11-02"
      dateField="outboundExpectedDate"
      dateLabel="구매날짜"
      purchaseMethod="개인"
      allow1688TrackingLookup
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
    })

    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      `/api/purchasing/purchase-requests/${itemId}/1688-tracking`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          orderNumber,
          trackingNumbers: ['S71268668516', 'S71268668517'],
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
})
