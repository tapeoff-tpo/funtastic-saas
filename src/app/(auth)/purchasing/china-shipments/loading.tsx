import { Loader2 } from 'lucide-react'

export default function Loading() {
  return <div role="status" aria-live="polite" data-purchasing-translate className="space-y-4">
    <p className="flex items-center gap-2 text-sm"><Loader2 className="size-4 animate-spin" />출고요청 불러오는 중</p>
    <div aria-hidden="true" className="h-20 animate-pulse rounded-lg bg-muted" />
    <div aria-hidden="true" className="h-64 animate-pulse rounded-lg bg-muted" />
  </div>
}
