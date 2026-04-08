'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const tabs = [
  { href: '/shipping/invoice',  label: '운송장 관리' },
  { href: '/shipping/scan',     label: '🔍 스캔 출고' },
  { href: '/shipping/combined', label: '합포장 관리' },
  { href: '/shipping/held',     label: '미발송 관리' },
  { href: '/shipping/print',    label: '송장 출력' },
  { href: '/shipping/templates', label: '템플릿' },
]

export default function ShippingLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <div>
      <div className="border-b">
        <nav className="-mb-px flex gap-1 px-1">
          {tabs.map((tab) => {
            const isActive = pathname.startsWith(tab.href)
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
                  isActive
                    ? 'border-black text-black'
                    : 'border-transparent text-muted-foreground hover:border-gray-300 hover:text-foreground'
                }`}
              >
                {tab.label}
              </Link>
            )
          })}
        </nav>
      </div>
      <div className="pt-6">{children}</div>
    </div>
  )
}
