import { redirect } from 'next/navigation'
import { PanelsTopLeft } from 'lucide-react'
import { getCurrentUser } from '@/lib/auth/current-user'
import { DetailPageComparison } from './detail-page-comparison'

export const dynamic = 'force-dynamic'

export default async function DetailPageComparisonPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  return (
    <div className="space-y-4">
      <header>
        <h1 className="flex items-center gap-2 text-xl font-bold"><PanelsTopLeft className="size-5" /> 상세페이지 초안 비교</h1>
      </header>
      <DetailPageComparison />
    </div>
  )
}
