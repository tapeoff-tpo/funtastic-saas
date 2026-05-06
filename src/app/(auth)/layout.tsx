import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { AppShell } from '@/components/layout/app-shell'
import { getProfile } from '@/lib/admin-accounts/queries'
import { getCurrentUser } from '@/lib/auth/current-user'

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
  const profile = await getProfile(user.id)
  if (profile?.deactivatedAt) {
    const supabase = await createClient()
    await supabase.auth.signOut()
    redirect('/login?reason=deactivated')
  }

  return <AppShell>{children}</AppShell>
}
