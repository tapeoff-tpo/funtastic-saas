import { listDevLogEntries } from './actions'
import { DevLogForm } from './dev-log-form'
import { DeleteEntryButton } from './delete-button'
import type { DevLogAuthor } from '@/lib/db/schema'

export const dynamic = 'force-dynamic'

const AUTHOR_BADGE: Record<DevLogAuthor, string> = {
  상철: 'bg-blue-100 text-blue-700 ring-blue-200',
  기환: 'bg-emerald-100 text-emerald-700 ring-emerald-200',
  지은: 'bg-purple-100 text-purple-700 ring-purple-200',
}

function formatDateLabel(d: string): string {
  // d = 'YYYY-MM-DD'
  const [y, m, day] = d.split('-').map(Number)
  const date = new Date(y, (m ?? 1) - 1, day ?? 1)
  const weekday = ['일', '월', '화', '수', '목', '금', '토'][date.getDay()]
  return `${y}년 ${m}월 ${day}일 (${weekday})`
}

function formatTime(ts: Date): string {
  const kst = new Date(ts.getTime() + 9 * 60 * 60 * 1000)
  return kst.toISOString().slice(11, 16)
}

export default async function DevLogPage() {
  const entries = await listDevLogEntries()

  // 날짜별 그룹화 (logDate 기준, 이미 DESC 정렬되어 있음)
  const grouped = new Map<string, typeof entries>()
  for (const e of entries) {
    const key = e.logDate
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key)!.push(e)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">개발로그</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          상철 · 기환 · 지은 — 날짜별 작업 기록
        </p>
      </div>

      <DevLogForm />

      <div className="space-y-6">
        {entries.length === 0 ? (
          <p className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
            아직 등록된 개발로그가 없습니다. 위 양식에서 첫 기록을 남겨보세요.
          </p>
        ) : (
          Array.from(grouped.entries()).map(([logDate, items]) => (
            <section key={logDate} className="space-y-2">
              <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background py-2">
                <h2 className="text-base font-semibold">{formatDateLabel(logDate)}</h2>
                <span className="text-xs text-muted-foreground">
                  · 기록 {items.length}건
                </span>
              </div>
              <ul className="space-y-2">
                {items.map((e) => (
                  <li
                    key={e.id}
                    className="flex gap-3 rounded-lg border bg-card p-3"
                  >
                    <div className="shrink-0">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${
                          AUTHOR_BADGE[e.author as DevLogAuthor] ??
                          'bg-gray-100 text-gray-700 ring-gray-200'
                        }`}
                      >
                        {e.author}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">
                        {e.content}
                      </pre>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1 text-right">
                      <span className="text-xs text-muted-foreground">
                        {formatTime(e.createdAt)}
                      </span>
                      <DeleteEntryButton id={e.id} />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  )
}
