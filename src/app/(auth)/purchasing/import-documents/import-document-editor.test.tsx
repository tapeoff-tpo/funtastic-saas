import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ImportDocumentEditor } from './import-document-editor'
vi.mock('./shipment-cost-panel', () => ({ ShipmentCostPanel: () => <p>별도 회차 원가 계산</p> }))
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const prepared = { shipmentNo: 'CN-1', plannedOutboundDate: '2026-11-20', snapshot: 'a'.repeat(64), items: [], boxes: [], pallets: [], palletCount: 0, looseBoxCount: 0, packageCount: 0, boxCount: 0 }
it('edits directly inside the document and saves the changed document under its revision', async () => {
  const dirty = vi.fn()
  const fetcher = vi.fn(async (_url: string, request?: RequestInit) => {
    if (!request?.method) return { ok: true, json: async () => prepared }
    const body = JSON.parse(request.body as string)
    if (body.intent === 'save-document') return { ok: true, json: async () => ({ revision: 1 }) }
    return { ok: true, json: async () => ({ html: `<html><body><table><tbody><tr><td><input aria-label="문서번호" data-edit-key="invoiceNo" value="${body.invoiceNo}" /></td></tr></tbody></table></body></html>` }) }
  })
  vi.stubGlobal('fetch', fetcher)
  render(<ImportDocumentEditor shipmentId="shipment" onDirtyChange={dirty} />)
  const input = await screen.findByLabelText('문서번호')
  expect(screen.queryByRole('button', { name: '문서 정보 수정' })).not.toBeInTheDocument()
  fireEvent.focus(input)
  fireEvent.change(input, { target: { value: 'INV-UPDATED' } })
  fireEvent.blur(input)
  fireEvent.click(screen.getByRole('button', { name: '저장' }))
  await screen.findByText('저장되었습니다.')
  const savedCall = fetcher.mock.calls.find(([, request]) => request?.body && JSON.parse(request.body as string).intent === 'save-document')!
  expect(JSON.parse(savedCall[1]!.body as string)).toMatchObject({ invoiceNo: 'INV-UPDATED', revision: 0 })
  expect(dirty).toHaveBeenCalledWith(true)
  expect(dirty).toHaveBeenLastCalledWith(false)
  expect(screen.queryByText('별도 회차 원가 계산')).not.toBeInTheDocument()
})
it('loads saved document values and does not round an untouched price when focusing its display', async () => {
  const data = { ...prepared, items: [{ id: 'a', sku: '100457-0001', englishName: 'Glass', hsCode: '7013', quantity: 1, unitPriceCny: 16.758 }], savedDocument: { revision: 3, snapshot: prepared.snapshot, inputs: { invoiceNo: 'SAVED-3', items: {}, boxes: {} } } }
  const fetcher = vi.fn(async (_url: string, request?: RequestInit) => {
    if (!request?.method) return { ok: true, json: async () => data }
    const body = JSON.parse(request.body as string)
    if (body.intent === 'save-document') return { ok: true, json: async () => ({ revision: 4 }) }
    return { ok: true, json: async () => ({ html: '<table><tbody><tr><td><input aria-label="Unit Price" data-edit-key="product:100457:unitPriceCny" value="16.76" /></td></tr></tbody></table>' }) }
  })
  vi.stubGlobal('fetch', fetcher)
  render(<ImportDocumentEditor shipmentId="shipment" onDirtyChange={vi.fn()} />)
  const input = await screen.findByLabelText('Unit Price')
  fireEvent.focus(input); fireEvent.blur(input)
  fireEvent.click(screen.getByRole('button', { name: '저장' }))
  await screen.findByText('저장되었습니다.')
  const call = fetcher.mock.calls.find(([, request]) => request?.body && JSON.parse(request.body as string).intent === 'save-document')!
  expect(JSON.parse(call[1]!.body as string)).toMatchObject({ invoiceNo: 'SAVED-3', revision: 3, items: { a: { unitPriceCny: 16.758 } } })
})
it('shows cost calculation separately without requesting an invoice preview', async () => {
  const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ ...prepared, costPacking: {} }) }))
  vi.stubGlobal('fetch', fetcher)
  render(<ImportDocumentEditor shipmentId="shipment" onDirtyChange={vi.fn()} mode="cost" />)
  expect(await screen.findByText('별도 회차 원가 계산')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '엑셀 다운로드' })).not.toBeInTheDocument()
  expect(fetcher).toHaveBeenCalledTimes(1)
})
it('switches preview templates without mutating the base price', async () => {
  const data = { ...prepared, items: [{ id: 'a', sku: '100457-0001', englishName: 'Glass', hsCode: '7013', quantity: 1, unitPriceCny: 10 }] }
  const fetcher = vi.fn(async (_url: string, request?: RequestInit) => request?.method ? { ok: true, json: async () => ({ html: '<table><tbody><tr><td>preview</td></tr></tbody></table>' }) } : { ok: true, json: async () => data })
  vi.stubGlobal('fetch', fetcher)
  render(<ImportDocumentEditor shipmentId="shipment" onDirtyChange={vi.fn()} />)
  fireEvent.click(await screen.findByRole('radio', { name: 'TAPEOFF용' }))
  await waitFor(() => expect(fetcher.mock.calls.some(([, request]) => request?.body && JSON.parse(request.body as string).template === 'tapeoff')).toBe(true))
  const body = JSON.parse(fetcher.mock.calls.find(([, request]) => request?.body && JSON.parse(request.body as string).template === 'tapeoff')![1]!.body as string)
  expect(body.items.a.unitPriceCny).toBe(10)
  expect(screen.getByRole('radio', { name: 'TAPEOFF용' })).toBeChecked()
})
it('offers a target choice when dragging TAPEOFF rows and sends the chosen merge without altering base items', async () => {
  const data = { ...prepared, items: [{ id: 'a', sku: '100457-0001', productName: '컵', englishName: 'Cup', quantity: 2, unitPriceCny: 10 }, { id: 'b', sku: '100458-0001', productName: '샘플', englishName: 'Sample', quantity: 1, unitPriceCny: 2 }] }
  const fetcher = vi.fn(async (_url: string, request?: RequestInit) => !request?.method ? { ok: true, json: async () => data } : { ok: true, json: async () => ({ html: '<table><tbody><tr><td><input aria-label="컵 영문명" data-edit-key="product:100457:englishName" value="Cup" /></td></tr><tr><td><input aria-label="샘플 영문명" data-edit-key="product:100458:englishName" value="Sample" /></td></tr></tbody></table>' }) })
  vi.stubGlobal('fetch', fetcher)
  render(<ImportDocumentEditor shipmentId="shipment" onDirtyChange={vi.fn()} />)
  fireEvent.click(await screen.findByRole('radio', { name: 'TAPEOFF용' }))
  const source = await screen.findByLabelText('샘플 영문명'), target = screen.getByLabelText('컵 영문명')
  const dataTransfer = { setData: vi.fn(), effectAllowed: '' }
  fireEvent.dragStart(source, { dataTransfer }); fireEvent.dragOver(target, { dataTransfer }); fireEvent.drop(target, { dataTransfer })
  expect(screen.getByRole('dialog', { name: '병합 기준 상품 선택' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /100457 · 컵 기준/ }))
  await waitFor(() => expect(fetcher.mock.calls.some(([, request]) => request?.body && JSON.parse(request.body as string).merges?.[0]?.target === '100457')).toBe(true))
})
