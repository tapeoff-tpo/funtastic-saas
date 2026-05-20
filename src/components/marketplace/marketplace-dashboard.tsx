'use client'

import { useState, useRef, useTransition, useMemo, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCollectPoll, type JobLogResult } from '@/lib/hooks/use-collect-poll'
import { StatusBadge } from './status-badge'
import { SyncedScrollContainer } from '@/components/ui/synced-scroll'
import { useColumnSizing } from '@/lib/hooks/use-column-sizing'
import { getIntegrationInfo, type IntegrationMethod } from '@/lib/marketplace/integration-methods'
import type { ConnectionStatus } from '@/lib/marketplace/types'
import {
  createExcelImportTemplate,
  deleteExcelImportTemplate,
  updateExcelImportTemplate,
  type ExcelImportTemplateView,
} from '@/app/(auth)/orders/collect/actions'
import {
  ORDER_IMPORT_FIELDS,
  type OrderImportField,
  type OrderImportMapping,
} from '@/lib/orders/excel-import-fields'

interface Connection {
  id: string
  marketplaceId: string
  displayName: string
  status: string
  lastCheckedAt: Date | null
  lastErrorMessage: string | null
  expiresAt: Date | null
  isManual: boolean
  integrationMethod: IntegrationMethod
  linkedMarketplaces?: string[]
}

interface MarketplaceDashboardProps {
  connections: Connection[]
  importTemplates: ExcelImportTemplateView[]
}

function formatRelativeTime(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMinutes = Math.floor(diffMs / 60000)
  if (diffMinutes < 1) return '방금 전'
  if (diffMinutes < 60) return `${diffMinutes}분 전`
  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours}시간 전`
  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays}일 전`
}

function isExpiringSoon(expiresAt: Date): boolean {
  const now = new Date()
  const sevenDays = 7 * 24 * 60 * 60 * 1000
  return expiresAt.getTime() - now.getTime() < sevenDays
}

/**
 * 위험순 점수 — 작을수록 화면 상단으로.
 * 0 오류 → 1 만료임박 → 2 미수집(lastCheckedAt 없음) → 3 연결됨(오래된순) → 4 엑셀(수동)
 */
function riskScore(c: Connection): number {
  if (c.isManual) return 4
  if (c.status === 'error') return 0
  if (c.expiresAt && isExpiringSoon(c.expiresAt)) return 1
  if (c.lastCheckedAt == null) return 2
  return 3
}

type FilterKey = 'all' | 'api' | 'hub' | 'rpa' | 'excel' | 'connected' | 'error' | 'expiring'
type CollectionRangeMode = 'preset' | 'custom'

function toDateInputValue(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function daysAgoInputValue(daysAgo: number): string {
  const date = new Date()
  date.setDate(date.getDate() - daysAgo)
  return toDateInputValue(date)
}

const DEFAULT_IMPORT_MAPPINGS: OrderImportMapping[] = ORDER_IMPORT_FIELDS.map((field) => ({
  field: field.field,
  excelColumn: field.label,
}))

const JOIN_SEPARATORS: { value: string; label: string }[] = [
  { value: ' ', label: '공백' },
  { value: '[,]', label: '[,]' },
  { value: '(,)', label: '(,)' },
  { value: ' / ', label: ' / ' },
  { value: '#', label: '#' },
  { value: '<,>', label: '<,>' },
]

const IMPORT_TEMPLATE_KEY = 'orders.collect.selectedImportTemplateId'

function normalizeTemplateName(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, '')
}

function findTemplateForConnection(
  connection: Connection,
  templates: ExcelImportTemplateView[],
): ExcelImportTemplateView | null {
  const displayName = normalizeTemplateName(connection.displayName)
  const marketplaceId = normalizeTemplateName(connection.marketplaceId)

  return templates.find((template) => {
    const templateName = normalizeTemplateName(template.name)
    return (
      templateName.includes(displayName) ||
      displayName.includes(templateName.replace('주문수집', '')) ||
      templateName.includes(marketplaceId)
    )
  }) ?? null
}

export function MarketplaceDashboard({ connections, importTemplates: initialImportTemplates }: MarketplaceDashboardProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [importTemplateModal, setImportTemplateModal] = useState<{
    templateId?: string
    draftName?: string
  } | null>(null)
  const [importTemplates, setImportTemplates] = useState(initialImportTemplates)
  const [selectedImportTemplateId, setSelectedImportTemplateId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    return window.localStorage.getItem(IMPORT_TEMPLATE_KEY)
  })
  const [collectionRangeMode, setCollectionRangeMode] = useState<CollectionRangeMode>('preset')
  const [manualLookbackDays, setManualLookbackDays] = useState(3)
  const [manualDateFrom, setManualDateFrom] = useState(() => daysAgoInputValue(2))
  const [manualDateTo, setManualDateTo] = useState(() => toDateInputValue(new Date()))
  const [filter, setFilter] = useState<FilterKey>('all')
  const [search, setSearch] = useState('')
  const { collecting, logs, startCollect, cancelCollect, clearResults } = useCollectPoll()

  const connectedMarkets = useMemo(
    () => connections.filter((c) => c.status !== 'disconnected' && !c.isManual),
    [connections]
  )

  // 필터 카운트 — 칩에 표시
  const counts = useMemo(() => {
    const c = { all: connections.length, api: 0, hub: 0, rpa: 0, excel: 0, connected: 0, error: 0, expiring: 0 }
    for (const conn of connections) {
      c[conn.integrationMethod]++
      if (conn.status === 'error') c.error++
      else {
        c.connected++
        if (conn.expiresAt && isExpiringSoon(conn.expiresAt)) c.expiring++
      }
    }
    return c
  }, [connections])

  // 필터 + 검색 + 위험순 정렬
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return connections
      .filter((c) => {
        if (filter === 'api') return c.integrationMethod === 'api'
        if (filter === 'hub') return c.integrationMethod === 'hub'
        if (filter === 'rpa') return c.integrationMethod === 'rpa'
        if (filter === 'excel') return c.integrationMethod === 'excel'
        if (filter === 'connected') return !c.isManual && c.status !== 'disconnected' && c.status !== 'error'
        if (filter === 'error') return c.status === 'error'
        if (filter === 'expiring') return !c.isManual && !!c.expiresAt && isExpiringSoon(c.expiresAt)
        return true
      })
      .filter((c) => (q ? c.displayName.toLowerCase().includes(q) : true))
      .sort((a, b) => {
        const ra = riskScore(a)
        const rb = riskScore(b)
        if (ra !== rb) return ra - rb
        // 같은 점수면 lastCheckedAt 오래된 순 (null 먼저)
        const ta = a.lastCheckedAt?.getTime() ?? 0
        const tb = b.lastCheckedAt?.getTime() ?? 0
        if (ta !== tb) return ta - tb
        return a.displayName.localeCompare(b.displayName, 'ko-KR')
      })
  }, [connections, filter, search])

  const eligibleSelectable = useMemo(
    () => visible.filter((c) => !c.isManual && c.status !== 'disconnected'),
    [visible]
  )
  const visibleSections = useMemo(() => {
    const api = visible.filter((c) => c.integrationMethod === 'api')
    const hub = visible.filter((c) => c.integrationMethod === 'hub')
    const rpa = visible.filter((c) => c.integrationMethod === 'rpa')
    const excel = visible.filter((c) => c.integrationMethod === 'excel')
    return [
      { key: 'hub', label: '연동몰', description: '여러 쇼핑몰을 모아주는 중계 API로 주문을 수집합니다.', rows: hub },
      { key: 'api', label: 'API 연동', description: '공식/제휴 API로 주문을 수집합니다', rows: api },
      { key: 'rpa', label: 'RPA 자동화', description: '판매자센터 화면에서 엑셀 다운로드를 자동화합니다', rows: rpa },
      { key: 'excel', label: '엑셀 수동', description: '주문 엑셀 업로드로 수집합니다', rows: excel },
    ].filter((section) => section.rows.length > 0)
  }, [visible])
  const activeImportTemplate = useMemo(() => {
    if (importTemplates.length === 0) return null
    return importTemplates.find((t) => t.id === selectedImportTemplateId) ?? importTemplates[0]
  }, [importTemplates, selectedImportTemplateId])
  const allEligibleSelected =
    eligibleSelectable.length > 0 && eligibleSelectable.every((c) => selected.has(c.id))
  const someEligibleSelected =
    eligibleSelectable.some((c) => selected.has(c.id)) && !allEligibleSelected

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleSelectAll = useCallback(() => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allEligibleSelected) {
        for (const c of eligibleSelectable) next.delete(c.id)
      } else {
        for (const c of eligibleSelectable) next.add(c.id)
      }
      return next
    })
  }, [allEligibleSelected, eligibleSelectable])

  const handleCollectSelected = () => {
    const ids = [...selected].filter((id) =>
      connectedMarkets.some((c) => c.id === id)
    )
    if (ids.length === 0) return
    startCollect(ids, getCollectionOptions())
  }

  const handleCollectAll = () => {
    if (connectedMarkets.length === 0) return
    startCollect(connectedMarkets.map((c) => c.id), getCollectionOptions())
  }

  const handleCollectOne = (connectionId: string) => {
    startCollect([connectionId], getCollectionOptions())
  }

  const getCollectionOptions = () => collectionRangeMode === 'custom'
    ? { manualDateFrom, manualDateTo }
    : { manualLookbackDays }

  const nameMap = Object.fromEntries(
    connections.map((c) => [c.id, c.displayName])
  )

  const enrichedLogs = logs?.map((l) => ({
    ...l,
    displayName: l.connectionId
      ? (nameMap[l.connectionId] ?? l.marketplaceId ?? '오류')
      : (l.marketplaceId ?? '오류'),
  }))

  const allDone = enrichedLogs && enrichedLogs.every(
    (l) => l.status === 'completed' || l.status === 'failed' || l.status === 'cancelled'
  )
  const showModal = enrichedLogs && enrichedLogs.length > 0

  const totalOrders = enrichedLogs?.reduce((sum, r) => sum + (r.ordersCollected ?? 0), 0) ?? 0
  const totalClaims = enrichedLogs?.reduce((sum, r) => sum + (r.claimsCollected ?? 0), 0) ?? 0
  const successCount = enrichedLogs?.filter((r) => r.status === 'completed').length ?? 0
  const failCount = enrichedLogs?.filter((r) => r.status === 'failed').length ?? 0
  const cancelledCount = enrichedLogs?.filter((r) => r.status === 'cancelled').length ?? 0

  // 컬럼 너비 — localStorage 에 저장
  const [columnSizing, setColumnSizing] = useColumnSizing('marketplace-dashboard')

  // 테이블 헤더 정의
  const cols = [
    { id: 'select', label: '', size: 36 },
    { id: 'type', label: '타입', size: 50 },
    { id: 'name', label: '마켓명', size: 200 },
    { id: 'status', label: '상태', size: 90 },
    { id: 'lastCheck', label: '마지막수집', size: 110 },
    { id: 'expires', label: '만료', size: 90 },
    { id: 'note', label: '알림', size: 260 },
    { id: 'actions', label: '액션', size: 220 },
  ]
  const flexibleColumnId = 'note'
  const minTableWidth = cols.reduce((s, c) => s + (columnSizing[c.id] ?? c.size), 0)
  const sizeOf = (id: string) => columnSizing[id] ?? cols.find((c) => c.id === id)!.size
  const columnWidthStyle = (id: string) =>
    id === flexibleColumnId
      ? { minWidth: sizeOf(id) }
      : { width: sizeOf(id) }

  const onResize = (id: string) => (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault()
    const startX = 'touches' in e ? e.touches[0].clientX : e.clientX
    const startSize = sizeOf(id)
    const move = (ev: MouseEvent | TouchEvent) => {
      const x = 'touches' in ev ? ev.touches[0].clientX : ev.clientX
      const delta = x - startX
      const next = Math.max(40, startSize + delta)
      setColumnSizing((prev) => ({ ...prev, [id]: next }))
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('touchmove', move)
      window.removeEventListener('mouseup', up)
      window.removeEventListener('touchend', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('touchmove', move)
    window.addEventListener('mouseup', up)
    window.addEventListener('touchend', up)
  }

  const filterChips: { key: FilterKey; label: string; count: number; dot?: string }[] = [
    { key: 'all', label: '전체', count: counts.all },
    { key: 'api', label: 'API', count: counts.api, dot: 'bg-emerald-500' },
    { key: 'hub', label: '연동몰', count: counts.hub, dot: 'bg-cyan-500' },
    { key: 'rpa', label: 'RPA', count: counts.rpa, dot: 'bg-violet-500' },
    { key: 'excel', label: '엑셀', count: counts.excel, dot: 'bg-blue-500' },
    { key: 'connected', label: '연결됨', count: counts.connected, dot: 'bg-green-500' },
    { key: 'error', label: '오류', count: counts.error, dot: 'bg-red-500' },
    { key: 'expiring', label: '만료임박', count: counts.expiring, dot: 'bg-amber-500' },
  ]

  const pickImportTemplate = (templateId: string) => {
    setSelectedImportTemplateId(templateId)
    window.localStorage.setItem(IMPORT_TEMPLATE_KEY, templateId)
  }

  const openImportTemplateModal = (draftName?: string, templateId?: string) => {
    setImportTemplateModal({
      templateId: templateId ?? activeImportTemplate?.id,
      draftName,
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <h1 className="text-2xl font-bold">주문 수집</h1>
        <div className="flex flex-wrap items-center gap-1 lg:justify-end">
          <label className="flex items-center gap-1 rounded-md border bg-white px-2 py-1 text-xs">
            <span className="whitespace-nowrap">수집기간</span>
            <select
              value={collectionRangeMode === 'custom' ? 'custom' : manualLookbackDays}
              onChange={(e) => {
                if (e.target.value === 'custom') {
                  setCollectionRangeMode('custom')
                } else {
                  setCollectionRangeMode('preset')
                  setManualLookbackDays(Number(e.target.value))
                }
              }}
              className="bg-transparent text-xs outline-none"
              title="주문수집 기간"
            >
              <option value={1}>1일</option>
              <option value={3}>3일</option>
              <option value={6}>6일</option>
              <option value={9}>9일</option>
              <option value={14}>14일</option>
              <option value="custom">직접</option>
            </select>
          </label>
          {collectionRangeMode === 'custom' && (
            <div className="flex items-center gap-1 rounded-md border bg-white px-2 py-1 text-xs">
              <input
                type="date"
                value={manualDateFrom}
                max={manualDateTo}
                onChange={(e) => setManualDateFrom(e.target.value)}
                className="w-[116px] bg-transparent text-xs outline-none"
                title="수집 시작일"
              />
              <span className="text-muted-foreground">~</span>
              <input
                type="date"
                value={manualDateTo}
                min={manualDateFrom}
                max={toDateInputValue(new Date())}
                onChange={(e) => setManualDateTo(e.target.value)}
                className="w-[116px] bg-transparent text-xs outline-none"
                title="수집 종료일"
              />
            </div>
          )}
          {selected.size > 0 && (
            <>
              <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                {selected.size}개 선택
              </span>
              <button
                type="button"
                onClick={handleCollectSelected}
                disabled={collecting}
                className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/80 disabled:opacity-50"
              >
                {collecting ? '수집 중...' : '선택 수집'}
              </button>
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="rounded-md border bg-white px-2 py-1 text-xs hover:bg-muted"
              >
                선택 해제
              </button>
            </>
          )}
          {selected.size === 0 && connectedMarkets.length > 0 && (
            <button
              type="button"
              onClick={handleCollectAll}
              disabled={collecting}
              className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/80 disabled:opacity-50"
            >
              {collecting ? '수집 중...' : `전체 수집 (${connectedMarkets.length})`}
            </button>
          )}
          <Link
            href="/settings/marketplaces"
            className="rounded-md border bg-white px-3 py-1 text-xs font-medium hover:bg-muted"
          >
            연동 관리
          </Link>
          {importTemplates.length > 0 && (
            <select
              value={activeImportTemplate?.id ?? ''}
              onChange={(e) => pickImportTemplate(e.target.value)}
              className="rounded-md border bg-white px-2 py-1 text-xs"
              title="엑셀 업로드에 사용할 주문수집 양식"
            >
              {importTemplates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={() => openImportTemplateModal()}
            className="rounded-md border bg-white px-3 py-1 text-xs font-medium hover:bg-muted"
            title="주문수집 엑셀 양식 만들기 또는 수정"
          >
            엑셀양식관리
          </button>
        </div>
      </div>

      {/* 상단 툴바: 필터칩 + 검색 */}
      <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 p-2">
        {filterChips.map((chip) => (
          <button
            key={chip.key}
            type="button"
            onClick={() => setFilter(chip.key)}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              filter === chip.key
                ? 'border-primary bg-primary text-primary-foreground'
                : 'bg-white hover:bg-muted'
            }`}
          >
            {chip.dot && <span className={`h-2 w-2 rounded-full ${chip.dot}`} />}
            {chip.label}
            <span
              className={`rounded-full px-1.5 text-[10px] ${
                filter === chip.key ? 'bg-primary-foreground/20' : 'bg-muted-foreground/10'
              }`}
            >
              {chip.count}
            </span>
          </button>
        ))}
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="마켓명 검색"
          className="ml-2 w-[180px] rounded-md border bg-white px-2 py-1 text-xs placeholder:text-muted-foreground"
        />
      </div>

      {/* 테이블 */}
      {visible.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-muted/30 px-4 py-12 text-center text-sm text-muted-foreground">
          {connections.length === 0 ? (
            <div className="space-y-3">
              <p>주문수집에 사용할 연동이 없습니다.</p>
              <Link
                href="/settings/marketplaces"
                className="inline-flex rounded-md border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
              >
                마켓연동 등록으로 이동
              </Link>
            </div>
          ) : (
            '조건에 맞는 마켓이 없습니다.'
          )}
        </div>
      ) : (
        <SyncedScrollContainer>
          <table className="w-full table-fixed text-xs" style={{ minWidth: minTableWidth }}>
            <colgroup>
              {cols.map((c) => (
                <col key={c.id} style={c.id === flexibleColumnId ? undefined : { width: sizeOf(c.id) }} />
              ))}
            </colgroup>
            <thead className="sticky top-0 z-[1] bg-muted/50">
              <tr className="border-b">
                {cols.map((c) => (
                  <th
                    key={c.id}
                    style={columnWidthStyle(c.id)}
                    className="relative whitespace-nowrap px-2 py-1.5 text-left font-medium text-muted-foreground"
                  >
                    {c.id === 'select' ? (
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5"
                        checked={allEligibleSelected}
                        ref={(el) => { if (el) el.indeterminate = someEligibleSelected }}
                        onChange={toggleSelectAll}
                        aria-label="모두 선택"
                      />
                    ) : (
                      c.label
                    )}
                    <div
                      onMouseDown={onResize(c.id)}
                      onTouchStart={onResize(c.id)}
                      className="absolute right-0 top-0 h-full w-1 cursor-col-resize select-none touch-none bg-transparent hover:bg-blue-400"
                      aria-label="컬럼 너비 조절"
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleSections.map((section) => (
                <SectionRows
                  key={section.key}
                  section={section}
                  selected={selected}
                  onToggle={toggleSelect}
                  onCollectOne={handleCollectOne}
                  collecting={collecting}
                  importTemplates={importTemplates}
                  fallbackImportTemplate={null}
                  onEditImportTemplate={openImportTemplateModal}
                  sizeOf={sizeOf}
                />
              ))}
            </tbody>
          </table>
        </SyncedScrollContainer>
      )}

      {importTemplateModal && (
        <ExcelImportTemplateModal
          templates={importTemplates}
          onTemplatesChange={setImportTemplates}
          onTemplateSaved={pickImportTemplate}
          initialTemplateId={importTemplateModal.templateId}
          initialName={importTemplateModal.draftName}
          onClose={() => setImportTemplateModal(null)}
        />
      )}

      {/* Results modal */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={allDone ? clearResults : undefined}
        >
          <div
            className="flex max-h-[calc(100vh-2rem)] w-full max-w-md flex-col overflow-hidden rounded-xl border bg-background shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between border-b px-5 py-4">
              <h2 className="text-base font-semibold">
                {allDone ? '수집 결과' : '수집 진행 중...'}
              </h2>
              <div className="flex items-center gap-2">
                {!allDone && (
                  <button
                    onClick={cancelCollect}
                    className="rounded-md border border-red-300 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                  >
                    중지
                  </button>
                )}
                <button
                  onClick={clearResults}
                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label="닫기"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 6 6 18" />
                    <path d="m6 6 12 12" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 divide-y overflow-y-auto px-5">
              {enrichedLogs!.map((r, i) => (
                <ResultRow key={i} log={r} />
              ))}
            </div>

            {allDone && (
              <div className="shrink-0 border-t bg-muted/30 px-5 py-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">
                    {successCount > 0 && (
                      <span>
                        총 <span className="font-semibold text-foreground">{totalOrders}건</span> 수집/갱신
                        {totalClaims > 0 && (
                          <> (클레임 <span className="font-semibold text-foreground">{totalClaims}건</span>)</>
                        )}
                      </span>
                    )}
                    {failCount > 0 && (
                      <span className={successCount > 0 ? 'ml-2' : ''}>{failCount}개 실패</span>
                    )}
                    {cancelledCount > 0 && (
                      <span className={successCount > 0 || failCount > 0 ? 'ml-2' : ''}>{cancelledCount}개 취소</span>
                    )}
                  </p>
                  <button
                    onClick={clearResults}
                    className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/80"
                  >
                    닫기
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function SectionRows({
  section,
  selected,
  onToggle,
  onCollectOne,
  collecting,
  importTemplates,
  fallbackImportTemplate,
  onEditImportTemplate,
  sizeOf,
}: {
  section: {
    key: string
    label: string
    description: string
    rows: Connection[]
  }
  selected: Set<string>
  onToggle: (id: string) => void
  onCollectOne: (id: string) => void
  collecting: boolean
  importTemplates: ExcelImportTemplateView[]
  fallbackImportTemplate: ExcelImportTemplateView | null
  onEditImportTemplate: (draftName?: string, templateId?: string) => void
  sizeOf: (id: string) => number
}) {
  return (
    <>
      <tr className="border-y bg-muted/40">
        <td colSpan={8} className="px-2 py-1.5">
          <div className="flex items-center gap-2 text-[11px]">
            <span className="font-semibold text-foreground">{section.label}</span>
            <span className="text-muted-foreground">{section.description}</span>
            <span className="ml-auto rounded-full bg-background px-2 py-0.5 font-medium text-muted-foreground">
              {section.rows.length}개
            </span>
          </div>
        </td>
      </tr>
      {section.rows.map((conn, idx) => (
        <ConnRow
          key={conn.id}
          conn={conn}
          isSelected={selected.has(conn.id)}
          onToggle={onToggle}
          onCollectOne={onCollectOne}
          collecting={collecting}
          importTemplate={findTemplateForConnection(conn, importTemplates) ?? fallbackImportTemplate}
          onEditImportTemplate={onEditImportTemplate}
          zebra={idx % 2 === 1}
          sizeOf={sizeOf}
        />
      ))}
    </>
  )
}

function ConnRow({
  conn,
  isSelected,
  onToggle,
  onCollectOne,
  collecting,
  importTemplate,
  onEditImportTemplate,
  zebra,
  sizeOf,
}: {
  conn: Connection
  isSelected: boolean
  onToggle: (id: string) => void
  onCollectOne: (id: string) => void
  collecting: boolean
  importTemplate: ExcelImportTemplateView | null
  onEditImportTemplate: (draftName?: string, templateId?: string) => void
  zebra: boolean
  sizeOf: (id: string) => number
}) {
  const isDisconnected = conn.status === 'disconnected'
  const isManual = conn.isManual
  const integrationInfo = getIntegrationInfo(conn.integrationMethod)
  const eligibleForCollect = conn.integrationMethod !== 'excel' && !isDisconnected
  const expiringSoon = !!conn.expiresAt && isExpiringSoon(conn.expiresAt)
  const errorMsg = conn.status === 'error' ? conn.lastErrorMessage : null

  return (
    <tr
      className={`group border-b transition-colors hover:bg-muted/50 ${zebra ? 'bg-gray-50/50' : 'bg-white'}`}
    >
      {/* select */}
      <td style={{ width: sizeOf('select') }} className="px-2 py-1.5 align-middle">
        {eligibleForCollect ? (
          <input
            type="checkbox"
            className="h-3.5 w-3.5"
            checked={isSelected}
            onChange={() => onToggle(conn.id)}
            aria-label={`${conn.displayName} 선택`}
          />
        ) : (
          <span className="inline-block h-3.5 w-3.5" />
        )}
      </td>
      {/* type */}
      <td style={{ width: sizeOf('type') }} className="px-2 py-1.5 align-middle">
        <span
          className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${
            conn.integrationMethod === 'excel'
              ? 'bg-blue-100 text-blue-700'
              : conn.integrationMethod === 'hub'
                ? 'bg-cyan-100 text-cyan-700'
              : conn.integrationMethod === 'rpa'
                ? 'bg-violet-100 text-violet-700'
                : 'bg-emerald-100 text-emerald-700'
          }`}
          title={integrationInfo.description}
        >
          {integrationInfo.label}
        </span>
      </td>
      {/* name */}
      <td style={{ width: sizeOf('name') }} className="overflow-hidden whitespace-nowrap px-2 py-1.5 align-middle">
        <span className="truncate font-medium">{conn.displayName}</span>
      </td>
      {/* status */}
      <td style={{ width: sizeOf('status') }} className="px-2 py-1.5 align-middle">
        {isManual ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <StatusBadge status={conn.status as ConnectionStatus} />
        )}
      </td>
      {/* lastCheck */}
      <td style={{ width: sizeOf('lastCheck') }} className="whitespace-nowrap px-2 py-1.5 align-middle text-muted-foreground">
        {isManual ? '—' : conn.lastCheckedAt ? formatRelativeTime(conn.lastCheckedAt) : '확인 안됨'}
      </td>
      {/* expires */}
      <td style={{ width: sizeOf('expires') }} className="whitespace-nowrap px-2 py-1.5 align-middle">
        {isManual || !conn.expiresAt ? (
          <span className="text-muted-foreground">—</span>
        ) : expiringSoon ? (
          <span className="text-amber-600">{conn.expiresAt.toLocaleDateString('ko-KR')}</span>
        ) : (
          <span className="text-muted-foreground">{conn.expiresAt.toLocaleDateString('ko-KR')}</span>
        )}
      </td>
      {/* note */}
      <td style={{ minWidth: sizeOf('note') }} className="overflow-hidden px-2 py-1.5 align-middle">
        {errorMsg ? (
          <span className="line-clamp-2 text-red-600" title={errorMsg}>
            {errorMsg}
          </span>
        ) : expiringSoon ? (
          <span className="text-amber-600">인증 만료 임박</span>
        ) : conn.integrationMethod === 'excel' ? (
          <span className="text-muted-foreground">엑셀 업로드 전용</span>
        ) : conn.integrationMethod === 'hub' ? (
          <span className="line-clamp-2 text-muted-foreground" title={conn.linkedMarketplaces?.join(', ')}>
            {conn.linkedMarketplaces && conn.linkedMarketplaces.length > 0
              ? `연동몰: ${conn.linkedMarketplaces.join(', ')}`
              : '연동몰: EMP 설정 전체'}
          </span>
        ) : conn.integrationMethod === 'rpa' ? (
          <span className="text-muted-foreground">RPA 자동 다운로드 준비</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      {/* actions */}
      <td style={{ width: sizeOf('actions') }} className="px-2 py-1.5 align-middle">
        <div className="flex items-center gap-1">
          {eligibleForCollect && (
            <button
              type="button"
              onClick={() => onCollectOne(conn.id)}
              disabled={collecting}
              className="rounded border px-2 py-0.5 text-xs hover:bg-muted disabled:opacity-50"
            >
              수집
            </button>
          )}
          <ExcelUploadButton
            marketplaceId={conn.marketplaceId}
            displayName={conn.displayName}
            disabled={false}
            template={importTemplate}
          />
          <button
            type="button"
            onClick={() => onEditImportTemplate(`${conn.displayName} 주문수집`, importTemplate?.id)}
            className="rounded border px-2 py-0.5 text-xs hover:bg-muted"
            title={
              importTemplate
                ? `${importTemplate.name} 양식 수정`
                : `${conn.displayName}용 주문수집 양식 만들기`
            }
          >
            양식
          </button>
        </div>
      </td>
    </tr>
  )
}

function ExcelUploadButton({
  marketplaceId,
  displayName,
  disabled,
  template,
}: {
  marketplaceId: string
  displayName: string
  disabled: boolean
  template: ExcelImportTemplateView | null
}) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState<{ inserted: number; skipped: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleFile = async (file: File) => {
    setUploading(true)
    setResult(null)
    setError(null)

    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('marketplaceId', marketplaceId)
      formData.append('marketplaceName', displayName)
      if (template) formData.append('templateId', template.id)

      const res = await fetch('/api/orders/import', { method: 'POST', body: formData })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error || '업로드 실패')
      } else {
        if (Array.isArray(data.errors) && data.errors.length > 0) {
          const firstError = data.errors[0]
          setError(firstError?.message ?? data.error ?? '업로드 실패')
        }
        setResult({ inserted: data.inserted ?? 0, skipped: data.skipped ?? 0 })
        if ((data.inserted ?? 0) > 0) {
          setTimeout(() => router.push('/orders?status=new'), 1500)
        }
        setTimeout(() => setResult(null), 5000)
      }
    } catch {
      setError('네트워크 오류')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) handleFile(f)
        }}
      />
      <button
        type="button"
        onClick={() => !disabled && !uploading && inputRef.current?.click()}
        disabled={disabled || uploading}
        title={
          result
            ? `${result.inserted}건 등록${result.skipped ? ` (${result.skipped} 중복)` : ''}`
            : error ?? `엑셀 업로드${template ? ` (${template.name})` : ' (기본 양식)'}`
        }
        className={`rounded border px-2 py-0.5 text-xs hover:bg-muted disabled:opacity-50 ${
          error ? 'border-red-300 text-red-600' : result ? 'border-emerald-300 text-emerald-600' : ''
        }`}
      >
        {uploading ? (
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />
            업로드중
          </span>
        ) : result ? (
          `${result.inserted}건↑`
        ) : error ? (
          '실패'
        ) : (
          '엑셀'
        )}
      </button>
    </>
  )
}

function ExcelImportTemplateModal({
  templates,
  onTemplatesChange,
  onTemplateSaved,
  initialTemplateId,
  initialName,
  onClose,
}: {
  templates: ExcelImportTemplateView[]
  onTemplatesChange: (templates: ExcelImportTemplateView[]) => void
  onTemplateSaved?: (templateId: string) => void
  initialTemplateId?: string
  initialName?: string
  onClose: () => void
}) {
  const initialTemplate = initialTemplateId
    ? templates.find((template) => template.id === initialTemplateId) ?? null
    : null
  const [editing, setEditing] = useState<ExcelImportTemplateView | null>(initialTemplate)
  const [name, setName] = useState(initialTemplate?.name ?? initialName ?? '')
  const [mappings, setMappings] = useState<OrderImportMapping[]>(
    initialTemplate?.mappings.length ? initialTemplate.mappings : DEFAULT_IMPORT_MAPPINGS,
  )
  const [selectedField, setSelectedField] = useState<OrderImportField>(
    ORDER_IMPORT_FIELDS[0]?.field ?? 'orderNumber',
  )
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const startCreate = () => {
    setEditing(null)
    setName(initialName ?? '')
    setMappings(DEFAULT_IMPORT_MAPPINGS)
    setError(null)
  }

  const startEdit = (template: ExcelImportTemplateView) => {
    setEditing(template)
    setName(template.name)
    setMappings(template.mappings.length > 0 ? template.mappings : DEFAULT_IMPORT_MAPPINGS)
    setError(null)
  }

  const addMapping = () => {
    const fieldDef = ORDER_IMPORT_FIELDS.find((field) => field.field === selectedField)
    if (!fieldDef) return
    setMappings((prev) => [
      ...prev,
      { field: fieldDef.field, excelColumn: fieldDef.label, joinSeparator: ' ' },
    ])
  }

  const updateMapping = (index: number, patch: Partial<OrderImportMapping>) => {
    setMappings((prev) => prev.map((mapping, idx) => (idx === index ? { ...mapping, ...patch } : mapping)))
  }

  const removeMapping = (index: number) => {
    setMappings((prev) => prev.filter((_, idx) => idx !== index))
  }

  const moveMapping = (index: number, direction: 'up' | 'down') => {
    setMappings((prev) => {
      const next = [...prev]
      const swapIndex = direction === 'up' ? index - 1 : index + 1
      if (swapIndex < 0 || swapIndex >= next.length) return prev
      ;[next[index], next[swapIndex]] = [next[swapIndex], next[index]]
      return next
    })
  }

  const addExtraColumn = (index: number, columnName: string) => {
    const trimmed = columnName.trim()
    if (!trimmed) return
    setMappings((prev) =>
      prev.map((mapping, idx) => {
        if (idx !== index) return mapping
        const current = mapping.extraColumns ?? []
        if (current.includes(trimmed)) return mapping
        return { ...mapping, extraColumns: [...current, trimmed], joinSeparator: mapping.joinSeparator ?? ' ' }
      }),
    )
  }

  const removeExtraColumn = (index: number, columnName: string) => {
    setMappings((prev) =>
      prev.map((mapping, idx) => {
        if (idx !== index) return mapping
        const next = (mapping.extraColumns ?? []).filter((col) => col !== columnName)
        return { ...mapping, extraColumns: next.length > 0 ? next : undefined }
      }),
    )
  }

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    const formData = new FormData()
    formData.set('name', name)
    formData.set('mappings', JSON.stringify(mappings))
    if (editing && !editing.isDefault) formData.set('templateId', editing.id)

    startTransition(async () => {
      const result = editing && !editing.isDefault
        ? await updateExcelImportTemplate(formData)
        : await createExcelImportTemplate(formData)

      if (result.error) {
        setError(result.error)
        return
      }
      if (result.templates) {
        onTemplatesChange(result.templates)
        const savedTemplate = [...result.templates]
          .reverse()
          .find((template) =>
            editing && !editing.isDefault ? template.id === editing.id : template.name === name.trim(),
          )
        if (savedTemplate) onTemplateSaved?.(savedTemplate.id)
      }
      startCreate()
    })
  }

  const handleDelete = (template: ExcelImportTemplateView) => {
    if (!window.confirm(`${template.name} 양식을 삭제할까요?`)) return
    setError(null)

    startTransition(async () => {
      const result = await deleteExcelImportTemplate(template.id)
      if (result.error) {
        setError(result.error)
        return
      }
      if (result.templates) onTemplatesChange(result.templates)
      if (editing?.id === template.id) startCreate()
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[86vh] w-full max-w-4xl flex-col rounded-xl border bg-background shadow-2xl">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div>
            <h2 className="text-base font-semibold">주문수집 엑셀양식관리</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              업로드할 엑셀의 헤더명을 주문 필드에 맞춰 저장합니다.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="닫기"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[240px_1fr] overflow-hidden">
          <aside className="overflow-y-auto border-r bg-muted/20 p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold">저장된 양식</h3>
              <button
                type="button"
                onClick={startCreate}
                className="rounded-md border bg-white px-2 py-1 text-xs hover:bg-muted"
              >
                새 양식
              </button>
            </div>
            {templates.length === 0 ? (
              <p className="rounded-md border border-dashed bg-white px-3 py-6 text-center text-xs text-muted-foreground">
                저장된 주문수집 양식이 없습니다.
              </p>
            ) : (
              <div className="space-y-1">
                {templates.map((template) => (
                  <div
                    key={template.id}
                    className={`rounded-md border bg-white p-2 ${
                      editing?.id === template.id ? 'border-primary' : ''
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => startEdit(template)}
                      className="block w-full truncate text-left text-sm font-medium hover:underline"
                      title={template.name}
                    >
                      {template.name}
                    </button>
                    <div className="mt-2 flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">{template.mappings.length}개 매핑</span>
                      {template.isDefault ? (
                        <span className="text-muted-foreground">기본</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleDelete(template)}
                          disabled={isPending}
                          className="text-red-600 hover:underline disabled:opacity-50"
                        >
                          삭제
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </aside>

          <form onSubmit={handleSubmit} className="min-h-0 overflow-y-auto p-5">
            <div className="mb-4">
              <label htmlFor="import-template-name" className="mb-1 block text-sm font-medium">
                양식 이름
              </label>
              <input
                id="import-template-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="예: 스마트스토어 수동수집, 자사몰 주문서"
                className="w-full rounded-md border px-3 py-2 text-sm"
                required
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">
                열 구성 <span className="text-xs text-muted-foreground">(헤더, 출력 항목, 출력내용, 합치기를 자유롭게 수정)</span>
              </label>
              <div className="mb-3 flex items-center gap-2">
                <select
                  value={selectedField}
                  onChange={(e) => setSelectedField(e.target.value as OrderImportField)}
                  className="flex-1 rounded-md border px-3 py-2 text-sm"
                >
                  {ORDER_IMPORT_FIELDS.map((field) => (
                    <option key={field.field} value={field.field}>
                      {field.label} ({field.field})
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={addMapping}
                  className="rounded-md border px-3 py-2 text-sm hover:bg-muted"
                >
                  행추가
                </button>
              </div>

              <div className="overflow-hidden rounded-md border">
                <div className="grid grid-cols-[2rem_1fr_16rem_1fr_6rem] items-center gap-2 border-b bg-muted/40 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <span>#</span>
                  <span>헤더 <span className="normal-case text-[10px] text-muted-foreground/80">(Excel 헤더명)</span></span>
                  <span>출력 항목 <span className="normal-case text-[10px] text-muted-foreground/80">(저장될 주문 필드 + 합치기)</span></span>
                  <span>출력내용 <span className="normal-case text-[10px] text-muted-foreground/80">(비우면 Excel 값, 입력 시 고정)</span></span>
                  <span className="text-right">동작</span>
                </div>
                {mappings.map((mapping, idx) => {
                  const fieldDef = ORDER_IMPORT_FIELDS.find((field) => field.field === mapping.field)
                  return (
                    <div
                      key={`${mapping.field}-${idx}`}
                      className="grid grid-cols-[2rem_1fr_16rem_1fr_6rem] items-start gap-2 border-b px-3 py-1.5 last:border-b-0"
                    >
                      <span className="pt-1.5 text-center text-xs text-muted-foreground">{idx + 1}</span>
                      <input
                        type="text"
                        value={mapping.excelColumn}
                        onChange={(e) => updateMapping(idx, { excelColumn: e.target.value })}
                        placeholder={fieldDef?.label ?? 'Excel 헤더명'}
                        className="rounded border px-2 py-1 text-sm"
                      />
                      <div className="flex flex-wrap items-center gap-1">
                        <select
                          value={mapping.field}
                          onChange={(e) => updateMapping(idx, { field: e.target.value })}
                          className="rounded border bg-white px-1.5 py-0.5 font-mono text-[11px] text-foreground"
                          aria-label="출력 항목 선택"
                        >
                          {ORDER_IMPORT_FIELDS.map((field) => (
                            <option key={field.field} value={field.field}>
                              {field.label} ({field.field})
                            </option>
                          ))}
                        </select>
                        {(mapping.extraColumns ?? []).map((extraColumn) => (
                          <span
                            key={extraColumn}
                            className="inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 font-mono text-[11px] text-emerald-700"
                          >
                            + {extraColumn}
                            <button
                              type="button"
                              onClick={() => removeExtraColumn(idx, extraColumn)}
                              className="text-emerald-500 hover:text-emerald-800"
                              aria-label={`${extraColumn} 합치기 해제`}
                            >
                              ×
                            </button>
                          </span>
                        ))}
                        <input
                          type="text"
                          placeholder="+ 합칠 헤더"
                          className="w-24 rounded border px-1 py-0.5 text-[11px]"
                          onKeyDown={(e) => {
                            if (e.key !== 'Enter') return
                            e.preventDefault()
                            addExtraColumn(idx, e.currentTarget.value)
                            e.currentTarget.value = ''
                          }}
                          onBlur={(e) => {
                            addExtraColumn(idx, e.currentTarget.value)
                            e.currentTarget.value = ''
                          }}
                        />
                        {(mapping.extraColumns ?? []).length > 0 && (
                          <select
                            value={mapping.joinSeparator ?? ' '}
                            onChange={(e) => updateMapping(idx, { joinSeparator: e.target.value })}
                            className="rounded border bg-white px-1 py-0.5 text-[11px]"
                            aria-label="구분자"
                            title="합쳐진 값 사이에 들어갈 구분자"
                          >
                            {JOIN_SEPARATORS.map((separator) => (
                              <option key={separator.value} value={separator.value}>
                                {separator.label}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                      <input
                        type="text"
                        value={mapping.fixedValue ?? ''}
                        onChange={(e) => updateMapping(idx, { fixedValue: e.target.value })}
                        placeholder="자동 (Excel 값 사용)"
                        className="rounded border px-2 py-1 text-sm"
                      />
                      <div className="flex items-center justify-end gap-1 pt-0.5">
                        <button
                          type="button"
                          onClick={() => moveMapping(idx, 'up')}
                          disabled={idx === 0}
                          className="rounded px-1.5 text-xs hover:bg-muted disabled:opacity-30"
                          aria-label="위로"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          onClick={() => moveMapping(idx, 'down')}
                          disabled={idx === mappings.length - 1}
                          className="rounded px-1.5 text-xs hover:bg-muted disabled:opacity-30"
                          aria-label="아래로"
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          onClick={() => removeMapping(idx)}
                          className="rounded px-1.5 text-xs text-red-500 hover:bg-red-50 hover:text-red-700"
                          aria-label="삭제"
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={startCreate}
                className="rounded-md border px-4 py-2 text-sm hover:bg-muted"
              >
                초기화
              </button>
              <button
                type="submit"
                disabled={isPending || !name.trim()}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {isPending ? '저장 중...' : editing ? '수정 저장' : '저장'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

function ResultRow({ log }: { log: JobLogResult & { displayName: string } }) {
  const isCompleted = log.status === 'completed'
  const isFailed = log.status === 'failed'
  const isCancelled = log.status === 'cancelled'
  const isRunning = log.status === 'running'
  const isQueued = log.status === 'queued' || (!isCompleted && !isFailed && !isCancelled && !isRunning)

  return (
    <div className="flex items-start gap-3 py-3">
      <span className="mt-0.5 text-base">
        {isCompleted && '✅'}
        {isFailed && '❌'}
        {isCancelled && '⏹'}
        {(isRunning || isQueued) && (
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{log.displayName}</p>
        {isCompleted && (
          <p className="text-sm text-muted-foreground">
            주문 <span className="font-medium text-foreground">{log.ordersCollected ?? 0}건</span>
            {(log.claimsCollected ?? 0) > 0 && (
              <>, 클레임 <span className="font-medium text-foreground">{log.claimsCollected}건</span></>
            )}{' '}수집/갱신
          </p>
        )}
        {isFailed && (
          <p className="break-words text-sm text-red-500">{log.errorMessage ?? '알 수 없는 오류'}</p>
        )}
        {isCancelled && <p className="text-sm text-muted-foreground">취소됨</p>}
        {isRunning && (
          <p className="text-sm text-muted-foreground">
            {log.progressMessage ?? '수집 중...'}
          </p>
        )}
        {isQueued && <p className="text-sm text-muted-foreground">대기 중...</p>}
      </div>
    </div>
  )
}
