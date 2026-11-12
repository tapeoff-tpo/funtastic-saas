import { redirect } from 'next/navigation'
import { createClient } from '@/lib/auth/server'
import { AppShell } from '@/components/layout/app-shell'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getUserAuthorization } from '@/lib/auth/menu-access'

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await getCurrentUser()

  if (!user) {
    redirect('/login')
  }

  // Block deactivated accounts (defense-in-depth alongside Supabase ban)
  const authorization = await getUserAuthorization(user.id)
  if (authorization?.deactivatedAt) {
    const supabase = await createClient()
    await supabase.auth.signOut()
    redirect('/login?reason=deactivated')
  }

  if (user.mustChangePassword) {
    redirect('/change-password')
  }

  if (!authorization?.access) redirect('/login')
  return <AppShell menuAccess={authorization.access}>{children}</AppShell>
}
