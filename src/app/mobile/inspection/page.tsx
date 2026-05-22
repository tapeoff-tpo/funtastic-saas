import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { getCurrentUser } from '@/lib/auth/current-user'
import { MobileInspectionClient } from './mobile-inspection-client'

export const metadata: Metadata = {
  title: '모바일 상품검수',
}

export default async function MobileInspectionPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  return <MobileInspectionClient />
}
