import { createClient } from '@/lib/supabase/server'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '대시보드',
}

export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return null
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">대시보드</h1>
      <div className="rounded-lg border border-dashed border-gray-300 p-12 text-center">
        <p className="text-sm text-muted-foreground">준비 중입니다.</p>
      </div>
    </div>
  )
}
