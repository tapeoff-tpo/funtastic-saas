import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ImportDocumentEditor } from './import-document-editor'
vi.mock('./shipment-cost-panel', () => ({ ShipmentCostPanel: () => <p>별도 회차 원가 계산</p> }))
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
it('opens the invoice template preview first and refreshes it after editing document information', async () => {
  const fetcher = vi.fn(async (_url: string, request?: RequestInit) => {
    if (!request?.method) return { ok: true, json: async () => ({ shipmentNo: 'CN-1', plannedOutboundDate: '2026-11-20', snapshot: 'a'.repeat(64), items: [], boxes: [], pallets: [], palletCount: 0, looseBoxCount: 0, packageCount: 0, boxCount: 0 }) }
    return { ok: true, json: async () => ({ html: '<html><body>INVOICE · PACKING LIST</body></html>' }) }
  })
  vi.stubGlobal('fetch', fetcher)
  render(<ImportDocumentEditor shipmentId="shipment" onDirtyChange={vi.fn()} />)
  const preview = await screen.findByTitle('인보이스·패킹리스트 엑셀 양식')
  expect(preview).toHaveAttribute('sandbox', '')
  expect(preview).toHaveAttribute('srcdoc', expect.stringContaining('PACKING LIST'))
  expect(screen.getByRole('button', { name: '엑셀 다운로드' })).toBeEnabled()
  expect(screen.queryByText('별도 회차 원가 계산')).not.toBeInTheDocument()
  expect(screen.getByLabelText('문서번호 / 发票编号')).not.toBeVisible()
  expect(JSON.parse(fetcher.mock.calls[1][1]!.body as string)).toMatchObject({ intent: 'preview', invoiceNo: 'CN-1' })
  fireEvent.click(screen.getByRole('button', { name: '문서 정보 수정' }))
  fireEvent.change(screen.getByLabelText('문서번호 / 发票编号'), { target: { value: 'INV-UPDATED' } })
  await waitFor(() => expect(fetcher.mock.calls.some(([, request]) => request?.body && JSON.parse(request.body as string).invoiceNo === 'INV-UPDATED')).toBe(true))
})

it('shows cost calculation separately without requesting an invoice preview', async () => {
  const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ shipmentNo: 'CN-1', plannedOutboundDate: '2026-11-20', snapshot: 'a'.repeat(64), items: [], boxes: [], pallets: [], palletCount: 0, looseBoxCount: 0, packageCount: 0, boxCount: 0, costPacking: {} }) }))
  vi.stubGlobal('fetch', fetcher)
  render(<ImportDocumentEditor shipmentId="shipment" onDirtyChange={vi.fn()} mode="cost" />)
  expect(await screen.findByText('별도 회차 원가 계산')).toBeInTheDocument()
  expect(screen.queryByTitle('인보이스·패킹리스트 엑셀 양식')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '엑셀 다운로드' })).not.toBeInTheDocument()
  expect(fetcher).toHaveBeenCalledTimes(1)
})
