/**
 * Combined shipping review page (합포장).
 *
 * Displays shipment groups with confirm/reject actions.
 * Admin can detect new merge candidates and manage groups.
 */

import { getShipmentGroups, confirmShipmentGroup, rejectShipmentGroup } from '@/lib/shipping/combined-queries'
import type { ShipmentGroupWithCount } from '@/lib/shipping/combined-queries'
import type { Metadata } from 'next'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { CombinedShippingClient } from './client'

export const metadata: Metadata = {
  title: '합포장 관리',
}

/** Fulfillment code badge colors */
const FULFILLMENT_STYLES: Record<string, string> = {
  normal: 'bg-blue-100 text-blue-700',
  frozen: 'bg-cyan-100 text-cyan-700',
  large: 'bg-amber-100 text-amber-700',
  mixed: 'bg-gray-100 text-gray-700',
}

/** Fulfillment code Korean labels */
const FULFILLMENT_LABELS: Record<string, string> = {
  normal: '일반',
  frozen: '냉동',
  large: '대형',
  mixed: '혼합',
}

/** Status badge styles */
const STATUS_STYLES: Record<string, string> = {
  suggested: 'bg-yellow-100 text-yellow-700',
  confirmed: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  shipped: 'bg-blue-100 text-blue-700',
}

const STATUS_LABELS: Record<string, string> = {
  suggested: '제안됨',
  confirmed: '확인됨',
  rejected: '거절됨',
  shipped: '배송됨',
}

export default async function CombinedShippingPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const groups = await getShipmentGroups(user.id)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">합포장 관리</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            동일 구매자/배송지 주문을 합포장으로 묶어 처리합니다
          </p>
        </div>
        <CombinedShippingClient />
      </div>

      {groups.length === 0 ? (
        <div className="rounded-md border p-8 text-center text-muted-foreground">
          합포장 대상이 없습니다
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {groups.map((group) => (
            <ShipmentGroupCard key={group.id} group={group} />
          ))}
        </div>
      )}
    </div>
  )
}

async function ShipmentGroupCard({ group }: { group: ShipmentGroupWithCount }) {
  // Parse group key for display: buyerName|zip|addr1|addr2|date|fulfillmentCode
  const keyParts = group.groupKey.split('|')
  const buyerName = keyParts[0] ?? '-'
  const date = keyParts[4] ?? ''
  const fulfillmentCode = group.fulfillmentCode

  async function handleConfirm() {
    'use server'
    await confirmShipmentGroup(group.id)
    revalidatePath('/shipping/combined')
  }

  async function handleReject() {
    'use server'
    await rejectShipmentGroup(group.id)
    revalidatePath('/shipping/combined')
  }

  return (
    <div className="rounded-lg border bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${FULFILLMENT_STYLES[fulfillmentCode] ?? FULFILLMENT_STYLES.normal}`}>
            {FULFILLMENT_LABELS[fulfillmentCode] ?? fulfillmentCode}
          </span>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[group.status] ?? STATUS_STYLES.suggested}`}>
            {STATUS_LABELS[group.status] ?? group.status}
          </span>
        </div>
        <span className="text-xs text-muted-foreground">{date}</span>
      </div>

      <div className="mb-2">
        <p className="font-medium">{buyerName}</p>
        <p className="text-sm text-muted-foreground">
          {group.orderCount}건 주문
        </p>
      </div>

      {group.status === 'suggested' && (
        <div className="mt-3 flex gap-2">
          <form action={handleConfirm}>
            <button
              type="submit"
              className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700"
            >
              확인
            </button>
          </form>
          <form action={handleReject}>
            <button
              type="submit"
              className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
            >
              거절
            </button>
          </form>
        </div>
      )}

      {group.status === 'confirmed' && (
        <div className="mt-3">
          <a
            href={`/orders?groupId=${group.id}`}
            className="inline-block rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            송장등록
          </a>
        </div>
      )}
    </div>
  )
}
