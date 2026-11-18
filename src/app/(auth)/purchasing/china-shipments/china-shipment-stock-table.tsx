'use client'

import { useId, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { chinaStockDate } from '@/lib/purchasing/china-outbound-packaging'
import type { ChinaShipmentStockItem } from './china-shipments-board'

type StockSortKey = 'sku' | 'productName'
type StockSort = { key: StockSortKey; direction: 'ascending' | 'descending' }

const stockCollator = new Intl.Collator('ko-KR', { numeric: true, sensitivity: 'base' })
const cellClass = 'border-b border-r px-3 py-2'
const headerClass = 'border-b border-r px-3 py-2 text-left text-xs font-medium whitespace-nowrap'

export function ChinaShipmentStockTable({
  items,
  quantities,
  onQuantityChange,
  quantityLabel,
  tableLabel,
  emptyMessage,
  categoryForItem,
  disabled = false,
}: {
  items: ChinaShipmentStockItem[]
  quantities: Record<string, string>
  onQuantityChange: (inventoryId: string, value: string) => void
  quantityLabel: '이번 출고' | '추가 출고'
  tableLabel: string
  emptyMessage: string
  categoryForItem: (item: ChinaShipmentStockItem) => string
  disabled?: boolean
}) {
  const idPrefix = useId()
  const [sort, setSort] = useState<StockSort>({ key: 'sku', direction: 'ascending' })
  const sortedItems = useMemo(() => [...items].sort((left, right) => {
    const primary = stockCollator.compare(left[sort.key], right[sort.key])
    return primary * (sort.direction === 'ascending' ? 1 : -1)
      || stockCollator.compare(left.sku, right.sku)
      || stockCollator.compare(left.productName, right.productName)
      || stockCollator.compare(left.optionName ?? '', right.optionName ?? '')
      || stockCollator.compare(left.warehouseCode, right.warehouseCode)
      || stockCollator.compare(left.id, right.id)
      || left.id.localeCompare(right.id)
  }), [items, sort])

  function sortHeader(key: StockSortKey, label: string) {
    const active = sort.key === key
    const SortIcon = !active ? ArrowUpDown : sort.direction === 'ascending' ? ArrowUp : ArrowDown
    return <th scope="col" aria-sort={active ? sort.direction : 'none'} className={headerClass}>
      <button type="button" aria-label={`${label} 정렬`} disabled={disabled}
        onClick={() => setSort((current) => ({ key, direction: current.key === key && current.direction === 'ascending' ? 'descending' : 'ascending' }))}
        className="inline-flex items-center gap-1.5 rounded-sm text-left hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60">
        {label}<SortIcon aria-hidden="true" className={`size-3.5 ${active ? 'text-foreground' : 'text-muted-foreground'}`} />
      </button>
    </th>
  }

  return <div className="max-h-[60vh] overflow-auto rounded-md border bg-background">
    <table aria-label={tableLabel} className="w-full min-w-[1408px] table-fixed border-separate border-spacing-0 text-sm">
      <colgroup>{[7, 5, 9, 17, 11, 10, 6, 6, 10, 7].map((width, index) => <col key={index} style={{ width: `${width}rem` }} />)}</colgroup>
      <thead className="sticky top-0 z-10 bg-muted text-muted-foreground"><tr>
        <th scope="col" className={headerClass}>출고 창고</th>
        <th scope="col" className={headerClass}>품목구분</th>
        {sortHeader('sku', '상품코드')}
        {sortHeader('productName', '상품명')}
        <th scope="col" className={headerClass}>상품명(중국어)</th>
        <th scope="col" className={headerClass}>옵션</th>
        <th scope="col" className={`${headerClass} text-right`}>현재고</th>
        <th scope="col" className={`${headerClass} text-right`}>작업 가능</th>
        <th scope="col" className={headerClass}>최근 입고·재고등록일</th>
        <th scope="col" className="sticky right-0 z-20 border-b border-l bg-muted px-3 py-2 text-right text-xs font-medium whitespace-nowrap">{quantityLabel}</th>
      </tr></thead>
      <tbody>{sortedItems.length === 0 ? <tr><td colSpan={10} className="px-3 py-8 text-center text-sm text-muted-foreground">{emptyMessage}</td></tr> : sortedItems.map((item) => {
        const skuId = `${idPrefix}-${item.id}-sku`
        const nameId = `${idPrefix}-${item.id}-name`
        const category = categoryForItem(item)
        return <tr key={item.id} className="even:bg-muted/20 hover:bg-muted/40">
          <td title={item.warehouseCode} className={`${cellClass} truncate`}>{item.warehouseCode}</td>
          <td title={category} className={`${cellClass} truncate text-xs text-muted-foreground`}>{category}</td>
          <td id={skuId} data-no-translate title={item.sku} className={`${cellClass} truncate font-medium`}>{item.sku}</td>
          <td id={nameId} data-no-translate title={item.productName} className={`${cellClass} truncate font-medium`}>{item.productName}</td>
          <td data-no-translate title={item.chineseProductName || undefined} className={`${cellClass} truncate`}>{item.chineseProductName || '—'}</td>
          <td data-no-translate title={item.optionName || undefined} className={`${cellClass} truncate text-muted-foreground`}>{item.optionName || '—'}</td>
          <td className={`${cellClass} text-right tabular-nums`}>{item.onHandQuantity.toLocaleString('ko-KR')}</td>
          <td className={`${cellClass} text-right font-medium tabular-nums text-emerald-700`}>{item.availableQuantity.toLocaleString('ko-KR')}</td>
          <td className={`${cellClass} whitespace-nowrap text-xs text-muted-foreground`}>{chinaStockDate(item.lastReceivedAt) || '—'}</td>
          <td className="sticky right-0 border-b border-l bg-background px-3 py-1.5 text-right">
            <input type="number" aria-label={quantityLabel} aria-describedby={`${skuId} ${nameId}`} min="0" max={item.availableQuantity} step="1"
              value={quantities[item.id] ?? ''} onChange={(event) => onQuantityChange(item.id, event.target.value)} disabled={disabled}
              className="h-8 w-full rounded-sm border bg-background px-2 text-right text-sm tabular-nums focus:border-primary focus:outline-2 focus:outline-primary/20 disabled:cursor-not-allowed disabled:opacity-60" placeholder="0" />
          </td>
        </tr>
      })}</tbody>
    </table>
  </div>
}
