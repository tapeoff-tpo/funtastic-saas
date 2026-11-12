import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ShortMeetingRow } from '@/lib/analytics/short-meeting'
import { ShortMeetingTable } from './short-meeting-table'

const rows: ShortMeetingRow[] = [
  { sku: 'A-01', productName: '테이블', optionName: '검정', todayOutbound: 3, currentStock: 20, stockAfterOutbound: 17, averageDailyOutbound: 45, monthOutbound: 12, stockStatus: 'normal', outOfStock: '11/11 품절', chinaStock: 10, chinaShipmentDate: '11/10', chinaOrderDate: '11/01', chinaOrderStatus: '구매완료', location: 'A1' },
  { sku: 'B-02', productName: '조명', optionName: '흰색', todayOutbound: 2, currentStock: 2, stockAfterOutbound: 0, averageDailyOutbound: 30, monthOutbound: 8, stockStatus: 'out', outOfStock: null, chinaStock: 0, chinaShipmentDate: null, chinaOrderDate: null, chinaOrderStatus: null, location: '-' },
]

describe('ShortMeetingTable', () => {
  it('shows source status and filters the meeting list by code and risk', () => {
    render(<ShortMeetingTable rows={rows} sheetStatus="available" />)
    expect(screen.getByText('11/11 품절')).toBeInTheDocument()
    expect(screen.getByText('미등록')).toBeInTheDocument()
    expect(screen.getByText('구매완료')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: '상품 검색' }), { target: { value: 'B-02' } })
    expect(screen.queryByText('테이블')).not.toBeInTheDocument()
    expect(screen.getByText('조명')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: '상품 검색' }), { target: { value: '' } })
    fireEvent.click(screen.getByRole('checkbox', { name: '재고 위험만 보기' }))
    expect(screen.queryByText('테이블')).not.toBeInTheDocument()
    expect(screen.getByText('조명')).toBeInTheDocument()
  })

  it('does not treat a failed sheet connection as an absent product', () => {
    render(<ShortMeetingTable rows={rows} sheetStatus="unavailable" />)
    expect(screen.getAllByText('확인 불가')).toHaveLength(2)
    expect(screen.queryByText('미등록')).not.toBeInTheDocument()
  })

  it('sorts numeric values in both directions and places missing values last', () => {
    const moreRows: ShortMeetingRow[] = [
      { ...rows[0], sku: 'A-01', chinaStock: 10 },
      { ...rows[1], sku: 'B-02', chinaStock: 2 },
      { ...rows[0], sku: 'C-03', chinaStock: null },
    ]
    render(<ShortMeetingTable rows={moreRows} sheetStatus="available" />)
    const order = () => within(screen.getByRole('table')).getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell')[0].textContent)
    const button = screen.getByRole('button', { name: '중국재고' })
    fireEvent.click(button)
    expect(order()).toEqual(['B-02', 'A-01', 'C-03'])
    expect(button.closest('th')).toHaveAttribute('aria-sort', 'ascending')
    fireEvent.click(button)
    expect(order()).toEqual(['A-01', 'B-02', 'C-03'])
    expect(button.closest('th')).toHaveAttribute('aria-sort', 'descending')
  })

  it('sorts by the latest date in a list and keeps filters working', () => {
    const moreRows: ShortMeetingRow[] = [
      { ...rows[0], sku: 'A-01', stockStatus: 'out', chinaShipmentDate: '2026-02-09, 2026-11-01' },
      { ...rows[1], sku: 'B-02', chinaShipmentDate: '2026-03-01' },
      { ...rows[0], sku: 'C-03', stockStatus: 'normal', chinaShipmentDate: null },
    ]
    render(<ShortMeetingTable rows={moreRows} sheetStatus="available" />)
    const order = () => within(screen.getByRole('table')).getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell')[0].textContent)
    fireEvent.click(screen.getByRole('button', { name: '중국출고날짜' }))
    expect(order()).toEqual(['B-02', 'A-01', 'C-03'])
    fireEvent.click(screen.getByRole('checkbox', { name: '재고 위험만 보기' }))
    expect(order()).toEqual(['B-02', 'A-01'])
    fireEvent.change(screen.getByRole('textbox', { name: '상품 검색' }), { target: { value: 'A-01' } })
    expect(order()).toEqual(['A-01'])
  })

  it('preserves the original priority order until a heading is selected and handles unavailable stock lists', () => {
    render(<ShortMeetingTable rows={[rows[1], rows[0]]} sheetStatus="unavailable" />)
    const order = () => within(screen.getByRole('table')).getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell')[0].textContent)
    expect(order()).toEqual(['B-02', 'A-01'])
    fireEvent.click(screen.getByRole('button', { name: '품절리스트' }))
    expect(order()).toEqual(['B-02', 'A-01'])
    fireEvent.click(screen.getByRole('button', { name: '품목코드' }))
    expect(order()).toEqual(['A-01', 'B-02'])
  })
})
