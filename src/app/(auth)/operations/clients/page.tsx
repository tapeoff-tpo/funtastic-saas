import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getCurrentUser } from '@/lib/auth/current-user'
import { assertMenuAccess } from '@/lib/auth/menu-access'
import { listQuoteClients } from '@/lib/quotes/store'
import ClientDirectoryPage from './client-directory'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: '거래처 정보' }

export default async function ClientsPage() {
  await assertMenuAccess('/operations/clients')
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  const workspaceUserId = await getWorkspaceUserId(user.id)
  const clients = await listQuoteClients(workspaceUserId)
  return <ClientDirectoryPage initialClients={clients} />
}
