/**
 * Held shipments page (/shipping/held).
 *
 * Shows orders that have a tracking number assigned but have not been
 * physically shipped yet (shippedAt IS NULL). These orders are "stuck
 * in limbo" — out-of-stock, issues, or forgotten — and need dedicated
 * management so they are not lost in the main order list.
 *
 * Admin can:
 * - Reprocess: delete shipment record + reset order to 'preparing'
 * - Add/edit memo: store a note in holdReason for context
 */

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getHeldShipments } from '@/lib/shipping/queries'
import type { HeldShipmentRow } from '@/lib/shipping/queries'
import type { Metadata } from 'next'
import { HeldOrderActions } from './client'

export const metadata: Metadata = {
  title: '미발송 관리',
}

/** Upload status Korean labels */
const UPLOAD_STATUS_LABELS: Record<string, string> = {
  pending: '대기중',
  uploading: '업로드중',
  uploaded: '업로드됨',
  failed: '실패',
  confirmed: '확인됨',
}

const UPLOAD_STATUS_STYLES: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  uploading: 'bg-blue-100 text-blue-700',
  uploaded: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
  confirmed: 'bg-gray-100 text-gray-700',
}

export default async function HeldShipmentsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const heldOrders = await getHeldShipments(user.id)
  const count = heldOrders.length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">
            미발송 관리{' '}
            {count > 0 && (
              <span className="ml-2 rounded-full bg-red-100 px-3 py-0.5 text-base font-semibold text-red-700">
                {count}건
              </span>
            )}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            운송장이 등록됐으나 출고 처리되지 않은 주문입니다
          </p>
        </div>
      </div>

      {/* Empty state */}
      {count === 0 ? (
        <div className="rounded-md border p-12 text-center text-muted-foreground">
          미발송 주문이 없습니다
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="border-b bg-gray-50">
              <tr>
                <th className="whitespace-nowrap px-4 py-3 text-left font-medium text-muted-foreground">
                  마켓
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-left font-medium text-muted-foreground">
                  마켓 주문번호
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-left font-medium text-muted-foreground">
                  수령인
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  상품명
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-left font-medium text-muted-foreground">
                  운송장번호
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-left font-medium text-muted-foreground">
                  택배사
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-left font-medium text-muted-foreground">
                  상태
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  메모
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-left font-medium text-muted-foreground">
                  액션
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {heldOrders.map((row) => (
                <HeldOrderRow key={row.shipmentId} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function HeldOrderRow({ row }: { row: HeldShipmentRow }) {
  const statusLabel = UPLOAD_STATUS_LABELS[row.uploadStatus] ?? row.uploadStatus
  const statusStyle =
    UPLOAD_STATUS_STYLES[row.uploadStatus] ?? 'bg-gray-100 text-gray-700'

  return (
    <tr className="bg-white hover:bg-gray-50">
      {/* 마켓 */}
      <td className="whitespace-nowrap px-4 py-3 font-medium">
        {row.marketplaceId}
      </td>

      {/* 주문번호 */}
      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-muted-foreground">
        {row.marketplaceOrderId}
      </td>

      {/* 수령인 */}
      <td className="whitespace-nowrap px-4 py-3">{row.recipientName}</td>

      {/* 상품명 */}
      <td className="max-w-[200px] truncate px-4 py-3" title={row.productName ?? ''}>
        {row.productName ?? '-'}
        {row.quantity != null && row.quantity > 1 && (
          <span className="ml-1 text-muted-foreground">x{row.quantity}</span>
        )}
      </td>

      {/* 운송장번호 */}
      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">
        {row.trackingNumber}
      </td>

      {/* 택배사 */}
      <td className="whitespace-nowrap px-4 py-3">{row.carrierName}</td>

      {/* 상태 */}
      <td className="whitespace-nowrap px-4 py-3">
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusStyle}`}
        >
          {statusLabel}
        </span>
      </td>

      {/* 메모 + 액션 (client component for interactivity) */}
      <HeldOrderActions
        orderId={row.orderId}
        initialMemo={row.holdReason ?? ''}
      />
    </tr>
  )
}
