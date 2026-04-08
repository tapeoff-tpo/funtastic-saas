'use client'

import { useState, useRef, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useCollectPoll, type JobLogResult } from '@/lib/hooks/use-collect-poll'
import { StatusBadge } from './status-badge'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import type { ConnectionStatus } from '@/lib/marketplace/types'
import { addManualChannel } from '@/app/(auth)/dashboard/actions'

interface Connection {
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

export function MarketplaceDashboard({ connections }: MarketplaceDashboardProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [showAddModal, setShowAddModal] = useState(false)
  const { collecting, logs, startCollect, cancelCollect, clearResults } = useCollectPoll()

  const connectedMarkets = connections.filter((c) => c.status !== 'disconnected' && !c.isManual)

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleCollectSelected = () => {
    const ids = [...selected].filter((id) =>
      connectedMarkets.some((c) => c.marketplaceId === id)
    )
    if (ids.length === 0) return
    startCollect(ids)
  }

  const handleCollectAll = () => {
    if (connectedMarkets.length === 0) return
    startCollect(connectedMarkets.map((c) => c.marketplaceId))
  }

  const nameMap = Object.fromEntries(
    connections.map((c) => [c.marketplaceId, c.displayName])
  )

  const enrichedLogs = logs?.map((l) => ({
    ...l,
    displayName: l.marketplaceId ? (nameMap[l.marketplaceId] ?? l.marketplaceId) : '오류',
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

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">마켓플레이스 연동 현황</h1>
          <p className="mt-1 text-muted-foreground">
            마켓을 클릭하여 선택 후 수집하거나, 전체 수집을 실행하세요.
          </p>
        </div>
        <div className="flex items-center gap-3">
        {selected.size > 0 && (
          <>
            <span className="rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-primary">
              {selected.size}개 선택
            </span>
            <button
              onClick={handleCollectSelected}
              disabled={collecting}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/80 disabled:opacity-70"
            >
              {collecting ? (
                <span className="flex items-center gap-2">
                  <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                  수집 중...
                </span>
              ) : (
                '선택 수집'
              )}
            </button>
            <button
              onClick={() => setSelected(new Set())}
              className="rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted"
            >
              선택 해제
            </button>
          </>
        )}
        {selected.size === 0 && connectedMarkets.length > 0 && (
          <button
            onClick={handleCollectAll}
            disabled={collecting}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/80 disabled:opacity-70"
          >
            {collecting ? (
              <span className="flex items-center gap-2">
                <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                수집 중...
              </span>
            ) : (
              `전체 수집 (${connectedMarkets.length}개)`
            )}
          </button>
        )}
        <button
          onClick={() => setShowAddModal(true)}
          className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted"
        >
          + 수동 쇼핑몰 추가
        </button>
        </div>
      </div>

      {/* Cards grid */}
      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {connections.map((conn) => {
          const isDisconnected = conn.status === 'disconnected'
          const isSelected = selected.has(conn.marketplaceId)
          const isManual = conn.isManual

          return (
            <Card
              key={conn.marketplaceId}
              className={`transition-all ${
                isManual
                  ? 'border-blue-200'
                  : isSelected
                    ? 'cursor-pointer ring-2 ring-primary ring-offset-2'
                    : isDisconnected
                      ? 'cursor-pointer opacity-60'
                      : 'cursor-pointer hover:shadow-md'
              }`}
              onClick={() => {
                if (!isDisconnected && !isManual) toggleSelect(conn.marketplaceId)
              }}
            >
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <div className="flex items-center gap-2">
                  {!isDisconnected && !isManual && (
                    <div
                      className={`flex h-5 w-5 items-center justify-center rounded border ${
                        isSelected
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-gray-300'
                      }`}
                    >
                      {isSelected && (
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </div>
                  )}
                  <CardTitle className="text-sm font-medium">{conn.displayName}</CardTitle>
                </div>
                <div className="flex items-center gap-1.5">
                  {isManual && (
                    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                      수동
                    </span>
                  )}
                  <StatusBadge status={conn.status as ConnectionStatus} />
                </div>
              </CardHeader>
              <CardContent>
                {!isManual && (
                  <div className="space-y-1 text-sm text-muted-foreground">
                    <p>
                      마지막 확인:{' '}
                      {conn.lastCheckedAt ? formatRelativeTime(conn.lastCheckedAt) : '확인 안됨'}
                    </p>
                    {conn.status === 'error' && conn.lastErrorMessage && (
                      <p className="text-red-600">
                        {conn.lastErrorMessage.length > 100
                          ? `${conn.lastErrorMessage.slice(0, 100)}...`
                          : conn.lastErrorMessage}
                      </p>
                    )}
                    {conn.expiresAt && isExpiringSoon(conn.expiresAt) && (
                      <p className="text-amber-600">
                        인증 만료 예정: {conn.expiresAt.toLocaleDateString('ko-KR')}
                      </p>
                    )}
                  </div>
                )}

                {isManual && (
                  <p className="text-sm text-muted-foreground">
                    엑셀 업로드로 주문을 관리합니다.
                  </p>
                )}

                {/* Excel upload -- inline, stops click propagation */}
                <div onClick={(e) => e.stopPropagation()} className="mt-3">
                  <ExcelUploadButton
                    displayName={conn.displayName}
                    disabled={isDisconnected}
                  />
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

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
  const [dragOver, setDragOver] = useState(false)
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

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
    if (disabled || uploading) return
    const file = e.dataTransfer.files[0]
    if (file?.name.endsWith('.xlsx')) handleFile(file)
    else setError('.xlsx 파일만 가능합니다')
  }

  return (
    <div className="space-y-1">
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
      <div
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); if (!disabled && !uploading) setDragOver(true) }}
        onDragLeave={(e) => { e.stopPropagation(); setDragOver(false) }}
        onDrop={handleDrop}
        onClick={() => !disabled && !uploading && inputRef.current?.click()}
        className={`flex cursor-pointer items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
          disabled
            ? 'cursor-not-allowed border-gray-200 text-gray-400'
            : dragOver
              ? 'border-primary bg-primary/5 text-primary'
              : uploading
                ? 'border-gray-200 text-gray-400'
                : 'hover:bg-muted'
        }`}
      >
        {uploading ? (
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" x2="12" y1="3" y2="15"/>
          </svg>
        )}
        {uploading ? '업로드 중...' : dragOver ? '여기에 놓기' : '엑셀 업로드'}
      </div>
      {result && (
        <p className="text-xs text-emerald-600">
          {result.inserted}건 등록{result.skipped > 0 ? ` (${result.skipped}건 중복 스킵)` : ''} → 신규주문으로 이동 중
        </p>
      )}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  )
}

function ResultRow({ log }: { log: JobLogResult & { displayName: string } }) {
  const isCompleted = log.status === 'completed'
  const isFailed = log.status === 'failed'
  const isCancelled = log.status === 'cancelled'
  const isPending = !isCompleted && !isFailed && !isCancelled

  return (
    <div className="flex items-start gap-3 py-3">
      <span className="mt-0.5 text-base">
        {isCompleted && '✅'}
        {isFailed && '❌'}
        {isCancelled && '⏹'}
        {isPending && (
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
        {isPending && <p className="text-sm text-muted-foreground">대기 중...</p>}
      </div>
    </div>
  )
}
