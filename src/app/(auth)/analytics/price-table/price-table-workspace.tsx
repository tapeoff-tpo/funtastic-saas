'use client'

import { useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { CheckCircle2, CircleAlert, Download, ExternalLink, PackageSearch, Store, Table2 } from 'lucide-react'
import { toast } from 'sonner'
import { PriceTableGrid, type PriceTableGridRow } from './price-table-grid'
import {
  findMarketplaceProductIds,
  getRegistrationMarketplaceColumns,
  type PriceTableDisplayColumn,
} from './price-table-columns'

type WorkspaceView = 'products' | 'malls' | 'compare'

export type MarketplaceCheckView = {
  productCode: string
  marketplaceKey: string
  marketplaceName: string
  accountKey: string
  status: string
  marketplaceProductId: string | null
  marketplaceProductName: string | null
  sellerUrl: string | null
  checkedAt: string
}

const VIEW_ITEMS: Array<{ id: WorkspaceView; label: string; icon: typeof Table2 }> = [
  { id: 'products', label: '상품 기준', icon: Table2 },
  { id: 'malls', label: '몰 기준', icon: Store },
  { id: 'compare', label: '가격 비교', icon: PackageSearch },
]

const SELLER_CENTERS: Record<string, string> = {
  coupang: 'https://wing.coupang.com/tenants/seller-web/vendor-inventory',
  'smartstore-home': 'https://sell.smartstore.naver.com/#/products/origin-list',
  'smartstore-life': 'https://sell.smartstore.naver.com/#/products/origin-list',
  'smartstore-nat': 'https://sell.smartstore.naver.com/#/products/origin-list',
  'smartstore-18': 'https://sell.smartstore.naver.com/#/products/origin-list',
  'smartstore-1530': 'https://sell.smartstore.naver.com/#/products/origin-list',
  gmarket: 'https://www.esmplus.com/Member/SignIn/LogOn',
  auction: 'https://www.esmplus.com/Member/SignIn/LogOn',
  '11st': 'https://soffice.11st.co.kr/',
  cafe24: 'https://eclogin.cafe24.com/Shop/',
  ohouse: 'https://partners.ohou.se/',
  'ohouse-home': 'https://partners.ohou.se/',
  ssg: 'https://po.ssgadm.com/',
  cj: 'https://partners.cjonstyle.com/',
  gs: 'https://withgs.gsshop.com/',
  ns: 'https://partner.nsmall.com/',
  hyundai: 'https://partners.hyundaihmall.com/',
  lotteon: 'https://store.lotteon.com/',
  kakao: 'https://shopping-sell.kakao.com/',
  'kakao-funta': 'https://shopping-sell.kakao.com/',
  'kakao-life': 'https://shopping-sell.kakao.com/',
  'kakao-gift': 'https://gift-sell.kakao.com/',
  ably: 'https://seller.a-bly.com/',
  zigzag: 'https://partners.kakaostyle.com/',
  onchannel: 'https://www.onch3.co.kr/supplier/',
  domechango: 'https://www.wholesaledepot.co.kr/wms',
  domesin: 'https://www.domesin.com/',
  tobizon: 'https://www.2biz.co.kr/',
  banana: 'https://store.bananab2b.shop/',
}

export function PriceTableWorkspace(props: {
  rows: PriceTableGridRow[]
  sheetName: string
  sortKey: string
  sortOrder: 'asc' | 'desc'
  initialView: WorkspaceView
  checks: MarketplaceCheckView[]
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [view, setView] = useState<WorkspaceView>(props.initialView)

  function changeView(next: WorkspaceView) {
    setView(next)
    const params = new URLSearchParams(searchParams.toString())
    if (next === 'products') params.delete('view')
    else params.set('view', next)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 border-b sm:flex-row sm:items-center sm:justify-between">
        <div className="flex overflow-x-auto">
          {VIEW_ITEMS.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => changeView(item.id)}
                className={`flex h-10 shrink-0 items-center gap-1.5 border-b-2 px-3 text-sm font-medium ${
                  view === item.id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon className="size-4" />
                {item.label}
              </button>
            )
          })}
        </div>
        <ExtensionStatus />
      </div>

      {view === 'products' ? (
        <PriceTableGrid {...props} />
      ) : view === 'malls' ? (
        <MarketplaceView rows={props.rows} checks={props.checks} />
      ) : (
        <PriceCompareView rows={props.rows} />
      )}
    </div>
  )
}

function ExtensionStatus() {
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== window || event.origin !== window.location.origin) return
      if (event.data?.source !== 'funtastic-marketplace-check-extension') return
      if (event.data.type === 'FUNTASTIC_MARKET_CHECK_PONG') setConnected(true)
      if (event.data.type === 'FUNTASTIC_MARKET_CHECK_SAVED') window.location.reload()
    }
    window.addEventListener('message', onMessage)
    window.postMessage({ source: 'funtastic-saas', type: 'FUNTASTIC_MARKET_CHECK_PING' }, window.location.origin)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  return (
    <div className="flex items-center gap-2 pb-2 sm:pb-0">
      <span className={`inline-flex items-center gap-1 text-xs ${connected ? 'text-emerald-700' : 'text-muted-foreground'}`}>
        <span className={`size-1.5 rounded-full ${connected ? 'bg-emerald-500' : 'bg-slate-300'}`} />
        화면 확인 {connected ? '연결됨' : '미연결'}
      </span>
      {!connected ? (
        <a href="/downloads/funtastic-marketplace-check.zip" download className="inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-xs font-medium hover:bg-muted">
          <Download className="size-3.5" />
          확장 다운로드
        </a>
      ) : null}
    </div>
  )
}

function MarketplaceView({ rows, checks }: { rows: PriceTableGridRow[]; checks: MarketplaceCheckView[] }) {
  const columns = useMemo(() => getRegistrationMarketplaceColumns(), [])
  const [marketplaceId, setMarketplaceId] = useState(columns[0]?.id ?? '')
  const [filter, setFilter] = useState<'all' | 'registered' | 'missing' | 'unchecked'>('all')
  const column = columns.find((item) => item.id === marketplaceId) ?? columns[0]
  const evaluatedRows = useMemo(() => rows.map((row) => {
    const recordedIds = column ? findMarketplaceProductIds(row.rawData, column) : []
    const check = checks.find((item) => item.productCode === row.productCode && item.marketplaceKey === column?.id)
    const status = check?.status ?? (recordedIds.length ? 'recorded' : 'unchecked')
    return { row, recordedIds, check, status }
  }), [checks, column, rows])
  const visibleRows = useMemo(() => evaluatedRows.filter((item) => {
    if (filter === 'all') return true
    if (filter === 'missing') return item.status === 'missing' || item.status === 'unchecked'
    return item.status === filter
  }), [evaluatedRows, filter])
  const counts = useMemo(() => ({
    registered: evaluatedRows.filter((item) => item.status === 'registered').length,
    missing: evaluatedRows.filter((item) => item.status === 'missing' || item.status === 'unchecked').length,
    unchecked: evaluatedRows.filter((item) => item.status === 'unchecked' || item.status === 'recorded').length,
  }), [evaluatedRows])

  if (!column) return <div className="rounded-md border p-8 text-center text-muted-foreground">몰 데이터가 없습니다.</div>

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 rounded-md border bg-card p-3 sm:flex-row sm:items-center">
        <label className="text-xs font-medium text-muted-foreground" htmlFor="marketplace-select">확인할 몰</label>
        <select id="marketplace-select" value={marketplaceId} onChange={(event) => setMarketplaceId(event.target.value)} className="h-9 min-w-[220px] rounded-md border bg-background px-3 text-sm">
          {columns.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
        <div className="flex flex-wrap gap-1 sm:ml-auto">
          <StatusFilter active={filter === 'all'} onClick={() => setFilter('all')}>전체 {rows.length}</StatusFilter>
          <StatusFilter active={filter === 'registered'} onClick={() => setFilter('registered')}>등록 {counts.registered}</StatusFilter>
          <StatusFilter active={filter === 'missing'} onClick={() => setFilter('missing')}>미등록 후보 {counts.missing}</StatusFilter>
          <StatusFilter active={filter === 'unchecked'} onClick={() => setFilter('unchecked')}>미확인 {counts.unchecked}</StatusFilter>
        </div>
      </div>

      <div className="overflow-hidden rounded-md border bg-card">
        <div className="grid grid-cols-[130px_minmax(220px,1fr)_150px_120px] border-b bg-muted px-3 py-2 text-xs font-medium text-muted-foreground">
          <span>상품코드</span><span>상품명</span><span>등록 상태</span><span className="text-right">확인</span>
        </div>
        {visibleRows.length ? visibleRows.map(({ row, recordedIds, check, status }) => (
          <div key={row.id} className="grid grid-cols-[130px_minmax(220px,1fr)_150px_120px] items-center border-b px-3 py-2.5 text-sm last:border-b-0 hover:bg-muted/30">
            <span className="font-mono font-medium">{row.productCode || '-'}</span>
            <span className="min-w-0 truncate pr-4" title={row.productName ?? ''}>{row.productName || row.registeredProductName || '-'}</span>
            <MarketplaceStatus status={status} check={check} recordedIds={recordedIds.map((item) => item.value)} />
            <div className="flex justify-end">
              <button type="button" disabled={!row.productCode} onClick={() => startMarketplaceCheck(row, column, recordedIds.map((item) => item.value))} className="inline-flex h-8 items-center gap-1 rounded-md border bg-background px-2.5 text-xs font-medium hover:bg-muted disabled:opacity-40">
                <ExternalLink className="size-3.5" />
                {check ? '재확인' : '확인'}
              </button>
            </div>
          </div>
        )) : <div className="p-10 text-center text-sm text-muted-foreground">조건에 맞는 상품이 없습니다.</div>}
      </div>
    </div>
  )
}

function MarketplaceStatus({ status, check, recordedIds }: { status: string; check?: MarketplaceCheckView; recordedIds: string[] }) {
  if (status === 'registered') return <div title={check?.checkedAt}><span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 className="size-4" />등록</span><div className="truncate font-mono text-[11px] text-muted-foreground">{check?.marketplaceProductId}</div></div>
  if (status === 'missing') return <span className="inline-flex items-center gap-1 text-red-600"><CircleAlert className="size-4" />미등록</span>
  if (status === 'stopped') return <span className="inline-flex items-center gap-1 text-amber-700"><CircleAlert className="size-4" />판매중지</span>
  if (recordedIds.length) return <div><span className="text-sky-700">엑셀 기록</span><div className="truncate font-mono text-[11px] text-muted-foreground">{recordedIds.join(', ')}</div></div>
  return <span className="text-muted-foreground">확인 필요</span>
}

function startMarketplaceCheck(row: PriceTableGridRow, column: PriceTableDisplayColumn, productIds: string[]) {
  const sellerUrl = SELLER_CENTERS[column.id] ?? null
  if (sellerUrl) window.open(sellerUrl, '_blank', 'noopener,noreferrer')
  window.postMessage({
    source: 'funtastic-saas',
    type: 'FUNTASTIC_MARKET_CHECK_START',
    check: {
      productCode: row.productCode,
      productName: row.productName || row.registeredProductName,
      marketplaceKey: column.id,
      marketplaceName: column.label,
      accountKey: column.label,
      productIds,
      sellerUrl,
    },
  }, window.location.origin)
  if (!sellerUrl) {
    toast.info(`${column.label} 판매자센터 주소를 등록하는 중입니다. 확장 프로그램에서 현재 탭을 확인해주세요.`)
    return
  }
}

function PriceCompareView({ rows }: { rows: PriceTableGridRow[] }) {
  const columns = useMemo(() => getRegistrationMarketplaceColumns(), [])
  const defaults = columns.filter((column) => column.defaultVisible).slice(0, 4).map((column) => column.id)
  const [selected, setSelected] = useState<string[]>(defaults)
  const selectedColumns = columns.filter((column) => selected.includes(column.id))

  function toggle(id: string) {
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : current.length < 6 ? [...current, id] : current)
  }

  return (
    <div className="space-y-3">
      <details className="rounded-md border bg-card" open>
        <summary className="cursor-pointer list-none px-3 py-2.5 text-sm font-medium [&::-webkit-details-marker]:hidden">비교할 몰 선택 <span className="ml-1 text-xs text-muted-foreground">최대 6개</span></summary>
        <div className="flex flex-wrap gap-1 border-t p-3">
          {columns.map((column) => <button key={column.id} type="button" onClick={() => toggle(column.id)} className={`rounded-md border px-2 py-1 text-xs ${selected.includes(column.id) ? 'border-primary bg-primary text-primary-foreground' : 'bg-background hover:bg-muted'}`}>{column.label}</button>)}
        </div>
      </details>
      <div className="overflow-auto rounded-md border bg-card">
        <table className="w-full min-w-[760px] text-sm">
          <thead><tr className="bg-muted text-left text-xs text-muted-foreground"><th className="sticky left-0 bg-muted px-3 py-2">상품</th>{selectedColumns.map((column) => <th key={column.id} className="min-w-[140px] px-3 py-2 text-right">{column.label}</th>)}</tr></thead>
          <tbody>{rows.map((row) => <tr key={row.id} className="border-t"><td className="sticky left-0 max-w-[300px] bg-card px-3 py-2"><div className="font-mono text-xs">{row.productCode}</div><div className="truncate">{row.productName}</div></td>{selectedColumns.map((column) => <td key={column.id} className="px-3 py-2 text-right tabular-nums"><div className="font-semibold">{formatMoney(row.rawData[column.valueKey])}</div><div className="text-[11px] text-muted-foreground">{findMarketplaceProductIds(row.rawData, column).length ? '상품번호 있음' : '미등록 후보'}</div></td>)}</tr>)}</tbody>
        </table>
      </div>
    </div>
  )
}

function StatusFilter({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} className={`h-8 rounded-md px-2.5 text-xs font-medium ${active ? 'bg-primary text-primary-foreground' : 'border bg-background hover:bg-muted'}`}>{children}</button>
}

function formatMoney(value?: string) {
  if (!value) return '-'
  const number = Number(value.replace(/,/g, ''))
  return Number.isFinite(number) ? `${number.toLocaleString('ko-KR')}원` : value
}
