'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const RELATED_WORK = [
  { href: '/costs', label: '품목' },
  { href: '/inventory', label: '재고' },
  { href: '/purchasing/purchases', label: '발주검토' },
  { href: '/purchasing/orders', label: '발주·입고' },
  { href: '/purchasing/payment-flow', label: '발주금액' },
  { href: '/purchasing/raw-data', label: '발주 로우데이터' },
  { href: '/purchasing/saas-china-inventory', label: '중국재고(SaaS)' },
  { href: '/purchasing/china-shipments', label: '중국출고' },
  { href: '/analytics/price-table', label: '판매가' },
  { href: '/operations/marketplace-registration', label: '상품등록' },
]

export function ProductFlowNav() {
  const pathname = usePathname()

  return (
    <nav
      aria-label="관련 작업"
      className="overflow-x-auto overscroll-x-contain border-y bg-muted/20 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <div className="flex w-max items-center gap-1 px-2 py-1.5 sm:min-w-max">
        <span className="mr-1 hidden text-xs text-muted-foreground sm:inline">관련 작업</span>
        {RELATED_WORK.map((stage) => (
          <div key={stage.href}>
            <Link
              href={stage.href}
              className={`block shrink-0 whitespace-nowrap rounded px-2 py-1 text-xs font-medium transition-colors ${
                pathname === stage.href ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              {stage.label}
            </Link>
          </div>
        ))}
      </div>
    </nav>
  )
}
