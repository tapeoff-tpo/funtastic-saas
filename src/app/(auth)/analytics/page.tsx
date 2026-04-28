import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '매출분석',
}

export default function AnalyticsPage() {
  return (
    <div className="space-y-2">
      <h1 className="text-xl font-bold">매출분석</h1>
      <p className="text-sm text-muted-foreground">준비 중입니다.</p>
    </div>
  )
}
