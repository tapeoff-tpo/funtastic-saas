import { Suspense } from 'react'
import { InboundBoardWorkspace } from './inbound-board-panel'

export const metadata = { title: '입고리스트 게시판' }

export default function InboundBoardPage() {
  return <div className="min-w-0 space-y-4">
    <h1 className="text-2xl font-semibold">입고리스트 게시판</h1>
    <Suspense fallback={<p role="status">입고리스트 불러오는 중…</p>}>
      <InboundBoardWorkspace />
    </Suspense>
  </div>
}
