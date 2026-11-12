import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PurchaseInspectionIssueButton, PurchaseInspectionIssueList, PurchaseInspectionIssueRegister } from './purchase-inspection-issues'
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

const id = '00000000-0000-4000-8000-000000000001'

describe('purchase inspection issue UI', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    HTMLDialogElement.prototype.showModal = function () { this.open = true }
    HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new Event('close')) }
  })

  it('registers an issue with only its description and no photo', async () => {
    const onRegistered = vi.fn()
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        inspection: { version: 1, revision: 2, expectedQuantity: 10, parcels: [], checkedAt: null, checkedBy: null, resolutionNote: '', hasReportedIssue: true },
        issue: { id: 'issue-1', description: '수량 부족', createdAt: '2026-11-12T01:00:00.000Z', createdByUserId: 'staff-id', attachments: [] },
      }),
    })
    vi.stubGlobal('fetch', fetcher)
    render(<PurchaseInspectionIssueRegister purchaseItemId={id} onRegistered={onRegistered} />)

    fireEvent.change(screen.getByLabelText('오류 설명'), { target: { value: '수량 부족' } })
    fireEvent.click(screen.getByRole('button', { name: '오류 등록' }))

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    const [url, init] = fetcher.mock.calls[0]
    expect(url).toBe(`/api/purchasing/purchase-requests/${id}/inspection/issues`)
    expect((init.body as FormData).get('description')).toBe('수량 부족')
    expect((init.body as FormData).getAll('photos')).toHaveLength(0)
    expect(onRegistered).toHaveBeenCalledWith(expect.objectContaining({ issue: expect.objectContaining({ description: '수량 부족' }) }))
  })

  it('renders an error description and secure item-scoped photo route', () => {
    render(<PurchaseInspectionIssueList purchaseItemId={id} issues={[{
      id: '00000000-0000-4000-8000-000000000010',
      description: '상자 파손',
      createdAt: '2026-11-12T01:00:00.000Z',
      createdByUserId: null,
      attachments: [{
        id: '00000000-0000-4000-8000-000000000011', fileName: 'damage.jpg', contentType: 'image/jpeg', fileSize: 123, createdAt: '2026-11-12T01:00:00.000Z',
      }],
    }]} />)
    expect(screen.getByText('상자 파손')).toBeTruthy()
    expect(screen.getByAltText('검수 오류 사진: damage.jpg')).toHaveAttribute(
      'src',
      `/api/purchasing/purchase-requests/${id}/inspection/issues/00000000-0000-4000-8000-000000000010/attachments/00000000-0000-4000-8000-000000000011`,
    )
  })

  it('opens a reported issue from the purchase list and offers purchase correction on the same record', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({
      id, status: 'inspecting', productName: '상품',
      inspection: { version: 1, revision: 1, expectedQuantity: 100, parcels: [], checkedAt: null, checkedBy: null, resolutionNote: '' },
      inspectionIssues: [{ id: 'issue-a', description: '수량 10개 부족', createdAt: '', createdByUserId: null, attachments: [] }],
      purchaseFields: { requestedQuantity: 100, actualPurchaseQuantity: 100, supplierOrderNumber: '3317159640039018761', outboundExpectedDate: '2026-11-12', purchaseMethod: '개인' },
    }) })))
    render(<PurchaseInspectionIssueButton purchaseItemId={id} issueCount={1} />)
    fireEvent.click(screen.getByRole('button', { name: '오류 1건' }))
    expect(await screen.findByText('수량 10개 부족')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '주문서번호' })).toHaveValue('3317159640039018761')
    expect(screen.getByLabelText('정정 구매수량')).toHaveValue(100)
    expect(screen.getByRole('button', { name: '구매수량 정정 저장' })).toBeEnabled()
  })
})
