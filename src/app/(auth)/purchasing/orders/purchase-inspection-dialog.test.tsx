import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
    expect(screen.getByRole('button', { name: '송장 추가' })).toBeInTheDocument()
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
  it('copies a completed box under the same tracking number with sequential box numbers and editable values', async () => {
    stubInspectionFetch(vi.fn(async () => json(detail)))
    render(<PurchaseInspectionButton id={id} productName="유리컵" />)
    fireEvent.click(screen.getByRole('button', { name: '송장·검수' }))

    fireEvent.click(await screen.findByRole('button', { name: '박스 복사' }))
    fireEvent.change(screen.getByLabelText('1번 송장 1번 박스 복사 개수'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: '복사 추가' }))

    expect(screen.getByLabelText('1번 송장 6번 박스 quantity')).toHaveValue(90)
    expect(screen.getByLabelText('1번 송장 6번 박스 lengthCm')).toHaveValue(50)
    expect(screen.getByLabelText('1번 송장 6번 박스 widthCm')).toHaveValue(40)
    expect(screen.getByLabelText('1번 송장 6번 박스 heightCm')).toHaveValue(30)
    expect(screen.getByLabelText('1번 송장 6번 박스 weightKg')).toHaveValue(10)

    fireEvent.change(screen.getByLabelText('1번 송장 4번 박스 lengthCm'), { target: { value: '60' } })
    expect(screen.getByLabelText('1번 송장 1번 박스 lengthCm')).toHaveValue(50)
    expect(screen.getByLabelText('1번 송장 4번 박스 lengthCm')).toHaveValue(60)
    expect(screen.getByLabelText('1번 송장 6번 박스 lengthCm')).toHaveValue(50)
  })
  it('copies boxes from an existing parcel header without adding boxes to another tracking number', async () => {
    const sourceBox = { ...box, id: '00000000-0000-4000-8000-000000000006', quantity: 12, lengthCm: 60, widthCm: 50, heightCm: 40, weightKg: 11 }
    const existingInspection = {
      ...inspection,
      parcels: [inspection.parcels[0], {
        id: '00000000-0000-4000-8000-000000000004',
        trackingNumber: 'SF002',
        boxes: [{ ...box, id: '00000000-0000-4000-8000-000000000005', lengthCm: null }, sourceBox],
      }],
    }
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({ ...detail, status: 'inspecting', inspection: existingInspection }))
      .mockResolvedValueOnce(json({ inspection: { ...existingInspection, revision: 1 } }))
    stubInspectionFetch(fetcher)
    render(<PurchaseInspectionButton id={id} productName="유리컵" />)
    fireEvent.click(screen.getByRole('button', { name: '송장·검수' }))

    const copy = await screen.findByRole('button', { name: '2번 송장 박스 복사' })
    expect(copy).toBeEnabled()
    expect(copy.closest('.overflow-x-auto')).toBeNull()
    const parcel = copy.closest('section')!
    expect(within(parcel).getByLabelText('운송장번호 2')).toHaveValue('SF002')
    expect(copy.compareDocumentPosition(parcel.querySelector('table')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.click(copy)
    const source = within(parcel).getByLabelText('복사할 박스')
    expect(within(source).getAllByRole('option').map((option) => option.textContent)).toEqual(['2번 송장 2번 박스 복사'])
    fireEvent.change(screen.getByLabelText('2번 송장 2번 박스 복사 개수'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: '복사 추가' }))

    expect(screen.queryByLabelText('1번 송장 2번 박스 quantity')).not.toBeInTheDocument()
    expect(screen.getByLabelText('운송장번호 1')).toHaveValue('SF001')
    expect(screen.getByLabelText('운송장번호 2')).toHaveValue('SF002')
    expect(screen.getByLabelText('2번 송장 3번 박스 quantity')).toHaveValue(12)
    expect(screen.getByLabelText('2번 송장 4번 박스 weightKg')).toHaveValue(11)
    fireEvent.change(screen.getByLabelText('2번 송장 3번 박스 quantity'), { target: { value: '9' } })
    fireEvent.change(screen.getByLabelText('2번 송장 3번 박스 lengthCm'), { target: { value: '77' } })
    expect(screen.getByLabelText('2번 송장 2번 박스 quantity')).toHaveValue(12)
    expect(screen.getByLabelText('2번 송장 2번 박스 lengthCm')).toHaveValue(60)
    expect(screen.getByLabelText('2번 송장 4번 박스 lengthCm')).toHaveValue(60)
    fireEvent.change(screen.getByLabelText('수량 차이 오류 설명'), { target: { value: '추가 포장 수량을 공급처에 확인했습니다.' } })
    fireEvent.click(screen.getByRole('button', { name: '임시저장' }))

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
    const saved = JSON.parse(fetcher.mock.calls[1][1].body)
    expect(saved.complete).toBe(false)
    expect(saved.parcels[0]).toEqual(existingInspection.parcels[0])
    expect(saved.parcels[1].trackingNumber).toBe('SF002')
    expect(saved.parcels[1].boxes).toHaveLength(4)
    expect(saved.parcels[1].boxes[1]).toEqual(sourceBox)
    expect(saved.parcels[1].boxes[2]).toMatchObject({ quantity: 9, lengthCm: 77, widthCm: 50, heightCm: 40, weightKg: 11 })
    expect(saved.parcels[1].boxes[3]).toMatchObject({ quantity: 12, lengthCm: 60, widthCm: 50, heightCm: 40, weightKg: 11 })
    const savedBoxIds = saved.parcels.flatMap((entry: { boxes: Array<{ id: string }> }) => entry.boxes.map((entryBox) => entryBox.id))
    expect(new Set(savedBoxIds).size).toBe(5)
  })
  it('keeps the parcel copy button outside the table while incomplete dimensions disable copying', async () => {
    stubInspectionFetch(vi.fn(async () => json({
      ...detail,
      status: 'inspecting',
      inspection: { ...inspection, parcels: [{ ...inspection.parcels[0], boxes: [{ ...box, lengthCm: null, widthCm: null, heightCm: null }] }] },
    })))
    render(<PurchaseInspectionButton id={id} productName="유리컵" />)
    fireEvent.click(screen.getByRole('button', { name: '송장·검수' }))

    const copy = await screen.findByRole('button', { name: '1번 송장 박스 복사' })
    expect(copy).toBeVisible()
    expect(copy).toBeDisabled()
    expect(copy.closest('.overflow-x-auto')).toBeNull()
    for (const field of ['lengthCm', 'widthCm', 'heightCm']) {
      fireEvent.change(screen.getByLabelText(`1번 송장 1번 박스 ${field}`), { target: { value: '10' } })
    }
    expect(copy).toBeEnabled()
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
  it('shows the shortage in inspection and completes in save-then-arrival order', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json(detail)).mockResolvedValueOnce(json({ inspection: { ...inspection, revision: 1 } })).mockResolvedValueOnce(json({ id, status: 'china_arrived' }))
    stubInspectionFetch(fetcher)
    render(<PurchaseInspectionButton id={id} productName="유리컵" />)
    fireEvent.click(screen.getByRole('button', { name: '송장·검수' }))
    expect(await screen.findByRole('status')).toHaveTextContent('입고오류 · 부족 10개')
    fireEvent.click(screen.getByRole('checkbox', { name: '구매수량과 실제 입고수량의 차이를 확인했습니다.' }))
    fireEvent.change(screen.getByLabelText('수량 차이 오류 설명'), { target: { value: '공급처와 부족수량 확인' } })
    fireEvent.change(screen.getByLabelText('스티커 부착 상태'), { target: { value: 'quality' } })
    fireEvent.click(screen.getByRole('button', { name: '검수완료' }))
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3))
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({ complete: true, acknowledgeMismatch: true, resolutionNote: '공급처와 부족수량 확인', stickerStatus: 'quality' })
    expect(fetcher.mock.calls[2][1]).toMatchObject({ method: 'PATCH', body: JSON.stringify({ status: 'china_arrived' }) })
    expect(mocks.refresh).toHaveBeenCalled()
  })
  it('does not advance to arrival when verification is rejected', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json(detail)).mockResolvedValueOnce(json({ error: '입고오류를 확인해주세요.' }, false))
    stubInspectionFetch(fetcher)
    render(<PurchaseInspectionButton id={id} productName="유리컵" />)
    fireEvent.click(screen.getByRole('button', { name: '송장·검수' }))
    await screen.findByRole('status')
    fireEvent.change(screen.getByLabelText('수량 차이 오류 설명'), { target: { value: '공급처 부족수량을 확인했습니다.' } })
    fireEvent.change(screen.getByLabelText('스티커 부착 상태'), { target: { value: 'none' } })
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
