'use client'

import { useActionState, useEffect, useRef } from 'react'
import { createDevLogEntry } from './actions'
import { DEV_LOG_AUTHORS } from '@/lib/db/schema'

function todayKst(): string {
  // YYYY-MM-DD in KST. Date input은 timezone naive 이라 toISOString 대신 직접 포맷.
  const now = new Date()
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  return kst.toISOString().slice(0, 10)
}

export function DevLogForm() {
  const [state, formAction, pending] = useActionState(createDevLogEntry, null)
  const formRef = useRef<HTMLFormElement>(null)
  const contentRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (state?.success) {
      // 내용만 비우고 작성자/날짜는 유지 — 같은 사람이 연속 작성하기 편하도록.
      if (contentRef.current) contentRef.current.value = ''
    }
  }, [state])

  return (
    <form
      ref={formRef}
      action={formAction}
      className="flex flex-col gap-3 rounded-lg border bg-card p-4"
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="dl-author" className="text-xs font-medium text-muted-foreground">
            작성자
          </label>
          <select
            id="dl-author"
            name="author"
            defaultValue="상철"
            required
            className="rounded-md border px-3 py-1.5 text-sm"
          >
            {DEV_LOG_AUTHORS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="dl-date" className="text-xs font-medium text-muted-foreground">
            날짜
          </label>
          <input
            id="dl-date"
            name="logDate"
            type="date"
            defaultValue={todayKst()}
            required
            className="rounded-md border px-3 py-1.5 text-sm"
          />
        </div>
        <div className="ml-auto flex items-center gap-2">
          {state?.error && (
            <span className="text-xs text-red-600">{state.error}</span>
          )}
          {state?.success && !pending && (
            <span className="text-xs text-green-600">저장됨</span>
          )}
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {pending ? '등록 중...' : '등록'}
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="dl-content" className="text-xs font-medium text-muted-foreground">
          내용
        </label>
        <textarea
          id="dl-content"
          name="content"
          ref={contentRef}
          required
          rows={4}
          placeholder="오늘 작업한 내용을 입력하세요. (여러 줄 가능)"
          className="w-full resize-y rounded-md border px-3 py-2 text-sm"
        />
      </div>
    </form>
  )
}
