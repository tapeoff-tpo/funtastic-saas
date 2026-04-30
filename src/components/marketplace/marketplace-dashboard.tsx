'use client'

import { useState, useRef, useTransition, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useCollectPoll, type JobLogResult } from '@/lib/hooks/use-collect-poll'
import { StatusBadge } from './status-badge'
import { SyncedScrollContainer } from '@/components/ui/synced-scroll'
import { useColumnSizing } from '@/lib/hooks/use-column-sizing'
import type { ConnectionStatus } from '@/lib/marketplace/types'
import { addManualChannel } from '@/app/(auth)/orders/collect/actions'

interface Connection {
  id: string
  marketplaceId: string
  displayName: string
  status: string
  lastCheckedAt: Date | null
  lastErrorMessage: string | null
  expiresAt: Date | null
  isManual: boolean
}

interface MarketplaceDashboardProps {
  connections: Connection[]
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
 * 0 오류 → 1 만료임박 → 2 미수집(lastCheckedAt 없음) → 3 연결됨(오래된순) → 4 미연결 → 5 엑셀(수동)
 */
function riskScore(c: Connection): number {
  if (c.isManual) return 5
  if (c.status === 'error') return 0
  if (c.expiresAt && isExpiringSoon(c.expiresAt)) return 1
  if (c.status === 'disconnected') return 4
  if (c.lastCheckedAt == null) return 2
  return 3
}

type FilterKey = 'all' | 'connected' | 'error' | 'expiring' | 'disconnected' | 'manual'

export function MarketplaceDashboard({ connections }: MarketplaceDashboardProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [showAddModal, setShowAddModal] = useState(false)
  const [filter, setFilter] = useState<FilterKey>('all')
  const [search, setSearch] = useState('')
  const { collecting, logs, startCollect, cancelCollect, clearResults } = useCollectPoll()

  const connectedMarkets = useMemo(
    () => connections.filter((c) => c.status !== 'disconnected' && !c.isManual),
    [connections]
  )

  // 필터 카운트 — 칩에 표시
  const counts = useMemo(() => {
    const c = { all: connections.length, connected: 0, error: 0, expiring: 0, disconnected: 0, manual: 0 }
    for (const conn of connections) {
      if (conn.isManual) c.manual++
      else if (conn.status === 'error') c.error++
      else if (conn.status === 'disconnected') c.disconnected++
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
        if (filter === 'connected') return !c.isManual && c.status !== 'disconnected' && c.status !== 'error'
        if (filter === 'error') return c.status === 'error'
        if (filter === 'expiring') return !c.isManual && !!c.expiresAt && isExpiringSoon(c.expiresAt)
        if (filter === 'disconnected') return c.status === 'disconnected'
        if (filter === 'manual') return c.isManual
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
    startCollect(ids)
  }

  const handleCollectAll = () => {
    if (connectedMarkets.length === 0) return
    startCollect(connectedMarkets.map((c) => c.id))
  }

  const handleCollectOne = (connectionId: string) => {
    startCollect([connectionId])
  }

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
    { id: 'actions', label: '액션', size: 180 },
  ]
  const totalWidth = cols.reduce((s, c) => s + (columnSizing[c.id] ?? c.size), 0)
  const sizeOf = (id: string) => columnSizing[id] ?? cols.find((c) => c.id === id)!.size

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
    { key: 'connected', label: '연결됨', count: counts.connected, dot: 'bg-green-500' },
    { key: 'error', label: '오류', count: counts.error, dot: 'bg-red-500' },
    { key: 'expiring', label: '만료임박', count: counts.expiring, dot: 'bg-amber-500' },
    { key: 'disconnected', label: '미연결', count: counts.disconnected, dot: 'bg-gray-400' },
    { key: 'manual', label: '엑셀', count: counts.manual, dot: 'bg-blue-500' },
  ]

  return (
    <div className="space-y-3">
      {/* 상단 툴바: 필터칩 + 검색 + 일괄수집/추가 */}
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
        <div className="ml-auto flex items-center gap-1">
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
                className="rounded-md border px-2 py-1 text-xs hover:bg-muted"
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
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="rounded-md border px-3 py-1 text-xs font-medium hover:bg-muted"
          >
            + 수동 쇼핑몰
          </button>
        </div>
      </div>

      {/* 테이블 */}
      {visible.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-muted/30 px-4 py-12 text-center text-sm text-muted-foreground">
          {connections.length === 0
            ? '연결된 마켓플레이스가 없습니다.'
            : '조건에 맞는 마켓이 없습니다.'}
        </div>
      ) : (
        <SyncedScrollContainer>
          <table className="text-xs" style={{ width: totalWidth }}>
            <thead className="sticky top-0 z-[1] bg-muted/50">
              <tr className="border-b">
                {cols.map((c) => (
                  <th
                    key={c.id}
                    style={{ width: sizeOf(c.id) }}
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
              {visible.map((conn, idx) => (
                <ConnRow
                  key={conn.id}
                  conn={conn}
                  isSelected={selected.has(conn.id)}
                  onToggle={toggleSelect}
                  onCollectOne={handleCollectOne}
                  collecting={collecting}
                  zebra={idx % 2 === 1}
                  sizeOf={sizeOf}
                />
              ))}
            </tbody>
          </table>
        </SyncedScrollContainer>
      )}

      {/* Add manual channel modal */}
      {showAddModal && (
        <AddManualChannelModal onClose={() => setShowAddModal(false)} />
      )}

      {/* Results modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-xl border bg-background shadow-2xl">
            <div className="flex items-center justify-between border-b px-5 py-4">
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
                {allDone && (
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
                )}
              </div>
            </div>

            <div className="divide-y px-5">
              {enrichedLogs!.map((r, i) => (
                <ResultRow key={i} log={r} />
              ))}
            </div>

            {allDone && (
              <div className="border-t bg-muted/30 px-5 py-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">
                    {successCount > 0 && (
                      <span>
                        총 <span className="font-semibold text-foreground">{totalOrders}건</span> 수집
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

function ConnRow({
  conn,
  isSelected,
  onToggle,
  onCollectOne,
  collecting,
  zebra,
  sizeOf,
}: {
  conn: Connection
  isSelected: boolean
  onToggle: (id: string) => void
  onCollectOne: (id: string) => void
  collecting: boolean
  zebra: boolean
  sizeOf: (id: string) => number
}) {
  const isDisconnected = conn.status === 'disconnected'
  const isManual = conn.isManual
  const eligibleForCollect = !isManual && !isDisconnected
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
            isManual ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700'
          }`}
        >
          {isManual ? '엑셀' : 'API'}
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
      <td style={{ width: sizeOf('note') }} className="overflow-hidden px-2 py-1.5 align-middle">
        {errorMsg ? (
          <span className="line-clamp-2 text-red-600" title={errorMsg}>
            {errorMsg}
          </span>
        ) : expiringSoon ? (
          <span className="text-amber-600">인증 만료 임박</span>
        ) : isManual ? (
          <span className="text-muted-foreground">엑셀 업로드 전용</span>
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
            displayName={conn.displayName}
            disabled={isDisconnected}
          />
        </div>
      </td>
    </tr>
  )
}

function AddManualChannelModal({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    const formData = new FormData(e.currentTarget)

    startTransition(async () => {
      const result = await addManualChannel(formData)
      if (result.error) {
        setError(result.error)
      } else {
        router.refresh()
        onClose()
      }
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-sm rounded-xl border bg-background shadow-2xl">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h2 className="text-base font-semibold">수동 쇼핑몰 추가</h2>
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

        <form onSubmit={handleSubmit} className="p-5">
          <label htmlFor="displayName" className="block text-sm font-medium">
            쇼핑몰 이름
          </label>
          <input
            id="displayName"
            name="displayName"
            type="text"
            required
            maxLength={100}
            placeholder="예: 자사몰, 네이버 수동, 오프라인"
            className="mt-1.5 w-full rounded-lg border px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            autoFocus
          />
          {error && <p className="mt-2 text-sm text-red-500">{error}</p>}

          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/80 disabled:opacity-70"
            >
              {isPending ? '추가 중...' : '추가'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function ExcelUploadButton({ displayName, disabled }: { displayName: string; disabled: boolean }) {
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
      formData.append('marketplaceId', displayName)

      const res = await fetch('/api/orders/import', { method: 'POST', body: formData })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error || '업로드 실패')
      } else {
        setResult({ inserted: data.inserted, skipped: data.skipped })
        if (data.inserted > 0) {
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
        title={result ? `${result.inserted}건 등록${result.skipped ? ` (${result.skipped} 중복)` : ''}` : error ?? '엑셀 업로드'}
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
            신규주문 <span className="font-medium text-foreground">{log.ordersCollected ?? 0}건</span>
            {(log.claimsCollected ?? 0) > 0 && (
              <>, 클레임 <span className="font-medium text-foreground">{log.claimsCollected}건</span></>
            )}{' '}수집
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
