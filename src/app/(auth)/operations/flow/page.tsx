import Link from 'next/link'
import type { Metadata } from 'next'
import { and, eq, inArray, lte, sql } from 'drizzle-orm'
import {
  ArrowRight,
  BarChart3,
  Boxes,
  ClipboardCheck,
  FileSpreadsheet,
  ImageIcon,
  PackageCheck,
  PackagePlus,
  ScanLine,
  ShoppingCart,
  Truck,
  Warehouse,
} from 'lucide-react'
import { db } from '@/lib/db'
import {
  detailPageJobs,
  inventory,
  orders,
  purchaseRequestItems,
  shipments,
  sourcingItems,
} from '@/lib/db/schema'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { ProductFlowNav } from '@/components/product-flow-nav'
import { ensureSourcingTables } from '@/lib/operations/sourcing'

export const metadata: Metadata = { title: '운영 플로우' }
export const dynamic = 'force-dynamic'

type FlowStage = {
  title: string
  description: string
  href: string
  action: string
  count?: number
  countLabel?: string
  tone: 'blue' | 'orange' | 'green' | 'slate'
  icon: typeof ShoppingCart
}

export default async function OperationsFlowPage() {
  const user = await getCurrentUser()
  if (!user) return null

  const workspaceUserId = await getWorkspaceUserId(user.id)
  await ensureSourcingTables()

  const [
    newOrders,
    shippingOrders,
    invoicePending,
    lowStock,
    purchaseReview,
    activePurchase,
    sourcingSelected,
    detailPending,
  ] = await Promise.all([
    countRows(orders, and(eq(orders.userId, workspaceUserId), eq(orders.status, 'new'))),
    countRows(orders, and(eq(orders.userId, workspaceUserId), inArray(orders.status, ['preparing', 'ready']))),
    countRows(shipments, and(eq(shipments.userId, workspaceUserId), inArray(shipments.uploadStatus, ['pending', 'failed']))),
    countRows(inventory, and(eq(inventory.userId, workspaceUserId), lte(inventory.availableStock, 0))),
    countRows(purchaseRequestItems, and(eq(purchaseRequestItems.userId, workspaceUserId), eq(purchaseRequestItems.status, 'requested'))),
    countRows(purchaseRequestItems, and(eq(purchaseRequestItems.userId, workspaceUserId), inArray(purchaseRequestItems.status, ['purchased', 'purchase_completed', 'china_arrived', 'outbound_requested']))),
    countRows(sourcingItems, and(eq(sourcingItems.userId, workspaceUserId), eq(sourcingItems.status, 'selected'))),
    countRows(detailPageJobs, and(eq(detailPageJobs.userId, workspaceUserId), inArray(detailPageJobs.status, ['agent_pending', 'agent_creating', 'agent_qa_pending', 'review', 'needs_info']))),
  ])

  const orderStages: FlowStage[] = [
    {
      title: '1. 사방넷 주문 업로드',
      description: '사방넷에서 내려받은 주문 엑셀을 업로드합니다. 기존 주문번호는 중복 생성하지 않습니다.',
      href: '/orders/import',
      action: '주문 엑셀 업로드',
      tone: 'blue',
      icon: FileSpreadsheet,
    },
    {
      title: '2. 주문 확인·매핑',
      description: '신규 주문의 상품 매핑을 확인한 뒤 출고 단계로 넘깁니다.',
      href: '/orders?status=new',
      action: '신규 주문 보기',
      count: newOrders,
      countLabel: '확인 대기',
      tone: 'orange',
      icon: ClipboardCheck,
    },
    {
      title: '3. 출고·송장 전송',
      description: '송장을 등록하고 바코드를 스캔해 출고 처리합니다. 출고 완료 시 재고 이력에 반영됩니다.',
      href: invoicePending > 0 ? '/shipping/invoice' : '/shipping/scan',
      action: invoicePending > 0 ? '송장 전송 확인' : '출고 작업 열기',
      count: invoicePending > 0 ? invoicePending : shippingOrders,
      countLabel: invoicePending > 0 ? '송장 전송 대기' : '출고 대기',
      tone: invoicePending > 0 ? 'orange' : 'green',
      icon: Truck,
    },
  ]

  const supplyStages: FlowStage[] = [
    {
      title: '4. 재고 확인',
      description: '사방넷 재고 엑셀을 기준으로 위치와 가용재고를 갱신하고, 출고 후 수량을 확인합니다.',
      href: '/inventory?searched=1',
      action: '재고관리 열기',
      count: lowStock,
      countLabel: '0개 재고 품목',
      tone: lowStock > 0 ? 'orange' : 'green',
      icon: Warehouse,
    },
    {
      title: '5. 자동발주 검토',
      description: '재고와 최근 출고량을 기준으로 추천 발주를 만들고 수량·담당자를 확정합니다.',
      href: '/purchasing/purchases',
      action: '발주검토 열기',
      count: purchaseReview,
      countLabel: '검토 대기',
      tone: purchaseReview > 0 ? 'orange' : 'blue',
      icon: PackagePlus,
    },
    {
      title: '6. 발주·중국창고·한국입고',
      description: '발주요청부터 구매완료, 중국창고도착, 출고신청, 한국 입고까지 한 흐름으로 관리합니다.',
      href: '/purchasing/orders',
      action: '발주 흐름 보기',
      count: activePurchase,
      countLabel: '진행 중',
      tone: 'blue',
      icon: Boxes,
    },
  ]

  const productStages: FlowStage[] = [
    {
      title: '7. 신상품 품목화',
      description: '소싱 확정 상품을 품목으로 만들고 원가·옵션·이미지·고시 정보를 채웁니다.',
      href: '/operations/sourcing',
      action: '소싱 확정 보기',
      count: sourcingSelected,
      countLabel: '품목 등록 대기',
      tone: sourcingSelected > 0 ? 'orange' : 'slate',
      icon: PackageCheck,
    },
    {
      title: '8. 상세페이지 제작',
      description: '품목 데이터와 이미지로 상세페이지 초안을 만들고 검수합니다.',
      href: '/operations/detail-pages',
      action: '상세페이지 작업 보기',
      count: detailPending,
      countLabel: '제작·검수 대기',
      tone: detailPending > 0 ? 'orange' : 'slate',
      icon: ImageIcon,
    },
    {
      title: '9. 채널 상품등록',
      description: '판매가, 재고, 카테고리, 이미지와 고시를 확인한 뒤 에이전트로 채널 등록을 진행합니다.',
      href: '/operations/marketplace-registration',
      action: '상품등록 관리 열기',
      tone: 'blue',
      icon: ScanLine,
    },
  ]

  return (
    <div className="space-y-5">
      <ProductFlowNav />
      <header className="flex flex-col gap-2 border-b pb-4">
        <h1 className="text-2xl font-semibold">운영 플로우</h1>
        <p className="text-sm text-muted-foreground">
          사방넷 주문 엑셀을 시작점으로 출고, 재고, 발주, 입고, 신상품 등록과 매출분석까지 이어서 관리합니다.
        </p>
      </header>

      <FlowGroup title="매일 처리" description="사방넷 주문을 올리고, 매핑·송장·출고까지 처리합니다." stages={orderStages} />
      <FlowGroup title="재고와 발주" description="출고 후 재고를 확인하고 부족분만 발주해 중국창고와 한국입고까지 추적합니다." stages={supplyStages} />
      <FlowGroup title="신상품 등록" description="신상품 데이터를 완성한 뒤 상세페이지와 채널 등록으로 연결합니다." stages={productStages} />

      <section className="flex flex-col gap-3 border-t pt-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold">10. 매출·정산 분석</h2>
          <p className="mt-1 text-sm text-muted-foreground">주문, 배송비, 수수료와 판매대금 정산일을 기준으로 결과를 확인합니다.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <FlowLink href="/analytics" label="매출분석" icon={BarChart3} />
          <FlowLink href="/analytics/settlements" label="정산 캘린더" icon={ShoppingCart} />
          <FlowLink href="/analytics/price-table" label="판매가 테이블" icon={FileSpreadsheet} />
        </div>
      </section>
    </div>
  )
}

async function countRows(table: typeof orders | typeof shipments | typeof inventory | typeof purchaseRequestItems | typeof sourcingItems | typeof detailPageJobs, where: Parameters<typeof db.select>[0] extends never ? never : unknown) {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(table)
    .where(where as never)
  return row?.count ?? 0
}

function FlowGroup({ title, description, stages }: { title: string; description: string; stages: FlowStage[] }) {
  return (
    <section>
      <div className="mb-3">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="grid gap-3 xl:grid-cols-3">
        {stages.map((stage, index) => (
          <div key={stage.title} className="relative border bg-background p-4">
            {index < stages.length - 1 ? <ArrowRight className="absolute -right-5 top-1/2 z-10 hidden h-4 w-4 -translate-y-1/2 bg-background text-muted-foreground xl:block" /> : null}
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold">{stage.title}</h3>
                <p className="mt-2 text-sm leading-5 text-muted-foreground">{stage.description}</p>
              </div>
              <StageIcon icon={stage.icon} tone={stage.tone} />
            </div>
            <div className="mt-4 flex items-center justify-between gap-3 border-t pt-3">
              {stage.count !== undefined ? <span className={`text-xs font-medium ${stage.tone === 'orange' ? 'text-orange-700' : 'text-muted-foreground'}`}>{stage.count.toLocaleString('ko-KR')}건 {stage.countLabel}</span> : <span className="text-xs text-muted-foreground">운영 도구</span>}
              <Link href={stage.href} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                {stage.action}<ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function FlowLink({ href, label, icon: Icon }: { href: string; label: string; icon: typeof BarChart3 }) {
  return (
    <Link href={href} className="inline-flex h-8 items-center gap-1.5 border px-2.5 text-sm font-medium hover:bg-muted">
      <Icon className="h-3.5 w-3.5" />
      {label}
    </Link>
  )
}

function StageIcon({ icon: Icon, tone }: { icon: typeof ShoppingCart; tone: FlowStage['tone'] }) {
  const className = {
    blue: 'bg-blue-50 text-blue-700',
    orange: 'bg-orange-50 text-orange-700',
    green: 'bg-emerald-50 text-emerald-700',
    slate: 'bg-muted text-muted-foreground',
  }[tone]
  return <span className={`flex size-8 shrink-0 items-center justify-center ${className}`}><Icon className="h-4 w-4" /></span>
}
