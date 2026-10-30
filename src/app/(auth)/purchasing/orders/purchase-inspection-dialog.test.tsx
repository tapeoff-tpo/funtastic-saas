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
  it('shows the shortage in inspection and completes in save-then-arrival order', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json(detail)).mockResolvedValueOnce(json({ inspection: { ...inspection, revision: 1 } })).mockResolvedValueOnce(json({ id, status: 'china_arrived' }))
    vi.stubGlobal('fetch', fetcher)
    render(<PurchaseInspectionButton id={id} productName="유리컵" />)
    fireEvent.click(screen.getByRole('button', { name: '송장·검수' }))
    expect(await screen.findByRole('status')).toHaveTextContent('입고오류 · 부족 10개')
    fireEvent.click(screen.getByRole('checkbox', { name: '구매수량과 실제 입고수량의 차이를 확인했습니다.' }))
    fireEvent.change(screen.getByLabelText('입고오류 처리 사유'), { target: { value: '공급처와 부족수량 확인' } })
    fireEvent.click(screen.getByRole('button', { name: '검수완료 · 중국창고도착' }))
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3))
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({ complete: true, acknowledgeMismatch: true, resolutionNote: '공급처와 부족수량 확인' })
    expect(fetcher.mock.calls[2][1]).toMatchObject({ method: 'PATCH', body: JSON.stringify({ status: 'china_arrived' }) })
    expect(mocks.refresh).toHaveBeenCalled()
  })
  it('does not advance to arrival when verification is rejected', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json(detail)).mockResolvedValueOnce(json({ error: '입고오류를 확인해주세요.' }, false))
    vi.stubGlobal('fetch', fetcher)
    render(<PurchaseInspectionButton id={id} productName="유리컵" />)
    fireEvent.click(screen.getByRole('button', { name: '송장·검수' }))
    await screen.findByRole('status')
    fireEvent.click(screen.getByRole('button', { name: '검수완료 · 중국창고도착' }))
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith('입고오류를 확인해주세요.'))
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('shows completed receipts as read-only', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ ...detail, status: 'china_arrived' })))
    render(<PurchaseInspectionButton id={id} productName="유리컵" />)
    fireEvent.click(screen.getByRole('button', { name: '송장·검수' }))
    expect(await screen.findByLabelText('송장번호 1')).toBeDisabled()
    expect(screen.queryByRole('button', { name: '검수완료 · 중국창고도착' })).not.toBeInTheDocument()
  })
})
