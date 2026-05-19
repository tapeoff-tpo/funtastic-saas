'use client'

import { useEffect, useRef, useState, useCallback } from 'react'

type ScanStatus = 'idle' | 'ok' | 'duplicate' | 'not_found'
type QueueStatus = 'queued' | 'processing' | ScanStatus

interface ScanResult {
  status: ScanStatus
  message: string
  tts?: string
  trackingNumber?: string
  carrierName?: string
  order?: { recipientName: string; marketplaceId: string; marketplaceOrderId: string } | null
  items?: { productName: string; quantity: number }[]
  todayCount?: number
}

interface ScanQueueItem {
  id: number
  trackingNumber: string
  status: QueueStatus
  message?: string
  recipientName?: string
}

const STATUS_STYLE: Record<ScanStatus, string> = {
  idle:      'bg-gray-900',
  ok:        'bg-green-700',
  duplicate: 'bg-amber-600',
  not_found: 'bg-red-700',
}

const STATUS_LABEL: Record<ScanStatus, string> = {
  idle:      '',
  ok:        '✅ 정상',
  duplicate: '⚠️ 중복',
  not_found: '❌ 비정상',
}

function speak(text: string) {
  if (typeof window === 'undefined') return
  window.speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.lang = 'ko-KR'
  u.rate = 0.9
  window.speechSynthesis.speak(u)
}

export default function ScanPage() {
  const inputRef = useRef<HTMLInputElement>(null)
  const queueRef = useRef<ScanQueueItem[]>([])
  const processingRef = useRef(false)
  const pausedRef = useRef(false)
  const nextIdRef = useRef(1)
  const [inputValue, setInputValue] = useState('')
  const [result, setResult] = useState<ScanResult | null>(null)
  const [queue, setQueue] = useState<ScanQueueItem[]>([])
  const [processing, setProcessing] = useState(false)
  const [paused, setPaused] = useState(false)
  const [todayCount, setTodayCount] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState<{ uploaded: number; failed: number; total: number } | null>(null)

  const syncQueue = useCallback((next: ScanQueueItem[]) => {
    queueRef.current = next
    setQueue(next)
  }, [])

  // Always keep input focused
  const refocus = useCallback(() => {
    setTimeout(() => inputRef.current?.focus(), 100)
  }, [])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleUpload = useCallback(async () => {
    if (uploading) return
    setUploading(true)
    setUploadResult(null)
    try {
      const res = await fetch('/api/shipping/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const data = await res.json()
      const result = { uploaded: data.uploaded ?? 0, failed: data.failed ?? 0, total: data.total ?? 0 }
      setUploadResult(result)
      if (result.uploaded > 0 || result.failed > 0) {
        speak(`${result.uploaded}건 전송 완료. ${result.failed > 0 ? `${result.failed}건 실패.` : ''}`)
      } else {
        speak('전송할 건이 없습니다')
      }
      // Auto-dismiss after 10 seconds
      setTimeout(() => setUploadResult(null), 10000)
    } catch {
      speak('전송 중 오류가 발생했습니다')
      setUploadResult(null)
    } finally {
      setUploading(false)
      refocus()
    }
  }, [uploading, refocus])

  const processNext = useCallback(async () => {
    if (processingRef.current || pausedRef.current) return

    const next = queueRef.current.find((item) => item.status === 'queued')
    if (!next) return

    processingRef.current = true
    setProcessing(true)
    syncQueue(queueRef.current.map((item) => (
      item.id === next.id ? { ...item, status: 'processing' } : item
    )))

    try {
      const res = await fetch('/api/shipping/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackingNumber: next.trackingNumber, includeTodayCount: false }),
      })
      const data: ScanResult = await res.json()
      data.trackingNumber = next.trackingNumber

      setResult(data)
      speak(data.tts ?? data.message)

      if (data.status === 'ok') {
        setTodayCount((count) => data.todayCount ?? count + 1)
      }

      const completed: ScanQueueItem = {
        ...next,
        status: data.status,
        message: data.message,
        recipientName: data.order?.recipientName,
      }
      const withoutCurrent = queueRef.current.filter((item) => item.id !== next.id)
      const ordered = data.status === 'not_found'
        ? [completed, ...withoutCurrent]
        : [completed, ...withoutCurrent].slice(0, 80)
      syncQueue(ordered)

      if (data.status === 'not_found') {
        pausedRef.current = true
        setPaused(true)
      }
    } catch {
      const errorResult = {
        status: 'not_found',
        message: '네트워크 오류',
        tts: '비정상입니다',
        trackingNumber: next.trackingNumber,
      } as ScanResult
      setResult(errorResult)
      speak('비정상입니다')
      syncQueue([
        { ...next, status: 'not_found', message: '네트워크 오류' },
        ...queueRef.current.filter((item) => item.id !== next.id),
      ])
      pausedRef.current = true
      setPaused(true)
    } finally {
      processingRef.current = false
      setProcessing(false)
      refocus()
      setTimeout(() => processNext(), 0)
    }
  }, [refocus, syncQueue])

  const enqueueScan = useCallback((trackingNumber: string) => {
    const normalized = trackingNumber.trim()
    if (!normalized || pausedRef.current) return

    const nextItem: ScanQueueItem = {
      id: nextIdRef.current,
      trackingNumber: normalized,
      status: 'queued',
    }
    nextIdRef.current += 1
    syncQueue([...queueRef.current, nextItem])
    setInputValue('')
    setTimeout(() => processNext(), 0)
  }, [processNext, syncQueue])

  const handleContinue = useCallback(() => {
    pausedRef.current = false
    setPaused(false)
    refocus()
    setTimeout(() => processNext(), 0)
  }, [processNext, refocus])

  const handleClearCompleted = useCallback(() => {
    const active = queueRef.current.filter((item) => item.status === 'queued' || item.status === 'processing' || item.status === 'not_found')
    syncQueue(active)
    refocus()
  }, [refocus, syncQueue])

  useEffect(() => {
    if (!processing && !paused) {
      processNext()
    }
  }, [processing, paused, processNext])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      enqueueScan(inputValue)
    }
  }

  const pendingCount = queue.filter((item) => item.status === 'queued').length
  const abnormalCount = queue.filter((item) => item.status === 'not_found').length
  const completedCount = queue.filter((item) => item.status === 'ok').length

  return (
    <div
      className={`flex min-h-[calc(100vh-8rem)] flex-col rounded-xl transition-colors duration-300 ${
        result ? STATUS_STYLE[result.status] : 'bg-gray-900'
      }`}
      onClick={refocus}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-8 pt-6">
        <h1 className="text-2xl font-bold text-white">포장검수 SCAN</h1>
        <div className="flex items-center gap-4">
          <div className="flex flex-col items-end gap-1">
            <button
              onClick={handleUpload}
              disabled={uploading || processing || paused}
              className="rounded-lg bg-white/20 px-4 py-2 text-sm font-medium text-white hover:bg-white/30 disabled:opacity-50 transition-colors"
            >
              {uploading ? '전송 중...' : '오늘 출고분 전송'}
            </button>
            {uploadResult && (
              <div className={`text-xs font-medium ${uploadResult.failed > 0 ? 'text-amber-300' : 'text-green-300'}`}>
                {uploadResult.uploaded}건 전송 / {uploadResult.failed}건 실패
              </div>
            )}
          </div>
          <div className="text-right">
            <div className="text-sm text-white/60">오늘 처리</div>
            <div className="text-4xl font-bold tabular-nums text-white">{todayCount}<span className="ml-1 text-lg font-normal">건</span></div>
          </div>
        </div>
      </div>

      {paused && (
        <div className="mx-8 mt-5 rounded-lg border-2 border-red-300 bg-red-600 px-6 py-4 text-white shadow-lg">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-2xl font-bold">비정상 송장 발견</div>
              <div className="mt-1 font-mono text-xl">{result?.trackingNumber}</div>
              <div className="mt-1 text-sm text-white/80">확인 후 계속 버튼을 눌러야 다음 스캔 처리가 이어집니다.</div>
            </div>
            <button
              type="button"
              onClick={handleContinue}
              className="shrink-0 rounded-lg bg-white px-5 py-3 text-base font-bold text-red-700 hover:bg-red-50"
            >
              확인 후 계속
            </button>
          </div>
        </div>
      )}

      {/* Scan input */}
      <div className="flex flex-col items-center justify-center flex-1 gap-6 px-8 py-8">
        <div className="w-full max-w-xl">
          <label className="mb-2 block text-center text-sm font-medium text-white/70">
            운송장번호 SCAN
          </label>
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={paused}
            placeholder={paused ? '비정상 송장 확인 후 계속 버튼을 눌러주세요' : '바코드를 스캔하거나 직접 입력 후 Enter'}
            className="w-full rounded-xl border-2 border-white/30 bg-white/10 px-6 py-5 text-center text-2xl font-mono tracking-widest text-white placeholder:text-white/30 focus:border-white focus:outline-none disabled:opacity-50"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <div className="mt-3 grid grid-cols-4 gap-2 text-center text-sm text-white">
            <div className="rounded bg-white/10 px-2 py-2">대기 <strong>{pendingCount}</strong></div>
            <div className="rounded bg-white/10 px-2 py-2">처리중 <strong>{processing ? 1 : 0}</strong></div>
            <div className="rounded bg-green-600/40 px-2 py-2">정상 <strong>{completedCount}</strong></div>
            <div className="rounded bg-red-600/60 px-2 py-2">비정상 <strong>{abnormalCount}</strong></div>
          </div>
        </div>

        {/* Result display */}
        {result && (
          <div className="w-full max-w-xl rounded-xl bg-white/10 p-6 text-white">
            <div className="mb-3 text-center text-4xl font-bold">
              {STATUS_LABEL[result.status]}
            </div>
            <div className="text-center text-2xl font-mono tracking-wider">
              {result.trackingNumber}
            </div>

            {result.status === 'ok' && result.order && (
              <div className="mt-4 space-y-1 text-center text-lg">
                <div className="font-semibold">{result.order.recipientName}</div>
                {result.items?.map((item, i) => (
                  <div key={i} className="text-white/80">
                    {item.productName} × {item.quantity}
                  </div>
                ))}
                <div className="mt-2 text-sm text-white/50">
                  {result.carrierName} · {result.order.marketplaceId} · {result.order.marketplaceOrderId}
                </div>
              </div>
            )}

            {result.status === 'duplicate' && (
              <div className="mt-3 text-center text-lg text-white/80">
                오늘 이미 출고 처리된 운송장입니다
              </div>
            )}

            {result.status === 'not_found' && (
              <div className="mt-3 text-center text-lg text-white/80">
                시스템에 등록되지 않은 운송장번호입니다
              </div>
            )}
          </div>
        )}

        {processing && (
          <div className="text-white/70 text-lg animate-pulse">처리 중...</div>
        )}
      </div>

      {/* History */}
      {queue.length > 0 && (
        <div className="px-8 pb-6">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm text-white/50">최근 스캔</div>
            <button
              type="button"
              onClick={handleClearCompleted}
              className="rounded bg-white/10 px-3 py-1 text-xs font-medium text-white hover:bg-white/20"
            >
              완료목록 정리
            </button>
          </div>
          <div className="grid max-h-48 grid-cols-1 gap-2 overflow-y-auto md:grid-cols-2 xl:grid-cols-3">
            {queue.slice(0, 30).map((h) => (
              <div
                key={h.id}
                className={`rounded-lg px-3 py-2 text-sm text-white ${
                  h.status === 'ok' ? 'bg-green-600/50' :
                  h.status === 'duplicate' ? 'bg-amber-600/50' :
                  h.status === 'not_found' ? 'border border-red-200 bg-red-600 text-lg font-bold' :
                  h.status === 'processing' ? 'bg-blue-600/50' : 'bg-white/10'
                }`}
              >
                <span className="font-mono">{h.trackingNumber}</span>
                <span className="ml-2">
                  {h.status === 'queued' ? '대기' :
                   h.status === 'processing' ? '처리중' :
                   h.status === 'ok' ? '정상' :
                   h.status === 'duplicate' ? '중복' : '비정상'}
                </span>
                {h.recipientName && <span className="ml-2 text-white/80">{h.recipientName}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
