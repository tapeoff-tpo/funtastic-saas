/**
 * Batch shipping label print page.
 *
 * Renders labels in a print-optimized layout with CSS @media print.
 * Receives order IDs from URL params and loads shipping address details.
 */

import { db } from '@/lib/db'
import { orders, orderItems, shipments } from '@/lib/db/schema'
import { inArray } from 'drizzle-orm'
import type { Metadata } from 'next'
import { PrintButtonClient } from './print-button'

export const metadata: Metadata = {
  title: '배송 라벨 인쇄',
}

interface LabelData {
  orderId: string
  marketplaceOrderId: string
  recipientName: string
  recipientPhone: string | null
  zipCode: string
  address1: string
  address2: string
  productSummary: string
  trackingNumber: string
  carrierName: string
}

export default async function PrintPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const idsParam = typeof params.ids === 'string' ? params.ids : ''
  const orderIds = idsParam.split(',').filter(Boolean)

  if (orderIds.length === 0) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        인쇄할 주문이 없습니다. 주문 관리에서 주문을 선택하고 "라벨인쇄"를 클릭하세요.
      </div>
    )
  }

  // Fetch orders
  const orderRows = await db
    .select()
    .from(orders)
    .where(inArray(orders.id, orderIds))

  // Fetch items
  const itemRows = await db
    .select()
    .from(orderItems)
    .where(inArray(orderItems.orderId, orderIds))

  // Fetch shipments
  const shipmentRows = await db
    .select()
    .from(shipments)
    .where(inArray(shipments.orderId, orderIds))

  // Build label data
  const labels: LabelData[] = orderRows.map((order) => {
    const items = itemRows.filter((item) => item.orderId === order.id)
    const shipment = shipmentRows.find((s) => s.orderId === order.id)
    const address = order.shippingAddress as {
      zipCode: string
      address1: string
      address2?: string
    } | null

    const productNames = items.map((item) => {
      const base = item.productName
      const qty = item.quantity > 1 ? ` x${item.quantity}` : ''
      return `${base}${qty}`
    })
    const productSummary = productNames.length > 2
      ? `${productNames[0]} 외 ${productNames.length - 1}건`
      : productNames.join(', ')

    return {
      orderId: order.id,
      marketplaceOrderId: order.marketplaceOrderId,
      recipientName: order.recipientName,
      recipientPhone: order.recipientPhone,
      zipCode: address?.zipCode ?? '',
      address1: address?.address1 ?? '',
      address2: address?.address2 ?? '',
      productSummary,
      trackingNumber: shipment?.trackingNumber ?? '',
      carrierName: shipment?.carrierName ?? '',
    }
  })

  return (
    <>
      {/* Print styles */}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #print-area, #print-area * { visibility: visible; }
          #print-area { position: absolute; left: 0; top: 0; width: 100%; }
          .print-hide { display: none !important; }
          .label-card { page-break-inside: avoid; break-inside: avoid; }
        }
      `}</style>

      <div className="space-y-4">
        {/* Controls (hidden when printing) */}
        <div className="print-hide flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">배송 라벨 인쇄</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {labels.length}건의 배송 라벨
            </p>
          </div>
          <PrintButton />
        </div>

        {/* Label grid */}
        <div id="print-area" className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {labels.map((label) => (
            <div
              key={label.orderId}
              className="label-card rounded-lg border border-gray-400 p-4"
            >
              {/* Carrier + Tracking */}
              {(label.carrierName || label.trackingNumber) && (
                <div className="mb-2 border-b pb-2 text-center">
                  <span className="text-sm font-bold">{label.carrierName}</span>
                  {label.trackingNumber && (
                    <p className="font-mono text-lg font-bold tracking-wider">
                      {label.trackingNumber}
                    </p>
                  )}
                </div>
              )}

              {/* Recipient */}
              <div className="mb-3">
                <p className="text-xs text-gray-500">수령인</p>
                <p className="text-lg font-bold">{label.recipientName}</p>
                {label.recipientPhone && (
                  <p className="text-sm">{label.recipientPhone}</p>
                )}
              </div>

              {/* Address */}
              <div className="mb-3">
                <p className="text-xs text-gray-500">배송지</p>
                <p className="text-sm">
                  [{label.zipCode}] {label.address1}
                  {label.address2 && ` ${label.address2}`}
                </p>
              </div>

              {/* Product */}
              <div className="mb-2">
                <p className="text-xs text-gray-500">상품</p>
                <p className="text-sm">{label.productSummary}</p>
              </div>

              {/* Order ID */}
              <div className="border-t pt-2 text-xs text-gray-400">
                주문번호: {label.marketplaceOrderId}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

function PrintButton() {
  return <PrintButtonClient />
}
