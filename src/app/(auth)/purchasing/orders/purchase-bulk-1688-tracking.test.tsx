import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PurchaseBulk1688TrackingLookup,
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
const exactWaybillEvidence = { label: '运单号码', extractionVersion: 2 }
let progressPopupDocument: Document

function progressPopup() {
  return within(progressPopupDocument.body)
}

function createProgressPopup() {
  progressPopupDocument = document.implementation.createHTMLDocument('1688 송장 일괄조회')
  return {
    document: progressPopupDocument,
    closed: false,
    focus: vi.fn(),
    close: vi.fn(),
    addEventListener: vi.fn(),
  } as unknown as Window
}

function renderBulkLookup() {
  render(
    <PurchaseBulk1688TrackingLookup
      candidates={[
        {
          id: firstId,
          sku: '111555-0001',
          productName: 'CABOSS 자갈 지압매트 150cm',
          optionName: null,
          supplierOrderNumber: firstOrder,
          trackingNumber: null,
        },
        {
          id: secondId,
          sku: '111555-0002',
          productName: '두 번째 상품',
          optionName: '블랙',
          supplierOrderNumber: secondOrder,
          trackingNumber: null,
        },
        {
          id: existingTrackingId,
          sku: '111555-0003',
          productName: '수동 송장 등록 상품',
          optionName: null,
          supplierOrderNumber: firstOrder,
          trackingNumber: 'MANUAL-TRACKING',
        },
        {
          id: invalidOrderId,
          sku: '111555-0004',
          productName: '주문번호 없는 상품',
          optionName: null,
          supplierOrderNumber: 'not-an-order',
          trackingNumber: null,
        },
      ]}
    />,
  )
}

function renderCorrectionLookup() {
  render(
    <PurchaseBulk1688TrackingLookup
      mode="correction"
      candidates={[{
        id: firstId,
        sku: '111555-0001',
        productName: 'CABOSS 자갈 지압매트 150cm',
        optionName: null,
        supplierOrderNumber: firstOrder,
        trackingNumber: 'LP00850611544129',
      }]}
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

describe('PurchaseBulk1688TrackingLookup', () => {
  beforeEach(() => {
    refresh.mockReset()
    toastSuccess.mockReset()
    toastWarning.mockReset()
    toastError.mockReset()
    vi.restoreAllMocks()
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('1688-batch-run')
    vi.spyOn(window, 'open').mockReturnValue(createProgressPopup())
  })

  it('opens one progress popup, queries all eligible rows, and skips existing/manual rows automatically', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url === `/api/purchasing/purchase-requests/${firstId}/1688-tracking` || url === `/api/purchasing/purchase-requests/${secondId}/1688-tracking`) {
        return { ok: true, json: async () => ({ id: url.includes(firstId) ? firstId : secondId, trackingCount: 1 }) } as Response
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    const postMessage = vi.spyOn(window, 'postMessage')
    renderBulkLookup()

    expect(screen.getByRole('button', { name: '1688 송장 일괄조회' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '1688 송장 일괄조회' }))

    expect(window.open).toHaveBeenCalledWith('', 'funtastic-1688-tracking-progress', expect.stringContaining('popup=yes'))
    expect(progressPopup().getByText(/111555-0001/)).toBeTruthy()
    expect(progressPopup().getByText(/CABOSS 자갈 지압매트 150cm/)).toBeTruthy()
    expect(progressPopup().getByText(/기존 송장 또는 주문서번호가 없는 2건은 자동으로 건너뜁니다/)).toBeTruthy()
    await waitFor(() => expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'funtastic-saas',
        type: 'FUNTASTIC_1688_TRACKING_START',
        runId: '1688-batch-run-0-1',
        orderNumber: firstOrder,
        background: true,
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
        trackingSource: 'waybill_number',
        trackingEvidence: exactWaybillEvidence,
      })
      await Promise.resolve()
    })
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      `/api/purchasing/purchase-requests/${firstId}/1688-tracking`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ orderNumber: firstOrder, trackingNumbers: ['S71268668516'], trackingSource: 'waybill_number', trackingEvidence: exactWaybillEvidence, replaceUninspectedInspection: false }),
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
        trackingSource: 'waybill_number',
        trackingEvidence: exactWaybillEvidence,
      })
      await Promise.resolve()
    })
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      `/api/purchasing/purchase-requests/${secondId}/1688-tracking`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ orderNumber: secondOrder, trackingNumbers: ['S71268668517'], trackingSource: 'waybill_number', trackingEvidence: exactWaybillEvidence, replaceUninspectedInspection: false }),
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

  it('re-queries LP legacy records in a separate batch and asks the API to replace only untouched inspections', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ id: firstId, trackingCount: 1 }) } as Response)
    const postMessage = vi.spyOn(window, 'postMessage')
    renderCorrectionLookup()

    expect(screen.getByRole('button', { name: '1688 송장 일괄정정' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '1688 송장 일괄정정' }))
    expect(progressPopup().getByText('1688 송장 일괄정정')).toBeTruthy()
    await waitFor(() => expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ runId: '1688-batch-run-0-1', orderNumber: firstOrder }),
      window.location.origin,
    ))

    await act(async () => {
      extensionMessage({
        source: 'funtastic-1688-extension',
        type: 'FUNTASTIC_1688_TRACKING_RESULT',
        runId: '1688-batch-run-0-1',
        orderNumber: firstOrder,
        trackingNumbers: ['9823528519765'],
        trackingSource: 'waybill_number',
        trackingEvidence: exactWaybillEvidence,
      })
      await Promise.resolve()
    })

    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      `/api/purchasing/purchase-requests/${firstId}/1688-tracking`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          orderNumber: firstOrder,
          trackingNumbers: ['9823528519765'],
          trackingSource: 'waybill_number',
          trackingEvidence: exactWaybillEvidence,
          replaceUninspectedInspection: true,
        }),
      }),
    ))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('1688 송장 1건을 실제 운송장으로 정정했습니다.'))
  })

  it('stops the queue when 1688 requires a login instead of starting the next order', async () => {
    const postMessage = vi.spyOn(window, 'postMessage')
    renderBulkLookup()

    fireEvent.click(screen.getByRole('button', { name: '1688 송장 일괄조회' }))
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

    await waitFor(() => expect(progressPopup().getByText(/남은 항목은 확인 후 다시 일괄조회해주세요/)).toBeTruthy())
    expect(progressPopup().getByText('남은 항목은 조회하지 않았습니다.')).toBeTruthy()
    expect(postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ runId: '1688-batch-run-1-1' }),
      window.location.origin,
    )
    expect(refresh).not.toHaveBeenCalled()
  })

  it('continues to the next order when one order has no tracking number', async () => {
    const postMessage = vi.spyOn(window, 'postMessage')
    renderBulkLookup()

    fireEvent.click(screen.getByRole('button', { name: '1688 송장 일괄조회' }))
    await waitFor(() => expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ runId: '1688-batch-run-0-1', orderNumber: firstOrder }),
      window.location.origin,
    ))

    await act(async () => {
      extensionMessage({
        source: 'funtastic-1688-extension',
        type: 'FUNTASTIC_1688_TRACKING_ERROR',
        runId: '1688-batch-run-0-1',
        message: '1688에서 송장번호를 찾지 못했습니다. 로그인·보안 확인 또는 주문 상태를 확인해주세요.',
      })
      await Promise.resolve()
    })

    await waitFor(() => expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ runId: '1688-batch-run-1-1', orderNumber: secondOrder }),
      window.location.origin,
    ))
  })

  it('does not save a legacy extension result without the 运单号码 source marker', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
    const postMessage = vi.spyOn(window, 'postMessage')
    renderBulkLookup()

    fireEvent.click(screen.getByRole('button', { name: '1688 송장 일괄조회' }))
    await waitFor(() => expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ runId: '1688-batch-run-0-1', orderNumber: firstOrder }),
      window.location.origin,
    ))

    await act(async () => {
      extensionMessage({
        source: 'funtastic-1688-extension',
        type: 'FUNTASTIC_1688_TRACKING_RESULT',
        runId: '1688-batch-run-0-1',
        orderNumber: firstOrder,
        trackingNumbers: ['LP00850611544129'],
      })
      await Promise.resolve()
    })

    await waitFor(() => expect(progressPopup().getAllByText(/확장프로그램을 1.10.0 이상으로 업데이트/).length).toBeGreaterThan(0))
    expect(fetch).not.toHaveBeenCalled()
    expect(postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ runId: '1688-batch-run-1-1' }),
      window.location.origin,
    )
  })

  it('retries the same order while the extension clears the preceding lookup run', async () => {
    const postMessage = vi.spyOn(window, 'postMessage')
    renderBulkLookup()

    fireEvent.click(screen.getByRole('button', { name: '1688 송장 일괄조회' }))
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
