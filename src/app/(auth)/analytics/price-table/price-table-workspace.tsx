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
  const activeColumns = useMemo(() => getRegistrationMarketplaceColumns(), [])
  const inactiveColumns = useMemo(() => getInactiveRegistrationMarketplaceColumns(), [])
  const columns = [...activeColumns, ...inactiveColumns]
  const defaults = activeColumns.filter((column) => column.defaultVisible).slice(0, 4).map((column) => column.id)
  const [selected, setSelected] = useState<string[]>(defaults)
  const selectedColumns = columns.filter((column) => selected.includes(column.id))

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
        <table className="w-full min-w-[680px] text-sm">
          <thead>
            <tr className="bg-muted text-left text-xs text-muted-foreground">
              <th className="sticky left-0 z-10 w-[130px] min-w-[130px] bg-muted px-3 py-2">상품코드</th>
              <th className="sticky left-[130px] z-10 min-w-[220px] bg-muted px-3 py-2">상품 / 옵션</th>
              {selectedColumns.map((column) => <th key={column.id} className="min-w-[132px] px-3 py-2 text-right">{column.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t hover:bg-muted/30">
                <td className="sticky left-0 bg-card px-3 py-2 font-mono text-xs font-medium">
                  {row.productCode ? (
                    <Link href={`/products?search=${encodeURIComponent(row.productCode)}&searched=1`} className="text-primary hover:underline">
                      {row.productCode}
                    </Link>
                  ) : '-'}
                </td>
                <td className="sticky left-[130px] max-w-[320px] bg-card px-3 py-2">
                  <div className="truncate font-medium" title={row.productName ?? ''}>{row.productName || row.registeredProductName || '-'}</div>
                  {row.optionName ? <div className="truncate text-xs text-muted-foreground">{row.optionName}</div> : null}
                </td>
                {selectedColumns.map((column) => (
                  <td key={column.id} className="px-3 py-2 text-right tabular-nums">
                    <div className="font-semibold">{formatMoney(row.rawData[column.valueKey])}</div>
                    <div className="text-[11px] text-muted-foreground">{findMarketplaceProductIds(row.rawData, column).length ? '등록번호 있음' : '-'}</div>
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
  const columns = useMemo(() => getRegistrationMarketplaceColumns(), [])
  const [openRow, setOpenRow] = useState<string | null>(null)

  return (
    <div className="overflow-hidden rounded-md border bg-card">
      <div className="grid grid-cols-[130px_minmax(220px,1fr)_170px_36px] border-b bg-muted px-3 py-2 text-xs font-medium text-muted-foreground">
        <span>상품코드</span><span>상품 / 옵션</span><span>등록된 몰</span><span />
      </div>
      {rows.map((row) => {
        const registrations = columns.flatMap((column) => findMarketplaceProductIds(row.rawData, column).map((id) => ({
          marketplace: column.label,
          productId: id.value,
          price: row.rawData[column.valueKey],
        })))
        const open = openRow === row.id
        return (
          <div key={row.id} className="border-b last:border-b-0">
            <button
              type="button"
              onClick={() => setOpenRow(open ? null : row.id)}
              className="grid w-full grid-cols-[130px_minmax(220px,1fr)_170px_36px] items-center px-3 py-2.5 text-left text-sm hover:bg-muted/30"
            >
              <span className="font-mono text-xs font-medium">{row.productCode || '-'}</span>
              <span className="min-w-0 pr-4">
                <span className="block truncate font-medium" title={row.productName ?? ''}>{row.productName || row.registeredProductName || '-'}</span>
                {row.optionName ? <span className="block truncate text-xs text-muted-foreground">{row.optionName}</span> : null}
              </span>
              <span className="flex min-w-0 flex-wrap gap-1">
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
