'use client'
import { useEffect, useState } from 'react'
import { PublishInboundDialog } from './publish-inbound-dialog'

export function KoreaShippingDocumentPanel({ shipmentId, group, onGroupChange, onPublished }: { shipmentId: string; group: 'pallet' | 'box'; onGroupChange: (group: 'pallet' | 'box') => void; onPublished?: (id: string) => void }) {
  const [publishing, setPublishing] = useState(false)
  const [revision, setRevision] = useState(0)
  const [html, setHtml] = useState('')
  const [error, setError] = useState('')
  const url = `/api/purchasing/china-shipments/${encodeURIComponent(shipmentId)}/import-documents?document=korea&group=${group}&layout=dimensions-v2`
  useEffect(() => {
    const controller = new AbortController()
    setHtml(''); setError('')
    void fetch(`${url}&format=preview&refresh=${revision}`, { signal: controller.signal, cache: 'no-store' }).then(async (response) => {
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || '출고서류를 불러오지 못했습니다.')
      if (!controller.signal.aborted) setHtml(result.html)
    }).catch((cause) => { if (!controller.signal.aborted) setError(cause.message) })
    return () => controller.abort()
  }, [url, revision])
  return <section className="space-y-3 rounded-lg border bg-background p-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-4"><h2 className="font-semibold">한국 출고서류</h2>{(['pallet', 'box'] as const).map((value) => <label key={value} className="flex items-center gap-2 text-sm"><input type="radio" name="korea-group" checked={value === group} onChange={() => onGroupChange(value)} />{value === 'pallet' ? '파레트 기준' : '박스 기준'}</label>)}</div><div className="flex flex-wrap gap-2">{onPublished && <button type="button" onClick={() => setPublishing(true)} className="rounded bg-primary px-3 py-2 text-sm text-primary-foreground">입고리스트 게시</button>}<button type="button" onClick={() => setRevision((value) => value + 1)} className="rounded border px-3 py-2 text-sm">미리보기 새로고침</button><a href={url} className="rounded bg-primary px-3 py-2 text-sm text-primary-foreground">한국 출고서류 엑셀 다운로드</a></div></div>
    {publishing && onPublished && <PublishInboundDialog shipmentId={shipmentId} onPublished={onPublished} onClose={() => setPublishing(false)} />}
    <p className="text-xs text-muted-foreground">출고 재고 위치를 기준으로 창고·쿠팡·대량 수량을 구분합니다. 엑셀에는 파레트별·박스별 시트가 함께 들어갑니다.</p>
    {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : !html ? <p role="status">출고서류 불러오는 중…</p> : <div className="max-h-[72vh] overflow-auto rounded border bg-slate-100 p-4 text-black"><div style={{ zoom: 0.8 }} dangerouslySetInnerHTML={{ __html: html.slice(html.indexOf('<table'), html.lastIndexOf('</table>') + 8) }} /></div>}
  </section>
}
