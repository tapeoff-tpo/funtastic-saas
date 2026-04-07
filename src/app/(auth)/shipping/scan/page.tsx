'use client'

import { useEffect, useRef, useState, useCallback } from 'react'

type ScanStatus = 'idle' | 'ok' | 'duplicate' | 'not_found'

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
  const [inputValue, setInputValue] = useState('')
  const [result, setResult] = useState<ScanResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [todayCount, setTodayCount] = useState(0)
  const [history, setHistory] = useState<{ trackingNumber: string; status: ScanStatus; recipientName?: string }[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState<{ uploaded: number; failed: number; total: number } | null>(null)

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

  const handleScan = useCallback(async (trackingNumber: string) => {
    if (!trackingNumber.trim() || loading) return
    setLoading(true)

    try {
      const res = await fetch('/api/shipping/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackingNumber: trackingNumber.trim() }),
      })
      const data: ScanResult = await res.json()
      data.trackingNumber = trackingNumber.trim()

      setResult(data)
      speak(data.tts ?? data.message)

      if (data.status === 'ok') {
        setTodayCount(data.todayCount ?? 0)
      }

      setHistory((prev) => [
        { trackingNumber: trackingNumber.trim(), status: data.status, recipientName: data.order?.recipientName },
        ...prev.slice(0, 29),
      ])
    } catch {
      setResult({ status: 'not_found', message: '네트워크 오류', tts: '비정상입니다' } as ScanResult)
      speak('비정상입니다')
    } finally {
      setLoading(false)
      setInputValue('')
      refocus()
    }
  }, [loading, refocus])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleScan(inputValue)
    }
  }

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
              disabled={uploading || loading}
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
            disabled={loading}
            placeholder="바코드를 스캔하거나 직접 입력 후 Enter"
            className="w-full rounded-xl border-2 border-white/30 bg-white/10 px-6 py-5 text-center text-2xl font-mono tracking-widest text-white placeholder:text-white/30 focus:border-white focus:outline-none disabled:opacity-50"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
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

        {loading && (
          <div className="text-white/70 text-lg animate-pulse">처리 중...</div>
        )}
      </div>

      {/* History */}
      {history.length > 0 && (
        <div className="px-8 pb-6">
          <div className="text-sm text-white/50 mb-2">최근 스캔</div>
          <div className="flex flex-wrap gap-2">
            {history.slice(0, 10).map((h, i) => (
              <span
                key={i}
                className={`rounded-full px-3 py-1 text-xs font-mono text-white ${
                  h.status === 'ok' ? 'bg-green-600/50' :
                  h.status === 'duplicate' ? 'bg-amber-600/50' : 'bg-red-600/50'
                }`}
              >
                {h.trackingNumber.slice(-6)} {h.recipientName ? `· ${h.recipientName}` : ''}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
