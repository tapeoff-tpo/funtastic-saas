/**
 * Layout wrapper for shipping sub-pages.
 * Provides breadcrumb navigation back to orders.
 */

export default function ShippingLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-muted-foreground">
        <a href="/orders" className="hover:text-foreground hover:underline">
          주문 관리
        </a>
        <span>/</span>
        <span className="text-foreground">배송 관리</span>
      </nav>

      {children}
    </div>
  )
}
