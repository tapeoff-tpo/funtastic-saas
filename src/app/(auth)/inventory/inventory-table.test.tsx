import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import type { ReactNode } from 'react'
import { InventoryTable } from './inventory-table'

vi.mock('./adjust-stock-dialog', () => ({ AdjustStockDialog: () => null }))
vi.mock('./bulk-adjustment-dialog', () => ({ BulkAdjustmentDialog: () => null }))
vi.mock('./excel-upload-dialog', () => ({ ExcelUploadDialog: () => null }))
vi.mock('./history-dialog', () => ({ HistoryDialog: () => null }))
vi.mock('@/components/ui/synced-scroll', () => ({ SyncedScrollContainer: ({ children }: { children: ReactNode }) => <div>{children}</div> }))

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

  it('labels historical stock and prevents stock changes while preserving the live-month controls', () => {
    const props = { data: [], total: 0, page: 1, pageSize: 25, warehouseZones: [], searched: true }
    const { rerender } = render(<NuqsTestingAdapter><InventoryTable {...props} referenceMonth="2026-09" /></NuqsTestingAdapter>)
    expect(screen.getByText('2026-09 월말재고')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '재고 등록' })).toBeNull()
    expect(screen.queryByRole('button', { name: '엑셀 업로드' })).toBeNull()
    rerender(<NuqsTestingAdapter><InventoryTable {...props} referenceMonth="2026-09" snapshotAvailable={false} /></NuqsTestingAdapter>)
    expect(screen.getAllByText('2026-09 월말 재고 자료가 등록되지 않았습니다.')).toHaveLength(2)
    const now = new Date(Date.now() + 9 * 60 * 60 * 1000)
    const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
    rerender(<NuqsTestingAdapter><InventoryTable {...props} referenceMonth={month} /></NuqsTestingAdapter>)
    expect(screen.getByRole('button', { name: '재고 등록' })).toBeInTheDocument()
  })
})
