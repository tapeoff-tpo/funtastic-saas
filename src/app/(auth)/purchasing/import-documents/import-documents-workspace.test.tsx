import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ImportDocumentsWorkspace } from './import-documents-workspace'

const navigate = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: navigate }), useSearchParams: () => new URLSearchParams(window.location.search) }))
vi.mock('./import-document-editor', () => ({
  ImportDocumentEditor: ({ shipmentId, onDirtyChange }: { shipmentId: string; onDirtyChange: (dirty: boolean) => void }) =>
    <button onClick={() => onDirtyChange(true)}>문서 편집 {shipmentId}</button>,
}))

vi.mock('./korea-shipping-document-panel', () => ({ KoreaShippingDocumentPanel: ({ group, onGroupChange }: { group: string; onGroupChange: (group: string) => void }) => <button onClick={() => onGroupChange('box')}>한국 서류 {group}</button> }))

afterEach(() => { window.history.replaceState(null, '', '/'); vi.restoreAllMocks(); navigate.mockClear() })

const shipments = [{ id: 'one', label: '출고 1' }, { id: 'two', label: '출고 2' }]

it('opens the selected shipment and requires confirmation before discarding document edits', () => {
  render(<ImportDocumentsWorkspace shipments={shipments} selectedShipmentId="one" invalidSelection={false} />)
  fireEvent.click(screen.getByRole('button', { name: '문서 편집 one' }))
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  fireEvent.change(screen.getByRole('combobox', { name: '중국출고 선택' }), { target: { value: 'two' } })
  expect(confirm).toHaveBeenCalledOnce()
  expect(navigate).not.toHaveBeenCalled()
  confirm.mockReturnValue(true)
  fireEvent.change(screen.getByRole('combobox', { name: '중국출고 선택' }), { target: { value: 'two' } })
  expect(navigate).toHaveBeenCalledWith('/purchasing/import-documents?shipment=two')
})

it('keeps the standalone cost workspace when switching shipments', () => {
  render(<ImportDocumentsWorkspace shipments={shipments} selectedShipmentId="one" invalidSelection={false} mode="cost" />)
  fireEvent.change(screen.getByRole('combobox', { name: '중국출고 선택' }), { target: { value: 'two' } })
  expect(navigate).toHaveBeenCalledWith('/purchasing/import-documents/costs?shipment=two')
})


it('restores the Korean document and grouping from the URL on refresh', () => {
  window.history.replaceState(null, '', '/purchasing/import-documents?shipment=one&document=korea&group=box')
  const view = render(<ImportDocumentsWorkspace shipments={shipments} selectedShipmentId="one" invalidSelection={false} />)
  expect(screen.getByRole('tab', { name: '한국 출고서류' }).getAttribute('aria-selected')).toBe('true')
  expect(screen.getByRole('button', { name: '한국 서류 box' })).toBeTruthy()
  view.unmount()
  render(<ImportDocumentsWorkspace shipments={shipments} selectedShipmentId="one" invalidSelection={false} />)
  expect(screen.getByRole('button', { name: '한국 서류 box' })).toBeTruthy()
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'two' } })
  expect(navigate).toHaveBeenCalledWith('/purchasing/import-documents?shipment=two&document=korea&group=box')
})

it('writes tab and grouping choices to the URL without a server navigation', () => {
  window.history.replaceState(null, '', '/purchasing/import-documents?shipment=one')
  const props = { shipments, selectedShipmentId: 'one', invalidSelection: false }
  const view = render(<ImportDocumentsWorkspace {...props} />)
  fireEvent.click(screen.getByRole('tab', { name: '한국 출고서류' }))
  expect(new URLSearchParams(window.location.search).get('document')).toBe('korea')
  view.rerender(<ImportDocumentsWorkspace {...props} />)
  expect(screen.getByRole('button', { name: '한국 서류 pallet' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '한국 서류 pallet' }))
  view.rerender(<ImportDocumentsWorkspace {...props} />)
  expect(screen.getByRole('button', { name: '한국 서류 box' })).toBeTruthy()
  expect(navigate).not.toHaveBeenCalled()
})
