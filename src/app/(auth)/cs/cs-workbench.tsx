'use client'

import { useMemo, useState, useTransition, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Barcode,
  Camera,
  CheckCircle2,
  Clipboard,
  ExternalLink,
  FileImage,
  MessageSquareReply,
  PackageCheck,
  PackageSearch,
  Search,
  Send,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { CsTicketStats, CsTicketSource, CsWorkstream } from '@/lib/cs/queries'

export interface SerializableCsTicket {
  id: string
  source: CsTicketSource
  workstream: CsWorkstream
  title: string
  description: string | null
  status: string
  statusLabel: string
  type: string
  typeLabel: string
  marketplaceId: string
  marketplaceName: string
  marketplaceReferenceId: string
  orderId: string | null
  internalNo: string | null
  marketplaceOrderId: string | null
  buyerName: string | null
  recipientName: string | null
  productName: string | null
  requestedAt: string
  updatedAt: string
  needsLogistics: boolean
  needsMarketplaceReply: boolean
}

interface CsWorkbenchProps {
  tickets: SerializableCsTicket[]
  stats: CsTicketStats
  total: number
  marketplaces: Array<{ value: string; label: string }>
  page: number
  pageSize: number
  filters: {
    source: string
    workstream: string
    marketplace: string
    status: string
    search: string
  }
}

interface CompressedAttachment {
  name: string
  type: string
  dataUrl: string
  size: number
}

interface BarcodeLookupOrder {
  orderId: string
  internalNo: string
  marketplaceId: string
  marketplaceName: string
  marketplaceOrderId: string
  status: string
  buyerName: string
  recipientName: string
  recipientPhone: string | null
  trackingNumber: string
  carrierName: string
  shippedAt: string | null
  deliveryMessage: string | null
  items: Array<{
    id: string
    productName: string
    optionText: string | null
    quantity: number
    sku: string | null
    lockedProductName: string | null
    lockedOptionName: string | null
    lockedQuantity: number | null
  }>
}

const SOURCE_OPTIONS = [
  { value: 'all', label: '전체' },
  { value: 'claim', label: '검수 요청' },
  { value: 'inquiry', label: '문의' },
]

const WORKSTREAM_OPTIONS = [
  { value: 'all', label: '전체' },
  { value: 'cs', label: 'CS 처리' },
  { value: 'logistics', label: '물류 확인' },
  { value: 'marketplace', label: '마켓 회신' },
]

const STATUS_OPTIONS = [
  { value: '', label: '전체 상태' },
  { value: 'requested', label: '신규/미답변' },
  { value: 'processing', label: '처리중' },
  { value: 'completed', label: '완료' },
  { value: 'rejected', label: '반려' },
]

const INSPECTION_OPTIONS = [
  '정상 입고',
  '파손',
  '오배송',
  '구성품 누락',
  '사용 흔적',
  '기타',
]

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function elapsedLabel(value: string) {
  const diff = Date.now() - new Date(value).getTime()
  const hours = Math.max(Math.floor(diff / 1000 / 60 / 60), 0)
  if (hours < 1) return '1시간 이내'
  if (hours < 24) return `${hours}시간`
  return `${Math.floor(hours / 24)}일`
}

function statusClass(status: string) {
  if (status === 'completed') return 'bg-emerald-50 text-emerald-700 ring-emerald-200'
  if (status === 'processing') return 'bg-blue-50 text-blue-700 ring-blue-200'
  if (status === 'rejected') return 'bg-red-50 text-red-700 ring-red-200'
  return 'bg-amber-50 text-amber-700 ring-amber-200'
}

function buildReplyDraft(ticket: SerializableCsTicket, inspection: string, note: string) {
  const lines = [
    `[${ticket.marketplaceName}] ${ticket.typeLabel} 건 확인드립니다.`,
    ticket.marketplaceOrderId ? `주문번호: ${ticket.marketplaceOrderId}` : null,
    ticket.productName ? `상품: ${ticket.productName}` : null,
    inspection ? `물류 검수 결과: ${inspection}` : null,
    note.trim() ? `검수 메모: ${note.trim()}` : null,
    '첨부 사진 확인 후 처리 부탁드립니다.',
  ].filter(Boolean)
  return lines.join('\n')
}

async function compressImage(file: File): Promise<CompressedAttachment> {
  const bitmap = await createImageBitmap(file)
  const maxSide = 1200
  const ratio = Math.min(maxSide / bitmap.width, maxSide / bitmap.height, 1)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(Math.round(bitmap.width * ratio), 1)
  canvas.height = Math.max(Math.round(bitmap.height * ratio), 1)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('이미지 압축을 준비하지 못했습니다.')
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => {
      if (!result) reject(new Error('이미지 압축에 실패했습니다.'))
      else resolve(result)
    }, 'image/jpeg', 0.72)
  })

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('이미지를 읽지 못했습니다.'))
    reader.readAsDataURL(blob)
  })

  return {
    name: file.name.replace(/\.[^.]+$/, '.jpg'),
    type: 'image/jpeg',
    dataUrl,
    size: blob.size,
  }
}

function StatTile({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: string
}) {
  return (
    <div className="border-r border-gray-200 px-4 py-3 last:border-r-0">
      <div className="text-[11px] font-medium text-gray-500">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${tone}`}>{value.toLocaleString('ko-KR')}</div>
    </div>
  )
}

export function CsWorkbench({
  tickets,
  stats,
  total,
  marketplaces,
  page,
  pageSize,
  filters,
}: CsWorkbenchProps) {
  const router = useRouter()
  const [selected, setSelected] = useState<SerializableCsTicket | null>(tickets[0] ?? null)
  const [inspection, setInspection] = useState(INSPECTION_OPTIONS[0])
  const [note, setNote] = useState('')
  const [attachments, setAttachments] = useState<CompressedAttachment[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [trackingNumber, setTrackingNumber] = useState('')
  const [barcodeOrder, setBarcodeOrder] = useState<BarcodeLookupOrder | null>(null)
  const [barcodeMessage, setBarcodeMessage] = useState<string | null>(null)
  const [barcodeSearching, setBarcodeSearching] = useState(false)
  const [isPending, startTransition] = useTransition()

  const totalPages = Math.max(Math.ceil(total / pageSize), 1)
  const activeTicketIds = useMemo(() => new Set(tickets.map((ticket) => ticket.id)), [tickets])
  const activeSelected = selected && activeTicketIds.has(selected.id) ? selected : tickets[0] ?? null
  const replyDraft = activeSelected ? buildReplyDraft(activeSelected, inspection, note) : ''

  const filterHref = (key: string, value: string) => {
    const sp = new URLSearchParams()
    Object.entries(filters).forEach(([filterKey, filterValue]) => {
      if (filterKey !== key && filterValue) sp.set(filterKey, filterValue)
    })
    if (value) sp.set(key, value)
    const qs = sp.toString()
    return `/cs${qs ? `?${qs}` : ''}`
  }

  const pageHref = (nextPage: number) => {
    const sp = new URLSearchParams()
    Object.entries(filters).forEach(([filterKey, filterValue]) => {
      if (filterValue) sp.set(filterKey, filterValue)
    })
    sp.set('page', String(nextPage))
    return `/cs?${sp.toString()}`
  }

  async function handleFiles(files: FileList | null) {
    if (!files) return
    setMessage('사진을 압축하는 중입니다.')
    try {
      const next = await Promise.all(Array.from(files).slice(0, 5).map(compressImage))
      const valid = next.filter((item) => item.size <= 1024 * 1024)
      setAttachments(valid)
      setMessage(valid.length === next.length ? '사진 압축이 완료되었습니다.' : '1MB 이하로 압축된 사진만 추가했습니다.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '사진 처리에 실패했습니다.')
    }
  }

  function saveInspection() {
    if (!activeSelected?.orderId) {
      setMessage('주문과 연결된 CS 건만 물류 검수 메모를 저장할 수 있습니다.')
      return
    }

    startTransition(async () => {
      setMessage(null)
      const res = await fetch(`/api/orders/${activeSelected.orderId}/memos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          memoType: 'return_inspection',
          content: replyDraft,
          attachments,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        setMessage(body?.error ?? '검수 메모 저장에 실패했습니다.')
        return
      }
      setMessage('물류 검수 내용이 CS 메모에 저장되었습니다.')
      router.refresh()
    })
  }

  async function copyReplyDraft() {
    await navigator.clipboard.writeText(replyDraft)
    setMessage('마켓 회신 문구를 복사했습니다.')
  }

  async function searchBarcode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = trackingNumber.trim()
    if (!value) {
      setBarcodeMessage('송장 바코드를 스캔하거나 입력해주세요.')
      setBarcodeOrder(null)
      return
    }

    setBarcodeSearching(true)
    setBarcodeMessage(null)
    setBarcodeOrder(null)
    try {
      const res = await fetch(`/api/cs/barcode?trackingNumber=${encodeURIComponent(value)}`)
      const data = await res.json().catch(() => null) as {
        found?: boolean
        error?: string
        order?: BarcodeLookupOrder
      } | null
      if (!res.ok) {
        setBarcodeMessage(data?.error ?? '송장 조회에 실패했습니다.')
        return
      }
      if (!data?.found || !data.order) {
        setBarcodeMessage('해당 송장으로 출고된 주문을 찾지 못했습니다.')
        return
      }
      setBarcodeOrder(data.order)
      setBarcodeMessage('출고 주문을 찾았습니다.')
    } catch {
      setBarcodeMessage('송장 조회 중 네트워크 오류가 발생했습니다.')
    } finally {
      setBarcodeSearching(false)
    }
  }

  return (
    <div className="flex h-[calc(100vh-5.5rem)] min-h-[680px] flex-col overflow-hidden">
      <div className="shrink-0 border-b bg-white px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-gray-950">상품검수 / CS 작업함</h1>
            <p className="mt-1 text-sm text-gray-500">
              물류팀이 반품 상품을 확인하고, CS가 검수 결과를 바탕으로 최종 안내와 마켓 처리를 진행합니다.
            </p>
          </div>
          <div className="overflow-hidden rounded border bg-white">
            <div className="grid grid-cols-5">
              <StatTile label="전체" value={stats.total} tone="text-gray-950" />
              <StatTile label="미처리" value={stats.open} tone="text-amber-700" />
              <StatTile label="물류 확인" value={stats.logistics} tone="text-blue-700" />
              <StatTile label="마켓 회신" value={stats.marketplaceReply} tone="text-red-700" />
              <StatTile label="완료" value={stats.completed} tone="text-emerald-700" />
            </div>
          </div>
        </div>

        <form action="/cs" className="mt-4 grid gap-2 lg:grid-cols-[180px_180px_180px_180px_1fr_auto]">
          <select name="source" defaultValue={filters.source} className="h-8 rounded border px-2 text-sm">
            {SOURCE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <select name="workstream" defaultValue={filters.workstream} className="h-8 rounded border px-2 text-sm">
            {WORKSTREAM_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <select name="marketplace" defaultValue={filters.marketplace} className="h-8 rounded border px-2 text-sm">
            <option value="">전체 몰</option>
            {marketplaces.map((marketplace) => (
              <option key={marketplace.value} value={marketplace.value}>{marketplace.label}</option>
            ))}
          </select>
          <select name="status" defaultValue={filters.status} className="h-8 rounded border px-2 text-sm">
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-2 h-4 w-4 text-gray-400" />
            <Input name="search" defaultValue={filters.search} placeholder="주문번호, 고객명, 상품명, 내용 검색" className="pl-8" />
          </div>
          <Button type="submit" size="sm">검색</Button>
        </form>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {WORKSTREAM_OPTIONS.map((option) => (
            <Link
              key={option.value}
              href={filterHref('workstream', option.value === 'all' ? '' : option.value)}
              className={`rounded px-2.5 py-1 text-xs font-medium ring-1 ${
                (filters.workstream || 'all') === option.value
                  ? 'bg-gray-900 text-white ring-gray-900'
                  : 'bg-white text-gray-600 ring-gray-200 hover:bg-gray-50'
              }`}
            >
              {option.label}
            </Link>
          ))}
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(360px,0.9fr)_1fr]">
          <section className="rounded-md border bg-gray-50 px-3 py-3">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-950">
              <Barcode className="h-4 w-4" />
              반품 송장 바코드 조회
            </div>
            <form onSubmit={searchBarcode} className="flex gap-2">
              <Input
                value={trackingNumber}
                onChange={(event) => setTrackingNumber(event.target.value)}
                placeholder="기존 출고 송장번호 스캔"
                className="bg-white"
                autoComplete="off"
              />
              <Button type="submit" size="sm" disabled={barcodeSearching}>
                {barcodeSearching ? '조회 중' : '조회'}
              </Button>
            </form>
            {barcodeMessage && <p className="mt-2 text-xs text-gray-600">{barcodeMessage}</p>}
          </section>

          <section className="rounded-md border bg-white px-3 py-3">
            {barcodeOrder ? (
              <div className="grid gap-3 text-sm lg:grid-cols-[1fr_1.4fr]">
                <div>
                  <div className="flex items-center gap-2 font-semibold text-gray-950">
                    <PackageSearch className="h-4 w-4" />
                    {barcodeOrder.marketplaceName}
                  </div>
                  <dl className="mt-2 grid grid-cols-[72px_1fr] gap-y-1 text-xs">
                    <dt className="text-gray-500">주문번호</dt>
                    <dd className="font-mono text-gray-900">{barcodeOrder.marketplaceOrderId}</dd>
                    <dt className="text-gray-500">관리번호</dt>
                    <dd className="text-gray-900">#{barcodeOrder.internalNo}</dd>
                    <dt className="text-gray-500">수령자</dt>
                    <dd className="text-gray-900">{barcodeOrder.recipientName} {barcodeOrder.recipientPhone ?? ''}</dd>
                    <dt className="text-gray-500">송장</dt>
                    <dd className="text-gray-900">{barcodeOrder.carrierName} {barcodeOrder.trackingNumber}</dd>
                  </dl>
                  <Button variant="outline" size="sm" className="mt-2" render={<Link href={`/orders/${barcodeOrder.orderId}`} />}>
                    <ExternalLink className="h-3.5 w-3.5" />
                    주문 상세
                  </Button>
                </div>
                <div className="min-w-0">
                  <div className="mb-1 text-xs font-semibold text-gray-500">출고 상품</div>
                  <div className="max-h-28 space-y-1 overflow-auto">
                    {barcodeOrder.items.map((item) => (
                      <div key={item.id} className="rounded border bg-gray-50 px-2 py-1.5 text-xs">
                        <div className="truncate font-medium text-gray-900">{item.lockedProductName ?? item.productName}</div>
                        <div className="mt-0.5 text-gray-500">
                          {item.lockedOptionName ?? item.optionText ?? '옵션 없음'} · {item.lockedQuantity ?? item.quantity}개
                          {item.sku ? ` · ${item.sku}` : ''}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex h-full min-h-24 items-center text-sm text-gray-500">
                반품 상품이 들어오면 기존 출고 송장 바코드를 스캔해 주문과 상품 구성을 바로 확인할 수 있습니다.
              </div>
            )}
          </section>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(760px,1fr)_420px] bg-gray-50">
        <div className="min-w-0 overflow-auto">
          <table className="min-w-full table-fixed border-b bg-white text-left text-sm">
            <thead className="sticky top-0 z-10 border-b bg-gray-50 text-xs font-medium text-gray-500">
              <tr>
                <th className="w-24 px-3 py-2">상태</th>
                <th className="w-24 px-3 py-2">유형</th>
                <th className="w-28 px-3 py-2">쇼핑몰</th>
                <th className="w-24 px-3 py-2">접수</th>
                <th className="w-40 px-3 py-2">주문번호</th>
                <th className="px-3 py-2">내용</th>
                <th className="w-28 px-3 py-2">작업</th>
              </tr>
            </thead>
            <tbody className="divide-y bg-white">
              {tickets.map((ticket) => (
                <tr
                  key={`${ticket.source}-${ticket.id}`}
                  onClick={() => setSelected(ticket)}
                  className={`cursor-pointer hover:bg-gray-50 ${
                    activeSelected?.id === ticket.id && activeSelected.source === ticket.source ? 'bg-blue-50/70' : ''
                  }`}
                >
                  <td className="px-3 py-3 align-top">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${statusClass(ticket.status)}`}>
                      {ticket.statusLabel}
                    </span>
                  </td>
                  <td className="px-3 py-3 align-top text-gray-700">{ticket.typeLabel}</td>
                  <td className="px-3 py-3 align-top">
                    <div className="truncate font-medium text-gray-900">{ticket.marketplaceName}</div>
                    <div className="truncate text-xs text-gray-400">{ticket.marketplaceId}</div>
                  </td>
                  <td className="px-3 py-3 align-top">
                    <div className="text-gray-900">{formatDateTime(ticket.requestedAt)}</div>
                    <div className="text-xs text-gray-500">{elapsedLabel(ticket.requestedAt)}</div>
                  </td>
                  <td className="px-3 py-3 align-top">
                    <div className="truncate font-mono text-xs text-gray-900">{ticket.marketplaceOrderId ?? '-'}</div>
                    <div className="text-xs text-gray-400">{ticket.internalNo ? `#${ticket.internalNo}` : ticket.marketplaceReferenceId}</div>
                  </td>
                  <td className="px-3 py-3 align-top">
                    <div className="truncate font-medium text-gray-950">{ticket.productName ?? ticket.title}</div>
                    <div className="mt-1 line-clamp-2 text-xs text-gray-500">{ticket.description ?? '내용 없음'}</div>
                  </td>
                  <td className="px-3 py-3 align-top">
                    <div className="flex flex-col gap-1">
                      {ticket.needsLogistics && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-700">
                          <PackageCheck className="h-3 w-3" />
                          물류 확인
                        </span>
                      )}
                      {ticket.needsMarketplaceReply && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700">
                          <MessageSquareReply className="h-3 w-3" />
                          회신 필요
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {tickets.length === 0 && (
                <tr>
                  <td colSpan={7} className="h-52 text-center text-sm text-gray-500">
                    조건에 맞는 CS 건이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <div className="flex items-center justify-between border-t bg-white px-4 py-3 text-sm text-gray-600">
            <span>
              {total === 0 ? 0 : (page - 1) * pageSize + 1}-{Math.min(page * pageSize, total)} / {total.toLocaleString('ko-KR')}
            </span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} render={<Link href={pageHref(page - 1)} />}>이전</Button>
              <span className="w-16 text-center text-xs">{page} / {totalPages}</span>
              <Button variant="outline" size="sm" disabled={page >= totalPages} render={<Link href={pageHref(page + 1)} />}>다음</Button>
            </div>
          </div>
        </div>

        <aside className="flex min-h-0 flex-col border-l bg-white">
          {activeSelected ? (
            <>
              <div className="border-b px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="font-semibold text-gray-950">{activeSelected.title}</h2>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${statusClass(activeSelected.status)}`}>
                        {activeSelected.statusLabel}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-gray-500">
                      {activeSelected.marketplaceName} · {formatDateTime(activeSelected.requestedAt)}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelected(null)}
                    className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                    aria-label="상세 닫기"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="min-h-0 flex-1 space-y-4 overflow-auto px-4 py-4">
                <section className="space-y-2">
                  <div className="text-xs font-semibold text-gray-500">주문 정보</div>
                  <dl className="grid grid-cols-[90px_1fr] gap-y-1 text-sm">
                    <dt className="text-gray-500">주문번호</dt>
                    <dd className="font-mono text-xs text-gray-900">{activeSelected.marketplaceOrderId ?? '-'}</dd>
                    <dt className="text-gray-500">상품</dt>
                    <dd className="text-gray-900">{activeSelected.productName ?? '-'}</dd>
                    <dt className="text-gray-500">고객</dt>
                    <dd className="text-gray-900">{activeSelected.buyerName ?? activeSelected.recipientName ?? '-'}</dd>
                    <dt className="text-gray-500">내용</dt>
                    <dd className="whitespace-pre-wrap text-gray-900">{activeSelected.description ?? '-'}</dd>
                  </dl>
                  {activeSelected.orderId && (
                    <Button variant="outline" size="sm" render={<Link href={`/orders/${activeSelected.orderId}`} />}>
                      <ExternalLink className="h-3.5 w-3.5" />
                      주문 상세
                    </Button>
                  )}
                </section>

                <section className="rounded border bg-gray-50 p-3">
                  <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-950">
                    <PackageCheck className="h-4 w-4" />
                    물류 검수
                  </div>
                  <label className="text-xs font-medium text-gray-600">검수 결과</label>
                  <select value={inspection} onChange={(e) => setInspection(e.target.value)} className="mt-1 h-8 w-full rounded border bg-white px-2 text-sm">
                    {INSPECTION_OPTIONS.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>

                  <label className="mt-3 block text-xs font-medium text-gray-600">검수 메모</label>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={4}
                    placeholder="파손 위치, 구성품 누락, 재판매 가능 여부 등을 남겨주세요."
                    className="mt-1 w-full resize-none rounded border bg-white px-2 py-2 text-sm outline-none focus:border-gray-400"
                  />

                  <div className="mt-3">
                    <label className="flex h-24 cursor-pointer flex-col items-center justify-center rounded border border-dashed bg-white text-sm text-gray-500 hover:bg-gray-50">
                      <Camera className="mb-1 h-5 w-5" />
                      문제 사진 추가
                      <span className="text-[11px] text-gray-400">최대 5장, 업로드 전 1MB 이하 압축</span>
                      <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => handleFiles(e.target.files)} />
                    </label>
                    {attachments.length > 0 && (
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        {attachments.map((attachment) => (
                          <div key={attachment.name} className="flex items-center gap-2 rounded border bg-white px-2 py-1 text-xs">
                            <FileImage className="h-3.5 w-3.5 text-gray-500" />
                            <span className="min-w-0 flex-1 truncate">{attachment.name}</span>
                            <span className="text-gray-400">{Math.ceil(attachment.size / 1024)}KB</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <p className="mt-2 text-[11px] text-gray-500">
                      저장된 검수 첨부는 30일 보관 대상으로 표시됩니다.
                    </p>
                  </div>
                </section>

                <section className="space-y-2">
                  <div className="flex items-center gap-2 text-sm font-semibold text-gray-950">
                    <Send className="h-4 w-4" />
                    마켓 회신 준비
                  </div>
                  <textarea
                    value={replyDraft}
                    readOnly
                    rows={7}
                    className="w-full resize-none rounded border bg-gray-50 px-2 py-2 text-sm text-gray-700"
                  />
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={copyReplyDraft}>
                      <Clipboard className="h-3.5 w-3.5" />
                      문구 복사
                    </Button>
                    <Button type="button" size="sm" onClick={saveInspection} disabled={isPending}>
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      검수 저장
                    </Button>
                  </div>
                  {message && <p className="text-xs text-gray-600">{message}</p>}
                </section>
              </div>
            </>
          ) : (
            <div className="flex h-full items-center justify-center px-8 text-center text-sm text-gray-500">
              왼쪽 목록에서 CS 건을 선택하면 주문, 물류 검수, 마켓 회신 준비가 표시됩니다.
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
