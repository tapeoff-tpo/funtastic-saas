'use client'

import { getPriceNumberDate } from '@/lib/analytics/price-number-date'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { setPriceRegistrationExcluded } from './price-registration-actions'
import { useEffect, useMemo, useState, useTransition } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, PackageSearch, Table2 } from 'lucide-react'
import {
  findMarketplaceProductIds,
  getInactiveRegistrationMarketplaceColumns,
  getRegistrationMarketplaceColumns,
  getRegistrationTargets,
} from './price-table-columns'
import type { PriceTableGridRow } from './price-table-grid'
import { ColumnResizeHandle, usePriceColumnWidths } from './column-resize'

import { priceTableHref, type PriceTableNavigation, type PriceTableView } from './price-table-navigation'

const NUMBER_WIDTH = 52

const VIEW_ITEMS: Array<{ id: PriceTableView; label: string; icon: typeof Table2 }> = [
  { id: 'compare', label: '가격 비교', icon: PackageSearch },
  { id: 'products', label: '등록 누락 확인', icon: Table2 },
]

export function PriceTableWorkspace(props: {
  rows: PriceTableGridRow[]
  navigation: PriceTableNavigation
  page: number
}) {
  const { view } = props.navigation

  return (
    <div className="space-y-1.5">
      <div className="flex border-b">
        {VIEW_ITEMS.map((item) => {
          const Icon = item.icon
          return (
            <Link
              key={item.id}
              href={priceTableHref({ ...props.navigation, view: item.id, page: props.page })}
              aria-current={view === item.id ? 'page' : undefined}
              prefetch={false}
              scroll={false}
              className={`flex h-10 items-center gap-1.5 border-b-2 px-3 text-sm font-medium ${
                view === item.id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="size-4" />
              {item.label}
            </Link>
          )
        })}
      </div>

      {view === 'compare' ? <PriceCompareView rows={props.rows} navigation={props.navigation} /> : <RegistrationReview key={props.navigation.malls?.join(',')} rows={props.rows} navigation={props.navigation} />}
    </div>
  )
}

function PriceCompareView({ rows, navigation }: { rows: PriceTableGridRow[]; navigation: PriceTableNavigation }) {
  const { width, resize } = usePriceColumnWidths('price-table-compare-widths-v1')
  const activeColumns = useMemo(() => getRegistrationMarketplaceColumns(), [])
  const inactiveColumns = useMemo(() => getInactiveRegistrationMarketplaceColumns(), [])
  const columns = [...activeColumns, ...inactiveColumns]
  const defaults = columns.map((column) => column.id)
  const [selected, setSelected] = useState<string[]>(defaults)
  const [groups, setGroups] = useState<Record<string, string[]>>({})
  const [groupName, setGroupName] = useState('B2B몰')
  useEffect(() => {
    try { const saved: unknown = JSON.parse(localStorage.getItem('price-table-mall-groups-v1') || '{}'); if (saved && typeof saved === 'object' && !Array.isArray(saved)) setGroups(Object.fromEntries(Object.entries(saved).filter(([, ids]) => Array.isArray(ids) && ids.every(id => typeof id === 'string')))) } catch { /* Keep empty groups if storage is unavailable. */ }
  }, [])
  function saveGroup() {
    const name = groupName.trim().slice(0, 40)
    if (!name) return
    const next = { ...groups, [name]: selected }
    setGroups(next)
    try { localStorage.setItem('price-table-mall-groups-v1', JSON.stringify(next)) } catch { /* Selection remains usable without storage. */ }
  }
  function applyGroup(ids: string[]) { setSelected([...new Set(['b2b', 'b2c', ...ids.filter(id => columns.some(column => column.id === id))])]) }
  function pinnedLeft(id: string) {
    const priceStart = NUMBER_WIDTH + codeWidth + productWidth
    if (id === 'b2b') return priceStart
    if (id === 'b2c') return priceStart + width('b2b', 132)
  }
  const selectedColumns = columns.filter((column) => selected.includes(column.id))
  const codeWidth = width('productCode', 96)
  const productWidth = width('product', 240)
  const tableWidth = NUMBER_WIDTH + codeWidth + productWidth + selectedColumns.reduce((sum, column) => sum + width(column.id, 132), 0)

  function toggle(id: string) {
    if (id === 'b2b' || id === 'b2c') return
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }

  return (
    <div className="space-y-1.5">
      <details className="group rounded-md border bg-muted/15">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-1.5 text-xs [&::-webkit-details-marker]:hidden"><span className="font-medium">몰 선택·그룹 ▾</span><span className="text-muted-foreground">{selected.length}개 선택 · B2B / B2C 고정</span></summary>
        <div className="border-t px-3 py-2">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-sm font-medium">이용 중인 몰</p>
          <span className="text-xs text-muted-foreground">{selected.length}개 선택 · B2B / B2C 항상 표시</span>
        </div>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button type="button" className="rounded border px-2 py-1 text-xs" onClick={() => setSelected(defaults)}>전체 선택</button>
          <button type="button" className="rounded border px-2 py-1 text-xs" onClick={() => setSelected(['b2b', 'b2c'])}>몰 선택 해제</button>
          {Object.entries(groups).filter(([, ids]) => Array.isArray(ids)).map(([name, ids]) => <span key={name} className="inline-flex rounded border bg-background"><button type="button" className="px-2 py-1 text-xs font-medium" onClick={() => applyGroup(ids)}>{name}</button><button type="button" aria-label={`${name} 그룹 삭제`} className="px-1 text-xs" onClick={() => { const next = { ...groups }; delete next[name]; setGroups(next); try { localStorage.setItem('price-table-mall-groups-v1', JSON.stringify(next)) } catch {} }}>×</button></span>)}
          <input aria-label="몰 그룹 이름" value={groupName} onChange={event => setGroupName(event.target.value)} className="h-7 w-32 rounded border bg-background px-2 text-xs" placeholder="B2B몰 / B2C몰" />
          <button type="button" onClick={saveGroup} className="rounded border px-2 py-1 text-xs">현재 선택을 그룹 저장</button>
          <span className="text-[11px] text-muted-foreground">그룹은 이 브라우저에 저장됩니다.</span>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-2">
          {activeColumns.map((column) => (
            <label key={column.id} className="flex cursor-pointer items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                checked={selected.includes(column.id)}
                onChange={() => toggle(column.id)}
                disabled={column.id === 'b2b' || column.id === 'b2c'}
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
                  disabled={column.id === 'b2b' || column.id === 'b2c'}
                  className="size-3.5 accent-primary"
                />
                {column.label}
              </label>
            ))}
          </div>
        </details>
        </div>
      </details>
      <div className="overflow-auto rounded-md border bg-card">
        <table className="table-fixed border-separate border-spacing-0 text-sm" style={{ width: tableWidth }}>
          <colgroup>
            <col style={{ width: NUMBER_WIDTH }} /><col style={{ width: codeWidth }} /><col style={{ width: productWidth }} />
            {selectedColumns.map(column => <col key={column.id} style={{ width: width(column.id, 132) }} />)}
          </colgroup>
          <thead>
            <tr className="bg-muted text-left text-xs text-muted-foreground">
              <th scope="col" aria-sort={sortDirection(navigation, 'sourceNumber')} className="sticky left-0 z-20 border-r border-b bg-muted px-1 py-2"><SortLink sortKey="sourceNumber" label="No." navigation={navigation} /></th>
              <th className="sticky z-20 border-r border-b bg-muted px-2 py-2" style={{ left: NUMBER_WIDTH }} aria-sort={sortDirection(navigation, 'productCode')}><SortLink sortKey="productCode" label="상품코드" navigation={navigation} /><ColumnResizeHandle label="상품코드" width={codeWidth} onResize={value => resize('productCode', value)} /></th>
              <th className="sticky z-20 border-r border-b bg-muted px-2 py-2" style={{ left: NUMBER_WIDTH + codeWidth }} aria-sort={sortDirection(navigation, 'productName')}><SortLink sortKey="productName" label="상품 / 옵션" navigation={navigation} /><ColumnResizeHandle label="상품 / 옵션" width={productWidth} onResize={value => resize('product', value)} /></th>
              {selectedColumns.map((column) => <th key={column.id} aria-sort={sortDirection(navigation, `raw:${column.valueKey}`)} style={{ left: pinnedLeft(column.id) }} className={`${pinnedLeft(column.id) !== undefined ? "sticky z-20 bg-muted" : "relative"} border-r border-b px-2 py-2 text-right`}><SortLink sortKey={`raw:${column.valueKey}`} label={column.label} navigation={navigation} /><ColumnResizeHandle label={column.label} width={width(column.id, 132)} onResize={value => resize(column.id, value)} /></th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t hover:bg-muted/30">
                <td className="sticky left-0 z-10 border-r border-b bg-card px-1 text-center text-xs tabular-nums text-muted-foreground">{row.sourceNumber ?? '–'}</td>
                <td className="sticky z-10 h-12 border-r border-b bg-card px-2 py-1.5 align-middle font-mono text-xs font-medium" style={{ left: NUMBER_WIDTH }}>
                  {row.productCode ? (
                    <Link data-no-translate title={row.productCode} href={`/products?search=${encodeURIComponent(row.productCode)}&searched=1`} className="block truncate text-primary hover:underline">
                      {row.productCode}
                    </Link>
                  ) : '-'}
                </td>
                <td className="sticky z-10 h-12 border-r border-b bg-card px-2 py-1.5 align-middle" style={{ left: NUMBER_WIDTH + codeWidth }}>
                  <div data-no-translate className="truncate font-medium leading-5" title={row.productName || row.registeredProductName || ''}>{row.productName || row.registeredProductName || '-'}</div>
                  <div data-no-translate title={row.optionName ?? ''} className="h-4 truncate text-xs leading-4 text-muted-foreground">{row.optionName || '\u00a0'}</div>
                </td>
                {selectedColumns.map((column) => {
                  const identifiers = findMarketplaceProductIds(row.rawData, column)
                  return (
                    <td key={column.id} style={{ left: pinnedLeft(column.id) }} className={`${pinnedLeft(column.id) !== undefined ? "sticky z-10 bg-card" : ""} h-12 border-r border-b px-2 py-1.5 text-right align-middle tabular-nums`}>
                      <div className="truncate font-semibold leading-5">{formatMoney(row.rawData[column.valueKey])}</div>
                      {identifiers.length ? identifiers.map((identifier) => {
                        const enteredDate = getPriceNumberDate(row.rawData, identifier.key) ?? row.directEntryDate
                        return (
                          <div key={identifier.key} className="text-[11px] leading-4 text-muted-foreground">
                            <div className="truncate" title={identifier.value}>{identifier.value}</div>
                            {enteredDate && <div>입력일 {enteredDate}</div>}
                          </div>
                        )
                      }) : <div className="h-4 text-[11px] leading-4 text-muted-foreground">-</div>}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function RegistrationReview({ rows, navigation }: { rows: PriceTableGridRow[]; navigation: PriceTableNavigation }) {
  const router = useRouter()
  const [selected, setSelected] = useState(navigation.malls ?? [])
  const [groups, setGroups] = useState<Record<string, string[]>>({})
  const [pending, startTransition] = useTransition()
  const targets = getRegistrationTargets(navigation.sheetName, [])
  const showExcluded = Boolean(navigation.showExcluded)

  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem('price-table-mall-groups-v1') || '{}')
      if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
        setGroups(Object.fromEntries(Object.entries(saved).filter(([, ids]) =>
          Array.isArray(ids) && ids.every((id) => typeof id === 'string'),
        )))
      }
    } catch { /* Groups are optional. */ }
  }, [])

  function selectGroup(ids: string[]) {
    const malls = targets.filter((column) => ids.includes(column.id)
      || (column.id.startsWith('new-') && ids.includes(column.id.slice(4)))).map((column) => column.id)
    setSelected(malls)
    router.push(priceTableHref({ ...navigation, malls }), { scroll: false })
  }

  function changeExclusion(row: PriceTableGridRow) {
    startTransition(async () => {
      const result = await setPriceRegistrationExcluded(row.id, !showExcluded)
      if (result.error) toast.error(result.error)
      else toast.success(showExcluded ? '등록 대상으로 복원했습니다.' : '등록 대상에서 제외했습니다.')
    })
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {Object.entries(groups).map(([name, ids]) => (
          <button key={name} type="button" className="rounded border px-2 py-1" onClick={() => selectGroup(ids)}>{name}</button>
        ))}
        <details className="relative">
          <summary className="cursor-pointer rounded border px-2 py-1">대상 몰 선택</summary>
          <form className="absolute z-30 mt-1 w-72 rounded border bg-popover p-3 shadow-lg" onSubmit={(event) => {
            event.preventDefault()
            router.push(priceTableHref({ ...navigation, malls: selected }), { scroll: false })
          }}>
            <div className="grid max-h-60 grid-cols-2 gap-2 overflow-auto">
              {targets.map((column) => (
                <label key={column.id} className="flex items-center gap-1">
                  <input type="checkbox" checked={selected.includes(column.id)} onChange={(event) => {
                    const checked = event.target.checked
                    setSelected((ids) => checked ? [...ids, column.id] : ids.filter((id) => id !== column.id))
                  }} />
                  {column.label}
                </label>
              ))}
            </div>
            <button type="submit" className="mt-3 rounded bg-primary px-2 py-1 text-primary-foreground">적용</button>
          </form>
        </details>
        <span className="text-muted-foreground">대상 {targets.filter((column) => navigation.malls?.includes(column.id)).length}개 몰</span>
        <Link href={priceTableHref({ ...navigation, showExcluded: !showExcluded })} prefetch={false} className="ml-auto rounded border px-2 py-1">
          {showExcluded ? '누락 목록 보기' : '제외한 상품 보기'}
        </Link>
      </div>

      <div className="overflow-auto rounded-md border bg-card">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead className="bg-muted text-xs text-muted-foreground">
            <tr>
              <th className="px-2 py-2"><SortLink sortKey="sourceNumber" label="No." navigation={navigation} /></th>
              <th className="px-2 py-2"><SortLink sortKey="productCode" label="상품코드" navigation={navigation} /></th>
              <th className="px-2 py-2"><SortLink sortKey="productName" label="상품 / 옵션" navigation={navigation} /></th>
              <th className="px-2 py-2">등록번호 미입력</th>
              <th className="px-2 py-2"><span className="sr-only">등록 대상 변경</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t">
                <td className="px-2 py-2 text-xs tabular-nums">{row.sourceNumber ?? '–'}</td>
                <td className="px-2 py-2 font-mono text-xs">{row.productCode || '–'}</td>
                <td className="px-2 py-2">
                  <div>{row.productName || row.registeredProductName}</div>
                  {row.optionName && <div className="text-xs text-muted-foreground">{row.optionName}</div>}
                </td>
                <td className="px-2 py-2 text-xs">{row.missingMalls?.join(', ')}</td>
                <td className="px-2 py-2 text-right">
                  <button type="button" disabled={pending} onClick={() => changeExclusion(row)} className="whitespace-nowrap rounded border px-2 py-1 text-xs disabled:opacity-50">
                    {showExcluded ? '대상 복원' : '등록 제외'}
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-sm text-muted-foreground">
                {showExcluded ? '제외한 상품이 없습니다.' : navigation.malls?.length ? '등록번호가 비어 있는 상품이 없습니다.' : '확인할 몰 그룹이나 대상 몰을 선택해주세요.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function sortDirection(navigation: PriceTableNavigation, sortKey: string) {
  if (navigation.sortKey !== sortKey) return undefined
  return navigation.sortOrder === 'asc' ? 'ascending' : 'descending'
}

function SortLink({ sortKey, label, navigation }: { sortKey: string; label: string; navigation: PriceTableNavigation }) {
  const direction = sortDirection(navigation, sortKey)
  const sortOrder = direction === 'ascending' ? 'desc' : 'asc'
  const Icon = direction === 'ascending' ? ArrowUp : direction === 'descending' ? ArrowDown : ArrowUpDown
  return (
    <Link
      href={priceTableHref({ ...navigation, sortKey, sortOrder })}
      prefetch={false}
      scroll={false}
      title={`${label} ${sortOrder === 'asc' ? '오름차순' : '내림차순'} 정렬`}
      className={`inline-flex max-w-full items-center gap-0.5 rounded hover:text-foreground ${direction ? 'text-foreground' : ''}`}
    >
      <span className="truncate">{label}</span>
      <Icon aria-hidden="true" className="size-3 shrink-0" />
    </Link>
  )
}

function formatMoney(value?: string) {
  if (!value) return '-'
  const number = Number(value.replace(/,/g, ''))
  return Number.isFinite(number) ? `${number.toLocaleString('ko-KR')}원` : value
}
