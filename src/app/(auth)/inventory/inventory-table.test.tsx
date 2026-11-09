import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { InventoryTable } from './inventory-table'

vi.mock('./adjust-stock-dialog', () => ({ AdjustStockDialog: () => null }))
vi.mock('./bulk-adjustment-dialog', () => ({ BulkAdjustmentDialog: () => null }))
vi.mock('./excel-upload-dialog', () => ({ ExcelUploadDialog: () => null }))
vi.mock('./history-dialog', () => ({ HistoryDialog: () => null }))

describe('inventory month filter', () => {
  it('includes the selected year and month in the server search and restores the applied period', async () => {
    const onUrlUpdate = vi.fn()
    const props = { data: [], total: 0, page: 1, pageSize: 25, warehouseZones: [], searched: false }
    const { rerender } = render(
      <NuqsTestingAdapter onUrlUpdate={onUrlUpdate} searchParams="?year=2026&month=11">
        <InventoryTable {...props} referenceMonth="2026-11" />
      </NuqsTestingAdapter>,
    )
    fireEvent.change(screen.getByLabelText('조회 월'), { target: { value: '10' } })
    fireEvent.click(screen.getByRole('button', { name: '검색' }))
    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
    expect(onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.get('year')).toBe('2026')
    expect(onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.get('month')).toBe('10')
    expect(onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.get('searched')).toBe('1')
    rerender(
      <NuqsTestingAdapter onUrlUpdate={onUrlUpdate} searchParams="?year=2026&month=9">
        <InventoryTable {...props} referenceMonth="2026-09" />
      </NuqsTestingAdapter>,
    )
    await waitFor(() => expect(screen.getByLabelText('조회 월')).toHaveValue('9'))
  })
})
