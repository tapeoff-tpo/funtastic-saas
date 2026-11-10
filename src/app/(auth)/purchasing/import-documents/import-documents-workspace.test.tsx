import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ImportDocumentsWorkspace } from './import-documents-workspace'

const navigate = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: navigate }) }))
vi.mock('./import-document-editor', () => ({
  ImportDocumentEditor: ({ shipmentId, onDirtyChange }: { shipmentId: string; onDirtyChange: (dirty: boolean) => void }) =>
    <button onClick={() => onDirtyChange(true)}>문서 편집 {shipmentId}</button>,
}))

afterEach(() => { vi.restoreAllMocks(); navigate.mockClear() })

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
