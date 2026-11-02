import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PurchaseBulk1688TrackingLookup,
  PurchaseBulkSelectionProvider,
  PurchaseRowCheckbox,
} from './purchase-request-actions'

const refresh = vi.hoisted(() => vi.fn())
const toastSuccess = vi.hoisted(() => vi.fn())
const toastWarning = vi.hoisted(() => vi.fn())
const toastError = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
  usePathname: () => '/purchasing/orders',
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('sonner', () => ({
  toast: {
    success: toastSuccess,
    warning: toastWarning,
    error: toastError,
    info: vi.fn(),
  },
}))

const firstId = '11111111-1111-4111-8111-111111111111'
const secondId = '22222222-2222-4222-8222-222222222222'
const existingTrackingId = '33333333-3333-4333-8333-333333333333'
const invalidOrderId = '44444444-4444-4444-8444-444444444444'
const firstOrder = '3317159640039018761'
const secondOrder = '3317159640039018762'

function renderBulkLookup() {
  render(
    <PurchaseBulkSelectionProvider
      ids={[firstId, secondId, existingTrackingId, invalidOrderId]}
      nextStatus={null}
    >
      <PurchaseRowCheckbox id={firstId} />
      <PurchaseRowCheckbox id={secondId} />
      <PurchaseRowCheckbox id={existingTrackingId} />
      <PurchaseRowCheckbox id={invalidOrderId} />
      <PurchaseBulk1688TrackingLookup
        candidates={[
          { id: firstId, supplierOrderNumber: firstOrder, trackingNumber: null },
          { id: secondId, supplierOrderNumber: secondOrder, trackingNumber: null },
          { id: existingTrackingId, supplierOrderNumber: firstOrder, trackingNumber: 'MANUAL-TRACKING' },
          { id: invalidOrderId, supplierOrderNumber: 'not-an-order', trackingNumber: null },
        ]}
      />
    </PurchaseBulkSelectionProvider>,
  )
}

function extensionMessage(data: Record<string, unknown>) {
  window.dispatchEvent(new MessageEvent('message', {
    source: window,
    origin: window.location.origin,
    data,
  }))
}

describe('PurchaseBulk1688TrackingLookup', () => {
  beforeEach(() => {
    refresh.mockReset()
    toastSuccess.mockReset()
    toastWarning.mockReset()
    toastError.mockReset()
    vi.restoreAllMocks()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('1688-batch-run')
  })

  it('queries selected valid rows one at a time and excludes existing/manual rows', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url === `/api/purchasing/purchase-requests/${firstId}/1688-tracking` || url === `/api/purchasing/purchase-requests/${secondId}/1688-tracking`) {
        return { ok: true, json: async () => ({ id: url.includes(firstId) ? firstId : secondId, trackingCount: 1 }) } as Response
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    const postMessage = vi.spyOn(window, 'postMessage')
    renderBulkLookup()

    for (const checkbox of screen.getAllByRole('checkbox')) fireEvent.click(checkbox)
    expect(screen.getByRole('button', { name: '현재 페이지 선택 4건 중 2건 일괄조회' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: '현재 페이지 선택 4건 중 2건 일괄조회' }))
    await waitFor(() => expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'funtastic-saas',
        type: 'FUNTASTIC_1688_TRACKING_START',
        runId: '1688-batch-run-0-1',
        orderNumber: firstOrder,
      }),
      window.location.origin,
    ))

    await act(async () => {
      extensionMessage({
        source: 'funtastic-1688-extension',
        type: 'FUNTASTIC_1688_TRACKING_ACK',
        runId: '1688-batch-run-0-1',
      })
      extensionMessage({
        source: 'funtastic-1688-extension',
        type: 'FUNTASTIC_1688_TRACKING_RESULT',
        runId: '1688-batch-run-0-1',
        orderNumber: firstOrder,
        trackingNumbers: ['S71268668516'],
      })
      await Promise.resolve()
    })
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      `/api/purchasing/purchase-requests/${firstId}/1688-tracking`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ orderNumber: firstOrder, trackingNumbers: ['S71268668516'] }),
      }),
    ))
    await waitFor(() => expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: '1688-batch-run-1-1',
        orderNumber: secondOrder,
      }),
      window.location.origin,
    ))

    await act(async () => {
      extensionMessage({
        source: 'funtastic-1688-extension',
        type: 'FUNTASTIC_1688_TRACKING_RESULT',
        runId: '1688-batch-run-1-1',
        orderNumber: secondOrder,
        trackingNumbers: ['S71268668517'],
      })
      await Promise.resolve()
    })
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      `/api/purchasing/purchase-requests/${secondId}/1688-tracking`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ orderNumber: secondOrder, trackingNumbers: ['S71268668517'] }),
      }),
    ))
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce())

    expect(fetch).not.toHaveBeenCalledWith(
      `/api/purchasing/purchase-requests/${existingTrackingId}/1688-tracking`,
      expect.anything(),
    )
    expect(fetch).not.toHaveBeenCalledWith(
      `/api/purchasing/purchase-requests/${invalidOrderId}/1688-tracking`,
      expect.anything(),
    )
    expect(toastSuccess).toHaveBeenCalledWith('1688 송장 2건을 등록하고 검수로 이동했습니다.')
  })

  it('stops the queue when 1688 requires a login instead of starting the next order', async () => {
    const postMessage = vi.spyOn(window, 'postMessage')
    renderBulkLookup()

    for (const checkbox of screen.getAllByRole('checkbox').slice(0, 2)) fireEvent.click(checkbox)
    fireEvent.click(screen.getByRole('button', { name: '현재 페이지 선택 2건 1688 송장 일괄조회' }))
    await waitFor(() => expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ runId: '1688-batch-run-0-1', orderNumber: firstOrder }),
      window.location.origin,
    ))

    await act(async () => {
      extensionMessage({
        source: 'funtastic-1688-extension',
        type: 'FUNTASTIC_1688_TRACKING_ERROR',
        runId: '1688-batch-run-0-1',
        message: '1688 로그인이 필요합니다. 로그인 후 다시 조회해주세요.',
      })
      await Promise.resolve()
    })

    await waitFor(() => expect(screen.getByText(/남은 항목은 확인 후 다시 일괄조회해주세요/)).toBeInTheDocument())
    expect(postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ runId: '1688-batch-run-1-1' }),
      window.location.origin,
    )
    expect(refresh).not.toHaveBeenCalled()
  })

  it('retries the same order while the extension clears the preceding lookup run', async () => {
    const postMessage = vi.spyOn(window, 'postMessage')
    renderBulkLookup()

    fireEvent.click(screen.getAllByRole('checkbox')[0])
    fireEvent.click(screen.getByRole('button', { name: '현재 페이지 선택 1건 1688 송장 일괄조회' }))
    await waitFor(() => expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ runId: '1688-batch-run-0-1', orderNumber: firstOrder }),
      window.location.origin,
    ))

    await act(async () => {
      extensionMessage({
        source: 'funtastic-1688-extension',
        type: 'FUNTASTIC_1688_TRACKING_ERROR',
        runId: '1688-batch-run-0-1',
        message: '다른 1688 작업이 진행 중입니다. 완료된 뒤 다시 조회해주세요.',
      })
      await Promise.resolve()
    })

    await waitFor(() => expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ runId: '1688-batch-run-0-2', orderNumber: firstOrder }),
      window.location.origin,
    ), { timeout: 2_000 })
  })
})
