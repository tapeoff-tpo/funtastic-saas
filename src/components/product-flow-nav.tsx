'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const STAGES = [
  { href: '/operations/sourcing', label: '소싱' },
  { href: '/costs', label: '품목' },
  { href: '/purchasing/purchases', label: '발주검토' },
  { href: '/purchasing/orders', label: '발주' },
  { href: '/purchasing/china-inventory', label: '중국재고' },
  { href: '/inventory', label: '재고관리' },
  { href: '/analytics/price-table', label: '판매가' },
  { href: '/operations/marketplace-registration', label: '상품등록' },
]

export function ProductFlowNav() {
  const pathname = usePathname()

  return (
    <nav aria-label="상품 운영 흐름" className="overflow-x-auto border-y bg-muted/20">
      <div className="flex min-w-max items-center px-1 py-1">
        {STAGES.map((stage, index) => (
          <div key={stage.href} className="flex items-center">
            {index > 0 ? <span className="px-1 text-xs text-muted-foreground">›</span> : null}
            <Link
              href={stage.href}
              className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
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
