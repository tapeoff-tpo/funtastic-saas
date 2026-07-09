import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'AI 계정공유',
}

export default function AiAccountsPage() {
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">AI 계정공유</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          공용 AI 계정의 사용 상태, 사용자, 한도, 초기화 시간을 관리하는 운영 도구입니다.
        </p>
      </header>

      <section className="rounded-md border bg-background p-4">
        <h2 className="text-base font-semibold">준비 중</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          다음 단계에서 계정 10개 등록, 사용 시작/종료, 한도 상태, 대기자, 계정별 로그를 붙일 수 있습니다.
        </p>
      </section>
    </div>
  )
}
