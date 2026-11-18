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
    fireEvent.click(screen.getByRole('button', { name: '상품명 정렬' }))
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
    expect(screen.getByRole('button', { name: '상품코드 정렬' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '상품명 정렬' })).toBeDisabled()
    expect(screen.getByRole('spinbutton', { name: '이번 출고' })).toBeDisabled()
  })

  it('keeps an empty result inside the same table structure', () => {
    renderTable([])
    expect(screen.getByRole('table', { name: '신규 출고 상품 목록' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: '재고 없음' })).toHaveAttribute('colspan', '10')
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
  })
})
