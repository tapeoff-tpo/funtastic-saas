'use client'

import { useEffect, useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

type SectionPreview = {
  id: string
  name: string
  type: string
  width: number
  height: number
  preview: string | null
}

type FramePreview = {
  id: string
  name: string
  pageName: string
  width: number
  height: number
  preview: string | null
  sections: SectionPreview[]
}

type Capture = {
  status: string
  errorMessage: string | null
  updatedAt: string
  result: { capturedAt?: string; frames?: FramePreview[] }
}

function productGroup(name: string) {
  if (name.includes('델토')) return '델토'
  if (name.includes('헬리겔')) return '헬리겔'
  return '기타'
}

export function DetailPageComparison() {
  const [capture, setCapture] = useState<Capture | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/operations/detail-pages/comparison', { cache: 'no-store' })
      const payload = await response.json().catch(() => ({})) as { captures?: Capture[]; error?: string }
      if (!response.ok) throw new Error(payload.error || '비교 자료를 불러오지 못했습니다.')
      setCapture(payload.captures?.[0] ?? null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '비교 자료를 불러오지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const groups = useMemo(() => {
    const frames = capture?.result.frames ?? []
    return ['델토', '헬리겔'].map((name) => ({
      name,
      frames: frames.filter((frame) => productGroup(frame.name) === name),
    })).filter((group) => group.frames.length > 0)
  }, [capture])

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3">
        <div className="text-sm text-muted-foreground">
          {capture?.result.capturedAt ? `최근 수집: ${new Date(capture.result.capturedAt).toLocaleString('ko-KR')}` : 'Figma 플러그인에서 초안 비교 수집을 실행하면 여기에 표시됩니다.'}
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={loading ? 'animate-spin' : ''} /> 새로고침
        </Button>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {!loading && capture?.status === 'failed' ? <p className="text-sm text-destructive">수집 실패: {capture.errorMessage || '알 수 없는 오류'}</p> : null}
      {!loading && !groups.length && !error ? <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">비교 수집 결과가 아직 없습니다.</p> : null}
      {groups.map((group) => (
        <section key={group.name} className="space-y-3">
          <h2 className="text-base font-bold">{group.name} 초안 {group.frames.length}개</h2>
          <div className="grid gap-4 xl:grid-cols-2">
            {group.frames.map((frame) => (
              <article key={frame.id} className="overflow-hidden rounded-lg border bg-card">
                <div className="border-b px-4 py-3">
                  <h3 className="font-semibold">{frame.name}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">{frame.pageName} · {frame.width} x {frame.height}px · 섹션 {frame.sections.length}개</p>
                </div>
                <div className="grid grid-cols-[116px_1fr] gap-3 p-3">
                  <div className="overflow-hidden rounded border bg-muted/30">
                    {frame.preview ? <img src={frame.preview} alt={`${frame.name} 전체 미리보기`} className="h-auto w-full" /> : <p className="p-3 text-xs text-muted-foreground">전체 미리보기 없음</p>}
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {frame.sections.map((section) => (
                      <div key={section.id} className="overflow-hidden rounded border bg-muted/20">
                        {section.preview ? <img src={section.preview} alt={section.name} className="h-auto w-full" /> : null}
                        <p className="line-clamp-2 px-2 py-1 text-[11px] leading-4">{section.name}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}
    </section>
  )
}
