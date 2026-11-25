import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PurchaseInspectionButton } from './purchase-inspection-dialog'

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), toast: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))
vi.mock('sonner', () => ({ toast: { success: mocks.toast, error: mocks.toast } }))
const id = '00000000-0000-4000-8000-000000000001'
const box = { id: '00000000-0000-4000-8000-000000000003', quantity: 90, lengthCm: 50, widthCm: 40, heightCm: 30, weightKg: 10 }
const inspection = { version: 1, revision: 0, expectedQuantity: 100, checkedAt: null, checkedBy: null, resolutionNote: '', parcels: [{ id: '00000000-0000-4000-8000-000000000002', trackingNumber: 'SF001', boxes: [box] }] }
const detail = { id, status: 'purchase_completed', productName: '유리컵', sku: 'SKU-A', inspection, imageUrls: ['https://images.example/cup.png'] }
const json = (data: unknown, ok = true) => ({ ok, json: async () => structuredClone(data) })
function stubInspectionFetch(fetcher: (url: string, init?: RequestInit) => Promise<ReturnType<typeof json>>, files: unknown[] = []) {
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) =>
    url.endsWith('/inspection/labels') ? Promise.resolve(json({ files })) : fetcher(url, init))
}
describe('purchase tracking and inspection editor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    HTMLDialogElement.prototype.showModal = function () { this.open = true }
    HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new Event('close')) }
  })
  it('opens the product image when its name is clicked', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(detail)))
    render(<PurchaseInspectionButton id={id} productName="유리컵" mode="image" />)
    fireEvent.click(screen.getByRole('button', { name: '유리컵' }))
    expect(await screen.findByRole('img', { name: '유리컵' })).toHaveAttribute('src', 'https://images.example/cup.png')
  })
  it('prefills a single blank inspection box with the purchase quantity without persisting it first', async () => {
    const blankInspection = {
      ...inspection,
      parcels: [{ ...inspection.parcels[0], boxes: [{ ...box, quantity: null }] }],
    }
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({ ...detail, inspection: blankInspection }))
      .mockResolvedValueOnce(json({ inspection: { ...blankInspection, revision: 1 } }))
    stubInspectionFetch(fetcher)

    render(<PurchaseInspectionButton id={id} productName="유리컵" />)
    fireEvent.click(screen.getByRole('button', { name: '송장·검수' }))

    expect(await screen.findByLabelText('1번 송장 1번 박스 quantity')).toHaveValue(100)
    expect(screen.queryByText(/임시 기본값/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '박스 추가' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '새 송장 추가' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '임시저장' }))

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({
      complete: false,
      parcels: [{ boxes: [{ quantity: 100 }] }],
    })
  })
  it.each([90, 110])('requires a nonblank discrepancy explanation before saving %i received units against a purchase of 100', async (quantity) => {
    const currentInspection = {
      ...inspection,
      parcels: [{ ...inspection.parcels[0], boxes: [{ ...box, quantity, lengthCm: null, widthCm: null, heightCm: null, weightKg: null }] }],
    }
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({ ...detail, inspection: currentInspection }))
      .mockResolvedValueOnce(json({ inspection: { ...currentInspection, revision: 1 } }))
    stubInspectionFetch(fetcher)
    render(<PurchaseInspectionButton id={id} productName="유리컵" />)
    fireEvent.click(screen.getByRole('button', { name: '송장·검수' }))
    const note = await screen.findByLabelText('수량 차이 오류 설명')
    fireEvent.click(screen.getByRole('button', { name: '임시저장' }))
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(mocks.toast).toHaveBeenCalledWith('입고오류: 구매수량과 실제 입고수량이 다릅니다. 수량 차이 오류 설명을 입력해주세요.')
    expect(note).toHaveFocus()

    fireEvent.change(note, { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: '임시저장' }))
    expect(fetcher).toHaveBeenCalledTimes(1)

    const reason = quantity < 100 ? '공급처가 10개를 누락했습니다.' : '공급처가 여분 10개를 동봉했습니다.'
    fireEvent.change(note, { target: { value: reason } })
    fireEvent.click(screen.getByRole('button', { name: '임시저장' }))
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({
      complete: false, acknowledgeMismatch: false, resolutionNote: reason,
      parcels: [{ boxes: [{ quantity, lengthCm: null, widthCm: null, heightCm: null, weightKg: null }] }],
    })
    expect(fetcher.mock.calls[1][0]).toBe(`/api/purchasing/purchase-requests/${id}/inspection`)
    expect(fetcher.mock.calls[1][1].method).toBe('POST')
  })
  it('adds exactly one copy of the first box to its own tracking number', async () => {
    const first = { ...box, id: '00000000-0000-4000-8000-000000000005', quantity: 12, lengthCm: 60 }
    const second = { ...box, id: '00000000-0000-4000-8000-000000000006', quantity: 3 }
    const savedInspection = {
      ...inspection,
      revision: 1,
      boxNumbers: { [box.id]: '261125-001', [first.id]: '261125-002', [second.id]: '261125-003' },
      parcels: [inspection.parcels[0], {
        id: '00000000-0000-4000-8000-000000000004',
        trackingNumber: 'SF002', boxes: [first, second],
      }],
    }
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({ ...detail, status: 'inspecting', inspection: savedInspection }))
      .mockResolvedValueOnce(json({ inspection: { ...savedInspection, revision: 2 } }))
    stubInspectionFetch(fetcher)
    render(<PurchaseInspectionButton id={id} productName="유리컵" />)
    fireEvent.click(screen.getByRole('button', { name: '송장·검수' }))

    const copy = await screen.findByRole('button', { name: '2번 송장 박스 복사' })
    fireEvent.click(copy)
    expect(screen.getByLabelText('2번 송장 3번 박스 quantity')).toHaveValue(12)
    expect(screen.getByLabelText('2번 송장 3번 박스 lengthCm')).toHaveValue(60)
    expect(screen.queryByLabelText('2번 송장 4번 박스 quantity')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('1번 송장 2번 박스 quantity')).not.toBeInTheDocument()
    expect(screen.getByText('261125-002')).toBeInTheDocument()
    expect(screen.getByText('미발급')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('2번 송장 3번 박스 lengthCm'), { target: { value: '77' } })
    expect(screen.getByLabelText('2번 송장 1번 박스 lengthCm')).toHaveValue(60)
    fireEvent.change(screen.getByLabelText('수량 차이 오류 설명'), { target: { value: '공급처 포장 수량 확인' } })
    fireEvent.click(screen.getByRole('button', { name: '임시저장' }))
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
    const saved = JSON.parse(fetcher.mock.calls[1][1].body)
    expect(saved.parcels[1].trackingNumber).toBe('SF002')
    expect(saved.parcels[1].boxes).toHaveLength(3)
    expect(saved.parcels[1].boxes[2]).toEqual({ ...first, id: expect.any(String), lengthCm: 77 })
    expect(saved.parcels[1].boxes[2].id).not.toBe(first.id)
  })
  it('keeps an unsaved box draft and its original revision after registering a description-only inspection issue', async () => {
    // A response with a newer revision must not silently rebase local boxes:
    // a real concurrent parcel save should still be rejected by the server.
    const registeredInspection = { ...inspection, revision: 8, hasReportedIssue: true }
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json(detail))
      .mockResolvedValueOnce(json({
        inspection: registeredInspection,
        issue: { id: 'issue-1', description: '외관 파손', createdAt: '2026-11-12T01:00:00.000Z', createdByUserId: 'staff-id', attachments: [] },
      }))
      .mockResolvedValueOnce(json({ inspection: { ...registeredInspection, revision: 2 } }))
    stubInspectionFetch(fetcher)
    render(<PurchaseInspectionButton id={id} productName="유리컵" />)
    fireEvent.click(screen.getByRole('button', { name: '송장·검수' }))

    fireEvent.change(await screen.findByLabelText('1번 송장 1번 박스 lengthCm'), { target: { value: '77' } })
    expect(screen.queryByLabelText('오류 설명')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '검수 오류 등록' }))
    fireEvent.change(screen.getByLabelText('오류 설명'), { target: { value: '외관 파손' } })
    fireEvent.click(screen.getByRole('button', { name: '오류 등록' }))
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))

    fireEvent.change(screen.getByLabelText('수량 차이 오류 설명'), { target: { value: '공급처 부족수량 10개를 확인했습니다.' } })
    fireEvent.click(screen.getByRole('button', { name: '임시저장' }))
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3))
    const savedBody = JSON.parse(fetcher.mock.calls[2][1].body)
    expect(savedBody.revision).toBe(0)
    expect(savedBody.parcels[0].boxes[0].lengthCm).toBe(77)
  })
  it('shows issued box numbers and enables sticker printing after a draft save', async () => {
    const boxId = inspection.parcels[0].boxes[0].id
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json(detail))
      .mockResolvedValueOnce(json({ inspection: { ...inspection, revision: 1, boxNumbers: { [boxId]: '261125-001' } } }))
    stubInspectionFetch(fetcher)
    render(<PurchaseInspectionButton id={id} productName="유리컵" />)
    fireEvent.click(screen.getByRole('button', { name: '송장·검수' }))

    const saveDraft = await screen.findByRole('button', { name: '임시저장' })
    expect(screen.queryByRole('button', { name: '박스 스티커 인쇄' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('수량 차이 오류 설명'), { target: { value: '공급처 부족수량 확인' } })
    fireEvent.click(saveDraft)

    expect(await screen.findByText('261125-001')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '박스 스티커 인쇄' })).toBeEnabled()
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('shows the shortage in inspection and completes inspection and arrival in one request', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json(detail)).mockResolvedValueOnce(json({ inspection: { ...inspection, revision: 1 }, status: 'china_arrived' }))
    stubInspectionFetch(fetcher)
    render(<PurchaseInspectionButton id={id} productName="유리컵" />)
    fireEvent.click(screen.getByRole('button', { name: '송장·검수' }))
    expect(await screen.findByRole('status')).toHaveTextContent('입고오류 · 부족 10개')
    fireEvent.click(screen.getByRole('checkbox', { name: '구매수량과 실제 입고수량의 차이를 확인했습니다.' }))
    fireEvent.change(screen.getByLabelText('수량 차이 오류 설명'), { target: { value: '공급처와 부족수량 확인' } })
    fireEvent.click(screen.getByRole('button', { name: '검수완료' }))
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({ complete: true, acknowledgeMismatch: true, resolutionNote: '공급처와 부족수량 확인' })
    expect(mocks.refresh).toHaveBeenCalled()
  })
  it('does not advance to arrival when verification is rejected', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json(detail)).mockResolvedValueOnce(json({ error: '입고오류를 확인해주세요.' }, false))
    stubInspectionFetch(fetcher)
    render(<PurchaseInspectionButton id={id} productName="유리컵" />)
    fireEvent.click(screen.getByRole('button', { name: '송장·검수' }))
    await screen.findByRole('status')
    fireEvent.change(screen.getByLabelText('수량 차이 오류 설명'), { target: { value: '공급처 부족수량을 확인했습니다.' } })
    fireEvent.click(screen.getByRole('button', { name: '검수완료' }))
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith('입고오류를 확인해주세요.'))
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('shows completed receipts as read-only', async () => {
    stubInspectionFetch(vi.fn(async () => json({ ...detail, status: 'china_arrived' })))
    render(<PurchaseInspectionButton id={id} productName="유리컵" />)
    fireEvent.click(screen.getByRole('button', { name: '송장·검수' }))
    expect(await screen.findByLabelText('운송장번호 1')).toBeDisabled()
    expect(screen.queryByRole('button', { name: '검수완료' })).not.toBeInTheDocument()
  })
  it('shows both sticker file controls above the parcels and the purchase summary below them', async () => {
    const fileId = '00000000-0000-4000-8000-000000000010'
    stubInspectionFetch(vi.fn(async () => json(detail)), [{ id: fileId, kind: 'quality', source: 'works', fileName: '라벨.pdf', contentType: 'application/pdf' }])
    render(<PurchaseInspectionButton id={id} productName="유리컵" />)
    fireEvent.click(screen.getByRole('button', { name: '송장·검수' }))
    const print = await screen.findByRole('link', { name: '품질표시사항 인쇄' })
    const tracking = screen.getByLabelText('운송장번호 1')
    expect(print).toHaveAttribute('href', `/api/purchasing/purchase-requests/${id}/inspection/labels?file=${fileId}&source=works&print=1`)
    expect(print.compareDocumentPosition(tracking) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const summary = screen.getByText((_, element) => element?.tagName === 'P' && element.textContent?.startsWith('구매수량 ') === true)
    expect(tracking.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByLabelText('바코드 스티커 파일 등록')).toBeEnabled()
  })
})
