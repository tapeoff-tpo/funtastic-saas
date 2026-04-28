import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '설정',
}

export default function SettingsPage() {
  return (
    <div className="space-y-2">
      <h1 className="text-xl font-bold">설정</h1>
      <p className="text-sm text-muted-foreground">준비 중입니다.</p>
    </div>
  )
}
