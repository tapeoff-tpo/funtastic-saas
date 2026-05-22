'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import {
  Camera,
  CheckCircle2,
  ImagePlus,
  Keyboard,
  Loader2,
  PackageCheck,
  RefreshCcw,
  ScanLine,
  Search,
  X,
} from 'lucide-react'

type ClaimType = 'cancel' | 'return' | 'exchange'
type ClaimStatus = 'requested' | 'processing' | 'completed' | 'rejected' | 'withdrawn'

interface OrderItem {
  id: string
  productName: string
  optionText: string | null
  quantity: number
  sku: string | null
}

interface InspectionOrder {
  id: string
  internalNo: string
  marketplaceId: string
  marketplaceOrderId: string
  status: string
  buyerName: string
  recipientName: string
  recipientPhone: string | null
  recipientPhone2: string | null
  orderedAt: string
  collectedAt: string | null
  logisticsMessage: string | null
  deliveryMessage: string | null
  items: OrderItem[]
  claims: Array<{
    id: string
    claimType: ClaimType
    claimStatus: ClaimStatus
    reason: string | null
    requestedAt: string
  }>
  shipments: Array<{
    id: string
    trackingNumber: string
    carrierName: string
    uploadStatus: string
  }>
}

interface CompressedAttachment {
  name: string
  type: string
  dataUrl: string
  size: number
}

const MAX_VIDEO_BYTES = 20 * 1024 * 1024

const INSPECTION_RESULTS = [
  '정상 입고',
  '파손',
  '오배송',
  '구성품 누락',
  '사용 흔적',
  '기타',
]

const CLAIM_TYPE_LABELS: Record<ClaimType, string> = {
  cancel: '취소',
  return: '반품',
  exchange: '교환',
}

const CLAIM_STATUS_LABELS: Record<ClaimStatus, string> = {
  requested: '신규',
  processing: '처리중',
  completed: '완료',
  rejected: '반려',
  withdrawn: '철회',
}

function formatDateTime(value: string | null) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function buildInspectionMemo(order: InspectionOrder, result: string, note: string) {
  const claim = order.claims[0]
  return [
    '[모바일 물류 검수]',
    `검수결과: ${result}`,
    `마켓: ${order.marketplaceId}`,
    `주문번호: ${order.marketplaceOrderId}`,
    claim ? `CS유형: ${CLAIM_TYPE_LABELS[claim.claimType]} / ${CLAIM_STATUS_LABELS[claim.claimStatus]}` : null,
    order.items[0] ? `대표상품: ${order.items[0].productName}` : null,
    note.trim() ? `메모: ${note.trim()}` : null,
    result === '정상 입고' ? 'CS팀 확인 후 정상 처리 가능' : 'CS팀 확인 및 마켓 회신 필요',
  ]
    .filter(Boolean)
    .join('\n')
}

async function compressImage(file: File): Promise<CompressedAttachment> {
  const bitmap = await createImageBitmap(file)
  const maxSide = 1280
  const ratio = Math.min(maxSide / bitmap.width, maxSide / bitmap.height, 1)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(Math.round(bitmap.width * ratio), 1)
  canvas.height = Math.max(Math.round(bitmap.height * ratio), 1)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('사진 압축을 시작하지 못했습니다.')
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) resolve(result)
      else reject(new Error('사진 압축에 실패했습니다.'))
    }, 'image/jpeg', 0.72)
  })

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('사진을 읽지 못했습니다.'))
    reader.readAsDataURL(blob)
  })

  return {
    name: file.name.replace(/\.[^.]+$/, '.jpg') || `inspection-${Date.now()}.jpg`,
    type: 'image/jpeg',
    dataUrl,
    size: blob.size,
  }
}

async function readVideo(file: File): Promise<CompressedAttachment> {
  if (file.size > MAX_VIDEO_BYTES) {
    throw new Error('동영상은 20MB 이하만 첨부할 수 있습니다.')
  }

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('동영상을 읽지 못했습니다.'))
    reader.readAsDataURL(file)
  })

  return {
    name: file.name || `inspection-${Date.now()}.mp4`,
    type: file.type || 'video/mp4',
    dataUrl,
    size: file.size,
  }
}

async function prepareAttachment(file: File): Promise<CompressedAttachment> {
  if (file.type.startsWith('image/')) return compressImage(file)
  if (file.type.startsWith('video/')) return readVideo(file)
  throw new Error('사진 또는 동영상 파일만 첨부할 수 있습니다.')
}

export function MobileInspectionClient() {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const scanningRef = useRef(false)
  const [query, setQuery] = useState('')
  const [order, setOrder] = useState<InspectionOrder | null>(null)
  const [result, setResult] = useState(INSPECTION_RESULTS[0])
  const [note, setNote] = useState('')
  const [attachments, setAttachments] = useState<CompressedAttachment[]>([])
  const [cameraOpen, setCameraOpen] = useState(false)
  const [cameraMessage, setCameraMessage] = useState('')
  const [message, setMessage] = useState('')
  const [isPending, startTransition] = useTransition()

  const memo = useMemo(
    () => (order ? buildInspectionMemo(order, result, note) : ''),
    [order, result, note],
  )

  function stopCamera() {
    scanningRef.current = false
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setCameraOpen(false)
  }

  useEffect(() => {
    return () => stopCamera()
  }, [])

  async function lookup(nextQuery = query) {
    const q = nextQuery.trim()
    if (!q) {
      setMessage('송장번호나 주문번호를 입력하세요.')
      return
    }

    setMessage('')
    startTransition(async () => {
      const res = await fetch(`/api/mobile/inspection/lookup?q=${encodeURIComponent(q)}`)
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setOrder(null)
        setMessage(body?.error ?? '주문 조회에 실패했습니다.')
        return
      }
      setOrder(body.order)
      setResult(INSPECTION_RESULTS[0])
      setNote('')
      setAttachments([])
      setMessage('주문을 찾았습니다.')
    })
  }

  async function startCameraScan() {
    setCameraMessage('')
    if (!('BarcodeDetector' in window)) {
      setCameraMessage('이 기기는 브라우저 바코드 스캔을 지원하지 않습니다. 번호 입력이나 사진 촬영은 사용할 수 있습니다.')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      })
      streamRef.current = stream
      setCameraOpen(true)
      const video = videoRef.current
      if (!video) return
      video.srcObject = stream
      await video.play()

      const detector = new (window as unknown as {
        BarcodeDetector: new (options: { formats: string[] }) => {
          detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue: string }>>
        }
      }).BarcodeDetector({
        formats: ['code_128', 'code_39', 'ean_13', 'ean_8', 'qr_code', 'itf'],
      })

      scanningRef.current = true
      const tick = async () => {
        if (!scanningRef.current || !videoRef.current) return
        try {
          const codes = await detector.detect(videoRef.current)
          const value = codes[0]?.rawValue?.trim()
          if (value) {
            setQuery(value)
            stopCamera()
            if ('vibrate' in navigator) navigator.vibrate(80)
            await lookup(value)
            return
          }
        } catch {
          setCameraMessage('스캔 중 오류가 발생했습니다. 번호 입력으로 진행해 주세요.')
        }
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    } catch {
      setCameraMessage('카메라 권한을 허용해야 바코드 스캔을 사용할 수 있습니다.')
      stopCamera()
    }
  }

  async function handleFiles(files: FileList | null) {
    if (!files) return
    setMessage('사진을 압축하는 중입니다.')
    try {
      const next = await Promise.all(Array.from(files).slice(0, 5).map(prepareAttachment))
      const valid = next.filter((item) => (
        item.type.startsWith('video/')
          ? item.size <= MAX_VIDEO_BYTES
          : item.size <= 1024 * 1024
      ))
      setAttachments(valid)
      setMessage(valid.length === next.length ? '첨부 파일이 추가되었습니다.' : '용량 기준에 맞는 첨부만 추가했습니다.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '첨부 파일 처리에 실패했습니다.')
    }
  }

  function saveInspection() {
    if (!order) return
    startTransition(async () => {
      setMessage('')
      const res = await fetch(`/api/orders/${order.id}/memos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          memoType: 'mobile_return_inspection',
          content: memo,
          attachments,
        }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setMessage(body?.error ?? '검수 저장에 실패했습니다.')
        return
      }
      setMessage('검수 내용이 저장되었습니다.')
      if ('vibrate' in navigator) navigator.vibrate([60, 40, 60])
    })
  }

  return (
    <main className="min-h-dvh bg-gray-950 text-white">
      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col bg-gray-100 text-gray-950">
        <header className="sticky top-0 z-20 border-b border-gray-800 bg-gray-950 px-4 py-3 text-white">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg font-semibold">상품검수</h1>
              <p className="text-xs text-gray-400">스캔, 사진/동영상, CS 메모 저장</p>
            </div>
            <PackageCheck className="h-6 w-6 text-blue-300" />
          </div>
        </header>

        <section className="space-y-3 p-4">
          <div className="rounded-xl border bg-white p-3 shadow-sm">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <ScanLine className="h-4 w-4" />
              바코드 또는 주문번호
            </div>
            <div className="flex gap-2">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void lookup()
                }}
                inputMode="text"
                placeholder="송장번호, 주문번호, 내부번호"
                className="h-12 min-w-0 flex-1 rounded-lg border px-3 text-base outline-none focus:border-blue-500"
              />
              <button
                type="button"
                onClick={() => void lookup()}
                disabled={isPending}
                className="flex h-12 w-12 items-center justify-center rounded-lg bg-gray-950 text-white disabled:opacity-50"
                aria-label="조회"
              >
                {isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Search className="h-5 w-5" />}
              </button>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => void startCameraScan()}
                className="flex h-11 items-center justify-center gap-2 rounded-lg bg-blue-600 text-sm font-semibold text-white"
              >
                <Camera className="h-4 w-4" />
                스캔
              </button>
              <button
                type="button"
                onClick={() => setQuery('')}
                className="flex h-11 items-center justify-center gap-2 rounded-lg border bg-white text-sm font-semibold"
              >
                <Keyboard className="h-4 w-4" />
                직접입력
              </button>
            </div>
            {cameraMessage && <p className="mt-2 text-xs text-amber-700">{cameraMessage}</p>}
          </div>

          {cameraOpen && (
            <div className="overflow-hidden rounded-xl border bg-black">
              <div className="flex items-center justify-between px-3 py-2 text-white">
                <span className="text-sm font-medium">바코드를 화면 안에 맞춰주세요</span>
                <button type="button" onClick={stopCamera} className="rounded-full bg-white/10 p-1">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <video ref={videoRef} playsInline muted className="aspect-[3/4] w-full object-cover" />
            </div>
          )}

          {order && (
            <>
              <section className="rounded-xl border bg-white p-3 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-gray-500">{order.marketplaceId}</div>
                    <div className="truncate font-mono text-sm font-semibold">{order.marketplaceOrderId}</div>
                    <div className="mt-1 text-xs text-gray-500">#{order.internalNo} · {formatDateTime(order.orderedAt)}</div>
                  </div>
                  <span className="rounded-full bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">{order.status}</span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-lg bg-gray-50 p-2">
                    <div className="text-xs text-gray-500">구매자</div>
                    <div className="font-medium">{order.buyerName}</div>
                  </div>
                  <div className="rounded-lg bg-gray-50 p-2">
                    <div className="text-xs text-gray-500">수취인</div>
                    <div className="font-medium">{order.recipientName}</div>
                  </div>
                </div>
                {order.shipments.length > 0 && (
                  <div className="mt-3 rounded-lg bg-gray-50 p-2 text-xs">
                    <div className="font-semibold text-gray-600">송장</div>
                    {order.shipments.map((shipment) => (
                      <div key={shipment.id} className="mt-1 flex justify-between gap-2">
                        <span>{shipment.carrierName}</span>
                        <span className="font-mono">{shipment.trackingNumber}</span>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="rounded-xl border bg-white p-3 shadow-sm">
                <div className="mb-2 text-sm font-semibold">상품</div>
                <div className="space-y-2">
                  {order.items.map((item) => (
                    <div key={item.id} className="rounded-lg border p-2">
                      <div className="text-sm font-medium">{item.productName}</div>
                      {item.optionText && <div className="mt-1 text-xs text-gray-500">{item.optionText}</div>}
                      <div className="mt-1 flex justify-between text-xs text-gray-500">
                        <span>{item.sku ?? '-'}</span>
                        <span>수량 {item.quantity}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {order.claims.length > 0 && (
                <section className="rounded-xl border bg-white p-3 shadow-sm">
                  <div className="mb-2 text-sm font-semibold">CS 내역</div>
                  <div className="space-y-2">
                    {order.claims.map((claim) => (
                      <div key={claim.id} className="rounded-lg bg-amber-50 p-2 text-sm text-amber-900">
                        <div className="font-semibold">
                          {CLAIM_TYPE_LABELS[claim.claimType]} · {CLAIM_STATUS_LABELS[claim.claimStatus]}
                        </div>
                        {claim.reason && <div className="mt-1 text-xs">{claim.reason}</div>}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <section className="rounded-xl border bg-white p-3 shadow-sm">
                <div className="mb-3 text-sm font-semibold">검수 결과</div>
                <div className="grid grid-cols-2 gap-2">
                  {INSPECTION_RESULTS.map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setResult(option)}
                      className={`h-12 rounded-lg border text-sm font-semibold ${
                        result === option ? 'border-gray-950 bg-gray-950 text-white' : 'bg-white text-gray-700'
                      }`}
                    >
                      {option}
                    </button>
                  ))}
                </div>
                <textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  rows={3}
                  placeholder="문제 위치, 구성품 누락, 재판매 가능 여부 등"
                  className="mt-3 w-full resize-none rounded-lg border px-3 py-2 text-sm outline-none focus:border-blue-500"
                />
              </section>

              <section className="rounded-xl border bg-white p-3 shadow-sm">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-sm font-semibold">사진/동영상</div>
                  <div className="text-xs text-gray-500">{attachments.length}/5</div>
                </div>
                <label className="flex h-24 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed bg-gray-50 text-sm text-gray-600">
                  <ImagePlus className="mb-1 h-6 w-6" />
                  촬영/등록
                  <span className="text-xs text-gray-400">사진 1MB, 동영상 20MB 이하 · 30일 보관</span>
                  <input
                    type="file"
                    accept="image/*,video/*"
                    capture="environment"
                    multiple
                    className="hidden"
                    onChange={(event) => void handleFiles(event.target.files)}
                  />
                </label>
                {attachments.length > 0 && (
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {attachments.map((attachment) => (
                      <div key={attachment.name} className="overflow-hidden rounded-lg border bg-gray-50">
                        {attachment.type.startsWith('video/') ? (
                          <div className="flex aspect-square w-full items-center justify-center bg-gray-900 px-2 text-center text-[11px] font-semibold text-white">
                            동영상
                          </div>
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={attachment.dataUrl} alt="" className="aspect-square w-full object-cover" />
                        )}
                        <div className="truncate px-1 py-1 text-[10px] text-gray-500">{Math.ceil(attachment.size / 1024)}KB</div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </section>

        <div className="sticky bottom-0 mt-auto border-t bg-white p-3">
          {message && <p className="mb-2 rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-700">{message}</p>}
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <button
              type="button"
              onClick={saveInspection}
              disabled={!order || isPending}
              className="flex h-12 items-center justify-center gap-2 rounded-xl bg-gray-950 text-sm font-semibold text-white disabled:opacity-40"
            >
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              검수 저장
            </button>
            <button
              type="button"
              onClick={() => {
                setOrder(null)
                setQuery('')
                setNote('')
                setAttachments([])
                setMessage('')
              }}
              className="flex h-12 w-12 items-center justify-center rounded-xl border bg-white"
              aria-label="초기화"
            >
              <RefreshCcw className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>
    </main>
  )
}
