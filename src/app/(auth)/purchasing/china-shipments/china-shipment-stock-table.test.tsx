import { useState } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ChinaShipmentStockItem } from './china-shipments-board'
import { ChinaShipmentStockTable } from './china-shipment-stock-table'

function stock(id: string, sku: string, productName: string, warehouseCode = '중국창고'): ChinaShipmentStockItem {
  return { id, sku, productName, warehouseCode, optionName: null, chineseProductName: '商品', itemCategory: '상품', lastReceivedAt: '2026-11-02T15:00:00Z', onHandQuantity: 20, reservedQuantity: 5, availableQuantity: 15 }
}

function renderTable(items: ChinaShipmentStockItem[], extra = {}) {
  return render(<ChinaShipmentStockTable items={items} quantities={{}} onQuantityChange={vi.fn()} quantityLabel="이번 출고"
    tableLabel="신규 출고 상품 목록" emptyMessage="재고 없음" categoryForItem={() => '상품'} {...extra} />)
}

function orderedSkus() {
  return within(screen.getByRole('table')).getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell')[2].textContent)
}

function orderedNames() {
  return within(screen.getByRole('table')).getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell')[3].textContent)
}

describe('ChinaShipmentStockTable', () => {
  it('sorts product codes naturally in both directions without changing the source array', () => {
    const items = [stock('10', 'SKU-10', '나 상품'), stock('2', 'SKU-2', '다 상품'), stock('1', 'SKU-1', '가 상품')]
    renderTable(items)
    expect(orderedSkus()).toEqual(['SKU-1', 'SKU-2', 'SKU-10'])
    expect(screen.getByRole('columnheader', { name: /상품코드/ })).toHaveAttribute('aria-sort', 'ascending')
    fireEvent.click(screen.getByRole('button', { name: '상품코드 정렬' }))
    expect(orderedSkus()).toEqual(['SKU-10', 'SKU-2', 'SKU-1'])
    expect(screen.getByRole('columnheader', { name: /상품코드/ })).toHaveAttribute('aria-sort', 'descending')
    fireEvent.click(screen.getByRole('button', { name: '상품코드 정렬' }))
    expect(orderedSkus()).toEqual(['SKU-1', 'SKU-2', 'SKU-10'])
    expect(items.map((item) => item.id)).toEqual(['10', '2', '1'])
  })

  it('sorts Korean product names in both directions and starts each new column in ascending order', () => {
    renderTable([stock('1', 'SKU-1', '나 상품'), stock('2', 'SKU-2', '가 상품'), stock('3', 'SKU-3', '다 상품')])
    fireEvent.click(screen.getByRole('button', { name: '상품명 정렬' }))
    expect(orderedNames()).toEqual(['가 상품', '나 상품', '다 상품'])
    expect(screen.getByRole('columnheader', { name: '상품명' })).toHaveAttribute('aria-sort', 'ascending')
    fireEvent.click(screen.getByRole('button', { name: '상품명 정렬' }))
    expect(orderedNames()).toEqual(['다 상품', '나 상품', '가 상품'])
    expect(screen.getByRole('columnheader', { name: '상품명' })).toHaveAttribute('aria-sort', 'descending')
    fireEvent.click(screen.getByRole('button', { name: '상품코드 정렬' }))
    expect(orderedSkus()).toEqual(['SKU-1', 'SKU-2', 'SKU-3'])
  })

  it.each([
    ['출고 창고', 'warehouseCode', ['창고 100', '창고 2', '창고 10']],
    ['상품명(중국어)', 'chineseProductName', ['收纳架 100', '收纳架 2', '收纳架 10']],
    ['옵션', 'optionName', ['옵션 100', '옵션 2', '옵션 10']],
  ] as const)('sorts the %s column naturally in both directions', (label, key, values) => {
    renderTable(values.map((value, index) => ({ ...stock(String(index), `SKU-${index + 1}`, '상품'), [key]: value })))
    const button = screen.getByRole('button', { name: `${label} 정렬` })
    fireEvent.click(button)
    expect(button.closest('th')).toHaveAttribute('aria-sort', 'ascending')
    expect(orderedSkus()).toEqual(['SKU-2', 'SKU-3', 'SKU-1'])
    fireEvent.click(button)
    expect(button.closest('th')).toHaveAttribute('aria-sort', 'descending')
    expect(orderedSkus()).toEqual(['SKU-1', 'SKU-3', 'SKU-2'])
  })

  it('sorts the displayed normalized item category rather than the raw category', () => {
    renderTable([
      { ...stock('1', 'SKU-1', '기본 상품'), itemCategory: null },
      { ...stock('2', 'SKU-2', '샘플'), itemCategory: '[샘플]' },
      { ...stock('3', 'SKU-3', '포장재'), itemCategory: '[부재료]' },
    ], { categoryForItem: (item: ChinaShipmentStockItem) => item.itemCategory === '[부재료]' ? '부자재' : item.itemCategory === '[샘플]' ? '샘플' : '상품' })
    const button = screen.getByRole('button', { name: '품목구분 정렬' })
    fireEvent.click(button)
    expect(orderedSkus()).toEqual(['SKU-3', 'SKU-1', 'SKU-2'])
    fireEvent.click(button)
    expect(orderedSkus()).toEqual(['SKU-2', 'SKU-1', 'SKU-3'])
  })

  it.each([
    ['현재고', 'onHandQuantity'],
    ['작업 가능', 'availableQuantity'],
  ] as const)('sorts %s numerically in both directions', (label, key) => {
    renderTable([100, 2, 10].map((value, index) => ({ ...stock(String(index), `SKU-${index + 1}`, '상품'), [key]: value })))
    const button = screen.getByRole('button', { name: `${label} 정렬` })
    fireEvent.click(button)
    expect(orderedSkus()).toEqual(['SKU-2', 'SKU-3', 'SKU-1'])
    fireEvent.click(button)
    expect(orderedSkus()).toEqual(['SKU-1', 'SKU-3', 'SKU-2'])
  })

  it('sorts displayed Korea receipt dates with stable same-day ties and missing dates last in both directions', () => {
    const dates = ['2026-11-03T03:00:00Z', '2026-11-02T15:00:00Z', '2026-11-02T14:59:00Z', null, 'invalid-date', undefined, '']
    renderTable(dates.map((lastReceivedAt, index) => ({ ...stock(String(index), `SKU-${index + 1}`, '상품'), lastReceivedAt })))
    const button = screen.getByRole('button', { name: '최근 입고·재고등록일 정렬' })
    fireEvent.click(button)
    expect(orderedSkus()).toEqual(['SKU-3', 'SKU-1', 'SKU-2', 'SKU-4', 'SKU-5', 'SKU-6', 'SKU-7'])
    fireEvent.click(button)
    expect(orderedSkus()).toEqual(['SKU-1', 'SKU-2', 'SKU-3', 'SKU-4', 'SKU-5', 'SKU-6', 'SKU-7'])
  })

  it.each(['이번 출고', '추가 출고'] as const)('sorts %s input quantities numerically, keeping zero valid and blanks or invalid values last', (quantityLabel) => {
    const quantities = { one: '100', two: '2', three: '10', four: '0', five: '', six: 'invalid', seven: '   ', eight: 'Infinity' }
    renderTable(Object.keys(quantities).map((id, index) => stock(id, `SKU-${index + 1}`, '상품')), { quantities, quantityLabel })
    const button = screen.getByRole('button', { name: `${quantityLabel} 정렬` })
    fireEvent.click(button)
    expect(orderedSkus()).toEqual(['SKU-4', 'SKU-2', 'SKU-3', 'SKU-1', 'SKU-5', 'SKU-6', 'SKU-7', 'SKU-8'])
    fireEvent.click(button)
    expect(orderedSkus()).toEqual(['SKU-1', 'SKU-3', 'SKU-2', 'SKU-4', 'SKU-5', 'SKU-6', 'SKU-7', 'SKU-8'])
  })

  it('reorders an active quantity sort after editing without changing inventory identities or entered values', () => {
    const items = [stock('a', 'SKU-1', '가 상품'), stock('b', 'SKU-2', '나 상품'), stock('c', 'SKU-3', '다 상품')]
    const changed = vi.fn()
    function ControlledTable() {
      const [quantities, setQuantities] = useState<Record<string, string>>({ a: '2', b: '10', c: '100' })
      return <ChinaShipmentStockTable items={items} quantities={quantities} onQuantityChange={(id, value) => { changed(id, value); setQuantities((current) => ({ ...current, [id]: value })) }}
        quantityLabel="이번 출고" tableLabel="신규 출고 상품 목록" emptyMessage="재고 없음" categoryForItem={() => '상품'} />
    }
    render(<ControlledTable />)
    fireEvent.click(screen.getByRole('button', { name: '이번 출고 정렬' }))
    fireEvent.change(within(screen.getByText('가 상품').closest('tr')!).getByRole('spinbutton', { name: '이번 출고' }), { target: { value: '200' } })
    expect(changed).toHaveBeenCalledExactlyOnceWith('a', '200')
    expect(orderedSkus()).toEqual(['SKU-2', 'SKU-3', 'SKU-1'])
    expect(within(screen.getByText('가 상품').closest('tr')!).getByRole('spinbutton', { name: '이번 출고' })).toHaveValue(200)
    expect(within(screen.getByText('나 상품').closest('tr')!).getByRole('spinbutton', { name: '이번 출고' })).toHaveValue(10)
    expect(within(screen.getByText('다 상품').closest('tr')!).getByRole('spinbutton', { name: '이번 출고' })).toHaveValue(100)
  })

  it('keeps quantities attached to inventory identities across sorting for same-code warehouse stock', () => {
    const items = [stock('a', 'SAME-1', '나 상품', 'A창고'), stock('b', 'SAME-1', '가 상품', 'B창고')]
    const changed = vi.fn()
    function ControlledTable() {
      const [quantities, setQuantities] = useState<Record<string, string>>({ a: '3', b: '7' })
      return <ChinaShipmentStockTable items={items} quantities={quantities} onQuantityChange={(id, value) => { changed(id, value); setQuantities((current) => ({ ...current, [id]: value })) }}
        quantityLabel="추가 출고" tableLabel="추가 출고 상품 목록" emptyMessage="재고 없음" categoryForItem={() => '상품'} />
    }
    render(<ControlledTable />)
    const aInput = () => within(screen.getByText('A창고').closest('tr')!).getByRole('spinbutton', { name: '추가 출고' })
    const bInput = () => within(screen.getByText('B창고').closest('tr')!).getByRole('spinbutton', { name: '추가 출고' })
    fireEvent.change(aInput(), { target: { value: '4' } })
    expect(changed).toHaveBeenCalledExactlyOnceWith('a', '4')
    fireEvent.click(screen.getByRole('button', { name: '상품명 정렬' }))
    fireEvent.click(screen.getByRole('button', { name: '상품명 정렬' }))
    expect(orderedNames()).toEqual(['나 상품', '가 상품'])
    expect(aInput()).toHaveValue(4)
    expect(bInput()).toHaveValue(7)
  })

  it('does not submit the surrounding registration form when sorting and exposes stock limits and Korea receipt date', () => {
    const submit = vi.fn((event) => event.preventDefault())
    render(<form onSubmit={submit}><ChinaShipmentStockTable items={[stock('a', 'SKU-1', '상품 이름')]} quantities={{}} onQuantityChange={vi.fn()}
      quantityLabel="이번 출고" tableLabel="신규 출고 상품 목록" emptyMessage="재고 없음" categoryForItem={() => '상품'} /></form>)
    const headers = screen.getAllByRole('columnheader')
    expect(headers).toHaveLength(10)
    for (const header of headers) {
      expect(header).toHaveAttribute('aria-sort')
      fireEvent.click(within(header).getByRole('button'))
    }
    expect(submit).not.toHaveBeenCalled()
    const input = screen.getByRole('spinbutton', { name: '이번 출고' })
    expect(input).toHaveAttribute('min', '0')
    expect(input).toHaveAttribute('max', '15')
    expect(input).toHaveAttribute('step', '1')
    expect(input).toHaveAccessibleDescription('SKU-1 상품 이름')
    expect(screen.getByText('2026-11-03')).toBeInTheDocument()
    expect(screen.getByText('商品')).toHaveAttribute('data-no-translate')
  })

  it('disables sorting and quantity editing while the parent is working', () => {
    renderTable([stock('a', 'SKU-1', '상품 이름')], { disabled: true })
    const sortButtons = screen.getAllByRole('button')
    expect(sortButtons).toHaveLength(10)
    for (const button of sortButtons) expect(button).toBeDisabled()
    expect(screen.getByRole('spinbutton', { name: '이번 출고' })).toBeDisabled()
  })

  it('keeps an empty result inside the same table structure', () => {
    renderTable([])
    expect(screen.getByRole('table', { name: '신규 출고 상품 목록' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: '재고 없음' })).toHaveAttribute('colspan', '10')
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
  })
})
