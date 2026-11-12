import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PurchaseInspectionPurchaseEditor } from './purchase-inspection-purchase-editor'
import type { PurchaseInspection } from '@/lib/purchasing/purchase-inspection'

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), error: vi.fn(), success: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))
vi.mock('sonner', () => ({ toast: { success: mocks.success, error: mocks.error } }))
vi.mock('./purchase-request-actions', () => ({ PurchasePlanFieldsV2: () => <div>구매 정보 입력</div> }))

const inspection: PurchaseInspection = { version: 1, revision: 3, expectedQuantity: 100, checkedAt: null, checkedBy: null, resolutionNote: '', parcels: [] }
const issues = [{ id: 'issue-a', description: '구매수량 오기입 확인', createdAt: '', createdByUserId: null, attachments: [] }]
const purchaseFields = { requestedQuantity: 100, actualPurchaseQuantity: 100, supplierOrderNumber: '3317159640039018761', outboundExpectedDate: '2026-11-12', purchaseMethod: '개인' }

describe('inspection issue purchase correction', () => {
  beforeEach(() => vi.clearAllMocks())

  it('saves an issue-linked quantity correction with its inspection revision and reason', async () => {
    const onCorrected = vi.fn()
    const saved = { actualPurchaseQuantity: 90, inspection: { ...inspection, revision: 4, expectedQuantity: 90 } }
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => saved }))
    vi.stubGlobal('fetch', fetcher)
    render(<PurchaseInspectionPurchaseEditor purchaseItemId="item-a" status="inspecting" inspection={inspection} issues={issues} purchaseFields={purchaseFields} onCorrected={onCorrected} />)
    fireEvent.change(screen.getByLabelText('정정 구매수량'), { target: { value: '90' } })
    fireEvent.change(screen.getByLabelText('구매수량 정정 사유'), { target: { value: '공급처 구매내역 90개로 확인' } })
    fireEvent.click(screen.getByRole('button', { name: '구매수량 정정 저장' }))
    await waitFor(() => expect(onCorrected).toHaveBeenCalledWith(saved))
    expect(fetcher).toHaveBeenCalledWith('/api/purchasing/purchase-requests/item-a/inspection/correction', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ issueId: 'issue-a', actualPurchaseQuantity: 90, reason: '공급처 구매내역 90개로 확인', expectedRevision: 3 }),
    }))
    expect(mocks.refresh).toHaveBeenCalledOnce()
  })

  it('does not offer quantity correction after warehouse arrival', () => {
    render(<PurchaseInspectionPurchaseEditor purchaseItemId="item-a" status="china_arrived" inspection={inspection} issues={issues} purchaseFields={purchaseFields} onCorrected={vi.fn()} />)
    expect(screen.queryByRole('button', { name: '구매수량 정정 저장' })).not.toBeInTheDocument()
    expect(screen.getByText('중국창고도착 이후에는 구매수량을 정정할 수 없습니다.')).toBeInTheDocument()
  })
})
