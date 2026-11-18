import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { priceNumberDateKey } from '@/lib/analytics/price-number-date'
import { priceTablePages, type PriceTableNavigation } from './price-table-navigation'
import { PriceTableWorkspace } from './price-table-workspace'

vi.mock('./price-registration-actions', () => ({ setPriceRegistrationExcluded: vi.fn() }))
const push = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

afterEach(() => { cleanup(); localStorage.clear() })

const navigation: PriceTableNavigation = { view: 'compare', sheetName: '상품등록', search: '테스트', sortKey: 'sourceNumber', sortOrder: 'asc' }
const defaultProps = { navigation, page: 14 }

describe('price table mall selection', () => {
  it('selects every mall initially and keeps the common price visible when clearing', () => {
    render(<PriceTableWorkspace {...defaultProps} rows={[]} />)
    fireEvent.click(screen.getByText("몰 선택·그룹 ▾"))
    const inputs = screen.getAllByRole('checkbox') as HTMLInputElement[]
    expect(inputs.length).toBeGreaterThan(6)
    expect(inputs.every(input => input.checked)).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '몰 선택 해제' }))
    expect(inputs.filter(input => input.checked)).toHaveLength(0)
    expect(screen.getByRole('link', { name: '공통 판매가' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '전체 선택' }))
    expect(inputs.every(input => input.checked)).toBe(true)
  })
  it('restores a saved custom mall group in one click', () => {
    render(<PriceTableWorkspace {...defaultProps} rows={[]} />)
    fireEvent.click(screen.getByText("몰 선택·그룹 ▾"))
    fireEvent.click(screen.getByRole('button', { name: '몰 선택 해제' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '쿠팡' }))
    fireEvent.change(screen.getByRole('textbox', { name: '몰 그룹 이름' }), { target: { value: 'B2C몰' } })
    fireEvent.click(screen.getByRole('button', { name: '현재 선택을 그룹 저장' }))
    fireEvent.click(screen.getByRole('button', { name: '전체 선택' }))
    fireEvent.click(screen.getByRole('button', { name: 'B2C몰' }))
    expect((screen.getAllByRole('checkbox') as HTMLInputElement[]).filter(input => input.checked)).toHaveLength(1)
    expect(JSON.parse(localStorage.getItem('price-table-mall-groups-v1')!)).toHaveProperty('B2C몰')
  })
})


it('shows saved dates in price comparison and only missing malls in registration review', () => {
  const key = '쿠팡 상품번호'
  const rows = [{
    id: 'row-1',
    rowNumber: 4,
    sourceNumber: '27',
    productCode: 'SKU-1',
    productName: '테스트 상품',
    optionName: null,
    registeredProductName: null,
    rawData: { [key]: '123456', [priceNumberDateKey(key)]: '2026-11-10', '오늘의집 상품번호': '789012' },
  }]
  const { rerender } = render(<PriceTableWorkspace {...defaultProps} rows={rows} />)
  expect(screen.getByRole('columnheader', { name: 'No.' })).toBeVisible()
  expect(screen.getByRole('cell', { name: '27' })).toBeVisible()
  expect(screen.getAllByText('789012')[0]).toBeVisible()
  expect(screen.getByText('입력일 2026-11-10')).toBeVisible()
  expect(screen.queryByText('입력일 미기록')).not.toBeInTheDocument()
  const sortParams = new URL(screen.getByRole('link', { name: 'No.' }).getAttribute('href')!, 'https://example.com').searchParams
  expect(Object.fromEntries(sortParams)).toEqual({ sheet: '상품등록', sort: 'sourceNumber', order: 'desc', view: 'compare', q: '테스트' })
  expect(screen.getByRole('link', { name: '등록 누락 확인' })).toHaveAttribute('href', expect.stringContaining('page=14'))
  rerender(<PriceTableWorkspace {...defaultProps} navigation={{ ...navigation, view: 'products', malls: ['coupang', 'toss'] }}
    canRegister rows={rows.map((row) => ({ ...row, missingMalls: [{ id: 'toss', label: '토스쇼핑' }] }))} />)
  expect(screen.getByText('27')).toBeVisible()
  expect(screen.getByRole('link', { name: '토스쇼핑' })).toHaveAttribute('href', expect.stringContaining('row=row-1&mall=toss'))
  expect(screen.getByRole('button', { name: '등록 제외' })).toBeVisible()
  expect(screen.queryByText('입력일 2026-11-10')).not.toBeInTheDocument()
})


it('shows up to ten page numbers in each group', () => {
  expect(priceTablePages(1, 24)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  expect(priceTablePages(14, 24)).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20])
  expect(priceTablePages(24, 24)).toEqual([21, 22, 23, 24])
})


it('uses saved mall groups for registration review and skips baseline price columns', async () => {
  localStorage.setItem('price-table-mall-groups-v1', JSON.stringify({ B2C몰: ['b2b', 'b2c', 'coupang'] }))
  render(<PriceTableWorkspace {...defaultProps} navigation={{ ...navigation, view: 'products' }} rows={[]} />)
  fireEvent.click(await screen.findByRole('button', { name: 'B2C몰' }))
  const url = new URL(push.mock.lastCall![0], 'https://example.com')
  expect(url.searchParams.get('malls')).toBe('coupang')
  expect(url.searchParams.get('page')).toBeNull()
})


it('keeps distinct B2B and B2C prices visible when every marketplace is deselected', () => {
  render(<PriceTableWorkspace {...defaultProps} rows={[{
    id: 'separate-prices', rowNumber: 1, sourceNumber: null, productCode: 'SKU-PRICE', productName: '가격 확인',
    optionName: null, registeredProductName: null,
    rawData: { 'B2B 판매가': '12,000', 'B2C 판매가': '15000' },
  }]} />)
  fireEvent.click(screen.getByText('몰 선택·그룹 ▾'))
  fireEvent.click(screen.getByRole('button', { name: '몰 선택 해제' }))
  expect(screen.getByRole('columnheader', { name: 'B2B 판매가' })).toBeVisible()
  expect(screen.getByRole('columnheader', { name: 'B2C 판매가' })).toBeVisible()
  expect(screen.getByRole('cell', { name: '12,000' })).toBeVisible()
  expect(screen.getByRole('cell', { name: '15,000' })).toBeVisible()
})
