'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { ChevronDown, PackageSearch, Table2 } from 'lucide-react'
import {
  findMarketplaceProductIds,
  getInactiveRegistrationMarketplaceColumns,
  getRegistrationMarketplaceColumns,
} from './price-table-columns'
import type { PriceTableGridRow } from './price-table-grid'
import { ColumnResizeHandle, usePriceColumnWidths } from './column-resize'

type WorkspaceView = 'compare' | 'products'

const VIEW_ITEMS: Array<{ id: WorkspaceView; label: string; icon: typeof Table2 }> = [
  { id: 'compare', label: '가격 비교', icon: PackageSearch },
  { id: 'products', label: '상품 기준', icon: Table2 },
]

export function PriceTableWorkspace(props: {
  rows: PriceTableGridRow[]
  initialView: WorkspaceView
}) {
  const [view, setView] = useState<WorkspaceView>(props.initialView)

  return (
    <div className="space-y-3">
      <div className="flex border-b">
        {VIEW_ITEMS.map((item) => {
          const Icon = item.icon
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setView(item.id)}
              className={`flex h-10 items-center gap-1.5 border-b-2 px-3 text-sm font-medium ${
                view === item.id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="size-4" />
              {item.label}
            </button>
          )
        })}
      </div>

      {view === 'compare' ? <PriceCompareView rows={props.rows} /> : <ProductMarketplaceView rows={props.rows} />}
    </div>
  )
}

function PriceCompareView({ rows }: { rows: PriceTableGridRow[] }) {
  const { width, resize } = usePriceColumnWidths('price-table-compare-widths-v1')
  const activeColumns = useMemo(() => getRegistrationMarketplaceColumns(), [])
  const inactiveColumns = useMemo(() => getInactiveRegistrationMarketplaceColumns(), [])
  const columns = [...activeColumns, ...inactiveColumns]
  const defaults = activeColumns.filter((column) => column.defaultVisible).slice(0, 4).map((column) => column.id)
  const [selected, setSelected] = useState<string[]>(defaults)
  const selectedColumns = columns.filter((column) => selected.includes(column.id))
  const codeWidth = width('productCode', 96)
  const productWidth = width('product', 240)
  const tableWidth = codeWidth + productWidth + selectedColumns.reduce((sum, column) => sum + width(column.id, 132), 0)

  function toggle(id: string) {
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : current.length < 6 ? [...current, id] : current)
  }

  return (
    <div className="space-y-3">
      <div className="border-b bg-muted/15 px-3 py-2.5">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-sm font-medium">이용 중인 몰</p>
          <span className="text-xs text-muted-foreground">최대 6개</span>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-2">
          {activeColumns.map((column) => (
            <label key={column.id} className="flex cursor-pointer items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                checked={selected.includes(column.id)}
                onChange={() => toggle(column.id)}
                disabled={!selected.includes(column.id) && selected.length >= 6}
                className="size-3.5 accent-primary"
              />
              {column.label}
            </label>
          ))}
        </div>
        <details className="mt-3 border-t pt-2.5">
          <summary className="cursor-pointer text-xs text-muted-foreground">기타·과거 몰 {inactiveColumns.length}개</summary>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-2">
            {inactiveColumns.map((column) => (
              <label key={column.id} className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={selected.includes(column.id)}
                  onChange={() => toggle(column.id)}
                  disabled={!selected.includes(column.id) && selected.length >= 6}
                  className="size-3.5 accent-primary"
                />
                {column.label}
              </label>
            ))}
          </div>
        </details>
      </div>
      <div className="overflow-auto rounded-md border bg-card">
        <table className="table-fixed border-separate border-spacing-0 text-sm" style={{ width: tableWidth }}>
          <colgroup>
            <col style={{ width: codeWidth }} /><col style={{ width: productWidth }} />
            {selectedColumns.map(column => <col key={column.id} style={{ width: width(column.id, 132) }} />)}
          </colgroup>
          <thead>
            <tr className="bg-muted text-left text-xs text-muted-foreground">
              <th className="sticky left-0 z-20 border-r border-b bg-muted px-2 py-2">상품코드<ColumnResizeHandle label="상품코드" width={codeWidth} onResize={value => resize('productCode', value)} /></th>
              <th className="sticky z-20 border-r border-b bg-muted px-2 py-2" style={{ left: codeWidth }}>상품 / 옵션<ColumnResizeHandle label="상품 / 옵션" width={productWidth} onResize={value => resize('product', value)} /></th>
              {selectedColumns.map((column) => <th key={column.id} className="relative border-r border-b px-2 py-2 text-right"><span className="block truncate">{column.label}</span><ColumnResizeHandle label={column.label} width={width(column.id, 132)} onResize={value => resize(column.id, value)} /></th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t hover:bg-muted/30">
                <td className="sticky left-0 z-10 h-12 border-r border-b bg-card px-2 py-1.5 align-middle font-mono text-xs font-medium">
                  {row.productCode ? (
                    <Link data-no-translate title={row.productCode} href={`/products?search=${encodeURIComponent(row.productCode)}&searched=1`} className="block truncate text-primary hover:underline">
                      {row.productCode}
                    </Link>
                  ) : '-'}
                </td>
                <td className="sticky z-10 h-12 border-r border-b bg-card px-2 py-1.5 align-middle" style={{ left: codeWidth }}>
                  <div data-no-translate className="truncate font-medium leading-5" title={row.productName || row.registeredProductName || ''}>{row.productName || row.registeredProductName || '-'}</div>
                  <div data-no-translate title={row.optionName ?? ''} className="h-4 truncate text-xs leading-4 text-muted-foreground">{row.optionName || '\u00a0'}</div>
                </td>
                {selectedColumns.map((column) => (
                  <td key={column.id} className="h-12 border-r border-b px-2 py-1.5 text-right align-middle tabular-nums">
                    <div className="truncate font-semibold leading-5">{formatMoney(row.rawData[column.valueKey])}</div>
                    <div className="h-4 truncate text-[11px] leading-4 text-muted-foreground">{findMarketplaceProductIds(row.rawData, column).length ? '등록번호 있음' : '-'}</div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ProductMarketplaceView({ rows }: { rows: PriceTableGridRow[] }) {
  const { width, resize } = usePriceColumnWidths('price-table-products-widths-v1')
  const codeWidth = width('productCode', 96)
  const productWidth = width('product', 240)
  const gridStyle = { gridTemplateColumns: `${codeWidth}px ${productWidth}px 170px 36px`, minWidth: codeWidth + productWidth + 230 }
  const columns = useMemo(() => getRegistrationMarketplaceColumns(), [])
  const [openRow, setOpenRow] = useState<string | null>(null)

  return (
    <div className="overflow-auto rounded-md border bg-card">
      <div style={gridStyle} className="grid border-b bg-muted px-3 py-2 text-xs font-medium text-muted-foreground">
        <span className="relative border-r pr-2">상품코드<ColumnResizeHandle label="상품코드" width={codeWidth} onResize={value => resize('productCode', value)} /></span>
        <span className="relative border-r px-2">상품 / 옵션<ColumnResizeHandle label="상품 / 옵션" width={productWidth} onResize={value => resize('product', value)} /></span>
        <span className="px-2">등록된 몰</span><span />
      </div>
      {rows.map((row) => {
        const registrations = columns.flatMap((column) => findMarketplaceProductIds(row.rawData, column).map((id) => ({
          marketplace: column.label,
          productId: id.value,
          price: row.rawData[column.valueKey],
        })))
        const open = openRow === row.id
        return (
          <div key={row.id} style={{ minWidth: gridStyle.minWidth }} className="border-b last:border-b-0">
            <button
              type="button"
              onClick={() => setOpenRow(open ? null : row.id)}
              style={gridStyle}
              className="grid h-12 w-full items-center px-3 py-1.5 text-left text-sm hover:bg-muted/30"
            >
              <span data-no-translate title={row.productCode ?? ''} className="truncate border-r pr-2 font-mono text-xs font-medium">{row.productCode || '-'}</span>
              <span className="min-w-0 border-r px-2">
                <span data-no-translate className="block truncate font-medium" title={row.productName ?? ''}>{row.productName || row.registeredProductName || '-'}</span>
                {row.optionName || row.productCode ? (
                  <span className="block truncate text-xs text-muted-foreground">
                    <span data-no-translate className="font-mono lg:hidden">{row.productCode || '-'}</span>
                    {row.optionName ? <><span className="lg:hidden"> · </span><span data-no-translate>{row.optionName}</span></> : null}
                  </span>
                ) : null}
              </span>
              <span className="flex min-w-0 flex-wrap gap-1 px-2">
                {registrations.length ? registrations.slice(0, 3).map((item) => <span key={`${item.marketplace}-${item.productId}`} className="truncate rounded bg-sky-50 px-1.5 py-0.5 text-[11px] text-sky-700">{item.marketplace}</span>) : <span className="text-xs text-muted-foreground">등록 이력 없음</span>}
                {registrations.length > 3 ? <span className="text-xs text-muted-foreground">+{registrations.length - 3}</span> : null}
              </span>
              <ChevronDown className={`size-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
            {open ? (
              <div className="border-t bg-muted/15 px-4 py-3">
                {registrations.length ? (
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {registrations.map((item) => (
                      <div key={`${item.marketplace}-${item.productId}`} className="rounded-md border bg-background px-3 py-2">
                        <div className="text-xs font-medium">{item.marketplace}</div>
                        <div className="mt-1 font-mono text-xs text-muted-foreground">상품번호 {item.productId}</div>
                        <div className="mt-1 text-sm font-semibold tabular-nums">판매가 {formatMoney(item.price)}</div>
                      </div>
                    ))}
                  </div>
                ) : <p className="text-sm text-muted-foreground">판매가 원본에서 확인되는 등록 몰 상품번호가 없습니다.</p>}
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

function formatMoney(value?: string) {
  if (!value) return '-'
  const number = Number(value.replace(/,/g, ''))
  return Number.isFinite(number) ? `${number.toLocaleString('ko-KR')}원` : value
}
