'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const tabs = [
  { href: '/products', label: '상품 목록', exact: true },
  { href: '/products/mappings', label: '상품명 매핑', exact: false },
  { href: '/products/categories', label: '카테고리', exact: false },
]

export default function ProductsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()

  return (
    <div>
      {/* Tab Navigation */}
      <div className="border-b">
        <nav className="-mb-px flex gap-1 px-1">
          {tabs.map((tab) => {
            const isActive = tab.exact
              ? pathname === tab.href
              : pathname.startsWith(tab.href)
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
