'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

type Result = { id: string; productName: string; status: 'saved' | 'existing' | 'unmatched' | 'failed'; images?: number }

export function CatalogueImageSyncButton() {
  const router = useRouter()
  const running = useRef(false)
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<Result[]>([])
  const [error, setError] = useState('')
  const [opened, setOpened] = useState(false)
  useEffect(() => () => { running.current = false }, [])
  async function start() {
    if (running.current) return
    running.current = true; setBusy(true); setResults([]); setError(''); setOpened(true)
    let after: string | null = null
    try {
      do {
        const response: Response = await fetch('/api/new-products/catalogue-images', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(after ? { after } : {}) })
        const body: { results: Result[]; nextCursor: string | null; error?: string } = await response.json()
        if (!response.ok) throw new Error(body.error || '상품 이미지를 저장하지 못했습니다.')
        setResults((current) => [...current, ...body.results])
        after = body.nextCursor
      } while (after && running.current)
      router.refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '상품 이미지를 저장하지 못했습니다.') }
    finally { running.current = false; setBusy(false) }
  }
  return <div data-purchasing-translate>
    <button type="button" onClick={() => void start()} disabled={busy} className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50">{busy ? 'B2B 이미지 저장 중…' : 'B2B 이미지 일괄 저장'}</button>
    {opened && <div role="status" className="mt-2 max-w-xl rounded-md border bg-muted/30 p-3 text-sm">
      <p>이미지가 없는 상품의 제품 이미지만 저장합니다. 기존 첨부파일은 유지됩니다.</p>
      <p className="mt-1">저장 {results.filter((row) => row.status === 'saved').length} · 매칭 없음 {results.filter((row) => row.status === 'unmatched').length} · 오류 {results.filter((row) => row.status === 'failed').length}</p>
      {busy ? <button type="button" onClick={() => { running.current = false }} className="mt-2 rounded border px-2 py-1">현재 묶음 저장 후 중지</button> : <span className="mt-1 block">처리가 끝났습니다. 다시 실행해도 저장된 이미지는 중복 추가하지 않습니다.</span>}
      {error && <p role="alert" className="mt-1 text-red-700">{error}</p>}
      {!busy && results.some((row) => row.status === 'unmatched' || row.status === 'failed') && <details className="mt-2"><summary className="cursor-pointer">미처리 상품 보기</summary><ul className="max-h-48 overflow-auto">{results.filter((row) => row.status === 'unmatched' || row.status === 'failed').map((row) => <li key={row.id}><span data-no-translate>{row.productName}</span> · {row.status === 'unmatched' ? '매칭 없음' : '오류'}</li>)}</ul></details>}
    </div>}
  </div>
}
