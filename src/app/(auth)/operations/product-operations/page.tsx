import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getUserMenuAccess } from '@/lib/auth/menu-access'
import { canUseMenu } from '@/lib/auth/menu-permissions'
import { PRODUCT_OPERATIONS_TABS } from '@/lib/operations/product-operations'

export default async function ProductOperationsPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  const access = await getUserMenuAccess(user.id)
  if (!access) redirect('/access-denied')
  const params = await searchParams
  const available = PRODUCT_OPERATIONS_TABS.filter((tab) => tab.menus.some((menu) => canUseMenu(access, menu)))
  const tab = available.find((candidate) => candidate.id === params.tab) ?? available[0]
  if (!tab) redirect('/access-denied')
  const destination = tab.menus[0]
  const query = new URLSearchParams()
  const sku = typeof params.sku === 'string' ? params.sku.trim() : ''
  if (sku) {
    if (destination === '/inventory' || destination === '/costs') query.set('search', sku)
    else if (destination === '/operations/detail-pages') query.set('sku', sku)
    else query.set('q', sku)
    if (destination === '/inventory') query.set('searched', '1')
  }
  redirect(query.size ? `${destination}?${query}` : destination)
}
