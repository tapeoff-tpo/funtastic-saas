import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  Purchase1688TrackingProgressWindow,
  PurchaseBulk1688TrackingLookup,
  purchase1688TrackingPopupStorageKey,
  type Purchase1688TrackingLookupCandidate,
} from './purchase-request-actions'

const refresh = vi.hoisted(() => vi.fn())
const toastSuccess = vi.hoisted(() => vi.fn())
const toastWarning = vi.hoisted(() => vi.fn())
const toastError = vi.hoisted(() => vi.fn())
const toastInfo = vi.hoisted(() => vi.fn())

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
    info: toastInfo,
  },
}))

const firstId = '11111111-1111-4111-8111-111111111111'
const secondId = '22222222-2222-4222-8222-222222222222'
const existingTrackingId = '33333333-3333-4333-8333-333333333333'
const invalidOrderId = '44444444-4444-4444-8444-444444444444'
const firstOrder = '3317159640039018761'
const secondOrder = '3317159640039018762'
const runId = '1688-batch-run'
const exactWaybillEvidence = { label: '运单号码', extractionVersion: 2 }

const initialCandidates: Purchase1688TrackingLookupCandidate[] = [
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
]

const recollectCandidates: Purchase1688TrackingLookupCandidate[] = [{
  id: firstId,
  sku: '111555-0001',
  productName: 'CABOSS 자갈 지압매트 150cm',
  optionName: null,
  supplierOrderNumber: firstOrder,
  trackingNumber: 'LP00850611544129',
}]

function popupWindow() {
  return {
    closed: false,
    focus: vi.fn(),
  } as unknown as Window
}

function writePopupHandoff({
  candidates = initialCandidates,
  mode = 'initial',
  handoffRunId = runId,
}: {
  candidates?: Purchase1688TrackingLookupCandidate[]
  mode?: 'initial' | 'recollect'
  handoffRunId?: string
} = {}) {
  window.localStorage.setItem(purchase1688TrackingPopupStorageKey(handoffRunId), JSON.stringify({
    createdAt: Date.now(),
    mode,
    candidates,
  }))
}

function renderInitialRunner(handoffRunId = runId) {
  writePopupHandoff({ handoffRunId })
  return render(<Purchase1688TrackingProgressWindow runId={handoffRunId} />)
}

function renderRecollectRunner() {
  writePopupHandoff({ candidates: recollectCandidates, mode: 'recollect' })
  return render(<Purchase1688TrackingProgressWindow runId={runId} />)
}

function extensionMessage(data: Record<string, unknown>) {
  window.dispatchEvent(new MessageEvent('message', {
    source: window,
    origin: window.location.origin,
    data,
  }))
}

async function waitForStart(postMessage: ReturnType<typeof vi.spyOn>, orderNumber = firstOrder, attempt = 1) {
  await waitFor(() => expect(postMessage).toHaveBeenCalledWith(
    expect.objectContaining({
      source: 'funtastic-saas',
      type: 'FUNTASTIC_1688_TRACKING_START',
      runId: `${runId}-0-${attempt}`,
      orderNumber,
      background: true,
    }),
    window.location.origin,
  ))
}

describe('PurchaseBulk1688TrackingLookup', () => {
  beforeEach(() => {
    window.localStorage.clear()
    refresh.mockReset()
    toastSuccess.mockReset()
    toastWarning.mockReset()
    toastError.mockReset()
    toastInfo.mockReset()
    vi.restoreAllMocks()
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(runId)
  })

  it('hands work off to a real same-origin popup before the originating page can navigate', () => {
    const popup = popupWindow()
    vi.spyOn(window, 'open').mockReturnValue(popup)
    render(<PurchaseBulk1688TrackingLookup candidates={initialCandidates} />)

    fireEvent.click(screen.getByRole('button', { name: '1688 송장 일괄조회' }))

    expect(window.open).toHaveBeenCalledWith(
      `${window.location.origin}/purchasing/orders/1688-tracking-run?runId=${runId}`,
      'funtastic-1688-tracking-progress',
      expect.stringContaining('popup=yes'),
    )
    expect(popup.focus).toHaveBeenCalledOnce()
    expect(JSON.parse(window.localStorage.getItem(purchase1688TrackingPopupStorageKey(runId)) ?? '{}')).toMatchObject({
      mode: 'initial',
      candidates: initialCandidates,
    })
  })

  it('runs the independent popup queue, saves exact waybills, and skips existing/manual rows', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url === `/api/purchasing/purchase-requests/${firstId}/1688-tracking` || url === `/api/purchasing/purchase-requests/${secondId}/1688-tracking`) {
        return { ok: true, json: async () => ({ id: url.includes(firstId) ? firstId : secondId, trackingCount: 1 }) } as Response
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    const postMessage = vi.spyOn(window, 'postMessage')
    renderInitialRunner()

    expect(await screen.findByText(/CABOSS 자갈 지압매트 150cm/)).toBeTruthy()
    expect(screen.getByText(/기존 송장 또는 주문서번호가 없는 2건은 자동으로 건너뜁니다/)).toBeTruthy()
    await waitForStart(postMessage)

    await act(async () => {
      extensionMessage({
        source: 'funtastic-1688-extension',
        type: 'FUNTASTIC_1688_TRACKING_ACK',
        runId: `${runId}-0-1`,
      })
      extensionMessage({
        source: 'funtastic-1688-extension',
        type: 'FUNTASTIC_1688_TRACKING_RESULT',
        runId: `${runId}-0-1`,
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
      expect.objectContaining({ runId: `${runId}-1-1`, orderNumber: secondOrder }),
      window.location.origin,
    ))

    await act(async () => {
      extensionMessage({
        source: 'funtastic-1688-extension',
        type: 'FUNTASTIC_1688_TRACKING_RESULT',
        runId: `${runId}-1-1`,
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

    expect(fetch).not.toHaveBeenCalledWith(`/api/purchasing/purchase-requests/${existingTrackingId}/1688-tracking`, expect.anything())
    expect(fetch).not.toHaveBeenCalledWith(`/api/purchasing/purchase-requests/${invalidOrderId}/1688-tracking`, expect.anything())
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('1688 송장 2건을 등록하고 검수로 이동했습니다.'))
  })

  it('re-queries LP legacy records in the popup and asks the API to replace only untouched inspections', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ id: firstId, trackingCount: 1 }) } as Response)
    const postMessage = vi.spyOn(window, 'postMessage')
    renderRecollectRunner()

    expect(await screen.findByText('1688 송장 다시 수집')).toBeTruthy()
    await waitForStart(postMessage)

    await act(async () => {
      extensionMessage({
        source: 'funtastic-1688-extension',
        type: 'FUNTASTIC_1688_TRACKING_RESULT',
        runId: `${runId}-0-1`,
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
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('1688 송장 1건을 다시 수집했습니다.'))
  })

  it('keeps the queue in the popup after the originating list unmounts', async () => {
    const popup = popupWindow()
    vi.spyOn(window, 'open').mockReturnValue(popup)
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ id: firstId, trackingCount: 1 }) } as Response)
    const postMessage = vi.spyOn(window, 'postMessage')
    const originatingList = render(<PurchaseBulk1688TrackingLookup candidates={initialCandidates} />)

    fireEvent.click(screen.getByRole('button', { name: '1688 송장 일괄조회' }))
    originatingList.unmount()

    render(<Purchase1688TrackingProgressWindow runId={runId} />)
    await waitForStart(postMessage)

    await act(async () => {
      extensionMessage({
        source: 'funtastic-1688-extension',
        type: 'FUNTASTIC_1688_TRACKING_RESULT',
        runId: `${runId}-0-1`,
        orderNumber: firstOrder,
        trackingNumbers: ['S71268668516'],
        trackingSource: 'waybill_number',
        trackingEvidence: exactWaybillEvidence,
      })
      await Promise.resolve()
    })

    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      `/api/purchasing/purchase-requests/${firstId}/1688-tracking`,
      expect.anything(),
    ))
  })

  it('stops the popup queue when 1688 requires a login instead of starting the next order', async () => {
    const postMessage = vi.spyOn(window, 'postMessage')
    renderInitialRunner()
    await waitForStart(postMessage)

    await act(async () => {
      extensionMessage({
        source: 'funtastic-1688-extension',
        type: 'FUNTASTIC_1688_TRACKING_ERROR',
        runId: `${runId}-0-1`,
        message: '1688 로그인이 필요합니다. 로그인 후 다시 조회해주세요.',
      })
      await Promise.resolve()
    })

    expect(await screen.findByText(/남은 항목은 확인 후 다시 일괄조회해주세요/)).toBeTruthy()
    expect(screen.getByText('남은 항목은 조회하지 않았습니다.')).toBeTruthy()
    expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ runId: `${runId}-1-1` }), window.location.origin)
  })

  it('continues to the next order when one popup lookup has no tracking number', async () => {
    const postMessage = vi.spyOn(window, 'postMessage')
    renderInitialRunner()
    await waitForStart(postMessage)

    await act(async () => {
      extensionMessage({
        source: 'funtastic-1688-extension',
        type: 'FUNTASTIC_1688_TRACKING_ERROR',
        runId: `${runId}-0-1`,
        message: '1688에서 송장번호를 찾지 못했습니다. 로그인·보안 확인 또는 주문 상태를 확인해주세요.',
      })
      await Promise.resolve()
    })

    await waitFor(() => expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ runId: `${runId}-1-1`, orderNumber: secondOrder }),
      window.location.origin,
    ))
  })

  it('does not save a legacy extension result without the 运单号码 source marker', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
    const postMessage = vi.spyOn(window, 'postMessage')
    renderInitialRunner()
    await waitForStart(postMessage)

    await act(async () => {
      extensionMessage({
        source: 'funtastic-1688-extension',
        type: 'FUNTASTIC_1688_TRACKING_RESULT',
        runId: `${runId}-0-1`,
        orderNumber: firstOrder,
        trackingNumbers: ['LP00850611544129'],
      })
      await Promise.resolve()
    })

    expect((await screen.findAllByText(/확장프로그램을 1.10.1 이상으로 업데이트/)).length).toBeGreaterThan(0)
    expect(fetch).not.toHaveBeenCalled()
    expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ runId: `${runId}-1-1` }), window.location.origin)
  })

  it('retries the same popup order while the extension clears a preceding lookup run', async () => {
    const postMessage = vi.spyOn(window, 'postMessage')
    renderInitialRunner()
    await waitForStart(postMessage)

    await act(async () => {
      extensionMessage({
        source: 'funtastic-1688-extension',
        type: 'FUNTASTIC_1688_TRACKING_ERROR',
        runId: `${runId}-0-1`,
        message: '다른 1688 작업이 진행 중입니다. 완료된 뒤 다시 조회해주세요.',
      })
      await Promise.resolve()
    })

    await waitFor(() => expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ runId: `${runId}-0-2`, orderNumber: firstOrder }),
      window.location.origin,
    ), { timeout: 2_000 })
  })
})
