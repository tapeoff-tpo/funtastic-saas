'use client'
import { useRef, useState } from 'react'

type Result = { sourceId: string; fileName: string; status: 'saved' | 'existing' | 'unmatched' }
export function WorksQualityImportButton() {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<Result[]>([])
  const [error, setError] = useState('')
  async function upload(files: FileList | null) {
    if (!files?.length || busy) return
    setBusy(true); setError(''); setResults([])
    try {
      for (const file of Array.from(files)) {
        const body = new FormData(); body.append('file', file)
        const response = await fetch('/api/new-products/works-quality-files', { method: 'POST', body })
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || '품질표시 저장 실패')
        setResults((previous) => [...previous, ...result.results])
        window.dispatchEvent(new Event('new-product-attachments-imported'))
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : '품질표시 저장 실패') }
    finally { setBusy(false); if (input.current) input.current.value = '' }
  }
  return <div>
    <button className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50" disabled={busy} onClick={() => input.current?.click()}>{busy ? '품질표시 저장 중…' : 'WORKS 품질표시 PDF 가져오기'}</button>
    <input ref={input} type="file" accept=".zip,application/zip" multiple hidden onChange={(event) => void upload(event.target.files)} />
    {(busy || results.length > 0 || error) && <div role="status" className="mt-2 rounded-md border bg-muted/30 p-3 text-sm"><p>저장 {results.filter((row) => row.status === 'saved').length} · 기존 파일 {results.filter((row) => row.status === 'existing').length} · 매칭 없음 {results.filter((row) => row.status === 'unmatched').length}</p><p className="mt-1 text-xs text-muted-foreground">WORKS 원본 ID로 상품별 저장합니다. 동일 파일은 중복 추가하지 않습니다.</p>{error && <p role="alert" className="mt-1 text-red-700">{error}</p>}</div>}
  </div>
}
