'use client'

import { useState, useTransition } from 'react'
import {
  VALID_TRANSITIONS,
  ORDER_STATUS_LABELS,
  type OrderStatus,
} from '@/lib/orders/types'
import {
  changeStatusAction,
  bulkChangeStatusAction,
  forceBulkChangeStatusAction,
  forceBulkHoldOrdersAction,
  bulkUploadInvoiceAction,
  unlockOrderSnapshotsAction,
} from './actions'
import { toast } from 'sonner'
import { CARRIERS } from '@/lib/shipping/carrier-codes'
import type { OrderRow } from './columns'

interface StatusDropdownProps {
  orderId: string
  currentStatus: OrderStatus
  isHeld: boolean
}

/**
 * Dropdown to change a single order's status.
 * Shows only valid transitions. Disabled when order is held (D-11).
 */
export function StatusDropdown({ orderId, currentStatus, isHeld }: StatusDropdownProps) {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  const validNext = VALID_TRANSITIONS[currentStatus] ?? []

  if (validNext.length === 0 && !isHeld) return null

  const handleChange = (newStatus: OrderStatus) => {
    setOpen(false)
    startTransition(async () => {
      const result = await changeStatusAction(orderId, newStatus)
      if (result.success) {
        toast.success(`상태가 ${ORDER_STATUS_LABELS[newStatus]}(으)로 변경되었습니다`)
      } else {
        toast.error(result.error ?? '상태 변경에 실패했습니다')
      }
    })
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={isHeld || isPending}
        className="rounded border px-2 py-1 text-xs hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
        title={isHeld ? '보류 중인 주문은 상태를 변경할 수 없습니다' : '상태 변경'}
      >
        {isPending ? '처리중...' : '상태 변경'}
      </button>
      {open && validNext.length > 0 && (
        <div className="absolute right-0 top-full z-20 mt-1 min-w-[120px] rounded-md border bg-white py-1 shadow-lg">
          {validNext.map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => handleChange(status)}
              className="block w-full px-3 py-1.5 text-left text-sm hover:bg-muted"
            >
              {ORDER_STATUS_LABELS[status]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

interface BulkActionBarProps {
  selectedIds: string[]
  onClear: () => void
}

interface ManualStatusChangeButtonProps {
  selectedIds: string[]
  selectedOrders: OrderRow[]
  canUnlockOrderSnapshots?: boolean
  onChanged?: () => void
}

interface ManualInvoiceButtonProps {
  selectedOrders: OrderRow[]
  onChanged?: () => void
}

const ALL_ORDER_STATUSES = Object.keys(ORDER_STATUS_LABELS) as OrderStatus[]

const MANUAL_SPECIAL_STATUSES = [
  { value: 'exchange', label: '교환' },
  { value: 'return', label: '반품' },
  { value: 'held', label: '미발송' },
] as const

const CLAIM_REASON_OPTIONS = [
  { value: 'change_of_mind', label: '변심' },
  { value: 'wrong_delivery', label: '오배송' },
  { value: 'defective', label: '불량' },
  { value: 'other', label: '기타사유' },
] as const

type ClaimReasonCode = (typeof CLAIM_REASON_OPTIONS)[number]['value']

const CARRIER_LABELS: Record<string, string> = {
  CJGLS: 'CJ대한통운',
  HANJIN: '한진택배',
  HYUNDAI: '롯데택배',
  EPOST: '우체국택배',
  KGB: '로젠택배',
  KDEXP: '경동택배',
  CHUNIL: '천일택배',
  DAESIN: '대신택배',
  ILYANG: '일양로지스',
  CVSNET: '편의점택배',
  REGISTPOST: '등기우편',
  HDEXP: '합동택배',
  HONAM: '호남택배',
  ETC: '기타택배',
}

export function ManualInvoiceButton({ selectedOrders, onChanged }: ManualInvoiceButtonProps) {
  const [open, setOpen] = useState(false)
  const [carrierId, setCarrierId] = useState(CARRIERS[0]?.code ?? 'CJGLS')
  const [trackingByOrderId, setTrackingByOrderId] = useState<Record<string, string>>({})
  const [isPending, startTransition] = useTransition()
  const selectedCount = selectedOrders.length

  const handleOpen = () => {
    if (selectedCount === 0) {
      toast.info('송장을 등록할 주문을 선택하세요.')
      return
    }

    setTrackingByOrderId((prev) => {
      const next: Record<string, string> = {}
      for (const order of selectedOrders) {
        next[order.id] = prev[order.id] ?? order.trackingNumber ?? ''
      }
      return next
    })
    setOpen(true)
  }

  const handleSubmit = () => {
    const payload = selectedOrders
      .map((order) => ({
        orderId: order.id,
        trackingNumber: (trackingByOrderId[order.id] ?? '').trim(),
        carrierId,
      }))
      .filter((entry) => entry.trackingNumber)

    if (payload.length === 0) {
      toast.error('송장번호를 입력하세요.')
      return
    }

    if (payload.length !== selectedOrders.length) {
      const ok = window.confirm(
        `${selectedOrders.length}건 중 ${payload.length}건만 송장번호가 입력됐습니다. 입력된 주문만 등록할까요?`,
      )
      if (!ok) return
    }

    startTransition(async () => {
      const result = await bulkUploadInvoiceAction(payload)
      if (result.errors.length === 0 && result.queued === payload.length) {
        toast.success(`${result.queued}건 송장등록 요청 완료`)
        setOpen(false)
        setTrackingByOrderId({})
        onChanged?.()
      } else {
        toast.warning(`${result.queued}건 성공, ${payload.length - result.queued}건 미등록`)
        for (const failure of result.errors.slice(0, 5)) {
          toast.error(failure.error, { duration: 7000 })
        }
      }
    })
  }

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        disabled={selectedCount === 0 || isPending}
        className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? '등록 중...' : `송장 수기등록${selectedCount > 0 ? ` (${selectedCount})` : ''}`}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
          <div className="w-full max-w-2xl rounded-lg border bg-white shadow-xl">
            <div className="flex items-center justify-between border-b px-5 py-3">
              <h2 className="text-base font-semibold">송장 수기등록</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded px-2 py-1 text-sm text-muted-foreground hover:bg-muted"
              >
                닫기
              </button>
            </div>

            <div className="space-y-4 p-5">
              <label className="block text-sm">
                <span className="mb-1 block font-medium">택배사</span>
                <select
                  value={carrierId}
                  onChange={(event) => setCarrierId(event.target.value)}
                  className="w-full rounded-md border px-3 py-2 text-sm"
                >
                  {CARRIERS.map((carrier) => (
                    <option key={carrier.code} value={carrier.code}>
                      {CARRIER_LABELS[carrier.code] ?? carrier.englishName ?? carrier.code}
                    </option>
                  ))}
                </select>
              </label>

              <div className="max-h-[55vh] overflow-y-auto rounded-md border">
                <div className="grid grid-cols-[1.2fr_1fr_1.4fr] gap-2 border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
                  <span>마켓</span>
                  <span>주문번호</span>
                  <span>송장번호</span>
                </div>
                {selectedOrders.map((order) => (
                  <div
                    key={order.id}
                    className="grid grid-cols-[1.2fr_1fr_1.4fr] items-center gap-2 border-b px-3 py-2 last:border-b-0"
                  >
                    <span className="truncate text-sm" title={order.marketplaceName ?? order.marketplaceId}>
                      {order.marketplaceName ?? order.marketplaceId}
                    </span>
                    <span className="truncate font-mono text-xs" title={order.marketplaceOrderId}>
                      {order.marketplaceOrderId}
                    </span>
                    <input
                      value={trackingByOrderId[order.id] ?? ''}
                      onChange={(event) =>
                        setTrackingByOrderId((prev) => ({
                          ...prev,
                          [order.id]: event.target.value,
                        }))
                      }
                      placeholder="송장번호 입력"
                      className="w-full rounded-md border px-2 py-1.5 text-sm"
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t px-5 py-3">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md border px-4 py-2 text-sm hover:bg-muted"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={isPending}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {isPending ? '등록 중...' : '송장 등록'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export function ManualStatusChangeButton({
  selectedIds,
  selectedOrders,
  canUnlockOrderSnapshots = false,
  onChanged,
}: ManualStatusChangeButtonProps) {
  const [open, setOpen] = useState(false)
  const [claimModalType, setClaimModalType] = useState<'return' | 'exchange' | null>(null)
  const [claimReasonCode, setClaimReasonCode] = useState<ClaimReasonCode>('change_of_mind')
  const [claimReasonDetail, setClaimReasonDetail] = useState('')
  const [claimQuantities, setClaimQuantities] = useState<Record<string, number>>({})
  const [isPending, startTransition] = useTransition()
  const selectedCount = selectedIds.length

  function openClaimModal(claimType: 'return' | 'exchange') {
    if (selectedOrders.length === 0) {
      toast.info('상태를 변경할 주문을 선택하세요.')
      return
    }
    setOpen(false)
    setClaimModalType(claimType)
    setClaimReasonCode('change_of_mind')
    setClaimReasonDetail('')
    setClaimQuantities(Object.fromEntries(
      selectedOrders.flatMap((order) => order.items.map((item) => [item.id, item.quantity])),
    ))
  }

  const handleChange = (newStatus: OrderStatus) => {
    if (selectedCount === 0) {
      toast.info('상태를 변경할 주문을 선택하세요.')
      return
    }

    setOpen(false)
    if (
      !window.confirm(
        `선택한 ${selectedCount}건의 주문상태를 '${ORDER_STATUS_LABELS[newStatus]}'(으)로 변경하시겠습니까?`,
      )
    ) {
      return
    }

    startTransition(async () => {
      const result = await forceBulkChangeStatusAction(selectedIds, newStatus)
      if (result.errors.length === 0) {
        toast.success(`${result.updated}건의 주문상태가 변경되었습니다.`)
      } else {
        toast.warning(`${result.updated}건 변경, ${result.errors.length}건 실패`)
        for (const failure of result.errors.slice(0, 3)) {
          toast.error(failure.error, { duration: 7000 })
        }
      }
      onChanged?.()
    })
  }

  const handleSpecialChange = (specialStatus: (typeof MANUAL_SPECIAL_STATUSES)[number]['value']) => {
    if (selectedCount === 0) {
      toast.info('상태를 변경할 주문을 선택하세요.')
      return
    }

    if (specialStatus === 'return' || specialStatus === 'exchange') {
      openClaimModal(specialStatus)
      return
    }

    const label = MANUAL_SPECIAL_STATUSES.find((status) => status.value === specialStatus)?.label ?? specialStatus
    setOpen(false)
    if (
      !window.confirm(
        `선택한 ${selectedCount}건의 주문상태를 '${label}'(으)로 변경하시겠습니까?`,
      )
    ) {
      return
    }

    startTransition(async () => {
      const result = await forceBulkHoldOrdersAction(selectedIds)

      if (result.errors.length === 0) {
        toast.success(`${result.updated}건의 주문상태가 ${label}(으)로 변경되었습니다.`)
      } else {
        toast.warning(`${result.updated}건 변경, ${result.errors.length}건 실패`)
        for (const failure of result.errors.slice(0, 3)) {
          toast.error(failure.error, { duration: 7000 })
        }
      }
      onChanged?.()
    })
  }

  const submitClaimStatusChange = () => {
    if (!claimModalType) return
    const label = claimModalType === 'return' ? '반품' : '교환'
    const payloadByOrder = selectedOrders.map((order) => ({
      order,
      quantities: order.items
        .map((item) => ({
          orderItemId: item.id,
          quantity: Number(claimQuantities[item.id] ?? 0),
        }))
        .filter((item) => item.quantity > 0),
    })).filter((entry) => entry.quantities.length > 0)

    if (payloadByOrder.length === 0) {
      toast.error('접수 수량을 1개 이상 입력해주세요.')
      return
    }

    startTransition(async () => {
      let success = 0
      const errors: string[] = []

      for (const entry of payloadByOrder) {
        try {
          const res = await fetch('/api/orders/claims', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              orderId: entry.order.id,
              claimType: claimModalType,
              reasonCode: claimReasonCode,
              reasonDetail: claimReasonDetail,
              quantities: entry.quantities,
            }),
          })
          if (!res.ok) {
            const data = await res.json().catch(() => ({})) as { error?: string }
            errors.push(`${entry.order.marketplaceOrderId}: ${data.error ?? `${label} 접수 실패`}`)
            continue
          }
          success++
        } catch (error) {
          errors.push(`${entry.order.marketplaceOrderId}: ${error instanceof Error ? error.message : `${label} 접수 실패`}`)
        }
      }

      if (errors.length === 0) {
        toast.success(`${success}건 ${label} 접수 완료`)
        setClaimModalType(null)
      } else {
        toast.warning(`${success}건 접수, ${errors.length}건 실패`)
        for (const error of errors.slice(0, 3)) {
          toast.error(error, { duration: 8000 })
        }
      }
      onChanged?.()
    })
  }

  const handleUnlockSnapshots = () => {
    if (selectedCount === 0) {
      toast.info('잠금 해제할 주문을 선택하세요.')
      return
    }
    setOpen(false)
    if (
      !window.confirm(
        `선택한 ${selectedCount}건의 출고 스냅샷 잠금을 해제할까요?\n\n` +
          '잠금 해제 후에는 현재 상품/재고/매핑 기준으로 다시 표시될 수 있습니다.',
      )
    ) {
      return
    }

    startTransition(async () => {
      const result = await unlockOrderSnapshotsAction(selectedIds)
      if (result.error) {
        toast.error(result.error, { duration: 7000 })
      } else {
        toast.success(`${result.unlocked}개 주문상품 잠금이 해제되었습니다.`)
      }
      onChanged?.()
    })
  }

  return (
    <>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          disabled={selectedCount === 0 || isPending}
          className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          title="선택한 주문의 상태만 변경합니다. 몰 통보와 재고 차감은 실행하지 않습니다."
        >
          {isPending ? '변경 중...' : `주문상태변경${selectedCount > 0 ? ` (${selectedCount})` : ''}`}
        </button>
        {open && (
          <div className="absolute right-0 top-full z-20 mt-1 min-w-[140px] rounded-md border bg-white py-1 shadow-lg">
            {ALL_ORDER_STATUSES.map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => handleChange(status)}
                className="block w-full px-3 py-1.5 text-left text-sm hover:bg-muted"
              >
                {ORDER_STATUS_LABELS[status]}
              </button>
            ))}
            <div className="my-1 border-t" />
            {MANUAL_SPECIAL_STATUSES.map((status) => (
              <button
                key={status.value}
                type="button"
                onClick={() => handleSpecialChange(status.value)}
                className="block w-full px-3 py-1.5 text-left text-sm hover:bg-muted"
              >
                {status.label}
              </button>
            ))}
            {canUnlockOrderSnapshots && (
              <>
                <div className="my-1 border-t" />
                <button
                  type="button"
                  onClick={handleUnlockSnapshots}
                  className="block w-full px-3 py-1.5 text-left text-sm text-red-700 hover:bg-red-50"
                >
                  출고잠금 해제
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {claimModalType && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="grid max-h-[88vh] w-full max-w-3xl grid-rows-[auto_1fr_auto] overflow-hidden rounded-lg bg-white shadow-xl">
            <div className="border-b px-5 py-3">
              <h3 className="text-base font-semibold">{claimModalType === 'return' ? '반품 접수' : '교환 접수'}</h3>
            </div>
            <div className="min-h-0 space-y-4 overflow-auto p-5">
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                {CLAIM_REASON_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setClaimReasonCode(option.value)}
                    className={`rounded border px-3 py-2 text-sm ${claimReasonCode === option.value ? 'border-blue-500 bg-blue-50 text-blue-700' : ''}`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <textarea
                value={claimReasonDetail}
                onChange={(event) => setClaimReasonDetail(event.target.value)}
                placeholder="상세 사유"
                className="h-20 w-full resize-none rounded border px-3 py-2 text-sm"
              />
              <div className="rounded border">
                {selectedOrders.map((order) => (
                  <div key={order.id} className="border-b last:border-b-0">
                    <div className="flex items-center justify-between gap-2 bg-muted/40 px-3 py-2 text-xs">
                      <span className="font-medium">{order.marketplaceName ?? order.marketplaceId}</span>
                      <span className="font-mono text-muted-foreground">{order.marketplaceOrderId}</span>
                    </div>
                    {order.items.map((item) => (
                      <div key={item.id} className="grid grid-cols-[1fr_88px] items-center gap-2 border-t px-3 py-2">
                        <div className="min-w-0">
                          <div className="truncate text-xs font-medium" title={item.displayName ?? item.productName}>
                            {item.displayName ?? item.productName}
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            주문수량 {item.quantity}개
                          </div>
                        </div>
                        <input
                          type="number"
                          min={0}
                          max={item.quantity}
                          value={claimQuantities[item.id] ?? 0}
                          onChange={(event) => {
                            const next = Math.min(item.quantity, Math.max(0, Number(event.target.value)))
                            setClaimQuantities((prev) => ({ ...prev, [item.id]: next }))
                          }}
                          className="h-8 rounded border px-2 text-right text-sm"
                        />
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t px-5 py-3">
              <button type="button" onClick={() => setClaimModalType(null)} className="rounded border px-3 py-1.5 text-sm">
                취소
              </button>
              <button
                type="button"
                onClick={submitClaimStatusChange}
                disabled={isPending}
                className="rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                {isPending ? '접수중' : '접수'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

/**
 * Floating action bar shown when rows are selected.
 * Supports bulk status change and bulk hold.
 */
export function BulkActionBar({ selectedIds, onClear }: BulkActionBarProps) {
  const [isPending, startTransition] = useTransition()
  const [confirming, setConfirming] = useState(false)
  const [showStatusMenu, setShowStatusMenu] = useState(false)

  if (selectedIds.length === 0) return null

  // Common statuses available for bulk change
  // "confirmed" is handled by 발주확인 button (includes marketplace API call)
  const bulkStatuses: OrderStatus[] = ['preparing', 'shipped', 'cancelled']

  const handleBulkStatus = (newStatus: OrderStatus) => {
    setShowStatusMenu(false)
    startTransition(async () => {
      const result = await bulkChangeStatusAction(selectedIds, newStatus)
      if (result.errors.length === 0) {
        toast.success(`${result.updated}건의 주문 상태가 변경되었습니다`)
      } else {
        toast.warning(
          `${result.updated}건 성공, ${result.errors.length}건 실패`,
        )
      }
      onClear()
    })
  }

  const handleConfirmOrders = async () => {
    setConfirming(true)
    try {
      const res = await fetch('/api/orders/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderIds: selectedIds }),
      })
      const text = await res.text()
      let data: Record<string, unknown> = {}
      try { data = JSON.parse(text) } catch { /* non-json response */ }

      if (!res.ok) {
        const errMsg = (data.error as string) || text.slice(0, 200) || `HTTP ${res.status}`
        toast.error(`발주확인 실패 [${res.status}]: ${errMsg}`, { duration: 8000 })
        return
      }

      const successCount = (data.successCount as number) ?? 0
      const failCount = (data.failCount as number) ?? 0
      const results = (data.results as Array<{ success: boolean; marketplaceOrderId: string; error?: string }>) ?? []

      if (failCount === 0) {
        toast.success(`${successCount}건 발주확인 완료`)
      } else if (successCount > 0) {
        toast.warning(`${successCount}건 성공, ${failCount}건 실패`)
        const failures = results.filter((r) => !r.success)
        for (const f of failures.slice(0, 5)) {
          toast.error(`${f.marketplaceOrderId}: ${f.error ?? '알 수 없는 오류'}`, { duration: 8000 })
        }
      } else {
        const failures = results.filter((r) => !r.success)
        if (failures.length === 0) {
          toast.error('발주확인 실패 (상세 정보 없음)', { duration: 8000 })
        } else {
          toast.error(`${failCount}건 모두 실패`)
          for (const f of failures.slice(0, 5)) {
            toast.error(`${f.marketplaceOrderId}: ${f.error ?? '알 수 없는 오류'}`, { duration: 8000 })
          }
        }
      }
      onClear()
    } catch (err) {
      toast.error(`네트워크 오류: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setConfirming(false)
    }
  }

  return (
    <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg border bg-white px-4 py-3 shadow-xl">
      <span className="text-sm font-medium">{selectedIds.length}개 주문 선택됨</span>

      {/* 발주확인 (신규 → 주문확인 + 몰 API 호출) */}
      <button
        type="button"
        onClick={handleConfirmOrders}
        disabled={confirming || isPending}
        title="신규 상태 주문을 주문확인으로 변경 + 몰에 자동 통보"
        className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
      >
        {confirming ? '처리 중...' : '발주확인 (몰 통보)'}
      </button>

      <div className="relative">
        <button
          type="button"
          onClick={() => setShowStatusMenu((v) => !v)}
          disabled={isPending || confirming}
          title="상태만 수동 변경 (몰 통보 없음)"
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {isPending ? '처리중...' : '상태 수동 변경'}
        </button>
        {showStatusMenu && (
          <div className="absolute bottom-full left-0 mb-1 min-w-[140px] rounded-md border bg-white py-1 shadow-lg">
            {bulkStatuses.map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => handleBulkStatus(status)}
                className="block w-full px-3 py-1.5 text-left text-sm hover:bg-muted"
              >
                {ORDER_STATUS_LABELS[status]}
              </button>
            ))}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onClear}
        className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
      >
        선택 해제
      </button>
    </div>
  )
}
