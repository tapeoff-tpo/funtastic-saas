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
        <p className="mt-1 text-sm text-muted-foreground">Figma 플러그인에서 수집한 델토와 헬리겔 초안을 비교해 최종본에 쓸 섹션을 고릅니다.</p>
      </header>
      <DetailPageComparison />
    </div>
  )
}
